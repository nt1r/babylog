/** 严格解析非负整数字符串，拒绝空值、小数与带尾随非数字字符的输入。 */
export function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : null;
}

/** 严格解析有限实数字符串，空字符串返回 null，非法格式返回 'invalid'。 */
export function parseOptionalStrictNumber(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : 'invalid';
}
