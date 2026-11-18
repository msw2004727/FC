/**
 * 一場比賽的勝負（由比分與 PK 決定）。
 * PK 只在正規時間平手時才決定勝負。比分一律嚴格型別檢查。
 */

import type { MatchResult } from './types.js';

/** 0 以上的整數才算比分；其他（null、undefined、字串、小數）一律 null。 */
export function scoreOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * 比分不合法回 null（呼叫端要 fail-closed，不寫入）。
 */
export function matchResult(
  score: { home?: unknown; away?: unknown } | null | undefined,
  penaltyScore: { home?: unknown; away?: unknown } | null = null,
  { winPoints = 3, drawPoints = 1 }: { winPoints?: number; drawPoints?: number } = {}
): MatchResult | null {
  const h = scoreOf(score?.home);
  const a = scoreOf(score?.away);
  if (h == null || a == null) return null;

  const pkH = scoreOf(penaltyScore?.home);
  const pkA = scoreOf(penaltyScore?.away);
  const hasPk = pkH != null && pkA != null;

  let winner: MatchResult['winner'] = h > a ? 'home' : h < a ? 'away' : 'draw';
  let method: MatchResult['method'] = 'regulation';
  if (winner === 'draw' && hasPk && pkH !== pkA) {
    winner = pkH > pkA ? 'home' : 'away';
    method = 'penalty';
  }

  return {
    winner,
    method,
    homePoints: winner === 'home' ? winPoints : winner === 'draw' ? drawPoints : 0,
    awayPoints: winner === 'away' ? winPoints : winner === 'draw' ? drawPoints : 0
  };
}
