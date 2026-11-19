/**
 * 末場確認結束時的冠軍名（§3.274／Q11）。純函式。
 * 每一組取名次 1 且未標待裁定的那一隊。該列 hasUnresolvedTie、或第 1 名不是恰好一隊，就不寫該組。
 * 後面名次仍待裁定、但第 1 名已經分開時，仍寫冠軍。
 */
export interface ChampionStanding {
  divisionId: string;
  groupId: string;
  rows?: Array<{ rank?: number; name?: string | null; hasUnresolvedTie?: boolean }>;
}

export interface Champion {
  dv: string;
  n: string;
}

const NAME_MAX = 30;

function clipName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return Array.from(text).slice(0, NAME_MAX).join('');
}

export function championsFromStandings(items: readonly ChampionStanding[]): Champion[] {
  const sorted = [...items].sort((a, b) =>
    a.divisionId.localeCompare(b.divisionId) || a.groupId.localeCompare(b.groupId));
  const out: Champion[] = [];
  for (const standing of sorted) {
    if (!standing.divisionId) continue;
    const rows = Array.isArray(standing.rows) ? standing.rows : [];
    const first = rows.filter(row => row.rank === 1);
    if (first.length !== 1) continue;
    const row = first[0];
    if (!row || row.hasUnresolvedTie === true) continue;
    const name = clipName(row.name);
    if (!name) continue;
    out.push({ dv: standing.divisionId, n: name });
  }
  return out;
}
