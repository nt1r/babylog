import { differenceInCalendarDays } from 'date-fns';
import { ApiError, apiFetchBlob, triggerBlobDownload } from '@/lib/http';
import { getBrowserTimeZone, parseLocalDateKey } from '@/lib/time';

export type ExportCategoryKey = 'feeding' | 'sleep' | 'care' | 'health' | 'growth';
export type ExportRangePreset = '7' | '14' | '30' | '90' | 'custom';

export const MAX_EXPORT_SPAN_DAYS = 366;

export const EXPORT_CATEGORY_OPTIONS: ReadonlyArray<{
  readonly key: ExportCategoryKey;
  readonly label: string;
  readonly hint: string;
}> = [
  { key: 'feeding', label: '喂养记录', hint: '配方奶、瓶喂母乳、亲喂与辅食' },
  { key: 'sleep', label: '睡眠记录', hint: '白天小睡、夜间整觉与跨夜切分' },
  { key: 'care', label: '日常护理', hint: '嘘嘘、便便性状颜色、洗澡与其他' },
  { key: 'health', label: '健康观察', hint: '体温测量与用药记录' },
  { key: 'growth', label: '生长发育', hint: '体重、身高、头围与乳牙萌出' },
];

export const ALL_EXPORT_CATEGORIES: readonly ExportCategoryKey[] = ['feeding', 'sleep', 'care', 'health', 'growth'];

interface ExportFormInput {
  readonly preset: ExportRangePreset;
  readonly startDate: string;
  readonly endDate: string;
  readonly categories: readonly ExportCategoryKey[];
}

/** 校验导出筛选条件（非空类别、自定义起止日期合法且不超过 366 天），通过返回 null。 */
export function validateExportSelection(input: ExportFormInput): string | null {
  if (input.categories.length === 0) {
    return '请至少选择一项需要导出的数据类别';
  }
  if (input.preset === 'custom') {
    if (!input.startDate || !input.endDate) {
      return '请选择完整的开始日期和结束日期';
    }
    const start = parseLocalDateKey(input.startDate);
    const end = parseLocalDateKey(input.endDate);
    if (!start || !end) {
      return '日期格式无效，请重新选择';
    }
    if (end < start) {
      return '结束日期不能早于开始日期';
    }
    const spanDays = differenceInCalendarDays(end, start) + 1;
    if (spanDays > MAX_EXPORT_SPAN_DAYS) {
      return `单次导出时间范围不能超过 ${MAX_EXPORT_SPAN_DAYS} 天`;
    }
  }
  return null;
}

/** 构造导出接口 URL（包含时区、预设天数或自定义起止日期及已勾选类别）。 */
function buildExportXlsxUrl(babyId: number, input: ExportFormInput, timeZone: string = getBrowserTimeZone()): string {
  const params = new URLSearchParams();
  params.set('tz', timeZone);
  params.set('categories', input.categories.join(','));
  if (input.preset === 'custom') {
    params.set('start', input.startDate);
    params.set('end', input.endDate);
  } else {
    params.set('days', input.preset);
  }
  return `/api/babies/${babyId}/export/xlsx?${params.toString()}`;
}

function parseDownloadFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // 解码失败时回退到 ASCII filename
    }
  }
  const asciiMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return asciiMatch?.[1]?.trim() || fallback;
}

/** 请求后端生成多 Sheet Excel 表格并触发浏览器文件下载。 */
export async function downloadExportXlsx(babyId: number, input: ExportFormInput): Promise<string> {
  const validationError = validateExportSelection(input);
  if (validationError) {
    throw new ApiError(400, validationError);
  }

  const url = buildExportXlsxUrl(babyId, input);
  const { blob, contentDisposition } = await apiFetchBlob(url);
  const filename = parseDownloadFilename(contentDisposition, 'babylog-export.xlsx');
  triggerBlobDownload(blob, filename);
  return filename;
}
