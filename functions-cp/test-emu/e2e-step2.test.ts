/**
 * 第 2 步 e2e（§12.4 站長最小驗收劇本的模擬器版）：
 *   管理員建一場測試賽並發布 → 另一帳號（內部測試者、俱樂部代表＋成員）報隊 → 管理員核准 →
 *   該帳號登錄 1 人（自己）→ 代表確認名單 → 管理員鎖定名單（檢錄）。
 * 前端讀取走真正的用戶端 SDK＋asia-main Rules；Callable 走伺服器處理函式（Admin SDK）。
 *
 * 讀取預算斷言（§8.1）：
 * - 伺服器：每個 Callable 動作的 Admin SDK 讀取由 ReadMeter 實際計數（每份文件 1、查詢至少 1、聚合每千筆 1）。
 * - 用戶端：模擬器不提供計費數字，以「回傳文件數（空查詢記 1）＋Rules 相依讀取上限」計算；
 *   相依讀取依 firestore.asia-main.rules 的實際判斷路徑逐條列出（同一請求同一文件只計一次）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { clientDb, closeClients, assertFails } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { ADMIN, STRANGER, TESTER, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

/** 每個 Callable 動作的伺服器讀取上限（含內部期 testers 1 讀） */
const SERVER_BUDGET: Record<string, number> = {
  create: 4, publish: 4, registerEntry: 8, reviewEntry: 5, joinRoster: 11, confirmRoster: 7, lockRosters: 3
};

/** 用戶端頁面讀取上限（§8.1；內部期每個請求另加 testers exists 1） */
const CLIENT_BUDGET = {
  entrance: 2,          // cpConfig/launch 1 ＋ 內部期測試者文件 1
  hostList: 50,         // 主辦自己的清單：1 查詢 × ≤ 50
  detailRecruit: 39 + 3, // 根 1＋組別 ≤ 4（+1 父）＋隊伍 ≤ 32（+1 父）；內部期 3 個請求各 +1 testers
  mine: 50,             // cpMine 清單 ≤ 50
  myRosterPrivate: 1 + 4 // 自己的名單私密：文件 1＋相依（賽事、testers、staff、cpClubs）≤ 4
};

const ledger: { page: string; op: string; docs: number; deps: number }[] = [];
async function clientRead<T>(page: string, op: string, deps: number, p: Promise<T>): Promise<T> {
  const r = await p as unknown as { size?: number; exists?: () => boolean };
  const docs = typeof r.size === 'number' ? Math.max(1, r.size) : 1;
  ledger.push({ page, op, docs, deps });
  return r as unknown as T;
}
const pageTotal = (page: string) => ledger.filter(l => l.page === page).reduce((s, l) => s + l.docs + l.deps, 0);

const server: { action: string; reads: number }[] = [];
async function serverCall(handler: typeof handleCpHost, who: typeof ADMIN, data: Record<string, unknown>) {
  const meter = new ReadMeter();
  const r = await ok<Record<string, unknown>>(call(handler, who, data, makeDeps(0, meter)));
  server.push({ action: String(data.action), reads: meter.reads });
  return r;
}

beforeAll(async () => { await resetAll({ isPublic: false }); });
afterEach(async () => { await closeClients(); });
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log('[e2e 伺服器讀取]', JSON.stringify(server));
  // eslint-disable-next-line no-console
  console.log('[e2e 用戶端讀取]', JSON.stringify(ledger));
});

