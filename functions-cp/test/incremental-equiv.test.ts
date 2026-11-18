/**
 * 增量與全量等價：一場比賽改變後，refreshAfterMatchChange 解出的每個受影響 slot，
 * 必須與「全部場次都在 ctx」的全量 resolveStage 結果相同。
 * （DeepSeek flash 審查 P1-1：增量 ctx 漏放不受影響的上游場次，例如四強另一邊的八強勝隊。）
 */
import { describe, expect, test } from 'vitest';
import {
  buildGroupKnockoutFormat,
  buildGroups,
  buildMatches,
  buildStanding,
  refreshAfterMatchChange,
  resolveStage
} from '../src/engine/index.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import type { AdvanceCtx, MatchLike } from '../src/engine/types.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const lowerWins = (a: string, b: string) => Number(a.slice(1)) < Number(b.slice(1));

function finish(m: MatchLike & { home: { teamId: string }; away: { teamId: string } }): MatchLike {
  const hw = lowerWins(m.home.teamId, m.away.teamId);
  return { ...m, status: 'finished', score: { home: hw ? 2 : 0, away: hw ? 0 : 2 }, result: { winner: hw ? 'home' : 'away', method: 'regulation' } };
}

/** 4 組×4 隊、每組前 2 → 8 強；小組與八強全部打完，四強待解。 */
function worldWithQuarterFinals() {
  const format = buildGroupKnockoutFormat({ groupCount: 4, groupSize: 4, advancePerGroup: 2 });
  const teams = Array.from({ length: 16 }, (_, i) => ({ teamId: `t${i + 1}`, name: `t${i + 1}` }));
  const built = buildMatches({ division: { code: 'D', divisionId: 'div' }, format, groups: buildGroups(teams, 4) });
  const groups = built.groups.map(g => ({ groupId: String(g.groupId), teamIds: g.teamIds }));
  let matches: MatchLike[] = built.matches.map(m => (m.stageId === 'group' ? finish(m as never) : { ...m, status: 'scheduled' }));
  const standings: NonNullable<AdvanceCtx['standings']> = {};
  for (const g of groups) {
    const doc = buildStanding({
      competitionId: 'c1', divisionId: 'div', stageId: 'group', groupId: g.groupId, teamIds: g.teamIds,
      matches: matches.filter(m => m.stageId === 'group' && m.groupId === g.groupId), rule: RULE
    });
    standings[doc.standingId] = doc;
  }
  const koStage = format.stages.find(s => s.type === 'knockout')!;
  const fullCtx = (): AdvanceCtx => ({
    divisionId: 'div', standings,
    matchesByKey: Object.fromEntries(matches.filter(m => m.matchKey).map(m => [m.matchKey as string, m]))
  });
  // 套用第一輪（八強）解析結果並打完
  const first = resolveStage(format, koStage.stageId, fullCtx());
  const firstRoundKeys = new Set((koStage.slots ?? []).filter(s => s.home.type === 'standing').map(s => s.matchKey));
  matches = matches.map(m => {
    const up = first.updates.find(u => u.matchKey === m.matchKey);
    if (!up || !firstRoundKeys.has(m.matchKey as string)) return m;
    const next = { ...m, ...(up.patch ?? {}) } as MatchLike & { home: { teamId: string }; away: { teamId: string } };
    return finish(next);
  });
  return { format, groups, matches, standings, koStage, fullCtx };
}

describe('增量與全量等價', () => {
  test('改 A 組一場（名次不變）：四強 slot 的解析結果與全量相同', () => {
    const w = worldWithQuarterFinals();
    const changed = w.matches.find(m => m.stageId === 'group' && m.groupId === 'A')!;
    const inc = refreshAfterMatchChange({
      format: w.format,
      match: { divisionId: 'div', stageId: 'group', groupId: 'A', matchKey: changed.matchKey, status: 'finished' },
      groups: w.groups, matches: w.matches, rule: RULE, standings: w.standings, eventsChanged: false, competitionId: 'c1'
    });
    const full = resolveStage(w.format, w.koStage.stageId, w.fullCtx());
    const fullByKey = new Map(full.updates.map(u => [u.matchKey, u]));
    const checked: string[] = [];
    for (const r of inc.resolutions) {
      for (const u of r.updates) {
        expect(u.patch, `slot ${u.matchKey}`).toEqual(fullByKey.get(u.matchKey)?.patch);
        checked.push(u.matchKey);
      }
      // 全量能解出的受影響 slot，增量不能變成 blocked
      for (const b of r.blocked) {
        expect(fullByKey.has(b.matchKey), `slot ${b.matchKey} 增量被擋、全量可解`).toBe(false);
      }
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});
