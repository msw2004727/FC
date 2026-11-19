/**
 * 賽程摘要片（契約 §1.4）。純函式。
 * shard 只用 utcOffset 換算日期，不看執行環境時區。
 */

export interface SummaryEntry {
  dv: string;
  r: number;
  no: number | null;
  k: number | null;
  v: string | null;
  h: { id: string; n: string };
  a: { id: string; n: string };
  s: [number, number];
  st: string;
  wo: string | null;
  /** 取消原因（只有 st 為 cancelled 時有值；G1 Opus 終審 P2：讓前端不必為了原因另讀場次） */
  cr?: string | null;
  /** PK 比分 [home, away]。penaltyScore 為 null 或不是整數對時省略（§3.317-6）。 */
  p?: [number, number];
}

const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
const NAME_MAX = 30;

function offsetMs(utcOffset: string): number {
  const m = OFFSET_RE.exec(utcOffset);
  if (!m) throw new RangeError('utcOffset');
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  if (hours > 23 || mins > 59) throw new RangeError('utcOffset');
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (hours * 60 + mins) * 60_000;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** null → 'tbd'；否則該時區日期 `d` + YYYYMMDD。預設 '+08:00'。 */
export function summaryShardIdOf(kickoffMs: number | null, utcOffset = '+08:00'): string {
  if (kickoffMs == null) return 'tbd';
  if (typeof kickoffMs !== 'number' || !Number.isFinite(kickoffMs)) return 'tbd';
  const shifted = new Date(kickoffMs + offsetMs(utcOffset));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  return `d${y}${pad2(shifted.getUTCMonth() + 1)}${pad2(shifted.getUTCDate())}`;
}

function clipName(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return Array.from(text).slice(0, NAME_MAX).join('');
}

function sideOf(raw: unknown): { id: string; n: string } {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    id: typeof o.teamId === 'string' ? o.teamId : '',
    n: clipName(o.name)
  };
}

/** 非整數（含缺欄）當 0。名字最多 30 字（code point）。 */
function scoreNum(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

/** 兩邊都是整數才收。null、缺欄、非整數整筆省略，避免把「沒踢 PK」寫成 0:0。 */
function penaltyPair(raw: unknown): [number, number] | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.home !== 'number' || !Number.isInteger(o.home)) return null;
  if (typeof o.away !== 'number' || !Number.isInteger(o.away)) return null;
  return [o.home, o.away];
}

export function summaryEntryOf(match: Record<string, unknown>, kickoffMs: number | null): SummaryEntry {
  const score = match.score && typeof match.score === 'object' ? match.score as Record<string, unknown> : {};
  const round = typeof match.round === 'number' && Number.isFinite(match.round) ? match.round : 0;
  const no = typeof match.matchNo === 'number' && Number.isFinite(match.matchNo) ? match.matchNo : null;
  const penalty = penaltyPair(match.penaltyScore);
  return {
    dv: typeof match.divisionId === 'string' ? match.divisionId : '',
    r: round,
    no,
    k: typeof kickoffMs === 'number' && Number.isFinite(kickoffMs) ? kickoffMs : null,
    v: typeof match.venueName === 'string' ? match.venueName : null,
    h: sideOf(match.home),
    a: sideOf(match.away),
    s: [scoreNum(score.home), scoreNum(score.away)],
    st: typeof match.status === 'string' ? match.status : '',
    wo: typeof match.walkoverSide === 'string' ? match.walkoverSide : null,
    ...(match.status === 'cancelled' && typeof match.cancelReason === 'string' ? { cr: match.cancelReason.slice(0, 100) } : {}),
    ...(penalty ? { p: penalty } : {})
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bRec = b as Record<string, unknown>;
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], bRec[key])) return false;
  }
  return true;
}

/** 深比較。任一為 null／undefined 時，兩邊都空才是 true。 */
export function sameEntry(a: SummaryEntry | undefined | null, b: SummaryEntry | undefined | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return deepEqual(a, b);
}
