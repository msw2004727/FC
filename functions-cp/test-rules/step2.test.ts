/**
 * 第 2 步（建賽與名單）會用到的讀寫路徑：報隊私密、名單私密、代填（uid null）、內部賽事、頂層稽核、
 * 用戶端繞過 Callable 直接寫名單。每條拒絕案例各自一條斷言（assertFails 不接受「預算耗盡」當拒絕）。
 * 另附 pad 量測：在 canReadCompData 前插入恆真運算式，確認第 2 步讀取路徑的運算式餘裕。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where, type Firestore
} from 'firebase/firestore';
import { RULES_FILE, adminDb, assertFails, assertSucceeds, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { seedBase } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const anon = () => clientDb(null);
const get1 = (db: Firestore, p: string) => getDoc(doc(db, p));

async function seedStep2() {
  const db = adminDb();
  const b = db.batch();
  // 另一隊 club_b：代表 repb、成員 mb；不是 club_a 的任何人
  b.set(db.doc('cpClubs/club_b'), { repUids: ['repb'], name: '乙隊' });
  b.set(db.doc('cpClubs/club_b/members/mb'), { since: new Date() });
  // 測試者同時是 club_a 代表（內部期驗收帳號的典型身分）
  b.set(db.doc('cpClubs/club_a'), { repUids: ['rep', 'tester'], name: '甲隊' });
  b.set(db.doc('cpAudits/del_cp_x'), { action: 'deleteCompetition', cid: 'cp_x' });
  for (const cid of ['cp_pub', 'cp_int', 'cp_draft']) {
    b.set(db.doc(`competitions/${cid}/entries/en_b`), { teamId: 'club_b', dvId: 'dv_1', name: '乙隊', status: 'pending' });
    b.set(db.doc(`competitions/${cid}/entryPrivate/en_b`), { teamId: 'club_b', registeredByUid: 'repb', contactPhone: '0900' });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_b1`), { teamId: 'club_b', enId: 'en_b', uid: 'mb', realName: '乙球員' });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_b2`), { teamId: 'club_b', enId: 'en_b', uid: null, realName: '乙代填', addedByUid: 'repb' });
  }
  b.set(db.doc('cpMine/mb/items/cp_pub'), { cid: 'cp_pub', roles: ['player'] });
  await b.commit();
}

beforeAll(async () => { await loadRules(); await clearDb(); await seedBase(); await seedStep2(); });
afterEach(async () => { await closeClients(); });
afterAll(async () => { await clearDb(); });

describe('報隊私密 entryPrivate（第 2 步）', () => {
  it('代表帶 teamId 篩選可列自己隊的報隊私密', async () => {
    await assertSucceeds(getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), where('teamId', '==', 'club_b'), limit(10))));
  });
  it('【拒】代表不帶 teamId 篩選列全部', async () => {
    await assertFails(getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), limit(10))));
  });
  it('【拒】他隊代表以本隊 teamId 篩選列別隊', async () => {
    await assertFails(getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), where('teamId', '==', 'club_a'), limit(10))));
  });
  it('【拒】他隊代表讀別隊單筆', async () => {
    await assertFails(get1(as('rep'), 'competitions/cp_pub/entryPrivate/en_b'));
  });
  it('【拒】成員（非代表）讀自己隊的報隊私密（聯絡電話）', async () => {
    await assertFails(get1(as('mb'), 'competitions/cp_pub/entryPrivate/en_b'));
  });
  it('【拒】limit 超過 100', async () => {
    await assertFails(getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), where('teamId', '==', 'club_b'), limit(101))));
  });
  it('【拒】代表讀草稿賽事的報隊私密（父文件不可讀）', async () => {
    await assertFails(get1(as('repb'), 'competitions/cp_draft/entryPrivate/en_b'));
  });
});

describe('名單私密 rosterPrivate（第 2 步：自己登錄與代填）', () => {
  it('球員本人帶 uid 篩選可列自己的', async () => {
    await assertSucceeds(getDocs(query(collection(as('mb'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'mb'), limit(10))));
  });
  it('代表可讀本隊代填（uid null）球員', async () => {
    await assertSucceeds(get1(as('repb'), 'competitions/cp_pub/rosterPrivate/pl_b2'));
  });
  it('【拒】以 uid == null 篩選列代填球員（一般會員）', async () => {
    await assertFails(getDocs(query(collection(as('stranger'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', null), limit(10))));
  });
  it('【拒】未登入以 uid == null 篩選', async () => {
    await assertFails(getDocs(query(collection(anon(), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', null), limit(10))));
  });
  it('【拒】同隊其他成員讀代填球員真名', async () => {
    await assertFails(get1(as('mb'), 'competitions/cp_pub/rosterPrivate/pl_b2'));
  });
  it('【拒】他隊代表帶他隊 teamId 篩選', async () => {
    await assertFails(getDocs(query(collection(as('rep'), 'competitions/cp_pub/rosterPrivate'), where('teamId', '==', 'club_b'), limit(10))));
  });
  it('【拒】球員帶別人的 uid 篩選', async () => {
    await assertFails(getDocs(query(collection(as('mb'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'm1'), limit(10))));
  });
  it('主辦可列全部名單私密（檢錄）', async () => {
    await assertSucceeds(getDocs(query(collection(as('host'), 'competitions/cp_pub/rosterPrivate'), limit(100))));
  });
});

describe('內部賽事（內部期驗收：管理員建賽、測試者報隊）', () => {
  it('測試者（club_a 代表）可讀內部賽事的公開子集合與本隊報隊私密', async () => {
    const t = as('tester');
    await assertSucceeds(get1(t, 'competitions/cp_int'));
    await assertSucceeds(getDocs(query(collection(t, 'competitions/cp_int/entries'), limit(32))));
    await assertSucceeds(getDocs(query(collection(t, 'competitions/cp_int/divisions'), limit(4))));
    await assertSucceeds(getDocs(query(collection(t, 'competitions/cp_int/entryPrivate'), where('teamId', '==', 'club_a'), limit(10))));
  });
  it('【拒】非測試者代表讀內部賽事的報隊私密', async () => {
    await assertFails(get1(as('repb'), 'competitions/cp_int/entryPrivate/en_b'));
  });
  it('【拒】非測試者球員讀內部賽事自己的名單私密', async () => {
    await assertFails(get1(as('mb'), 'competitions/cp_int/rosterPrivate/pl_b1'));
  });
  it('【拒】非測試者讀內部賽事公開名單', async () => {
    await assertFails(getDocs(query(collection(as('mb'), 'competitions/cp_int/roster'), limit(10))));
  });
});

describe('頂層稽核與用戶端繞過 Callable', () => {
  it('【拒】cpAudits 用戶端讀（含管理員）', async () => {
    await assertFails(get1(as('admin', 'admin'), 'cpAudits/del_cp_x'));
  });
  it('【拒】cpAudits 用戶端 list', async () => {
    await assertFails(getDocs(query(collection(as('admin', 'admin'), 'cpAudits'), limit(10))));
  });
  it('【拒】cpAudits 用戶端寫', async () => {
    await assertFails(setDoc(doc(as('admin', 'admin'), 'cpAudits/x'), { action: 'x' }));
  });
  const writes: [string, string, Record<string, unknown>][] = [
    ['球員自己寫名單（繞過資格判斷）', 'competitions/cp_pub/roster/pl_new', { enId: 'en_h', displayName: 'x', number: 1, isMinor: false }],
    ['球員自己寫名單私密', 'competitions/cp_pub/rosterPrivate/pl_new', { teamId: 'club_a', uid: 'm1', realName: 'x' }],
    ['代表自己寫報隊', 'competitions/cp_pub/entries/en_new', { teamId: 'club_a', dvId: 'dv_1', status: 'approved' }],
    ['代表自己寫報隊私密', 'competitions/cp_pub/entryPrivate/en_new', { teamId: 'club_a', paymentStatus: 'paid' }],
    ['主辦直接改組別', 'competitions/cp_pub/divisions/dv_1', { name: 'x', maxTeams: 99 }],
    ['自己寫 cpMine', 'cpMine/m1/items/cp_pub', { cid: 'cp_pub', roles: ['host'] }],
    ['自己寫建賽配額', 'cpHostQuota/host', { recentCreates: [] }],
    ['自己寫檢舉', 'competitions/cp_pub/reports/rp_x', { reason: 'x' }],
    ['自己寫賽事稽核', 'competitions/cp_pub/audits/a_x', { action: 'x' }]
  ];
  for (const [label, p, data] of writes) {
    it(`【拒】${label}（create）`, async () => {
      const who = p.startsWith('competitions/cp_pub/divisions') || p.startsWith('cpHostQuota') ? 'host' : p.includes('entr') ? 'rep' : 'm1';
      await assertFails(setDoc(doc(as(who), p), data));
    });
  }
  it('【拒】主辦改報隊狀態、改名單背號、刪名單（update／delete）', async () => {
    await assertFails(updateDoc(doc(as('host'), 'competitions/cp_pub/entries/en_h'), { status: 'approved' }));
    await assertFails(updateDoc(doc(as('host'), 'competitions/cp_pub/roster/pl_1'), { number: 9 }));
    await assertFails(deleteDoc(doc(as('host'), 'competitions/cp_pub/roster/pl_1')));
  });
  it('【拒】主辦直接改賽事根文件（例如自行改成 public）', async () => {
    await assertFails(updateDoc(doc(as('host'), 'competitions/cp_int'), { visibility: 'public' }));
  });
});

// ── pad 量測（V5 作法延伸到第 2 步讀取路徑）──────────────────────────
function paddedRules(n: number): string {
  const src = fs.readFileSync(RULES_FILE, 'utf8');
  const groups: string[] = [];
  const calls: string[] = [];
  for (let g = 0; g * 25 < n; g++) {
    const terms = [];
    for (let i = g * 25; i < Math.min(n, (g + 1) * 25); i++) terms.push(`${i + 1} == ${i + 1}`);
    groups.push(`    function cpPad${g}() { return ${terms.join(' && ')}; }`);
    calls.push(`cpPad${g}()`);
  }
  const marker = '    function canReadCompData(cid, c) {\n      return isAdmin()';
  if (!src.includes(marker)) throw new Error('找不到 canReadCompData 插入點');
  const padExpr = calls.length ? calls.join(' && ') + ' && (' : '(';
  return src
    .replace(marker, `${groups.join('\n')}\n    function canReadCompData(cid, c) {\n      return ${padExpr}isAdmin()`)
    .replace(/(\|\| \(internalGate\(c\) && isHostOrCo\(cid, c\)\));/, '$1);');
}

describe('pad 量測：第 2 步讀取路徑', () => {
  const tmp = path.join(os.tmpdir(), `cp-step2-pad-${process.pid}.rules`);
  afterAll(async () => { fs.rmSync(tmp, { force: true }); await loadRules(); });

  const probes: [string, () => Promise<unknown>][] = [
    ['代表列本隊報隊私密', () => getDocs(query(collection(as('repb'), 'competitions/cp_pub/entryPrivate'), where('teamId', '==', 'club_b'), limit(10)))],
    ['代表讀本隊代填球員', () => getDoc(doc(as('repb'), 'competitions/cp_pub/rosterPrivate/pl_b2'))],
    ['測試者列內部賽事本隊報隊私密', () => getDocs(query(collection(as('tester'), 'competitions/cp_int/entryPrivate'), where('teamId', '==', 'club_a'), limit(10)))],
    ['球員列自己的名單私密', () => getDocs(query(collection(as('mb'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'mb'), limit(10)))]
  ];
  const result: Record<number, Record<string, boolean>> = {};
  const budget: Record<number, number> = {};
  for (const n of [0, 100, 125, 150, 175, 200]) {
    it(`pad ${n}`, async () => {
      fs.writeFileSync(tmp, paddedRules(n), 'utf8');
      await loadRules(undefined, tmp);
      result[n] = {};
      for (const [label, run] of probes) {
        try { await run(); result[n][label] = true; } catch (e) {
          result[n][label] = false;
          if (/maximum of 1000/i.test(String((e as Error).message))) budget[n] = (budget[n] ?? 0) + 1;
        }
        await closeClients();
      }
      // eslint-disable-next-line no-console
      console.log(`[pad ${n}]`, JSON.stringify(result[n]), `預算耗盡 ${budget[n] ?? 0} 條`);
      if (n <= 100) expect(Object.values(result[n]).every(Boolean), `pad ${n} 有讀取路徑失敗：${JSON.stringify(result[n])}`).toBe(true);
    });
  }
});

describe('§3.251 (a)(c)：主辦權只認目前代表與 staff 角色', () => {
  it('俱樂部賽事：被撤換的前代表（不在 repUids）不能讀草稿、報隊私密、名單私密', async () => {
    await adminDb().doc('cpClubs/club_a').update({ repUids: ['tester'] });
    try {
      await assertFails(get1(as('rep'), 'competitions/cp_club_draft'));
      await assertFails(get1(as('rep'), 'competitions/cp_club/entryPrivate/en_b'));
      await assertFails(getDocs(query(collection(as('rep'), 'competitions/cp_club/rosterPrivate'), limit(10))));
    } finally {
      await adminDb().doc('cpClubs/club_a').update({ repUids: ['rep', 'tester'] });
    }
  });
  it('發起人（staff creator，已非代表）可讀報隊與名單私密以審核（站長 11-18），但不能寫', async () => {
    await adminDb().doc('competitions/cp_club/staff/exrep').set({ roles: ['creator'], matchIds: [] });
    await assertSucceeds(getDocs(query(collection(as('exrep'), 'competitions/cp_club/entryPrivate'), limit(100))));
    await assertSucceeds(get1(as('exrep'), 'competitions/cp_club/rosterPrivate/pl_2'));
    await assertFails(updateDoc(doc(as('exrep'), 'competitions/cp_club/entries/en_h'), { status: 'approved' }));
  });
  it('目前代表可讀俱樂部草稿與全部名單私密（主辦檢錄）', async () => {
    await assertSucceeds(get1(as('rep'), 'competitions/cp_club_draft'));
    await assertSucceeds(getDocs(query(collection(as('rep'), 'competitions/cp_club/rosterPrivate'), limit(100))));
  });
  it('個人主辦（staff host）可讀草稿與全部名單私密；staff 文件不存在的人不行', async () => {
    await assertSucceeds(get1(as('host'), 'competitions/cp_draft'));
    await assertSucceeds(getDocs(query(collection(as('host'), 'competitions/cp_pub/rosterPrivate'), limit(100))));
    await assertFails(get1(as('stranger'), 'competitions/cp_draft'));
  });
  it('公開已發布賽事：訪客讀根文件與公開子集合不需相依讀取（先判公開條件）', async () => {
    await assertSucceeds(get1(anon(), 'competitions/cp_pub'));
    await assertSucceeds(getDocs(query(collection(anon(), 'competitions/cp_pub/entries'), limit(32))));
  });
});
