/**
 * 列表、詳情、按鈕、分享共用的賽事階段推導。
 * 時間先過 toMillis（毫秒、ISO、Date、有 toMillis() 的物件）。
 */

import type { CompetitionDoc, CompetitionPhase } from './types.js';
import { toMillis } from './util.js';

/** 末場開賽後 3 天，成績仍未結算則標記待補。 */
export const SCORE_PENDING_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** 末場開賽後 14 天，進行中的賽事可自動結束。 */
export const AUTO_END_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const idle = (phase: CompetitionPhase['phase']): CompetitionPhase => ({
  phase,
  regOpen: false,
  scorePending: false,
  autoEndDue: false
});

/**
 * 依序：draft → cancelled → postponed → 有 endedAt → 開賽前（recruiting／warmup）→ live。
 * 非 draft 但 firstMatchAt 無法解析時丟 TypeError。
 */
export function deriveCompetitionPhase(doc: CompetitionDoc, nowMs: number): CompetitionPhase {
  if (doc == null || typeof doc !== 'object') {
    throw new TypeError('deriveCompetitionPhase：doc 必須是物件');
  }
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('deriveCompetitionPhase：nowMs 必須是有限數字');
  }

  if (doc.status === 'draft') return idle('draft');

  const first = toMillis(doc.firstMatchAt);
  if (first == null) {
    throw new TypeError('deriveCompetitionPhase：非 draft 必須能解析 firstMatchAt');
  }

  if (doc.status === 'cancelled') return idle('cancelled');
  if (doc.status === 'postponed') return idle('postponed');

  if (doc.endedAt != null) {
    const endedAt = toMillis(doc.endedAt);
    if (endedAt == null) throw new TypeError('deriveCompetitionPhase：endedAt 無法解析');
    return idle('ended');
  }

  let phase: CompetitionPhase['phase'];
  if (nowMs < first) {
    const regClose = toMillis(doc.regCloseAt);
    if (regClose == null) throw new TypeError('deriveCompetitionPhase：regCloseAt 無法解析');
    phase = nowMs < regClose ? 'recruiting' : 'warmup';
  } else {
    phase = 'live';
  }

  let regOpen = false;
  if (phase === 'recruiting') {
    const regOpenAt = toMillis(doc.regOpenAt);
    if (regOpenAt == null) throw new TypeError('deriveCompetitionPhase：regOpenAt 無法解析');
    regOpen = nowMs >= regOpenAt;
  }

  let scorePending = false;
  let autoEndDue = false;
  if (phase === 'live') {
    const last = toMillis(doc.lastMatchAt);
    if (last == null) throw new TypeError('deriveCompetitionPhase：lastMatchAt 無法解析');
    scorePending = nowMs >= last + SCORE_PENDING_AFTER_MS;
    autoEndDue = nowMs >= last + AUTO_END_AFTER_MS;
  }

  return { phase, regOpen, scorePending, autoEndDue };
}
