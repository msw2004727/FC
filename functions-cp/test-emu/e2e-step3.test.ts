/**
 * 第 3 步 e2e（§12.4 站長最小驗收劇本的模擬器版）：排賽程 → 登錄 2 場比分 → 看積分榜。
 * 前端讀取走用戶端 SDK＋asia-main Rules；Callable 與觸發器走伺服器處理函式（Admin SDK）。
 *
 * 讀取預算（§8.1）：
 * - 伺服器：ReadMeter 實際計數（文件 1、查詢至少 1、聚合每千筆 1）。
 * - 用戶端：回傳文件數（空查詢記 1）＋Rules 相依讀取上限（同請求同文件只計一次）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { assertFails, clientDb, closeClients } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { ADMIN, call, makeDeps, ok, resetAll } from './_cp.js';
import { LATER, matchesOf, pairing, scheduleInput, setupComp, type Comp } from './_step3.js';

const SERVER_BUDGET: Record<string, number> = {
  // 閘門 1＋賽事 1＋組別 1＋報隊查詢 ≤ 16＋舊場次查詢 1＋摘要片 ≤ 2（＋管理員不讀 staff）
  generateSchedule: 1 + 1 + 1 + 16 + 1 + 2,
  // 閘門 1＋賽事 1＋組別 1＋場次 1（登錄比分改讀組別規則，K8）
  recordResult: 4,
  // 閘門 1＋賽事 1＋場次 1＋timeline ≤200＋voids ≤200（§3.307）＋組別 1（K8 積分規則）
  confirmMatchResult: 1 + 1 + 1 + 200 + 200 + 1,
  // 場次 1＋摘要片 1（＋舊片 1）＋場次重讀 1＋賽事 1＋組別 1＋積分 1＋該組場次 ≤ 6＋賽事 1＋組別清單 1＋聚合 2（實測 15）
  trigger: 1 + 2 + 1 + 1 + 1 + 1 + 6 + 1 + 1 + 2
};
const CLIENT_BUDGET = {
  detailWarmup: 39 + 3,  // 根 1＋組別 ≤ 4（+1）＋隊伍 ≤ 32（+1）；內部期 3 個請求各 +1
  detailLive: 8 + 3,     // 根 1＋摘要 1（+1）＋積分 ≤ 4（+1）；內部期 3 個請求各 +1
  schedule: 14 + 2       // 全部賽程：摘要片 ≤ 14 天（+1 父 +1 testers）
};

const ledger: { page: string; op: string; docs: number; deps: number }[] = [];
async function clientRead<T>(page: string, op: string, deps: number, p: Promise<T>): Promise<T> {
  const r = await p as unknown as { size?: number };
  ledger.push({ page, op, docs: typeof r.size === 'number' ? Math.max(1, r.size) : 1, deps });
  return r as unknown as T;
}
const pageTotal = (page: string) => ledger.filter(l => l.page === page).reduce((s, l) => s + l.docs + l.deps, 0);
const server: { action: string; reads: number }[] = [];

beforeAll(async () => { await resetAll({ isPublic: false }); });
afterEach(async () => { await closeClients(); });
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log('[e2e3 伺服器讀取]', JSON.stringify(server));
  // eslint-disable-next-line no-console
  console.log('[e2e3 用戶端讀取]', JSON.stringify(ledger));
});

function taipeiShard(ms: number) { return 'd' + new Date(ms + 8 * 3600_000).toISOString().slice(0, 10).replace(/-/g, ''); }

describe('§12.4 第 3 步最小驗收劇本', () => {
  let c: Comp;
  const t: () => Firestore = () => clientDb({ uid: 'tester' });

  it('0. 前置（第 2 步流程）：管理員建賽、4 隊報隊核准、鎖名單', async () => {
    c = await setupComp(['北區', '南區', '東區', '西區']);
    expect(Object.keys(c.enIdOf).length).toBe(4);
  });

  it('1. 管理員排賽程（先預覽再產生）；每場觸發器不重寫摘要', async () => {
    const meter = new ReadMeter();
    const deps = makeDeps(0, meter);
    const p = await ok<Record<string, unknown>>(call(handleCpHost, ADMIN, scheduleInput(c, { dryRun: true }), deps));
    expect(p.matchCount).toBe(6);
    meter.reads = 0;
    await ok(call(handleCpHost, ADMIN, scheduleInput(c, { seed: p.seed }), deps));
    server.push({ action: 'generateSchedule', reads: meter.reads });
    for (const m of await matchesOf(c)) {
      const r = await handleMatchWritten(makeDeps(), c.cid, m.id, null, m);
      expect(r.summary).toBe(false);   // 產生賽程時已寫好，觸發器只讀不寫
      expect(r.standing).toBe(false);
    }
  });

  it('2. 測試者開詳情（預熱：賽程已排、未開賽）', async () => {
    const db = t();
    await clientRead('detailWarmup', 'get competition', 1, getDoc(doc(db, `competitions/${c.cid}`)));
    await clientRead('detailWarmup', 'list divisions', 2, getDocs(query(collection(db, `competitions/${c.cid}/divisions`), limit(4))));
    await clientRead('detailWarmup', 'list entries', 2, getDocs(query(collection(db, `competitions/${c.cid}/entries`), limit(32))));
    expect(pageTotal('detailWarmup')).toBeLessThanOrEqual(CLIENT_BUDGET.detailWarmup);
    const sched = await clientRead('schedule', 'list summary', 2, getDocs(query(collection(db, `competitions/${c.cid}/summary`), limit(14))));
    const all = (sched as Awaited<ReturnType<typeof getDocs>>).docs.flatMap(d => Object.values(d.get('m') as Record<string, { st: string }>));
    expect(all.length).toBe(6);
    expect(all.every(e => e.st === 'scheduled')).toBe(true);
    expect(pageTotal('schedule')).toBeLessThanOrEqual(CLIENT_BUDGET.schedule);
  });

  it('3. 主辦登錄 2 場比分（一場登錄並確認、一場先登錄再確認）', async () => {
    const ms = await matchesOf(c);
    for (const [h, a, hs, as, confirm] of [['北區', '南區', 3, 1, true], ['東區', '西區', 0, 0, false]] as const) {
      const { m, score } = pairing(c, ms, h, a, hs, as);
      const before = m;
      const meter = new ReadMeter();
      await ok(call(handleCpHost, ADMIN, { action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: 0, score, confirm }, makeDeps(LATER, meter)));
      server.push({ action: 'recordResult', reads: meter.reads });
      const tm = new ReadMeter();
      await handleMatchWritten(makeDeps(LATER, tm), c.cid, m.id, before, null);
      server.push({ action: 'trigger', reads: tm.reads });
      if (!confirm) {
        const cm = new ReadMeter();
        await ok(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 1 }, makeDeps(LATER, cm)));
        server.push({ action: 'confirmMatchResult', reads: cm.reads });
        await handleMatchWritten(makeDeps(LATER), c.cid, m.id, { ...before, status: 'finished' }, null);
      }
    }
  });

  it('4. 測試者看積分榜與當日比分（進行中詳情）', async () => {
    const db = t();
    const root = await clientRead('detailLive', 'get competition', 1, getDoc(doc(db, `competitions/${c.cid}`)));
    const first = (root as Awaited<ReturnType<typeof getDoc>>).get('firstMatchAt').toMillis();
    const shard = await clientRead('detailLive', 'get summary today', 2, getDoc(doc(db, `competitions/${c.cid}/summary/${taipeiShard(first)}`)));
    const entries = Object.values(((shard as Awaited<ReturnType<typeof getDoc>>).get('m') ?? {}) as Record<string, { st: string; s: number[] }>);
    expect(entries.some(e => e.st === 'confirmed')).toBe(true);
    const st = await clientRead('detailLive', 'list standings', 2, getDocs(query(collection(db, `competitions/${c.cid}/standings`), limit(4))));
    const rows = (st as Awaited<ReturnType<typeof getDocs>>).docs[0].get('rows') as Array<{ teamId: string; points: number; played: number }>;
    const by = Object.fromEntries(rows.map(r => [c.nameOf[r.teamId], r]));
    expect(by['北區']).toMatchObject({ played: 1, points: 3 });
    expect(by['南區']).toMatchObject({ played: 1, points: 0 });
    expect(by['東區']).toMatchObject({ played: 1, points: 1 });
    expect(by['西區']).toMatchObject({ played: 1, points: 1 });
    expect(c.nameOf[rows[0].teamId]).toBe('北區');
    expect(pageTotal('detailLive')).toBeLessThanOrEqual(CLIENT_BUDGET.detailLive);
  });

  it('5. 用戶端不能寫積分、摘要，也不能直接把場次改成已確認', async () => {
    const db = t();
    await assertFails(setDoc(doc(db, `competitions/${c.cid}/standings/x`), { rows: [] }));
    await assertFails(setDoc(doc(db, `competitions/${c.cid}/summary/d20990101`), { m: {} }));
    const m = (await matchesOf(c)).find(x => x.status === 'scheduled')!;
    await assertFails(updateDoc(doc(db, `competitions/${c.cid}/matches/${m.id}`), { status: 'confirmed', rev: 1 }));
  });

  it('6. 讀取預算：伺服器每個動作不超過上限', () => {
    for (const s of server) {
      expect(s.reads, `${s.action} 讀取 ${s.reads} 超過上限 ${SERVER_BUDGET[s.action]}`).toBeLessThanOrEqual(SERVER_BUDGET[s.action]);
    }
  });
});
