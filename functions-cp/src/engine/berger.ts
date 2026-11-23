/**
 * 循環賽程產生｜Berger（circle method）
 * 純函式、零依賴。規格：02-賽制引擎與排名規則.md §4
 */

/**
 * 產生單循環賽程。
 * @returns rounds[r] = [[homeIdx, awayIdx], ...]
 * 保證：每隊每輪最多一場、任兩隊恰好一次、主客盡量平均、奇數隊輪空不排場。
 */
export function berger(n: number): Array<Array<[number, number]>> {
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError('berger(n)：n 必須是 >= 2 的整數');
  }

  const teams: number[] = [...Array(n).keys()];
  if (n % 2 === 1) teams.push(-1); // -1 = 輪空

  const m = teams.length;
  const rounds: Array<Array<[number, number]>> = [];

  for (let r = 0; r < m - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < m / 2; i++) {
      const a = teams[i] as number;
      const b = teams[m - 1 - i] as number;
      if (a === -1 || b === -1) continue;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    const last = teams.pop();
    if (last === undefined) throw new RangeError('berger：輪轉失敗');
    teams.splice(1, 0, last); // 固定第 0 位，其餘輪轉
  }

  return rounds;
}

/**
 * 雙循環：第二輪主客對調。
 * legs 不是 1 時只做一輪主客對調（不會做三循環）。
 */
export function roundRobin(n: number, legs: 1 | 2 | number = 1): Array<Array<[number, number]>> {
  const first = berger(n);
  if (legs === 1) return first;
  const second = first.map(round => round.map(([h, a]) => [a, h] as [number, number]));
  return [...first, ...second];
}

/**
 * 蛇形分組。seed: 1 2 3 4 5 6 7 8 → A B B A A B B A
 */
export function snakeSeed<T extends { seed?: number }>(teams: T[], groupCount: number): T[][] {
  if (groupCount < 1) throw new RangeError('groupCount 必須 >= 1');

  const sorted = [...teams].sort(
    (x, y) => (x.seed ?? Number.MAX_SAFE_INTEGER) - (y.seed ?? Number.MAX_SAFE_INTEGER)
  );

  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  sorted.forEach((team, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const g = row % 2 === 0 ? col : groupCount - 1 - col;
    groups[g]?.push(team);
  });

  return groups;
}

/** 小組代號：0 → 'A'、1 → 'B'… */
export function groupLabel(index: number): string {
  return String.fromCharCode(65 + index);
}
