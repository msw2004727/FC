/**
 * 單元測試共用工具
 * ------------------------------------------------------------------
 * 只做「造資料」，不含任何被測邏輯。
 */

/** 造一場已完賽的場次 */
export function mk(matchId, homeId, awayId, hs, as, over = {}) {
  return {
    matchId,
    // ported: eventId 改名 competitionId（多賽事；standing id 格式不變）
    competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
    home: { teamId: homeId, name: homeId },
    away: { teamId: awayId, name: awayId },
    teamIds: [homeId, awayId],
    score: { home: hs, away: as },
    status: 'finished',
    result: {
      winner: hs > as ? 'home' : hs < as ? 'away' : 'draw',
      method: 'regulation'
    },
    kickoffAt: `2026-10-11T0${(matchId.length % 8) + 1}:00:00+08:00`,
    walkoverSide: null,
    ...over
  };
}

/** 造一批場次：[[id, home, away, hs, as], ...] */
export const mkAll = rows => rows.map(r => mk(...r));

/** 造一張卡片事件 */
export function card(matchId, teamId, playerId, cardType, seq, over = {}) {
  return {
    matchId, type: 'card', teamId, side: 'home',
    playerId, cardType, seq, voided: false, ...over
  };
}

/** 造一顆進球事件 */
export function goal(matchId, teamId, playerId, type = 'goal', over = {}) {
  return {
    matchId, type, teamId, side: 'home', playerId,
    goalType: type === 'penalty_scored' ? 'penalty' : 'open',
    voided: false, ...over
  };
}

/** 洗牌，但用固定種子的線性同餘，讓測試可重現 */
export function shuffle(arr, seed = 42) {
  const a = [...arr];
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 由 rows 取出 teamId 順序，方便斷言 */
export const order = rows => rows.map(r => r.teamId);
