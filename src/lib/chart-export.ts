import { triggerBlobDownload } from '@/lib/http';
import { formatLocalDateKey } from '@/lib/time';

export interface ChartExportLegendItem {
  readonly label: string;
  readonly colorVar: string;
}

interface ExportChartImageOptions {
  readonly container: HTMLElement;
  readonly title: string;
  readonly subtitle?: string;
  readonly filenameBase: string;
  readonly legend?: readonly ChartExportLegendItem[];
  readonly footerNote?: string;
}

const SVG_COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'color'] as const;

/**
 * 利用离屏 1x1 Canvas 将任意现代 CSS 色值（含 Tailwind v4 OKLCH）规范化为标准 rgba(...)，
 * 确保独立 SVG data URL 在 Safari / Chrome / Firefox 及微信保存图片时均不丢失主题配色。
 */
function normalizeCssColorToRgba(cssColor: string, probeCtx: CanvasRenderingContext2D | null): string {
  const trimmed = cssColor.trim();
  if (!trimmed || trimmed === 'none' || trimmed === 'transparent' || trimmed.startsWith('url(')) {
    return trimmed;
  }
  if (!probeCtx) return trimmed;
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = 'rgba(0, 0, 0, 0)';
  probeCtx.fillStyle = trimmed;
  probeCtx.fillRect(0, 0, 1, 1);
  const data = probeCtx.getImageData(0, 0, 1, 1).data;
  const alpha = Math.round((data[3] / 255) * 1000) / 1000;
  return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${alpha})`;
}

/** 递归解析 CSS 自定义属性（var(--token)），支持嵌套变量与 fallback。 */
function resolveCssVarExpression(
  raw: string,
  rootStyle: CSSStyleDeclaration,
  probeCtx: CanvasRenderingContext2D | null,
  depth = 0,
): string {
  if (!raw.includes('var(') || depth > 5) {
    return normalizeCssColorToRgba(raw, probeCtx);
  }
  const replaced = raw.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, varName: string, fallback) => {
    const val = rootStyle.getPropertyValue(varName).trim();
    if (val) return val;
    return typeof fallback === 'string' ? fallback.trim() : '';
  });
  return resolveCssVarExpression(replaced, rootStyle, probeCtx, depth + 1);
}

function resolveThemeColor(
  cssVar: string,
  rootStyle: CSSStyleDeclaration,
  probeCtx: CanvasRenderingContext2D | null,
  fallback: string,
): string {
  const raw = cssVar.startsWith('var(') ? cssVar : `var(${cssVar})`;
  const resolved = resolveCssVarExpression(raw, rootStyle, probeCtx);
  return resolved || fallback;
}

function sanitizeExportFilename(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'babylog-chart'
  );
}

/**
 * 将指定容器内的 Recharts SVG 图表渲染为带标题、宝宝信息、图例与实色背景的高清（2x）PNG 并触发浏览器下载。
 */
export async function exportChartContainerToPng(options: ExportChartImageOptions): Promise<void> {
  const svg =
    options.container.querySelector<SVGSVGElement>('.recharts-wrapper svg.recharts-surface') ??
    options.container.querySelector<SVGSVGElement>('svg.recharts-surface') ??
    options.container.querySelector<SVGSVGElement>('svg');

  if (!svg) {
    throw new Error('当前图表暂无可保存的画面');
  }

  const rect = svg.getBoundingClientRect();
  const svgWidth = Math.max(Math.round(rect.width), 320);
  const svgHeight = Math.max(Math.round(rect.height), 200);

  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
  const rootStyle = window.getComputedStyle(document.documentElement);

  const cardBg = resolveThemeColor('--card', rootStyle, probeCtx, '#ffffff');
  const borderColor = resolveThemeColor('--border', rootStyle, probeCtx, '#e5e7eb');
  const fgColor = resolveThemeColor('--foreground', rootStyle, probeCtx, '#1f2937');
  const mutedFgColor = resolveThemeColor('--muted-foreground', rootStyle, probeCtx, '#6b7280');
  const fontFamily =
    window.getComputedStyle(document.body).fontFamily ||
    '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  // 深拷贝 SVG 并将原 DOM 节点上的计算样式与 CSS 变量显式内联，脱离页面样式表也可精准渲染。
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('width', String(svgWidth));
  cloned.setAttribute('height', String(svgHeight));
  if (!cloned.getAttribute('viewBox')) {
    cloned.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  }

  const origNodes = svg.querySelectorAll('*');
  const cloneNodes = cloned.querySelectorAll('*');
  const count = Math.min(origNodes.length, cloneNodes.length);

  for (let i = 0; i < count; i++) {
    const origEl = origNodes[i];
    const cloneEl = cloneNodes[i];
    const computed = window.getComputedStyle(origEl);

    for (const attr of SVG_COLOR_ATTRS) {
      const rawAttr = cloneEl.getAttribute(attr);
      if (rawAttr?.includes('var(')) {
        cloneEl.setAttribute(attr, resolveCssVarExpression(rawAttr, rootStyle, probeCtx));
      } else if (rawAttr?.includes('oklch(')) {
        cloneEl.setAttribute(attr, normalizeCssColorToRgba(rawAttr, probeCtx));
      }
    }

    const tag = origEl.tagName.toLowerCase();
    if (tag === 'text' || tag === 'tspan') {
      const fill = computed.fill;
      if (fill && fill !== 'none') {
        cloneEl.setAttribute('fill', normalizeCssColorToRgba(fill, probeCtx));
      } else {
        cloneEl.setAttribute('fill', mutedFgColor);
      }
      cloneEl.setAttribute('font-size', computed.fontSize || '12px');
      cloneEl.setAttribute('font-family', fontFamily);
    } else if (tag === 'line' || tag === 'path' || tag === 'rect' || tag === 'circle') {
      // 对依赖 Tailwind 样式覆写（如 Recharts 网格线自带 stroke="#ccc" 被覆盖为 stroke-border/60）的图形元素，
      // 直接以计算描边色覆写非 url(...) 描边，确保亮/暗主题网格线与坐标轴还原一致。
      const rawStroke = cloneEl.getAttribute('stroke');
      if (!rawStroke?.startsWith('url(') && computed.stroke && computed.stroke !== 'none') {
        cloneEl.setAttribute('stroke', normalizeCssColorToRgba(computed.stroke, probeCtx));
      }
      const rawFill = cloneEl.getAttribute('fill');
      if (!rawFill && computed.fill && computed.fill !== 'none') {
        cloneEl.setAttribute('fill', normalizeCssColorToRgba(computed.fill, probeCtx));
      }
    }

    const inlineStyle = cloneEl.getAttribute('style');
    if (inlineStyle && (inlineStyle.includes('var(') || inlineStyle.includes('oklch('))) {
      const cleanedStyle = inlineStyle
        .split(';')
        .map((rule) => {
          const colonIdx = rule.indexOf(':');
          if (colonIdx === -1) return rule;
          const prop = rule.slice(0, colonIdx).trim();
          const val = rule.slice(colonIdx + 1).trim();
          if (val.includes('var(') || val.includes('oklch(')) {
            return `${prop}: ${resolveCssVarExpression(val, rootStyle, probeCtx)}`;
          }
          return rule;
        })
        .join('; ');
      cloneEl.setAttribute('style', cleanedStyle);
    }
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(cloned);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

  const svgImage = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图表画面生成失败，请稍后重试'));
    img.src = svgDataUrl;
  });

  const padX = 24;
  const padTop = 22;
  const padBottom = 20;
  const canvasWidth = Math.max(svgWidth + padX * 2, 420);
  const maxContentWidth = canvasWidth - padX * 2;
  const hasSubtitle = Boolean(options.subtitle);
  const hasLegend = Boolean(options.legend && options.legend.length > 0);

  // 预先按可用宽度折行排版图例条目，防止 390px 窄屏导出 4 项图例时右侧文字被裁切。
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const legendRows: Array<Array<{ label: string; colorVar: string; width: number }>> = [];
  if (hasLegend && options.legend) {
    if (measureCtx) measureCtx.font = `500 12px ${fontFamily}`;
    let currentRow: Array<{ label: string; colorVar: string; width: number }> = [];
    let rowWidth = 0;
    for (const item of options.legend) {
      const textWidth = measureCtx ? measureCtx.measureText(item.label).width : item.label.length * 12;
      const itemWidth = 14 + textWidth + 16;
      if (currentRow.length > 0 && rowWidth + itemWidth > maxContentWidth) {
        legendRows.push(currentRow);
        currentRow = [];
        rowWidth = 0;
      }
      currentRow.push({ ...item, width: itemWidth });
      rowWidth += itemWidth;
    }
    if (currentRow.length > 0) legendRows.push(currentRow);
  }

  const legendLineHeight = 20;
  const headerHeight =
    26 + (hasSubtitle ? 20 : 0) + (legendRows.length > 0 ? 8 + legendRows.length * legendLineHeight : 0) + 12;
  const footerHeight = 24;
  const canvasHeight = padTop + headerHeight + svgHeight + footerHeight + padBottom;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth * scale;
  canvas.height = canvasHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('浏览器暂不支持生成图片');
  }
  ctx.scale(scale, scale);

  // 1. 实色圆角卡片底色（防止透明底在暗色相册/微信转发时变黑）
  ctx.fillStyle = cardBg;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, canvasWidth - 1, canvasHeight - 1);

  // 2. 顶部标题与副标题（宝宝昵称、月龄、统计时间段）
  let cursorY = padTop + 18;
  ctx.fillStyle = fgColor;
  ctx.font = `600 16px ${fontFamily}`;
  ctx.fillText(options.title, padX, cursorY, maxContentWidth);

  if (options.subtitle) {
    cursorY += 20;
    ctx.fillStyle = mutedFgColor;
    ctx.font = `400 12px ${fontFamily}`;
    ctx.fillText(options.subtitle, padX, cursorY, maxContentWidth);
  }

  // 3. 多行折行图例条目
  if (legendRows.length > 0) {
    cursorY += 8;
    ctx.font = `500 12px ${fontFamily}`;
    for (const row of legendRows) {
      cursorY += legendLineHeight;
      let cursorX = padX;
      for (const item of row) {
        const dotColor = resolveThemeColor(item.colorVar, rootStyle, probeCtx, fgColor);
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(cursorX + 4.5, cursorY - 4, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = fgColor;
        ctx.fillText(item.label, cursorX + 14, cursorY);
        cursorX += item.width;
      }
    }
  }

  // 4. 居中绘制 SVG 图表主体
  const chartX = Math.round((canvasWidth - svgWidth) / 2);
  const chartY = padTop + headerHeight;
  ctx.drawImage(svgImage, chartX, chartY, svgWidth, svgHeight);

  // 5. 底部水印与导出日期
  const todayStr = formatLocalDateKey(new Date());
  ctx.fillStyle = mutedFgColor;
  ctx.font = `400 11px ${fontFamily}`;
  const footerText = options.footerNote ? `${options.footerNote} · ${todayStr}` : `BabyLog · 导出于 ${todayStr}`;
  ctx.fillText(footerText, padX, canvasHeight - padBottom + 2, maxContentWidth);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('导出图片失败，请稍后重试'));
    }, 'image/png');
  });

  triggerBlobDownload(blob, `${sanitizeExportFilename(options.filenameBase)}-${todayStr}.png`);
}
