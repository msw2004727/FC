/**
 * 引擎需要的時間與期別文字。
 * 其餘 UI 格式化（hhmm、dateLabel、displayMinute、clockText 等）不移植。
 */

export const PERIOD_LABEL: Record<string, string> = {
  pre: '未開賽',
  h1: '上半場',
  ht: '中場',
  h2: '下半場',
  et1: '延長上半',
  et2: '延長下半',
  pk: 'PK 大戰',
  ft: '完賽'
};

/** Firestore Timestamp / Date / ISO 字串 / 毫秒 → 毫秒數；無法解析回傳 null。 */
export function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const o = v as { toMillis?: unknown; seconds?: unknown };
    if (typeof o.toMillis === 'function') return (o.toMillis as () => number)();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * 依組別設定解析期別名稱。
 * periods === 1 時 h1 是整場，不是「上半場」。
 */
export function periodLabel(period: string, periods = 2): string {
  if (periods === 1 && period === 'h1') return '比賽';
  return PERIOD_LABEL[period] ?? period;
}
