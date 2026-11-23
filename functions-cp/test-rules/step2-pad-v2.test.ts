/**
 * 第 2 步讀取路徑 pad 重量（顧問 §3.300 補：G3 前置）。
 * ------------------------------------------------------------------
 * step2.test.ts 的 pad 用常數比較（`1 == 1`），第 4 步實測發現常數 pad 量不出餘裕（記分路徑墊到 100 仍全過）。
 * 本檔對同一組讀取探針、同一個插入點（canReadCompData 的 return 最前面）用兩種 pad 並列量測：
 *   const：`N == N`（原寫法，對照用）
 *   data ：`c.get('cpPad_N', N) == N`（讀賽事文件內容、不能被常數化；c 是 canReadCompData 的參數，
 *          get／list 都適用。與記分路徑用的 request.resource.data.get 同類，但讀取請求沒有 request.resource）
 * broken：data 最後一項故意不成立，證明 pad 在評估路徑上。
 * 只量測、不改 Rules；結果印出 `[step2 pad <種類> <N>]` 行，報告附前後對照表。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { RULES_FILE, adminDb, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { seedBase } from './_fixtures.js';

type Kind = 'const' | 'data' | 'broken';
const LEVELS = [0, 25, 50, 75, 100, 150, 200, 300];
const as = (uid: string) => clientDb({ uid });

function paddedReadRules(kind: Kind, n: number): string {
  const src = fs.readFileSync(RULES_FILE, 'utf8');
  const defs: string[] = [];
  const calls: string[] = [];
  for (let g = 0; g * 25 < n; g++) {
    const terms: string[] = [];
    for (let i = g * 25; i < Math.min(n, (g + 1) * 25); i++) {
      if (kind === 'const') terms.push(`${i + 1} == ${i + 1}`);
      else {
        const want = kind === 'broken' && i === n - 1 ? i + 2 : i + 1;
        terms.push(`c.get('cpPad_${i}', ${i + 1}) == ${want}`);
      }
    }
    defs.push(`    function cpReadPad${g}(c) { return ${terms.join(' && ')}; }`);
    calls.push(`cpReadPad${g}(c)`);
  }
  const re = /(function canReadCompData\(cid, c\) \{\s*return )/;
  if (!re.test(src)) throw new Error('找不到 canReadCompData 插入點');
  // canReadCompData 的 return 是 a || b || c；pad 用括號包住原式，避免 && 只綁到第一項
  const body = /function canReadCompData\(cid, c\) \{\s*return ([\s\S]*?);\n    \}/;
  const m = src.match(body);
  if (!m) throw new Error('找不到 canReadCompData 本體');
  const padded = `function canReadCompData(cid, c) {\n      return ${calls.length ? calls.join(' && ') + ' && ' : ''}(${m[1]});\n    }`;
  const anchor = '    function canReadCompData(cid, c) {';
  return src.replace(body, padded).replace(anchor, `${defs.join('\n')}\n${anchor}`);
}

async function seedStep2(): Promise<void> {
  const db = adminDb();
  const b = db.batch();
  b.set(db.doc('cpClubs/club_b'), { repUids: ['repb'], name: '乙隊' });
  b.set(db.doc('cpClubs/club_b/members/mb'), { since: new Date() });
  b.set(db.doc('cpClubs/club_a'), { repUids: ['rep', 'tester'], name: '甲隊' });
  for (const cid of ['cp_pub', 'cp_int', 'cp_draft']) {
    b.set(db.doc(`competitions/${cid}/entries/en_b`), { teamId: 'club_b', dvId: 'dv_1', name: '乙隊', status: 'pending' });
    b.set(db.doc(`competitions/${cid}/entryPrivate/en_b`), { teamId: 'club_b', registeredByUid: 'repb', contactPhone: '0900' });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_b1`), { teamId: 'club_b', enId: 'en_b', uid: 'mb', realName: '乙球員' });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_b2`), { teamId: 'club_b', enId: 'en_b', uid: null, realName: '乙代填', addedByUid: 'repb' });
  }
  await b.commit();
}

// 與 step2.test.ts「pad 量測：第 2 步讀取路徑」相同的四條探針，另加公開賽事根文件與公開子集合各一條
const PROBES: [string, () => Promise<unknown>][] = [
  ['代表列本隊報隊私密', () => getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), where('teamId', '==', 'club_b'), limit(10)))],
  ['代表讀本隊代填球員', () => getDoc(doc(as('repb'), 'competitions/cp_pub/rosterPrivate/pl_b2'))],
  ['測試者列內部賽事本隊報隊私密', () => getDocs(query(collection(as('tester'), 'competitions/cp_int/entryPrivate'), where('teamId', '==', 'club_a'), limit(10)))],
  ['球員列自己的名單私密', () => getDocs(query(collection(as('mb'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'mb'), limit(10)))],
  ['觀眾讀公開賽事', () => getDoc(doc(as('mb'), 'competitions/cp_pub'))],
  ['觀眾列公開報隊', () => getDocs(query(collection(as('mb'), 'competitions/cp_pub/entries'), limit(10)))]
];

describe('pad 重量：第 2 步讀取路徑（常數 vs 資料相依）', () => {
  const tmp = path.join(os.tmpdir(), `cp-step2-pad-v2-${process.pid}.rules`);
  beforeAll(async () => { await loadRules(); await clearDb(); await seedBase(); await seedStep2(); });
  afterEach(async () => { await closeClients(); });
  afterAll(async () => { fs.rmSync(tmp, { force: true }); await loadRules(); });

  async function runProbes(): Promise<Record<string, string>> {
    const row: Record<string, string> = {};
    for (const [label, run] of PROBES) {
      try { await run(); row[label] = '過'; } catch (e) {
        row[label] = /maximum of 1000/i.test(String((e as Error).message)) ? '預算耗盡' : '拒';
      }
      await closeClients();
    }
    return row;
  }

  it('插入點檢查：data pad 最後一項不成立 → 每條探針都被拒', async () => {
    fs.writeFileSync(tmp, paddedReadRules('broken', 1), 'utf8');
    await loadRules(undefined, tmp);
    const row = await runProbes();
    expect(Object.entries(row).filter(([, v]) => v === '過'), 'pad 沒有插進評估路徑').toEqual([]);
  });

  for (const kind of ['const', 'data'] as const) {
    for (const n of LEVELS) {
      it(`${kind} pad ${n}`, async () => {
        fs.writeFileSync(tmp, paddedReadRules(kind, n), 'utf8');
        await loadRules(undefined, tmp);
        const row = await runProbes();
        // eslint-disable-next-line no-console
        console.log(`[step2 pad ${kind} ${n}]`, JSON.stringify(row));
        if (n === 0) expect(Object.values(row).every((v) => v === '過'), JSON.stringify(row)).toBe(true);
      });
    }
  }
});
