/**
 * 積分對照飛達盃案例（§12.4 第 3 步完成定義）：
 * 把引擎單元測試 T05／T06／T07／T09 的比分，經「真的 Callable 排賽程 → 主辦登錄並確認 → 觸發器重算」
 * 整條路徑跑一次，讀模擬器裡的 standings 文件，名次與數字必須和飛達盃規格（test/ranking.test.ts、
 * test/standing.test.ts）相同。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ADMIN, resetAll } from './_cp.js';
import { act, generate, matchesOf, orderNames, pairing, record, setupComp, standingOf } from './_step3.js';

type Row = [string, string, number, number];
async function play(teams: string[], rows: Row[]) {
  const c = await setupComp(teams);
  await generate(c);
  for (const [h, a, hs, as] of rows) await record(c, h, a, hs, as);
  return c;
}

describe('飛達盃積分案例（整條路徑）', () => {
  beforeEach(() => resetAll());

  it('T05 兩隊同分 → 直接對戰：A、B、D、C', async () => {
    const c = await play(['A', 'B', 'C', 'D'], [
      ['A', 'B', 1, 0], ['C', 'A', 2, 0], ['A', 'D', 1, 0], ['B', 'C', 2, 0], ['B', 'D', 3, 0], ['D', 'C', 1, 0]
    ]);
    const st = await standingOf(c);
    expect(orderNames(c, st!.rows)).toEqual(['A', 'B', 'D', 'C']);
    expect(st!.hasUnresolvedTie).toBe(false);
    const by = Object.fromEntries(st!.rows.map(r => [c.nameOf[r.teamId], r]));
    expect([by.A.points, by.B.points, by.A.goalDiff, by.B.goalDiff]).toEqual([6, 6, 0, 4]);
  });

  it('T06 三隊同分 → 迷你循環表：A、C、B、D', async () => {
    const c = await play(['A', 'B', 'C', 'D'], [
      ['A', 'B', 3, 0], ['B', 'C', 1, 0], ['C', 'A', 1, 0], ['A', 'D', 1, 0], ['B', 'D', 5, 0], ['C', 'D', 1, 0]
    ]);
    expect(orderNames(c, (await standingOf(c))!.rows)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('T07 三隊同分拆出一隊後兩隊重比：前三名 A、B、C', async () => {
    const c = await play(['A', 'B', 'C', 'D', 'E'], [
      ['A', 'B', 5, 0], ['A', 'C', 1, 0], ['B', 'C', 2, 2], ['A', 'D', 0, 0], ['E', 'A', 1, 0],
      ['B', 'D', 6, 0], ['B', 'E', 6, 0], ['C', 'D', 1, 0], ['C', 'E', 1, 0], ['D', 'E', 1, 0]
    ]);
    const st = await standingOf(c);
    expect(orderNames(c, st!.rows).slice(0, 3)).toEqual(['A', 'B', 'C']);
    const b = st!.rows.find(r => c.nameOf[r.teamId] === 'B') as unknown as { tieBreakTrace: string[] };
    expect(b.tieBreakTrace).toContain('decided@goalDiff');
  });

  it('T09 棄賽判 0:2：A 棄賽勝 3 分＋和 C 1 分＝4 分，得球 3；B 失球 2', async () => {
    const c = await setupComp(['A', 'B', 'C']);
    await generate(c);
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, 'A', 'B', 0, 0);
    const forfeitSide = m.home.teamId === c.enIdOf.B ? 'home' : 'away';
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: 0, forfeitSide, reason: '逾時未出場' });
    await record(c, 'A', 'C', 1, 1);
    await record(c, 'B', 'C', 2, 0);
    const by = Object.fromEntries((await standingOf(c))!.rows.map(r => [c.nameOf[r.teamId], r]));
    expect(by.A).toMatchObject({ win: 1, points: 4, goalsFor: 3 });
    expect(by.B).toMatchObject({ loss: 1, goalsAgainst: 2 });
    // 末場確認 → 賽事自動結束
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('endedBy')).toBe('confirm');
  });
});
