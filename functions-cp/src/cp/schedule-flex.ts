/**
 * 賽程彈性（顧問 §3.272 F2）的純函式。
 * 不讀時鐘、不碰 Firestore。台北一律 +08:00，不看執行環境時區。
 * 重疊區間與引擎 placeMatches 相同：半開 [開始, 開始＋比賽分鐘＋緩衝)。
 */
import { taipeiMonthDay } from './notice.js';

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** 文案「最多可延到原末場後 60 天」：含原末場日之後的第 60 個台北日。 */
export const EXTEND_DAYS = 60;

/**
 * 整天順延與當日撞期查詢的場次上限。
 * 對齊單組 `SCHEDULE_LIMITS.matchesMax`（200）。
 * 寫入＝每場 1＋賽事根文件 1＋稽核 1，低於 Firestore 單交易 500（留餘裕 490）。
 */
export const DAY_MATCH_MAX = 200;
export const TX_WRITE_SOFT_MAX = 490;

/** 比賽分鐘上限 180＋緩衝上限 60。當日查詢往前多看這段，避免前一日深夜開打跨進當日卻漏判。 */
export const LOOKBACK_MIN = 180 + 60;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && validYmd(value);
}

function validYmd(date: string): boolean {
  if (!YMD_RE.test(date)) return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** 該瞬間所在台北日的 00:00（epoch 毫秒）。 */
export function taipeiDayStartMs(ms: number): number {
  return ms - (ms + TAIPEI_OFFSET_MS) % DAY_MS;
}

/** 台北 YYYY-MM-DD。 */
export function taipeiYmd(ms: number): string {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 台北 HH:mm，24 小時制、補零。 */
export function taipeiHm(ms: number): string {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** `2026-01-09` → 該日台北 00:00 的毫秒。非法日期回 null（含 2/31、非閏年 2/29）。 */
export function ymdToStartMs(ymd: string): number | null {
  if (!validYmd(ymd)) return null;
  const ms = Date.parse(`${ymd}T00:00:00+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** 台北日加天數。跨月、跨年都走固定 +08:00，沒有日光節約。 */
export function addDaysYmd(ymd: string, days: number): string | null {
  const start = ymdToStartMs(ymd);
  if (start == null || !Number.isInteger(days)) return null;
  return taipeiYmd(start + days * DAY_MS);
}

/** `2026-01-09` → `1/9`（不補零）。非法回 null。 */
export function ymdMonthDay(ymd: string): string | null {
  const start = ymdToStartMs(ymd);
  if (start == null) return null;
  return taipeiMonthDay(start);
}

/** 整天順延要搬的那一天（不含前一日跨日）。 */
export function taipeiDayWindow(ymd: string): { start: number; end: number } | null {
  const start = ymdToStartMs(ymd);
  if (start == null) return null;
  return { start, end: start + DAY_MS };
}

/** 撞期查詢窗：目標台北日再往前 LOOKBACK_MIN，到該日結束（不含次日）。 */
export function conflictWindowOfKickoff(kickoffMs: number): { start: number; end: number } {
  const day = taipeiDayStartMs(kickoffMs);
  return { start: day - LOOKBACK_MIN * 60_000, end: day + DAY_MS };
}

export interface KickoffBounds {
  /** 首場台北日（含） */
  minYmd: string;
  /** 原末場台北日再加 EXTEND_DAYS（含） */
  maxYmd: string;
  /** 含 */
  lo: number;
  /** 不含：上限日的次日 00:00 */
  hi: number;
}

/** 允許的開賽窗。原末場日 D 可排到 D+60 當天，D+61 的 00:00 起拒絕。 */
export function kickoffBounds(firstMs: number, originLastMs: number, extendDays = EXTEND_DAYS): KickoffBounds {
  const lo = taipeiDayStartMs(firstMs);
  const originDay = taipeiDayStartMs(originLastMs);
  return {
    minYmd: taipeiYmd(lo),
    maxYmd: taipeiYmd(originDay + extendDays * DAY_MS),
    lo,
    hi: originDay + (extendDays + 1) * DAY_MS
  };
}

/** 在窗內回 null。窗外回首場日與上限日，給 `SCHEDULE_OUT_OF_RANGE` 的 params。 */
export function kickoffOutOfRange(
  kickoffMs: number,
  firstMs: number,
  originLastMs: number,
  extendDays = EXTEND_DAYS
): { min: string; max: string } | null {
  const bounds = kickoffBounds(firstMs, originLastMs, extendDays);
  if (kickoffMs >= bounds.lo && kickoffMs < bounds.hi) return null;
  return { min: bounds.minYmd, max: bounds.maxYmd };
}

/**
 * 新開賽所在台北日的 00:00。只在比目前末場「日」更晚時回傳（只能延後、不能提前，同一日不改）。
 * 多個開賽取最晚的那一天。
 */
export function nextLastMatchDayStart(currentLastMs: number, kickoffs: readonly (number | null)[]): number | null {
  const cur = taipeiDayStartMs(currentLastMs);
  let best: number | null = null;
  for (const kick of kickoffs) {
    if (kick == null) continue;
    const day = taipeiDayStartMs(kick);
    if (day <= cur) continue;
    if (best == null || day > best) best = day;
  }
  return best;
}

/** 維持台北時刻，只換日期。`fromYmd` 是原開賽那天。 */
export function shiftKickoffToDate(kickoffMs: number, fromYmd: string, toYmd: string): number | null {
  const from = ymdToStartMs(fromYmd);
  const to = ymdToStartMs(toYmd);
  if (from == null || to == null) return null;
  return kickoffMs + (to - from);
}

export interface SlotView {
  mtId: string;
  startMs: number;
  endMs: number;
  teamIds: readonly string[];
  venueIdx: number | null;
}

/** 佔用結束（不含）。分鐘不是非負整數時當 0，呼叫端仍應傳賽程上的比賽＋緩衝。 */
export function slotEndMs(startMs: number, matchMinutes: number, bufferMinutes: number): number {
  const match = Number.isInteger(matchMinutes) && matchMinutes > 0 ? matchMinutes : 0;
  const buffer = Number.isInteger(bufferMinutes) && bufferMinutes > 0 ? bufferMinutes : 0;
  return startMs + (match + buffer) * 60_000;
}

/** 半開區間。端點相接（上一場結束＝下一場開始）不算重疊。 */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface ScheduleConflict {
  mtId: string;
  type: 'team' | 'venue';
}

/**
 * 候選場次與其他場次是否撞期。
 * 同一場（相同 mtId）略過。同時撞隊伍與場地時回 team。
 * 多場衝突取 mtId 字典序最小的那筆。場地兩邊都要有編號；null 不當同一場地。
 */
export function findSlotConflict(candidate: SlotView, others: readonly SlotView[]): ScheduleConflict | null {
  const teams = new Set(candidate.teamIds.filter(id => id.length > 0));
  const teamHits: string[] = [];
  const venueHits: string[] = [];
  for (const other of others) {
    if (other.mtId === candidate.mtId) continue;
    if (!rangesOverlap(candidate.startMs, candidate.endMs, other.startMs, other.endMs)) continue;
    const sameTeam = other.teamIds.some(id => teams.has(id));
    if (sameTeam) teamHits.push(other.mtId);
    else if (candidate.venueIdx != null && candidate.venueIdx === other.venueIdx) venueHits.push(other.mtId);
  }
  teamHits.sort();
  venueHits.sort();
  if (teamHits.length > 0) return { mtId: teamHits[0]!, type: 'team' };
  if (venueHits.length > 0) return { mtId: venueHits[0]!, type: 'venue' };
  return null;
}

/** 多場一起搬時，依搬動場次的 mtId 順序回第一筆衝突（對方的 mtId）。 */
export function firstMoveConflict(moves: readonly SlotView[], others: readonly SlotView[]): ScheduleConflict | null {
  const ordered = [...moves].sort((a, b) => (a.mtId < b.mtId ? -1 : a.mtId > b.mtId ? 1 : 0));
  for (const move of ordered) {
    const hit = findSlotConflict(move, others);
    if (hit) return hit;
  }
  return null;
}

export interface NoticeSide {
  kickoffMs: number | null;
  homeName: string;
  awayName: string;
  venueName?: string | null;
}

/** 「1/10 甲隊對乙隊改至 1/24 14:00 2號場」。沒有新時間則「改至待定」。 */
export function rescheduleNoticeText(input: NoticeSide & { toMs: number | null; venueName: string | null }): string {
  const who = `${input.homeName}對${input.awayName}`;
  const from = taipeiMonthDay(input.kickoffMs);
  const head = from ? `${from} ${who}` : who;
  if (input.toMs == null) return `${head}改至待定`;
  const venue = input.venueName && input.venueName.trim() ? ` ${input.venueName.trim()}` : '';
  return `${head}改至 ${taipeiMonthDay(input.toMs)} ${taipeiHm(input.toMs)}${venue}`;
}

/** 「1/9 全天賽程順延至 1/16」。日期必須是合法台北日；不合法回空字串，呼叫端不會拿去發公告。 */
export function shiftDayNoticeText(fromYmd: string, toYmd: string): string {
  const from = ymdMonthDay(fromYmd);
  const to = ymdMonthDay(toYmd);
  if (from == null || to == null) return '';
  return `${from} 全天賽程順延至 ${to}`;
}

function swapBrief(side: NoticeSide): string {
  const date = taipeiMonthDay(side.kickoffMs);
  if (date == null) return `${side.homeName}對${side.awayName}`;
  return `${date} ${taipeiHm(side.kickoffMs!)} ${side.homeName}對${side.awayName}`;
}

/** 「兩場對調：1/10 14:00 甲隊對乙隊 與 1/11 16:00 丙隊對丁隊」。時間用對調前的開賽，方便認出是哪兩場。 */
export function swapNoticeText(a: NoticeSide, b: NoticeSide): string {
  return `兩場對調：${swapBrief(a)} 與 ${swapBrief(b)}`;
}
