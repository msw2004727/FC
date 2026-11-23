/**
 * 晉級解算。
 * TeamSource 解不出來就回 null，不猜。積分榜有待裁定的同分時不解算。
 */

import type { AdvanceCtx, Format, MatchLike, TeamInfo, TeamSource } from './types.js';
import { standingIdOf } from './standing.js';

/** 可視為「已產生勝負」的狀態 */
const DECIDED_STATUSES = ['finished', 'confirmed', 'walkover'];

/**
 * 下游場次還沒開打、可以安全覆寫 home/away 的狀態。
 * 必須包含 'ready'：解算成功會把場次設成 ready，
 * 少了它，第二次解算會被自己的產物擋住。
 */
const WRITABLE_STATUSES = ['scheduled', 'checkin', 'ready'];

export interface SourceExplain {
  teamId: string | null;
  ready: boolean;
  reason: string;
}

/**
 * 求值單一 TeamSource。
 * 尚未能決定時回傳 null。
 */
export function resolveTeamSource(
  source: TeamSource | null | undefined,
  ctx: AdvanceCtx
): string | null {
  return explainTeamSource(source, ctx).teamId;
}

/** 同 resolveTeamSource，但附上為什麼還解不出來。 */
export function explainTeamSource(
  source: TeamSource | null | undefined,
  ctx: AdvanceCtx
): SourceExplain {
  if (!source || !source.type) return miss('來源未定義');

  if (source.type === 'fixed') {
    return source.teamId ? hit(source.teamId, '指定隊伍') : miss('fixed 缺 teamId');
  }

  if (source.type === 'standing') {
    const id = standingIdOf(ctx.divisionId, source.stageId, source.groupId);
    const st = ctx.standings?.[id];
    if (!st) return miss(`找不到積分榜 ${id}`);
    if (st.hasUnresolvedTie) return miss(`${id} 有待裁定的同分，暫不解算`);
    const row = st.rows?.[source.rank - 1];
    if (!row?.teamId) return miss(`${id} 尚無第 ${source.rank} 名`);
    return hit(row.teamId, `${source.groupId}組第${source.rank}名`);
  }

  if (source.type === 'matchWinner' || source.type === 'matchLoser') {
    const m = ctx.matchesByKey?.[source.matchKey];
    if (!m) return miss(`找不到場次 ${source.matchKey}`);
    if (!DECIDED_STATUSES.includes(m.status ?? '')) return miss(`${source.matchKey} 尚未完賽`);
    const w = m.result?.winner;
    if (w !== 'home' && w !== 'away') {
      // 淘汰賽平手代表 drawRule 沒被執行（PK 未登錄），這是資料問題，不猜
      return miss(`${source.matchKey} 未產生勝負（result.winner=${w ?? 'null'}）`);
    }
    const want = source.type === 'matchWinner' ? w : (w === 'home' ? 'away' : 'home');
    const teamId = m[want]?.teamId;
    return teamId
      ? hit(teamId, `${source.matchKey} ${source.type === 'matchWinner' ? '勝隊' : '敗隊'}`)
      : miss(`${source.matchKey} 的 ${want} 尚無 teamId`);
  }

  if (source.type === 'seed') {
    const rank = source.rank;
    const teamId = Array.isArray(ctx.seeds) && Number.isInteger(rank) && rank >= 1
      ? ctx.seeds[rank - 1]
      : undefined;
    if (!teamId) return miss(`尚無第 ${rank} 種子`);
    return hit(teamId, `種子第${rank}名`);
  }

  const unknownType = (source as { type: string }).type;
  return miss(`未知的 TeamSource type：${unknownType}`);
}

const hit = (teamId: string, reason: string): SourceExplain => ({ teamId, ready: true, reason });
const miss = (reason: string): SourceExplain => ({ teamId: null, ready: false, reason });

/** 公開端顯示用的佔位文字（未解算時） */
export function describeTeamSource(
  source: TeamSource | null | undefined,
  labels: Record<string, string> = {}
): string {
  if (!source) return '待定';
  if (source.type === 'standing') return `${source.groupId}組第${source.rank}名`;
  if (source.type === 'seed') return `種子第${source.rank}名`;
  if (source.type === 'matchWinner') return `${labels[source.matchKey] || source.matchKey}勝隊`;
  if (source.type === 'matchLoser') return `${labels[source.matchKey] || source.matchKey}敗隊`;
  return '待定';
}

