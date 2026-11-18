/** 比賽時間校正；不改隊伍、比分或事件。 */

import type { ClockState, MatchLike } from './types.js';

const fail = (message: string): never => {
  throw Object.assign(new Error(message), { code: 'invalid-argument' });
};

function millis(v: unknown): number | null {
  if (v != null && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (v as { toMillis: () => number | null }).toMillis();
    if (ms != null) return ms;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (v != null && typeof v === 'object' && (v as { seconds?: unknown }).seconds != null) {
    const o = v as { seconds: number; nanoseconds?: number };
    return o.seconds * 1000 + Math.floor((o.nanoseconds ?? 0) / 1e6);
  }
  return null;
}

export interface ClockEditBasis {
  period: string;
  status: string | undefined;
  locked: boolean;
  resetRevision: number;
  managementRevision: number;
  running: boolean;
  periodStartedAt: number | null;
  elapsedSecAtPause: number;
  clockPeriod: string | null;
  addedTimeSec: number;
}

export function clockEditBasis(match: MatchLike): ClockEditBasis {
  const c: Partial<ClockState> = match.clock ?? {};
  return {
    period: match.period ?? 'pre',
    status: match.status,
    locked: match.lock?.locked === true,
    resetRevision: match.resetRevision ?? 0,
    managementRevision: match.managementRevision ?? 0,
    running: c.running === true,
    periodStartedAt: millis(c.periodStartedAt),
    elapsedSecAtPause: c.elapsedSecAtPause ?? 0,
    clockPeriod: c.periodId ?? null,
    addedTimeSec: c.addedTimeSec ?? 0
  };
}

export function clockPeriodFor(match: MatchLike, division: { periods?: number }): string {
  if (match.period && ['h1', 'h2', 'et1', 'et2'].includes(match.period)) return match.period;
  if (match.clock?.periodId && ['h1', 'h2', 'et1', 'et2'].includes(match.clock.periodId)) {
    return match.clock.periodId;
  }
  return division.periods === 1 ? 'h1' : match.period === 'ht' ? 'h1' : 'h2';
}

export function clockLimitSec(match: MatchLike, division: { periods?: number; matchDurationMin?: number }): number {
  if (![1, 2].includes(division?.periods ?? 0) || !Number.isFinite(division.matchDurationMin) || (division.matchDurationMin ?? 0) <= 0) {
    fail('讀不到組別比賽時長');
  }
  const periods = division.periods as number;
  const matchDurationMin = division.matchDurationMin as number;
  const p = clockPeriodFor(match, division);
  return (p.startsWith('et') ? 5 : matchDurationMin / periods) * 60;
}

export function buildClockCorrection({
  match,
  division,
  seconds,
  nowMs
}: {
  match: MatchLike;
  division: { periods?: number; matchDurationMin?: number };
  seconds: number;
  nowMs: number;
}): ClockState {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
    fail('請輸入有效的比賽時間（0 至 1440 分鐘）');
  }
  if (!match.status || !['live', 'halftime', 'finished', 'confirmed'].includes(match.status)) {
    fail('此場次尚未開賽或無法修改時間');
  }
  const limit = clockLimitSec(match, division);
  const running = match.status === 'live' && match.clock?.running === true;
  return {
    ...(match.clock ?? { running: false, periodStartedAt: null, elapsedSecAtPause: 0 }),
    running,
    periodStartedAt: running ? new Date(nowMs) : null,
    elapsedSecAtPause: seconds,
    addedTimeSec: Math.max(0, seconds - limit),
    periodId: clockPeriodFor(match, division)
  };
}
