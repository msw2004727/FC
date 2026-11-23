/**
 * 同分排序｜隨機案例壓力測試
 * ------------------------------------------------------------------
 * 手寫案例只能涵蓋想得到的情況。這裡用固定種子的偽隨機產生大量小組，
 * 刻意製造大量同分，驗證三件事：
 *
 *   1. 不會爆炸、不會無限遞迴
 *   2. **順序穩定**：同一份資料重放、或把陣列順序打亂，結果必須完全一致
 *      （這是冪等性 T13 的根本；不穩定的排序會讓積分榜每次重算就跳動）
 *   3. rank 永遠是 1..n 的完整排列，不重不漏
 */
import { computeRows, buildStanding } from '../src/engine/standing.js';
import { rankRows } from '../src/engine/ranking.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { shuffle, order } from './_helpers.js';

/** 固定種子的線性同餘亂數，保證每次 CI 跑到的是同一批案例 */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** 產生一個小組：n 隊單循環，比分刻意集中在 0–2 以製造大量同分 */
function makeGroup(rand, n) {
  const teamIds = Array.from({ length: n }, (_, i) => `t${i + 1}`);
  const matches = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      matches.push({
        matchId: `m${++k}`, stageId: 'group', groupId: 'A',
        home: { teamId: teamIds[i] }, away: { teamId: teamIds[j] },
        teamIds: [teamIds[i], teamIds[j]],
        score: { home: Math.floor(rand() * 3), away: Math.floor(rand() * 3) },
        status: 'finished',
        kickoffAt: `2026-10-11T0${(k % 9) + 1}:00:00+08:00`
      });
    }
  }
  return { teamIds, matches };
}

const RULES = Object.values(RANKING_RULES);

describe('隨機小組壓力測試（600 組）', () => {
  const rand = rng(20261011);
  const cases = [];
  for (let i = 0; i < 600; i++) {
    const n = 2 + Math.floor(rand() * 5);          // 2–6 隊
    cases.push({ ...makeGroup(rand, n), rule: RULES[i % RULES.length], n });
  }

  test('全部案例都不丟例外，且 rank 是 1..n 的完整排列', () => {
    for (const c of cases) {
      const { rows } = rankRows(computeRows(c.teamIds, c.matches, c.rule), c.matches, c.rule);
      expect(rows.map(r => r.rank)).toEqual(Array.from({ length: c.n }, (_, i) => i + 1));
      expect(new Set(rows.map(r => r.teamId)).size).toBe(c.n);
    }
  });

  test('重放 3 次結果完全一致', () => {
    for (const c of cases) {
      const run = () => rankRows(computeRows(c.teamIds, c.matches, c.rule), c.matches, c.rule);
      const a = run();
      expect(order(run().rows)).toEqual(order(a.rows));
      expect(order(run().rows)).toEqual(order(a.rows));
      expect(run().hasUnresolvedTie).toBe(a.hasUnresolvedTie);
    }
  });

  test('打亂場次與球隊順序後結果仍一致', () => {
    for (const c of cases) {
      const base = order(rankRows(computeRows(c.teamIds, c.matches, c.rule), c.matches, c.rule).rows);
      for (const seed of [3, 77]) {
        const ms = shuffle(c.matches, seed);
        const ts = shuffle(c.teamIds, seed);
        expect(order(rankRows(computeRows(ts, ms, c.rule), ms, c.rule).rows)).toEqual(base);
      }
    }
  });

  test('確實有製造出足量的同分與待裁定案例（否則這個測試沒在測東西）', () => {
    const unresolved = cases.filter(c =>
      rankRows(computeRows(c.teamIds, c.matches, c.rule), c.matches, c.rule).hasUnresolvedTie).length;
    expect(unresolved).toBeGreaterThan(30);
  });

  test('buildStanding 的完整輸出也是冪等的', () => {
    for (const c of cases.slice(0, 100)) {
      const args = {
        // ported: eventId 改名 competitionId（多賽事；standing id 格式不變）
    competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
        teamIds: c.teamIds, matches: c.matches, rule: c.rule
      };
      expect(buildStanding(args).rows).toEqual(buildStanding(args).rows);
    }
  });
});

describe('極端輸入', () => {
  test('所有隊伍數據完全相同（8 隊全 0:0）不會卡住', () => {
    const teamIds = Array.from({ length: 8 }, (_, i) => `t${i + 1}`);
    const matches = [];
    let k = 0;
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        matches.push({
          matchId: `m${++k}`, home: { teamId: teamIds[i] }, away: { teamId: teamIds[j] },
          teamIds: [teamIds[i], teamIds[j]], score: { home: 0, away: 0 }, status: 'finished'
        });
      }
    }
    const t0 = Date.now();
    const { rows, hasUnresolvedTie } = rankRows(
      computeRows(teamIds, matches, RANKING_RULES.RR_FEDA_DEFAULT), matches, RANKING_RULES.RR_FEDA_DEFAULT);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(hasUnresolvedTie).toBe(true);
    expect(rows.every(r => r.hasUnresolvedTie === true)).toBe(true);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('空小組與單隊小組', () => {
    const R = RANKING_RULES.RR_FEDA_DEFAULT;
    expect(rankRows([], [], R)).toEqual({ rows: [], hasUnresolvedTie: false });
    const one = rankRows(computeRows(['A'], [], R), [], R);
    expect(one.rows.length).toBe(1);
    expect(one.rows[0].rank).toBe(1);
    expect(one.hasUnresolvedTie).toBe(false);
  });

  test('一場都還沒打的小組：全 0 分、標記待裁定但不隨機', () => {
    const R = RANKING_RULES.RR_FEDA_DEFAULT;
    const ids = ['C', 'A', 'B'];
    const first = order(rankRows(computeRows(ids, [], R), [], R).rows);
    expect(first).toEqual(['A', 'B', 'C']);
    expect(order(rankRows(computeRows(['B', 'C', 'A'], [], R), [], R).rows)).toEqual(first);
  });
});
