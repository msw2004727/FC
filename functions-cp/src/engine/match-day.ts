/**
 * 比賽日。台北固定 +08:00，不看執行環境時區，也不做日光節約。
 * 00:00～04:59 的開賽歸前一個比賽日；05:00 起算當天，到隔天 05:00 之前。
 * 純函式：不讀時鐘、不碰 Firestore。
 */

import { taipeiMs } from './schedule.js';

const DAY_MS = 86_400_000;
const CUTOFF_MS = 5 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 西元日曆日。2/31、平年 2/29 都不是。 */
export function civilYmd(ymd: string): boolean {
  if (!YMD_RE.test(ymd)) return false;
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** 牆上 HH:mm 的分鐘。非法時刻回 null。 */
function wallMinutes(hhmm: string): number | null {
  const m = HHMM_RE.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nextYmd(ymd: string): string | null {
  if (!civilYmd(ymd)) return null;
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day + 1));
  return `${String(utc.getUTCFullYear()).padStart(4, '0')}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * 開賽毫秒 → 比賽日 `YYYY-MM-DD`。
 * 台北 00:00～04:59 歸前一天；05:00 起算當天。
 */
export function matchDayOf(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new TypeError('matchDayOf：ms 必須是有限數字');
  }
  const shifted = new Date(ms + TAIPEI_OFFSET_MS - CUTOFF_MS);
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  return `${y}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * 該比賽日的半開區間 [當天 05:00, 隔天 05:00)。
 * 非法日期回 null。
 */
export function matchDayWindow(ymd: string): { start: number; end: number } | null {
  if (!civilYmd(ymd)) return null;
  const start = Date.parse(`${ymd}T05:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + DAY_MS };
}

export interface ScheduleDayWindow {
  /** 可排開賽的起點（含） */
  startMs: number;
  /** 比賽須在這之前結束（placeMatches 的 dayEndMs） */
  endMs: number;
  /** 開賽必須早於隔天 05:00。比賽可以進行到這個瞬間之後。 */
  kickoffBeforeMs: number;
}

/**
 * 組別賽程日 `{ date, start, end }`。
 * `end <= start` 視為隔天結束。總長必須 > 0 且 ≤ 24 小時。
 * `start` 早於 05:00 一律回 null。凌晨場請把前一天的 `end` 拉到隔天。
 * 隔天 05:00 之後仍可當結束時間（比賽可踢過 05:00），但開賽不得落在 05:00 或之後。
 * 沒有任何早於切點的開賽點、或日期無法換算時回 null（呼叫端回既有的欄位範圍錯誤）。
 * 切點看 start 的牆上時刻，不看 utcOffset。比賽日分日仍固定 +08:00。
 */
export function scheduleDayWindow(
  date: string,
  start: string,
  end: string,
  utcOffset = '+08:00'
): ScheduleDayWindow | null {
  if (!civilYmd(date)) return null;
  const startMin = wallMinutes(start);
  if (startMin != null && startMin < CUTOFF_MS / 60_000) return null;
  const startMs = taipeiMs(date, start, utcOffset);
  const endSame = taipeiMs(date, end, utcOffset);
  if (startMs == null || endSame == null) return null;
  const endMs = endSame <= startMs ? endSame + DAY_MS : endSame;
  const span = endMs - startMs;
  if (span <= 0 || span > DAY_MS) return null;
  const next = nextYmd(date);
  if (next == null) return null;
  const kickoffBeforeMs = taipeiMs(next, '05:00', utcOffset);
  if (kickoffBeforeMs == null || !(startMs < kickoffBeforeMs)) return null;
  return { startMs, endMs, kickoffBeforeMs };
}
