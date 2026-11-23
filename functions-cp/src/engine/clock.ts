/**
 * 比賽時鐘的純函式部分。
 * 不移植 setServerOffset／getServerOffset／now／startTicker／initClock。
 * 需要現在時間的函式一律收必填 nowMs，不隱含 Date.now()。
 */

import type { ClockState } from './types.js';
import { toMillis } from './util.js';

/** 空時鐘。 */
export const emptyClock = (): ClockState => ({
  running: false,
  periodStartedAt: null,
  elapsedSecAtPause: 0,
  addedTimeSec: 0
});

/** 目前期別已進行的秒數。nowMs 必填。 */
export function elapsedSec(clock: ClockState | null | undefined, nowMs: number): number {
  if (!clock) return 0;
  const paused = Math.max(0, Number(clock.elapsedSecAtPause) || 0);
  if (!clock.running) return paused;

  const startedAt = toMillis(clock.periodStartedAt);
  if (startedAt == null) return paused;

  // 手機時間往回跳時不能算出負值
  return paused + Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

/** 開始或繼續計時。nowMs 必填。 */
export function startClock(clock: Partial<ClockState> | null | undefined, nowMs: number): ClockState {
  if (clock?.running) return { ...emptyClock(), ...clock, running: true };
  return {
    ...emptyClock(),
    ...clock,
    running: true,
    periodStartedAt: new Date(nowMs),
    elapsedSecAtPause: Math.max(0, Number(clock?.elapsedSecAtPause) || 0)
  };
}

/** 暫停：把已跑的秒數固定下來。nowMs 必填。 */
export function pauseClock(clock: ClockState | null | undefined, nowMs: number): ClockState {
  if (!clock?.running) return { ...emptyClock(), ...clock, running: false };
  return {
    ...clock,
    running: false,
    periodStartedAt: null,
    elapsedSecAtPause: elapsedSec(clock, nowMs)
  };
}

/** 換期別：秒數歸零，保留補時設定。 */
export function resetClock(clock: Partial<ClockState> = {}): ClockState {
  return {
    ...emptyClock(),
    addedTimeSec: Number(clock.addedTimeSec) || 0,
    elapsedSecAtPause: 0
  };
}

/**
 * 期別流程：pre → h1 → ht → h2 → ft。
 * 平手且 drawRule 允許時，h2 可改走 et1；et2 可改走 pk。
 */
export const PERIOD_FLOW: Record<string, string[]> = {
  pre: ['h1'],
  h1: ['ht'],
  ht: ['h2'],
  h2: ['ft', 'et1'],
  et1: ['et2'],
  et2: ['ft', 'pk'],
  pk: ['ft'],
  ft: []
};

/**
 * 結束本節之後走到哪裡。
 * periods === 1 時 h1 直接走到 ft（或平手且黃金進球時走 et1），沒有中場與下半場。
 */
export function nextPeriod(
  period: string,
  { tied = false, drawRule = 'penalty', periods = 2 }: { tied?: boolean; drawRule?: string; periods?: number } = {}
): string | null {
  const options = PERIOD_FLOW[period] || [];
  if (!options.length) return null;
  if (periods === 1 && period === 'h1') {
    return tied && drawRule === 'goldenGoal' ? 'et1' : 'ft';
  }
  if (period === 'h2') return tied && drawRule === 'goldenGoal' ? 'et1' : 'ft';
  if (period === 'et2') return tied && drawRule === 'penalty' ? 'pk' : 'ft';
  return options[0] ?? null;
}

/** 該期別是否正在進行（計時器該跑）。 */
export const isPlayingPeriod = (p: string): boolean => ['h1', 'h2', 'et1', 'et2'].includes(p);

/** 期別 → 場次狀態。 */
export function statusForPeriod(period: string): string {
  if (period === 'pre') return 'ready';
  if (period === 'ht') return 'halftime';
  if (period === 'ft') return 'finished';
  return 'live';
}

/**
 * 該期別的正規長度（秒）。
 * periods === 1 時 h1 是整場，不是半場。
 */
export function periodLimitSec(period: string, matchDurationMin = 30, etHalfMin = 5, periods = 2): number {
  if (period === 'h1' && periods === 1) return matchDurationMin * 60;
  const half = Math.round(matchDurationMin / 2);
  if (period === 'h1' || period === 'h2') return half * 60;
  if (period === 'et1' || period === 'et2') return etHalfMin * 60;
  return 0;
}

/**
 * 是否已經超過正規時間（進入補時）。
 * 時鐘沒在跑時 nowMs 用不到；跑動中若沒給 nowMs 會丟 TypeError，避免偷用 Date.now()。
 */
export function isInAddedTime(
  clock: ClockState | null | undefined,
  period: string,
  matchDurationMin: number,
  periods = 2,
  nowMs?: number
): boolean {
  const limit = periodLimitSec(period, matchDurationMin, 5, periods);
  if (clock?.running && nowMs == null) {
    throw new TypeError('isInAddedTime：時鐘跑動中必須傳入 nowMs');
  }
  return limit > 0 && elapsedSec(clock, nowMs ?? 0) > limit;
}
