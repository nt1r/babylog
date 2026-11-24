import { differenceInCalendarDays, differenceInMonths, format, isToday, isYesterday, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

/** 获取浏览器当前 IANA 时区，兜底 Asia/Shanghai。 */
export function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz.length > 0) return tz;
  } catch {
    // 忽略受限运行环境下的 Intl 异常
  }
  return 'Asia/Shanghai';
}

/** 严格解析本地日期键 YYYY-MM-DD 为本地零点 Date，非法格式或越界日期（如 2月31日）返回 undefined。 */
export function parseLocalDateKey(dateKey: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return undefined;
  const [year, month, day] = dateKey.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return undefined;
  }
  return parsed;
}

/** 将 Date 格式化为本地 YYYY-MM-DD 字符串。 */
export function formatLocalDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** 严格解析本地时间键 HH:mm，非法格式或越界小时/分钟返回 undefined。 */
export function parseLocalTimeKey(timeKey: string): { hour: number; minute: number } | undefined {
  if (!/^\d{2}:\d{2}$/.test(timeKey)) return undefined;
  const [hour, minute] = timeKey.split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

/** 将小时与分钟格式化为标准 HH:mm 字符串。 */
export function formatLocalTimeKey(hour: number, minute: number): string {
  const safeHour = Math.max(0, Math.min(23, Math.trunc(hour)));
  const safeMinute = Math.max(0, Math.min(59, Math.trunc(minute)));
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

/** 判断 YYYY-MM-DD 日期键是否落在闭区间 [min, max] 内。 */
export function isDateKeyWithinBounds(dateKey: string, min?: string, max?: string): boolean {
  if (!parseLocalDateKey(dateKey)) return false;
  if (min && dateKey < min) return false;
  if (max && dateKey > max) return false;
  return true;
}

/** 计算日历弹层的默认定位月份：优先选中日，否则按 [min, max] 收敛今日日期，避免翻到不可选月份。 */
export function resolveInitialCalendarMonth(
  selectedDate: Date | undefined,
  min?: string,
  max?: string,
  now: Date = new Date(),
): Date {
  if (selectedDate) {
    return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  }
  const todayKey = formatLocalDateKey(now);
  if (min && todayKey < min) {
    const minDate = parseLocalDateKey(min);
    if (minDate) return new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  }
  if (max && todayKey > max) {
    const maxDate = parseLocalDateKey(max);
    if (maxDate) return new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** 拆解 Date 为日期与时间选择器所需的 YYYY-MM-DD 与 HH:mm。 */
export function splitLocalDateTime(date: Date): { date: string; time: string } {
  return {
    date: formatLocalDateKey(date),
    time: format(date, 'HH:mm'),
  };
}

/** 将本地日期与时间字符串组合为 UTC RFC3339 字符串，非法时返回 null。 */
export function combineLocalDateTimeToISO(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const parsed = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** 按本地小时智能猜测睡眠类型：20:00–05:59 为夜间整觉，其余为白天小睡。 */
export function guessSleepSubtype(date: Date): 'nap' | 'night' {
  const hour = date.getHours();
  return hour >= 20 || hour < 6 ? 'night' : 'nap';
}

/** 根据出生日期（YYYY-MM-DD）生成温暖易读的宝宝月龄与天数文案。 */
export function formatBabyAge(birthDateStr: string, now: Date = new Date()): { daysLabel: string; ageLabel: string } {
  const birth = parseISO(`${birthDateStr}T00:00:00`);
  if (Number.isNaN(birth.getTime())) {
    return { daysLabel: '', ageLabel: '' };
  }
  const totalDays = Math.max(0, differenceInCalendarDays(now, birth));
  if (totalDays === 0) {
    return { daysLabel: '出生第 1 天', ageLabel: '今天刚报到' };
  }

  const months = differenceInMonths(now, birth);
  const anchor = new Date(birth);
  anchor.setMonth(anchor.getMonth() + months);
  const remDays = Math.max(0, differenceInCalendarDays(now, anchor));

  let ageLabel: string;
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const remMonths = months % 12;
    ageLabel = remMonths > 0 ? `${years} 岁 ${remMonths} 个月` : `${years} 周岁`;
  } else if (months > 0) {
    ageLabel = remDays > 0 ? `${months} 个月零 ${remDays} 天` : `满 ${months} 个月`;
  } else {
    ageLabel = `${totalDays} 天`;
  }

  return {
    daysLabel: `第 ${totalDays + 1} 天`,
    ageLabel,
  };
}

/** 计算距某 UTC 时间戳已过多久（面向育儿「距上次喂奶/换尿布」场景）。 */
export function formatTimeSince(isoStr: string | null, now: Date = new Date()): string {
  if (!isoStr) return '暂无记录';
  const target = parseISO(isoStr);
  if (Number.isNaN(target.getTime())) return '暂无记录';
  const diffMin = Math.max(0, Math.floor((now.getTime() - target.getTime()) / 60000));
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours} 小时 ${mins} 分前` : `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/** 格式化分钟数为易读中文时长（如 45 分钟 / 1 小时 30 分）。 */
export function formatDurationMin(minutes: number): string {
  if (minutes <= 0) return '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} 小时 ${rem} 分` : `${hours} 小时`;
}

/** 将 YYYY-MM-DD 转为列表分组标题，如「今天 · 11月23日」「昨天 · 11月22日」。 */
export function formatDateGroupLabel(dateKey: string): string {
  const date = parseISO(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  if (isToday(date)) return `今天 · ${format(date, 'M月d日')}`;
  if (isYesterday(date)) return `昨天 · ${format(date, 'M月d日')}`;
  return format(date, 'M月d日 EEEE', { locale: zhCN });
}

/** 格式化 ISO 时间戳为带日期的简短时间（如「今天 09:30」「昨天 22:00」「11月20日 08:15」），便于删除核对。 */
export function formatLocalDateTimeShort(isoStr: string): string {
  const date = parseISO(isoStr);
  if (Number.isNaN(date.getTime())) return '--:--';
  const timeText = format(date, 'HH:mm');
  if (isToday(date)) return `今天 ${timeText}`;
  if (isYesterday(date)) return `昨天 ${timeText}`;
  return `${format(date, 'M月d日')} ${timeText}`;
}

/** 获取 ISO 时间戳在浏览器本地时区下的 YYYY-MM-DD 键与 HH:mm 显示值。 */
export function getLocalDateKeyFromISO(isoStr: string): string {
  const date = parseISO(isoStr);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
}

export function formatLocalTimeFromISO(isoStr: string): string {
  const date = parseISO(isoStr);
  if (Number.isNaN(date.getTime())) return '--:--';
  return format(date, 'HH:mm');
}