/**
 * 下游場次是否還能安全寫入晉級隊伍。
 * 已經有比分或已開打的場次一律擋下。
 * Number(score) > 0：null 會變成 0，0:0 仍可寫。維持原行為。
 */
export function isSlotWritable(match: MatchLike | null | undefined): boolean {
  if (!match) return false;
  if (!WRITABLE_STATUSES.includes(match.status ?? '')) return false;
  const s = match.score || {};
  if (Number(s.home) > 0 || Number(s.away) > 0) return false;
  return true;
}

export interface StageUpdate {
  matchId?: string;
  matchKey: string;
  noop: boolean;
  patch?: {
    home: ReturnType<typeof teamRefOf>;
    away: ReturnType<typeof teamRefOf>;
    teamIds: string[];
    status: 'ready';
  };
  trace?: { home: string; away: string };
}

export interface StageBlock {
  matchKey?: string;
  matchId?: string;
  stageId?: string;
  reason: string;
}

/**
 * 解算某個 Stage 的所有 slot。
 * 帶 onlyMatchKeys 時只解那些 slot：回傳的 allResolved／resolvedCount 只代表這些 slot，
 * 不代表整個階段都解完（要判斷整階段請省略 onlyMatchKeys 再呼叫一次）。
 */
export function resolveStage(
  format: Format | null | undefined,
  stageId: string,
  ctx: AdvanceCtx,
  onlyMatchKeys?: ReadonlySet<string> | readonly string[]
): {
  updates: StageUpdate[];
  blocked: StageBlock[];
  resolvedCount: number;
  allResolved: boolean;
  notApplicable?: boolean;
} {
  const stage = (format?.stages || []).find(s => s.stageId === stageId);
  const updates: StageUpdate[] = [];
  const blocked: StageBlock[] = [];
  if (!stage) {
    return { updates, blocked: [{ reason: `Format 沒有 stage ${stageId}` }], resolvedCount: 0, allResolved: false };
  }
  // 循環賽階段沒有 slots，不需要解算。回 allResolved:true 會讓呼叫端誤以為「解算完成」
  if (!stage.slots?.length) {
    return {
      updates,
      blocked: [{ stageId, reason: `${stageId} 不是需要解算的階段（沒有 slots）` }],
      resolvedCount: 0,
      allResolved: false,
      notApplicable: true
    };
  }

  const only = onlyMatchKeys == null
    ? null
    : onlyMatchKeys instanceof Set ? onlyMatchKeys : new Set(onlyMatchKeys);
  const slots = only ? stage.slots.filter(slot => only.has(slot.matchKey)) : stage.slots;
  if (only && slots.length === 0) {
    return { updates, blocked, resolvedCount: 0, allResolved: true };
  }

  for (const slot of slots) {
    const match = ctx.matchesByKey?.[slot.matchKey];
    if (!match) {
      blocked.push({ matchKey: slot.matchKey, reason: '找不到對應場次' });
      continue;
    }

    const home = explainTeamSource(slot.home, ctx);
    const away = explainTeamSource(slot.away, ctx);

    if (!home.ready || !away.ready || !home.teamId || !away.teamId) {
      blocked.push({
        matchKey: slot.matchKey,
        matchId: match.matchId,
        reason: [home.ready ? null : `home：${home.reason}`, away.ready ? null : `away：${away.reason}`]
          .filter(Boolean)
          .join('；')
      });
      continue;
    }
    if (home.teamId === away.teamId) {
      blocked.push({ matchKey: slot.matchKey, matchId: match.matchId, reason: '兩邊解出同一隊，設定有誤' });
      continue;
    }
    // noop 檢查一定要排在可寫入檢查之前。
    // 已經填好且結果相同時根本不需要寫，就算場次已開打也不該回報失敗。
    if (match.home?.teamId === home.teamId && match.away?.teamId === away.teamId) {
      updates.push({ matchId: match.matchId, matchKey: slot.matchKey, noop: true });
      continue;
    }
    if (!isSlotWritable(match)) {
      blocked.push({
        matchKey: slot.matchKey,
        matchId: match.matchId,
        reason: `場次已進行（status=${match.status}、score=${match.score?.home ?? 0}:${match.score?.away ?? 0}），需先清除比分並退回 scheduled`
      });
      continue;
    }

    updates.push({
      matchId: match.matchId,
      matchKey: slot.matchKey,
      noop: false,
      patch: {
        home: teamRefOf(home.teamId, ctx),
        away: teamRefOf(away.teamId, ctx),
        teamIds: [home.teamId, away.teamId],
        status: 'ready'
      },
      trace: { home: home.reason, away: away.reason }
    });
  }

  const resolvedCount = updates.length;
  return {
    updates,
    blocked,
    resolvedCount,
    allResolved: blocked.length === 0 && resolvedCount === slots.length
  };
}

