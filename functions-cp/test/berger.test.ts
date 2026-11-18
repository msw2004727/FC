import { berger, roundRobin, snakeSeed } from '../src/engine/berger.js';

describe('berger 循環賽程（docs/02 §11 T01）', () => {
  const flatten = rounds => rounds.flat();

  test.each([[3, 3], [4, 6], [6, 15], [8, 28]])('n=%i 產生 %i 場', (n, expected) => {
    expect(flatten(berger(n))).toHaveLength(expected);
  });

  test('任兩隊恰好對戰一次', () => {
    const pairs = flatten(berger(6)).map(([a, b]) => [a, b].sort().join('-'));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test('同一輪內每隊最多出現一次', () => {
    for (const round of berger(8)) {
      const seen = round.flat();
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  test('4 隊每隊 3 場（成人組分組賽）', () => {
    const count = {};
    for (const [h, a] of flatten(berger(4))) { count[h] = (count[h] || 0) + 1; count[a] = (count[a] || 0) + 1; }
    expect(Object.values(count)).toEqual([3, 3, 3, 3]);
  });

  test('雙循環場次加倍且主客對調', () => {
    expect(flatten(roundRobin(4, 2))).toHaveLength(12);
  });

  test('蛇形分組：seed 1..8 → A B B A A B B A', () => {
    const teams = Array.from({ length: 8 }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));
    const [A, B] = snakeSeed(teams, 2);
    expect(A.map(t => t.seed)).toEqual([1, 4, 5, 8]);
    expect(B.map(t => t.seed)).toEqual([2, 3, 6, 7]);
  });
});
