/**
 * 零依赖 RFC 5545 (.ics) 手机系统日历事件生成器。
 * 用于将宝宝疫苗预约或预计接种日程直接导入 iOS / Android / macOS 原生系统日历，
 * 在零云端推送的前提下提供可靠闹钟提醒。
 */

interface VaccineCalendarEventInput {
  readonly uidSeed: string;
  readonly summary: string;
  readonly date: string; // YYYY-MM-DD
  readonly time?: string; // 可选 HH:MM（本地时间）
  readonly location?: string;
  readonly description?: string;
}

interface ExportVaccineVisitParams {
  readonly uidSeed: string;
  readonly babyNickname?: string;
  readonly date: string;
  readonly time?: string;
  readonly location?: string;
  readonly stageLabel?: string;
  readonly doses: ReadonlyArray<{
    readonly short_name: string;
    readonly vaccine_name: string;
    readonly dose_number: number;
    readonly total_doses: number;
    readonly dose_tip?: string;
    readonly precautions_before?: readonly string[];
    readonly risk_warning?: string;
  }>;
}

const utf8Encoder = new TextEncoder();

function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * 按 RFC 5545 §3.1 将单行按 UTF-8 字节上限 75 octets 折行（续行以单个空格开头），
 * 逐 Unicode 码点切分以避免截断多字节中文字符。
 */
export function foldIcsLine(line: string, maxOctets = 75): string {
  if (utf8Encoder.encode(line).length <= maxOctets) {
    return line;
  }

  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = maxOctets;

  for (const ch of line) {
    const chBytes = utf8Encoder.encode(ch).length;
    if (currentBytes + chBytes > limit && current.length > 0) {
      segments.push(current);
      current = ch;
      currentBytes = chBytes;
      // 续行前缀占 1 字节空格，因此续行内容最多 maxOctets - 1 字节。
      limit = maxOctets - 1;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments.join('\r\n ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

function nextDateKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}`;
}

function addOneHourLocal(dateStr: string, timeStr: string): { dtStart: string; dtEnd: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
  return { dtStart: fmt(start), dtEnd: fmt(end) };
}

/** 生成标准 RFC 5545 日历文本（带时刻日程配提前 1 天与提前 2 小时闹钟；全天日程配提前 1 天与当日 08:00 闹钟）。 */
function buildVaccineVisitIcs(input: VaccineCalendarEventInput, now: Date = new Date()): string {
  const compactDate = input.date.replace(/-/g, '');
  const uid = `babylog-vaccine-${input.uidSeed.replace(/[^a-zA-Z0-9_-]/g, '-')}@babylog.local`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BabyLog//Vaccine Schedule//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];

  const hasValidTime = Boolean(input.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time));
  if (hasValidTime && input.time) {
    const { dtStart, dtEnd } = addOneHourLocal(input.date, input.time);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate}`);
    lines.push(`DTEND;VALUE=DATE:${nextDateKey(input.date)}`);
  }

  if (input.location && input.location.trim().length > 0) {
    lines.push(`LOCATION:${escapeIcsText(input.location.trim())}`);
  }

  const baseDesc = input.description?.trim() ?? '';
  const disclaimer =
    '温馨提醒：请携带纸质《预防接种证》与出院/体检资料，接种后现场留观 30 分钟；具体接种方案请以当地接种门诊及医生评估为准。';
  const fullDesc = baseDesc ? `${baseDesc}\n\n${disclaimer}` : disclaimer;
  lines.push(`DESCRIPTION:${escapeIcsText(fullDesc)}`);

  // 提前 1 天提醒（方便确认宝宝状态与预约号源）
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`明天疫苗提醒：${input.summary}`)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
  );

  // 带时刻事件提前 2 小时提醒；全天事件当日 08:00 提醒（DTSTART + 8 小时）。
  if (hasValidTime) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`即将出发接种：${input.summary}`)}`,
      'TRIGGER:-PT2H',
      'END:VALARM',
    );
  } else {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`今日疫苗提醒：${input.summary}`)}`,
      'TRIGGER;RELATED=START:PT8H',
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map((line) => foldIcsLine(line)).join('\r\n')}\r\n`;
}

/** 统一组装单剂或多剂疫苗的日历事件描述（含接种前注意事项与风险提示），供导出与纯函数测试共用。 */
export function buildVaccineVisitIcsFromDoses(params: ExportVaccineVisitParams, now: Date = new Date()): string {
  const titlePrefix = params.babyNickname ? `${params.babyNickname}疫苗接种` : '宝宝疫苗接种';
  const names = params.doses.map((d) => {
    const base = params.doses.length === 1 ? d.vaccine_name : d.short_name;
    return d.total_doses > 1 ? `${base} 第${d.dose_number}剂` : base;
  });

  const precautions: string[] = [];
  const seenPrecautions = new Set<string>();
  const tips: string[] = [];
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  for (const dose of params.doses) {
    if (dose.dose_tip) {
      tips.push(`- ${dose.short_name}：${dose.dose_tip}`);
    }
    if (dose.risk_warning && !seenWarnings.has(dose.risk_warning)) {
      seenWarnings.add(dose.risk_warning);
      warnings.push(`- ${dose.short_name}：${dose.risk_warning}`);
    }
    for (const item of dose.precautions_before ?? []) {
      if (!seenPrecautions.has(item)) {
        seenPrecautions.add(item);
        precautions.push(`- ${item}`);
      }
    }
  }

  const descParts: string[] = [];
  if (params.stageLabel) descParts.push(`阶段：${params.stageLabel}`);
  if (names.length > 0) descParts.push(`接种项目：${names.join('、')}`);
  if (tips.length > 0) descParts.push(`本剂提示：\n${tips.join('\n')}`);
  if (warnings.length > 0) descParts.push(`风险提示：\n${warnings.join('\n')}`);
  if (precautions.length > 0) descParts.push(`接种前注意事项：\n${precautions.join('\n')}`);

  return buildVaccineVisitIcs(
    {
      uidSeed: params.uidSeed,
      summary: `${titlePrefix}：${names.join('、')}`,
      date: params.date,
      time: params.time,
      location: params.location,
      description: descParts.join('\n\n'),
    },
    now,
  );
}

/** 统一生成并触发 .ics 文件下载。 */
export function exportVaccineVisitIcs(params: ExportVaccineVisitParams): void {
  const content = buildVaccineVisitIcsFromDoses(params);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `babylog-vaccine-${params.date}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