describe('§12.4 第 2 步最小驗收劇本', () => {
  let cid = '';
  let dvId = '';
  let enId = '';
  let plId = '';
  const t: () => Firestore = () => clientDb({ uid: 'tester' });

  it('1. 入口判斷（內部期）：測試者讀 launch 與自己的測試者文件', async () => {
    const db = t();
    const launch = await clientRead('entrance', 'get cpConfig/launch', 0, getDoc(doc(db, 'cpConfig/launch')));
    expect((launch as Awaited<ReturnType<typeof getDoc>>).get('isPublic')).toBe(false);
    await clientRead('entrance', 'get testers/me', 0, getDoc(doc(db, 'cpConfig/launch/testers/tester')));
    expect(pageTotal('entrance')).toBeLessThanOrEqual(CLIENT_BUDGET.entrance);
  });

  it('2. 管理員建賽（強制 internal）並發布；管理員自己的清單看得到', async () => {
    const created = await serverCall(handleCpHost, ADMIN, createInput({
      name: '【測試】站長驗收盃',
      divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 10 }]
    }));
    cid = String(created.cid);
    dvId = (created.dvIds as string[])[0];
    await serverCall(handleCpHost, ADMIN, { action: 'publish', cid });
    const a = clientDb({ uid: 'admin', role: 'admin' });
    // 主辦自己的清單改走 cpMine（§3.251 (c)）：路徑 uid == 自己，不讀相依文件
    const list = await clientRead('hostList', 'list cpMine（host）', 0,
      getDocs(query(collection(a, 'cpMine/admin/items'), limit(50))));
    const docs = (list as Awaited<ReturnType<typeof getDocs>>).docs;
    expect(docs.map(d => d.id)).toEqual([cid]);
    expect(docs[0].get('roles')).toEqual(['host']);
    // 點進去看根文件（Rules：isAdmin 成立）
    const root = await clientRead('hostList', 'get competition', 0, getDoc(doc(a, `competitions/${cid}`)));
    expect((root as Awaited<ReturnType<typeof getDoc>>).get('visibility')).toBe('internal');
    expect((root as Awaited<ReturnType<typeof getDoc>>).get('status')).toBe('published');
    expect(pageTotal('hostList')).toBeLessThanOrEqual(CLIENT_BUDGET.hostList);
  });

  it('3. 一般會員（非測試者）看不到、也不能報隊', async () => {
    await assertFails(getDoc(doc(clientDb({ uid: 'stranger' }), `competitions/${cid}`)));
    await fails(call(handleCpEntry, STRANGER, { action: 'registerEntry', cid, dvId, teamId: 'club_a' }), 'INTERNAL_PERIOD');
  });

  it('4. 另一帳號（測試者、俱樂部代表）開詳情（招募中）並報隊', async () => {
    const db = t();
    // 根文件：resource 本身＋internalGate → isTester（testers exists 1）
    await clientRead('detailRecruit', 'get competition', 1, getDoc(doc(db, `competitions/${cid}`)));
    // 子集合：canReadComp → get 父文件 1＋testers 1
    await clientRead('detailRecruit', 'list divisions', 2, getDocs(query(collection(db, `competitions/${cid}/divisions`), limit(4))));
    await clientRead('detailRecruit', 'list entries', 2, getDocs(query(collection(db, `competitions/${cid}/entries`), limit(32))));
    expect(pageTotal('detailRecruit')).toBeLessThanOrEqual(CLIENT_BUDGET.detailRecruit);

    const r = await serverCall(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a' });
    enId = String(r.enId);
    expect(r.status).toBe('pending');
  });

  it('5. 管理員核准（檢錄第一步）', async () => {
    const r = await serverCall(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' });
    expect(r.status).toBe('approved');
  });

  it('6. 測試者登錄 1 人（自己）；公開名單看得到、私密只有自己看得到', async () => {
    const r = await serverCall(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 10, position: 'FW', privacyAck: true });
    plId = String(r.plId);
    const db = t();
    const roster = await getDocs(query(collection(db, `competitions/${cid}/roster`), limit(60)));
    expect(roster.docs.map(d => d.get('displayName'))).toEqual(['代表乙']);
    // 相依：canManageComp（賽事、testers、staff exists）＋isRepOf（cpClubs）
    const mine = await clientRead('myRosterPrivate', 'list rosterPrivate uid==me', 4,
      getDocs(query(collection(db, `competitions/${cid}/rosterPrivate`), where('uid', '==', 'tester'), limit(10))));
    expect((mine as Awaited<ReturnType<typeof getDocs>>).size).toBe(1);
    expect(pageTotal('myRosterPrivate')).toBeLessThanOrEqual(CLIENT_BUDGET.myRosterPrivate);
    // cpMine：路徑 uid == 自己，不讀相依
    const items = await clientRead('mine', 'list cpMine', 0, getDocs(query(collection(db, 'cpMine/tester/items'), limit(50))));
    expect((items as Awaited<ReturnType<typeof getDocs>>).docs[0].get('roles')).toEqual(['rep', 'player']);
    expect(pageTotal('mine')).toBeLessThanOrEqual(CLIENT_BUDGET.mine);
  });

  it('7. 代表確認名單、管理員鎖定名單', async () => {
    await serverCall(handleCpEntry, TESTER, { action: 'confirmRoster', cid, enId });
    await serverCall(handleCpEntry, ADMIN, { action: 'lockRosters', cid });
    await fails(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 11, privacyAck: true }), 'ROSTERS_LOCKED');
  });

  it('8. 伺服器讀取預算：每個動作不超過上限', () => {
    for (const s of server) {
      expect(s.reads, `${s.action} 讀取 ${s.reads} 超過上限 ${SERVER_BUDGET[s.action]}`).toBeLessThanOrEqual(SERVER_BUDGET[s.action]);
    }
    expect(server.map(s => s.action)).toEqual(['create', 'publish', 'registerEntry', 'reviewEntry', 'joinRoster', 'confirmRoster', 'lockRosters']);
  });
});
