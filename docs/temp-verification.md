# 前端临时验证说明

根据 `AGENTS.md`，纳入 Git 的自动化测试仅限后端 Go 测试；前端纯逻辑（codec、视图模型、列表聚合等）通过系统临时目录（`$TMPDIR`）执行 `in-process` 断言验证，任务结束立即清理。

## 在 `$TMPDIR` 下加载工作区 TS 模块（避免 `ERR_MODULE_NOT_FOUND`）

由于临时脚本位于 Git 工作区之外，Node ESM 无法直接按裸包名 `import 'vite'` 解析工作区 `node_modules`。通过 `pathToFileURL` 指向当前工作区的 Vite 入口并调用 `ssrLoadModule`，即可复用 `@/` 路径别名与 TypeScript 转译：

```bash
TMP_TEST="${TMPDIR:-/tmp}/verify-frontend-$$.mjs"
cat <<'EOF' > "$TMP_TEST"
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { createServer } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/lib/dashboard.ts');
  // 在此编写 assert 断言
  assert.ok(mod);
} finally {
  await server.close();
}
EOF
node "$TMP_TEST"; STATUS=$?; rm -f "$TMP_TEST"; exit $STATUS
```

## 免登录隔离 UI 组件视觉预览（按需用于新页面/大幅排版与配色调整）

仅在**新建完整页面**或**大幅调整布局、留白、字号与主题配色**时按需执行（日常文案修正或局部小改跳过即可）。无需启动 Go 后端或登录：在 `$TMPDIR` 中写入预览入口，并通过 Vite 虚拟模块将其锚定为 `/src/__temp_preview__.tsx`，即可复用工作区 `@/` 别名、Tailwind v4 与 `node_modules`（物理文件全程留在工作区之外）：

```bash
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/babylog-ui-preview.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

cat <<'EOF' > "$TMP_DIR/preview.tsx"
import '@fontsource-variable/geist';
import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 替换为待核验的纯展示组件与 Mock 数据
import { Checkbox } from '@/components/ui/checkbox';

if (new URLSearchParams(window.location.search).get('theme') === 'dark') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <Checkbox checked />
    </div>
  </StrictMode>,
);
EOF

cat <<'EOF' > "$TMP_DIR/serve.mjs"
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmpDir = process.env.TMP_DIR;
const virtualId = path.resolve(process.cwd(), 'src/__temp_preview__.tsx');
const { createServer } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);

const server = await createServer({
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
  plugins: [
    {
      name: 'babylog:temp-preview',
      enforce: 'pre',
      resolveId(id) {
        if (id === '/src/__temp_preview__.tsx' || id === virtualId) return virtualId;
      },
      async load(id) {
        if (id === virtualId) return readFile(path.join(tmpDir, 'preview.tsx'), 'utf8');
      },
      configureServer(srv) {
        srv.middlewares.use('/__preview', async (req, res) => {
          const rawHtml =
            '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/__temp_preview__.tsx"></script></body></html>';
          const html = await srv.transformIndexHtml(req.originalUrl || '/__preview', rawHtml);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        });
      },
    },
  ],
});

await server.listen();
const { port } = server.httpServer.address();
console.log(`PREVIEW_URL=http://127.0.0.1:${port}/__preview`);
process.on('SIGINT', () => void server.close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().finally(() => process.exit(0)));
EOF

TMP_DIR="$TMP_DIR" node "$TMP_DIR/serve.mjs"
```

核验要点（截图同样存放在 `$TMP_DIR`，检查完毕随 `trap` 或 `rm -rf` 一并清理）：
- 无需额外安装 Playwright：若本机已有 Chrome/Chromium，可直接用无头模式批量截图到 `$TMP_DIR` 并通过读图工具审视亮/暗双色与移动/桌面视口：

```bash
CHROME=$(command -v google-chrome || command -v chromium || echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
if [ -x "$CHROME" ]; then
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=390,844 --screenshot="$TMP_DIR/mobile-light.png" "${PREVIEW_URL}"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=390,844 --screenshot="$TMP_DIR/mobile-dark.png" "${PREVIEW_URL}?theme=dark"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=1280,900 --screenshot="$TMP_DIR/desktop-light.png" "${PREVIEW_URL}"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=1280,900 --screenshot="$TMP_DIR/desktop-dark.png" "${PREVIEW_URL}?theme=dark"
fi
```

- 重点核对：390px 窄屏是否出现关键提醒截断或磁贴数值异常折行、卡片/区块留白是否过大、同层级字号是否统一、相邻语义色（如成功/信息/提醒）区分度及暗色可读性。（注：macOS 下 Chrome 无头窗口存在约 500px 最小宽度限制，如需精准复现 390px 窄屏，可在预览页外层包一层 `w-[390px]` 容器并配合 `--window-size=520,1100` 截屏。）

## 约束提醒

- 始终在 `finally` 或信号处理中关闭 Vite server，并在退出前清理系统临时目录中的所有脚本与截图。
- 不将临时验证脚本、截图或 Mock 预览入口写入仓库、`.gitignore` 目录、常驻 `package.json` 脚本或 CI。