function teamRefOf(teamId: string, ctx: AdvanceCtx) {
  const t: TeamInfo = ctx.teams?.[teamId] || {};
  return {
    teamId,
    name: t.shortName ?? t.name ?? null,
    abbr: t.abbr ?? null,
    logoUrl: t.logoUrl ?? null,
    colorPrimary: t.colors?.primary ?? null,
    placeholder: null,
    displayName: t.shortName ?? t.name ?? null
  };
}

/**
 * 某個 Stage 是否具備解算下一階段的前置條件。
 * 少帶 stageMatches、stageId 拼錯、空陣列，都當成不知道、不放行。
 */
export function canResolve(
  _format: Format | null | undefined,
  stageId: string,
  ctx: AdvanceCtx,
  stageState: { manualHold?: boolean } = {}
): { ready: boolean; reason: string } {
  if (stageState.manualHold === true) return { ready: false, reason: 'Admin 已鎖定自動晉級' };

  const stageMatches = ctx.stageMatches?.[stageId];
  if (!Array.isArray(stageMatches) || stageMatches.length === 0) {
    return { ready: false, reason: `缺少 ${stageId} 的場次資料，無法確認是否全部完賽` };
  }
  const pending = stageMatches.filter(m => !DECIDED_STATUSES.includes(m.status ?? ''));
  if (pending.length) {
    return { ready: false, reason: `${stageId} 尚有 ${pending.length} 場未完賽` };
  }
  const tied = Object.values(ctx.standings || {})
    .filter(s => s.stageId === stageId && s.hasUnresolvedTie);
  if (tied.length) {
    return { ready: false, reason: `${tied.map(s => s.standingId).join('、')} 有待裁定的同分` };
  }
  return { ready: true, reason: '' };
}

/**
 * 依 Format.finalRankingMap 解算最終排名。
 */
export function computeFinalRanking(format: Format | null | undefined, ctx: AdvanceCtx): {
  ranking: Array<{ rank: number; teamId: string; name: string | null; logoUrl: string | null }>;
  complete: boolean;
  missing: Array<{ rank: number; reason: string }>;
} {
  const ranking: Array<{ rank: number; teamId: string; name: string | null; logoUrl: string | null }> = [];
  const missing: Array<{ rank: number; reason: string }> = [];

  for (const item of format?.finalRankingMap || []) {
    const r = explainTeamSource(item.from, ctx);
    if (!r.ready || !r.teamId) {
      missing.push({ rank: item.rank, reason: r.reason });
      continue;
    }
    const t = ctx.teams?.[r.teamId] || {};
    ranking.push({
      rank: item.rank,
      teamId: r.teamId,
      name: t.shortName ?? t.name ?? null,
      logoUrl: t.logoUrl ?? null
    });
  }

  ranking.sort((a, b) => a.rank - b.rank);
  return { ranking, complete: rankingIsComplete(format, ranking, missing.length), missing };
}

/**
 * 全部隊伍都有名次才算完成。並列名次可以重複，但每隊只能出現一次。
 * 沒有 teamCount 的舊資料維持「來源都解出來就算完成」。
 */
function rankingIsComplete(
  format: Format | null | undefined,
  ranking: Array<{ teamId: string }>,
  missingCount: number
): boolean {
  if (missingCount !== 0) return false;
  const teamCount = format?.teamCount;
  if (typeof teamCount !== 'number') return true;
  if (ranking.length !== teamCount) return false;
  const seen = new Set<string>();
  for (const item of ranking) {
    if (!item.teamId || seen.has(item.teamId)) return false;
    seen.add(item.teamId);
  }
  return seen.size === teamCount;
}
