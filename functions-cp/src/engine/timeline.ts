/**
 * 由事件流推算比分。
 * 純函式：不碰 Firestore、不呼叫 Date.now()。
 * GOAL_EVENT_TYPES 含 own_goal（記給對方）；射手榜的 SCORING_TYPES 不含，兩邊不要互引。
 */

import type { Score, TimelineEvent } from './types.js';

export const GOAL_EVENT_TYPES = ['goal', 'own_goal', 'penalty_scored'] as const;

/** 有效事件：未作廢。 */
export const isLive = (e: TimelineEvent | null | undefined): boolean => !!e && e.voided !== true;

/**
 * 由 timeline 推算比分。烏龍球記給對方。
 * side 記的是踢球球員的隊伍，分數要算給對手。
 */
export function scoreFromTimeline(
  events: TimelineEvent[] | null | undefined,
  { includeShootout = false }: { includeShootout?: boolean } = {}
): { home: number; away: number } {
  const out = { home: 0, away: 0 };
  for (const e of events || []) {
    if (!isLive(e) || !GOAL_EVENT_TYPES.includes(e.type as typeof GOAL_EVENT_TYPES[number])) continue;
    if (!includeShootout && e.periodId === 'pk') continue;
    if (e.side !== 'home' && e.side !== 'away') continue;
    const credit = e.type === 'own_goal'
      ? (e.side === 'home' ? 'away' : 'home')
      : e.side;
    out[credit] += 1;
  }
  return out;
}

/**
 * 事件加總與登錄比分是否一致。不一致時警示但不阻擋。
 * 比分用嚴格型別，不可用 Number(v)（Number(null) 是 0）。
 */
export function reconcileScore(
  score: Partial<Score> | null | undefined,
  events: TimelineEvent[] | null | undefined
): {
  ok: boolean;
  derived: { home: number; away: number };
  entered: { home: number | null; away: number | null };
  complete: boolean;
} {
  const derived = scoreFromTimeline(events);
  const h = strictNum(score?.home);
  const a = strictNum(score?.away);
  const complete = h !== null && a !== null;
  return {
    ok: complete && derived.home === h && derived.away === a,
    derived,
    entered: { home: h, away: a },
    complete
  };
}

function strictNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function lastPlayedPeriod(events: TimelineEvent[] | null | undefined): string {
  let best: TimelineEvent | null = null;
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'period_start') continue;
    if (best === null || (e.seq ?? 0) >= (best.seq ?? 0)) best = e;
  }
  // 沒有 period_start 時退回 h1。退回 h2 會讓單節比賽顯示成下半場。
  return best?.periodId ?? 'h1';
}
