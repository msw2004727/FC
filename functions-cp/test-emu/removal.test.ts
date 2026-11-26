/**
 * 賽事個資移除 e2e（PII-P7）：模擬器（asia-main＋(default)）直呼動作層與排程。
 *
 * - 種資料直接用 adminDb()，不走建賽 Callable（避免不確定性）。
 * - 動作尚未接派工表，測試以 Handler 包裝呼叫（call/ok/fails）。
 * - 所有測試名稱、註解用繁中；deps.now 用 makeDeps(offset) 推時間。
 * - resetAll({isPublic:true}) 讓內部期閘門打開。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../test-rules/_harness.js';
import {
  ADMIN,
  DAY,
  STRANGER,
  TESTER,
  TESTER2,
  call,
  fails,
  makeDeps,
  ok,
  resetAll
} from './_cp.js';
import { ReadMeter, actorHash, launchGate } from '../src/cp/context.js';
import { ANON_HOST, ANON_PLAYER, removalJobId } from '../src/cp/removal-plan.js';
import {
  adminRemoveUserData,
  removeProxyPlayerData,
  requestMyDataRemoval,
  runRemovalJob
} from '../src/cp/removal-actions.js';
import { runDaily } from '../src/cp/daily.js';
import { type Handler } from '../src/cp/callable.js';

// ── 固定 id（皆符合 context.ts 的 *_RE 形狀） ────────────────────────
const CID = `cp_${'a'.repeat(20)}`;
const PLID = `pl_${'b'.repeat(20)}`;
const ENID = `en_${'c'.repeat(20)}`;
const DVID = `dv_${'d'.repeat(20)}`;
const MTID_A = 'mt_test_a';
const MTID_B = 'mt_test_b';

const EMPTY_COUNTS = {
  rosterDelete: 0, rosterDeidentify: 0, statsNameReplace: 0,
  entryRegistrantClear: 0, entryContactClear: 0, addedByClear: 0,
  staffNameClear: 0, staffDelete: 0, controlDelete: 0,
  hostDisplayReset: 0, publicByClear: 0, cpMineDelete: 0
};

// ── Handler 包裝 ─────────────────────────────────────────────────────
const reqRemovalHandler: Handler = async (d, c, i) =>
  requestMyDataRemoval(d, c, i as Record<string, unknown>);
const proxyHandler: Handler = async (d, c, i) => {
  const gate = await launchGate(d, c);
  return removeProxyPlayerData(d, c, gate, i as Record<string, unknown>);
};
const adminHandler: Handler = async (d, c, i) =>
  adminRemoveUserData(d, c, i as Record<string, unknown>);

// ── 種資料輔助 ───────────────────────────────────────────────────────
interface SeedRootOpts {
  cid?: string;
  hostDisplay?: string;
  hostType?: 'personal' | 'club';
  hostTeamId?: string;
  firstMatchAtOffset?: number;
  lastMatchAtOffset?: number;
  endedAtOffset?: number | null;
  notices?: unknown[];
}

async function seedRoot(opts: SeedRootOpts = {}): Promise<string> {
  const db = adminDb();
  const cid = opts.cid ?? CID;
  const now = Date.now();
  await db.doc(`competitions/${cid}`).set({
    name: '【測試】個資移除盃',
    sport: 'football',
    hostType: opts.hostType ?? 'personal',
    ...(opts.hostTeamId !== undefined ? { hostTeamId: opts.hostTeamId } : {}),
    hostDisplay: opts.hostDisplay ?? '王主辦',
    visibility: 'public',
    status: 'published',
    hidden: false,
    regOpenAt: Timestamp.fromMillis(now - DAY),
    regCloseAt: Timestamp.fromMillis(now + 10 * DAY),
    firstMatchAt: Timestamp.fromMillis(now + (opts.firstMatchAtOffset ?? 20 * DAY)),
    lastMatchAt: Timestamp.fromMillis(now + (opts.lastMatchAtOffset ?? 21 * DAY)),
    endedAt: opts.endedAtOffset != null ? Timestamp.fromMillis(now + opts.endedAtOffset) : null,
    rostersLockedAt: null,
    notices: opts.notices ?? []
  });
  return cid;
}

interface SeedPlayerOpts {
  cid: string;
  uid: string;
  plId?: string;
  enId?: string;
  dvId?: string;
  withStats?: boolean;
  mtId?: string;
  statsName?: string;
  source?: 'self' | 'rep';
  addedByUid?: string | null;
}

async function seedPlayer(opts: SeedPlayerOpts) {
  const db = adminDb();
  const plId = opts.plId ?? PLID;
  const enId = opts.enId ?? ENID;
  const dvId = opts.dvId ?? DVID;
  await db.doc(`competitions/${opts.cid}/roster/${plId}`).set({
    displayName: '小明', enId, dvId, number: 10
  });
  await db.doc(`competitions/${opts.cid}/rosterPrivate/${plId}`).set({
    uid: opts.uid, realName: '王小明', enId, dvId, teamId: 'club_a',
    source: opts.source ?? 'self', addedByUid: opts.addedByUid ?? null
  });
  await db.doc(`competitions/${opts.cid}/entries/${enId}`).set({
    rosterCount: 1, rosterConfirmed: true
  });
  if (opts.withStats) {
    const mtId = opts.mtId ?? MTID_A;
    await db.doc(`competitions/${opts.cid}/stats/${dvId}`).set({
      m: { [mtId]: { [plId]: { g: 1, y: 0, r: 0, n: opts.statsName ?? '王小明' } } }
    });
  }
  return { plId, enId, dvId };
}

async function seedMine(uid: string, cid: string, roles: string[], extra: Record<string, unknown> = {}) {
  await adminDb().doc(`cpMine/${uid}/items/${cid}`).set({
    cid, name: '【測試】個資移除盃', roles, host: '王主辦', ...extra
  });
}

describe('賽事個資移除（PII-P7 e2e）', () => {
  beforeEach(async () => {
    await resetAll({ isPublic: true });
  });

  // ── 案例 1：球員本人、名單階段內 ──────────────────────────────────
  it('球員本人名單階段內移除 → done；名單／私密刪除、計數−1、cpMine 刪、工作 done 無 uid 無 pseudo', async () => {
    const cid = await seedRoot({}); // firstMatchAt 20 天後
    const { plId, enId } = await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player'], { entryIds: [enId], plIds: [plId] });

    const r = await ok<{ status: string; processed: number; waiting: unknown[] }>(
      call(reqRemovalHandler, TESTER, { action: 'requestMyDataRemoval', confirm: 'REMOVE' })
    );
    expect(r.status).toBe('done');
    expect(r.waiting).toEqual([]);

    expect((await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).exists).toBe(false);

    const ep = await adminDb().doc(`competitions/${cid}/entries/${enId}`).get();
    expect(ep.get('rosterCount')).toBe(0);
    expect(ep.get('rosterConfirmed')).toBe(false);

    expect((await adminDb().doc(`cpMine/${TESTER.uid}/items/${cid}`).get()).exists).toBe(false);

    const job = await adminDb().doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(job.get('status')).toBe('done');
    expect(job.get('uid')).toBeUndefined();
    expect(job.get('pseudo')).toBeUndefined();
  });

  // ── 案例 2：球員本人、開賽後 ─────────────────────────────────────
  it('球員本人開賽後移除 → 名單去識別、stats 名字換、稽核假名化、無 uid 原文', async () => {
    const cid = await seedRoot({});
    const { plId, dvId } = await seedPlayer({ cid, uid: TESTER.uid, withStats: true });
    await seedMine(TESTER.uid, cid, ['player']);
    const h = actorHash(cid, TESTER.uid);
    await adminDb().doc(`competitions/${cid}/audits/old1`).set({
      action: 'rosterAdd', actor: h, details: {}, at: Timestamp.fromMillis(Date.now() - DAY)
    });

    const deps = makeDeps(21 * DAY);
    const r = await ok<{ status: string }>(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }, deps));
    expect(r.status).toBe('done');

    const roster = await adminDb().doc(`competitions/${cid}/roster/${plId}`).get();
    expect(roster.get('displayName')).toBe(ANON_PLAYER);

    const priv = await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get();
    expect(priv.get('uid')).toBeNull();
    expect(priv.get('realName')).toBeNull();
    expect(priv.get('removedAt')).toBeTruthy();

    const stats = await adminDb().doc(`competitions/${cid}/stats/${dvId}`).get();
    expect(stats.get(`m.${MTID_A}.${plId}.n`)).toBe(ANON_PLAYER);
    expect(stats.get(`m.${MTID_A}.${plId}.g`)).toBe(1);

    // 舊稽核 actor 假名化
    const old = await adminDb().doc(`competitions/${cid}/audits/old1`).get();
    const pseudo = old.get('actor') as string;
    expect(pseudo).not.toBe(h);
    expect(typeof pseudo).toBe('string');
    expect(pseudo).toMatch(/^[0-9a-f]{16}$/);

    // dataRemoval 稽核也用同一假名
    const audits = await adminDb().collection(`competitions/${cid}/audits`).get();
    const dr = audits.docs.find(d => d.get('action') === 'dataRemoval');
    expect(dr).toBeTruthy();
    expect(dr!.get('actor')).toBe(pseudo);

    // 稽核／工作文件／回傳值 JSON 都不含 uid 原文
    expect(JSON.stringify(audits.docs.map(d => d.data()))).not.toContain(TESTER.uid);
    expect(JSON.stringify(r)).not.toContain(TESTER.uid);
    const jobSnap = await adminDb().doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(JSON.stringify(jobSnap.data())).not.toContain(TESTER.uid);
  });

  // ── 案例 3：記分員指派有效 ───────────────────────────────────────
  it('記分員指派有效 → 顯示名清空、waiting；到期後續跑 → staff／control(scorer 本人) 刪、他人 control 保留', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    const expiresMs = Date.now() + 10 * DAY;
    await db.doc(`competitions/${cid}/staff/${TESTER.uid}`).set({
      roles: ['scorer'], matchIds: [MTID_A, MTID_B],
      expiresAt: Timestamp.fromMillis(expiresMs), displayName: '裁判甲', memberNo: 1
    });
    await db.doc(`competitions/${cid}/matches/${MTID_A}/control/scorer`).set({
      uid: TESTER.uid, sid: 'sess_a', takenAt: Timestamp.fromMillis(Date.now())
    });
    await db.doc(`competitions/${cid}/matches/${MTID_B}/control/scorer`).set({
      uid: TESTER2.uid, sid: 'sess_b', takenAt: Timestamp.fromMillis(Date.now())
    });
    await seedMine(TESTER.uid, cid, ['scorer']);

    const r1 = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' })
    );
    expect(r1.status).toBe('waiting');
    expect(r1.waiting).toContainEqual({ cid, reason: 'staff_active' });

    const staffSnap = await db.doc(`competitions/${cid}/staff/${TESTER.uid}`).get();
    expect(staffSnap.exists).toBe(true);
    expect(staffSnap.get('displayName')).toBeNull();

    const deps2 = makeDeps(11 * DAY);
    const r2 = await runRemovalJob(deps2, removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });
    expect(r2.status).toBe('done');

    expect((await db.doc(`competitions/${cid}/staff/${TESTER.uid}`).get()).exists).toBe(false);
    expect((await db.doc(`competitions/${cid}/matches/${MTID_A}/control/scorer`).get()).exists).toBe(false);
    expect((await db.doc(`competitions/${cid}/matches/${MTID_B}/control/scorer`).get()).exists).toBe(true);

    const job = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(job.get('status')).toBe('done');
  });

  // ── 案例 4：代表、賽事未結束 ─────────────────────────────────────
  it('代表未結束 → registeredByUid null、聯絡資料保留、waiting；結束後續跑 → 聯絡資料 null', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await db.doc(`competitions/${cid}/entryPrivate/${ENID}`).set({
      registeredByUid: TESTER.uid, contactName: '代表乙', contactPhone: '0912345678'
    });
    await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).set({
      uid: 'someplayer', realName: '王小明', enId: ENID, dvId: DVID,
      teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
    });
    await seedMine(TESTER.uid, cid, ['rep']);

    const r1 = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' })
    );
    expect(r1.status).toBe('waiting');
    expect(r1.waiting).toContainEqual({ cid, reason: 'rep_contact_active' });

    const ep1 = await db.doc(`competitions/${cid}/entryPrivate/${ENID}`).get();
    expect(ep1.get('registeredByUid')).toBeNull();
    expect(ep1.get('contactName')).toBe('代表乙');
    expect(ep1.get('contactPhone')).toBe('0912345678');

    // 推到 lastMatchAt + 8 天（超過 7 天寬限 → ended）
    const deps2 = makeDeps(21 * DAY + 8 * DAY);
    const r2 = await runRemovalJob(deps2, removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });
    expect(r2.status).toBe('done');

    const ep2 = await db.doc(`competitions/${cid}/entryPrivate/${ENID}`).get();
    expect(ep2.get('contactName')).toBeNull();
    expect(ep2.get('contactPhone')).toBeNull();
  });

  // ── 案例 5：主辦（host）────────────────────────────────────────
  it('主辦 host 未結束 → hostDisplay、notices.by、standings.manualOverride.by 去識別、waiting host_active', async () => {
    const cid = await seedRoot({
      hostDisplay: '王主辦',
      notices: [
        { id: 'n1', by: actorHash(CID, TESTER.uid), text: '公告一' },
        { id: 'n2', by: 'someotherhash', text: '公告二' }
      ]
    });
    await adminDb().doc(`competitions/${cid}/standings/s1`).set({
      manualOverride: { by: actorHash(CID, TESTER.uid) }
    });
    await seedMine(TESTER.uid, cid, ['host']);

    const r = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' })
    );
    expect(r.status).toBe('waiting');
    expect(r.waiting).toContainEqual({ cid, reason: 'host_active' });

    const comp = await adminDb().doc(`competitions/${cid}`).get();
    expect(comp.get('hostDisplay')).toBe(ANON_HOST);
    const notices = comp.get('notices') as Array<Record<string, unknown>>;
    expect(notices[0]!.by).toBeNull();
    expect(notices[1]!.by).toBe('someotherhash');

    const st = await adminDb().doc(`competitions/${cid}/standings/s1`).get();
    expect(st.get('manualOverride.by')).toBeNull();
  });

  // ── 案例 6：輸入驗證 ─────────────────────────────────────────────
  it('輸入驗證：多帶 uid、缺／錯 confirm、60 秒內重複、未登入', async () => {
    await fails(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE', uid: 'x' }), 'UNKNOWN_FIELD');
    await fails(call(reqRemovalHandler, TESTER, {}), 'CONFIRM_REQUIRED');
    await fails(call(reqRemovalHandler, TESTER, { confirm: 'KEEP' }), 'CONFIRM_REQUIRED');
    await fails(call(reqRemovalHandler, null, { confirm: 'REMOVE' }), 'SIGN_IN_REQUIRED');

    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }));
    await fails(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }), 'REMOVAL_RATE_LIMITED');
  });

  // ── 案例 7：代填球員 ─────────────────────────────────────────────
  it('代填球員：代表可移除、陌生人 NOT_ROSTER_OWNER、source=self 拒、重複呼叫仍成功', async () => {
    const cid = await seedRoot({ hostType: 'club', hostTeamId: 'club_a' });
    const db = adminDb();
    await db.doc(`competitions/${cid}/roster/${PLID}`).set({
      displayName: '小明', enId: ENID, dvId: DVID, number: 10
    });
    await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).set({
      uid: 'someplayer', realName: '王小明', enId: ENID, dvId: DVID,
      teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
    });
    await db.doc(`competitions/${cid}/entries/${ENID}`).set({ rosterCount: 1, rosterConfirmed: true });

    const r = await ok<{ deidentified: boolean }>(
      call(proxyHandler, TESTER, { action: 'removeProxyPlayerData', cid, plId: PLID, confirm: 'REMOVE' })
    );
    expect(r.deidentified).toBe(true);
    const priv = await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).get();
    expect(priv.get('realName')).toBeNull();
    expect(priv.get('addedByUid')).toBeNull();
    const roster = await db.doc(`competitions/${cid}/roster/${PLID}`).get();
    expect(roster.get('displayName')).toBe(ANON_PLAYER);

    await fails(call(proxyHandler, STRANGER, { confirm: 'REMOVE', cid, plId: PLID }), 'NOT_ROSTER_OWNER');

    const plId2 = `pl_${'x'.repeat(20)}`;
    await db.doc(`competitions/${cid}/rosterPrivate/${plId2}`).set({
      uid: 'other', realName: '林小華', enId: ENID, dvId: DVID,
      teamId: 'club_a', source: 'self', addedByUid: null
    });
    await fails(call(proxyHandler, TESTER, { confirm: 'REMOVE', cid, plId: plId2 }), 'NOT_PROXY_PLAYER');

    // 冪等：重複呼叫仍成功
    const r2 = await ok<{ deidentified: boolean }>(
      call(proxyHandler, TESTER, { confirm: 'REMOVE', cid, plId: PLID })
    );
    expect(r2.deidentified).toBe(true);
  });

  // ── 案例 8：管理員 ──────────────────────────────────────────────
  it('管理員：非管理員 → ADMIN_ONLY', async () => {
    await fails(
      call(adminHandler, TESTER, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true }),
      'ADMIN_ONLY'
    );
  });

  it('管理員 dryRun：有 confirmToken、competitions 長 1、JSON 無 uid；前後 roster/rosterPrivate/staff 不變', async () => {
    const cid = await seedRoot({});
    const { plId } = await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);
    await adminDb().doc(`competitions/${cid}/staff/${TESTER.uid}`).set({
      roles: ['host'], matchIds: [], expiresAt: null, displayName: '代表乙', memberNo: 1
    });

    const before = {
      roster: (await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).data(),
      priv: (await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).data(),
      staff: (await adminDb().doc(`competitions/${cid}/staff/${TESTER.uid}`).get()).data()
    };

    const res = await ok<{
      dryRun: boolean; confirmToken: string; expiresAt: string;
      competitions: unknown[]; collections: unknown[]; totals: Record<string, number>;
    }>(call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true }));

    expect(res.dryRun).toBe(true);
    expect(typeof res.confirmToken).toBe('string');
    expect(res.confirmToken.length).toBeGreaterThan(0);
    expect(res.competitions).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain(TESTER.uid);

    const after = {
      roster: (await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).data(),
      priv: (await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).data(),
      staff: (await adminDb().doc(`competitions/${cid}/staff/${TESTER.uid}`).get()).data()
    };
    expect(after).toEqual(before);
  });

  it('管理員 dryRun:false：缺 token → DRY_RUN_REQUIRED；錯 token → DRY_RUN_STALE', async () => {
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);

    await fails(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false }),
      'DRY_RUN_REQUIRED'
    );

    await ok(call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true }));

    await fails(call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false,
      confirmToken: 'dr_wrongwrongwrong'
    }), 'DRY_RUN_STALE');
  });

  it('管理員 dryRun:false：超過 72 小時正確 token → DRY_RUN_STALE', async () => {
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);

    const res = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true })
    );

    const deps2 = makeDeps(72 * 3_600_000 + 60_000);
    await fails(call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: res.confirmToken
    }, deps2), 'DRY_RUN_STALE');
  });

  it('管理員 dryRun:false：資料變動 → DRY_RUN_STALE；重新 dryRun 後成功；同 token 第二次被擋', async () => {
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);

    const dr = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true })
    );

    // 變動：多種一筆同 uid 名單
    await adminDb().doc(`competitions/${cid}/rosterPrivate/pl_${'y'.repeat(20)}`).set({
      uid: TESTER.uid, realName: '別名', enId: ENID, dvId: DVID,
      teamId: 'club_a', source: 'self', addedByUid: null
    });

    await fails(call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: dr.confirmToken
    }), 'DRY_RUN_STALE');

    const dr2 = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true })
    );
    const run = await ok<{ status: string }>(call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: dr2.confirmToken
    }));
    expect(run.status).toBe('done');

    const again = await call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: dr2.confirmToken
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(['DRY_RUN_REQUIRED', 'DRY_RUN_STALE']).toContain(again.error.reason);
    }
  });

  // ── 案例 9：租約 ────────────────────────────────────────────────
  it('同一工作並行兩個 runRemovalJob：恰一個 processed 0 / partial；最終資料正確、僅一筆 dataRemoval 稽核', async () => {
    const cid = await seedRoot({});
    const { plId } = await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);

    const jobId = removalJobId(TESTER.uid);
    await adminDb().doc(`cpRemovalJobs/${jobId}`).set({
      kind: 'self', uid: TESTER.uid, status: 'queued',
      pending: [cid], waiting: {}, pseudo: {},
      leaseUntil: null, attempts: 0,
      requestedAt: Timestamp.fromMillis(Date.now() - 120_000),
      counts: EMPTY_COUNTS
    });

    const deps = makeDeps();
    const [r1, r2] = await Promise.all([
      runRemovalJob(deps, jobId, { maxComps: 5, budgetMs: 40_000 }),
      runRemovalJob(deps, jobId, { maxComps: 5, budgetMs: 40_000 })
    ]);
    const zeros = [r1, r2].filter(r => r.processed === 0);
    expect(zeros).toHaveLength(1);
    expect(zeros[0]!.status).toBe('partial');

    expect((await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).exists).toBe(false);

    const job = await adminDb().doc(`cpRemovalJobs/${jobId}`).get();
    expect(job.get('status')).toBe('done');

    const audits = await adminDb().collection(`competitions/${cid}/audits`).get();
    const dr = audits.docs.filter(d => d.get('action') === 'dataRemoval');
    expect(dr).toHaveLength(1);
  });

  // ── 案例 10：每日排程檢舉清除 ───────────────────────────────────
  it('runDaily 檢舉清除：dryRun 不動、非 dryRun 依狀態 purge/drop、未來 purgeAt 不動', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    const past = Timestamp.fromMillis(Date.now() - DAY);
    const future = Timestamp.fromMillis(Date.now() + 10 * DAY);

    await db.doc(`competitions/${cid}/reports/r1`).set({
      status: 'resolved', reporterUid: 'tester', detail: '詳細內容', reason: 'impersonation'
    });
    await db.doc('cpReportPurge/' + cid + '_r1').set({ cid, rid: 'r1', purgeAt: past });

    await db.doc(`competitions/${cid}/reports/r2`).set({
      status: 'open', reporterUid: 'tester', detail: '另一筆', reason: 'fake'
    });
    await db.doc('cpReportPurge/' + cid + '_r2').set({ cid, rid: 'r2', purgeAt: past });

    await db.doc(`competitions/${cid}/reports/r3`).set({
      status: 'resolved', reporterUid: 'tester', detail: '未來', reason: 'fake'
    });
    await db.doc('cpReportPurge/' + cid + '_r3').set({ cid, rid: 'r3', purgeAt: future });

    // dryRun：只讀、只計數
    const rep1 = await runDaily(makeDeps(), {
      dryRun: true, max: 50, auditBackfill: false, reportBackfill: false
    });
    expect(rep1.reportPurged).toBe(1);
    expect(rep1.reportQueueDropped).toBe(1);

    expect((await db.doc(`competitions/${cid}/reports/r1`).get()).get('reporterUid')).toBe('tester');
    expect((await db.doc(`competitions/${cid}/reports/r1`).get()).get('detail')).toBe('詳細內容');
    expect((await db.doc(`competitions/${cid}/reports/r2`).get()).get('status')).toBe('open');
    expect((await db.doc('cpReportPurge/' + cid + '_r1').get()).exists).toBe(true);
    expect((await db.doc('cpReportPurge/' + cid + '_r2').get()).exists).toBe(true);
    expect((await db.doc('cpReportPurge/' + cid + '_r3').get()).exists).toBe(true);

    // 實際執行
    const rep2 = await runDaily(makeDeps(), {
      dryRun: false, max: 50, auditBackfill: false, reportBackfill: false
    });
    expect(rep2.reportPurged).toBe(1);
    expect(rep2.reportQueueDropped).toBe(1);

    const r1d = (await db.doc(`competitions/${cid}/reports/r1`).get()).data()!;
    expect(r1d.reporterUid).toBeNull();
    expect(r1d.detail).toBeNull();
    expect(r1d.reason).toBe('impersonation');
    expect(r1d.piiClearedAt).toBeTruthy();
    expect((await db.doc('cpReportPurge/' + cid + '_r1').get()).exists).toBe(false);

    const r2d = (await db.doc(`competitions/${cid}/reports/r2`).get()).data()!;
    expect(r2d.status).toBe('open');
    expect(r2d.reporterUid).toBe('tester');
    expect(r2d.reason).toBe('fake');
    expect((await db.doc('cpReportPurge/' + cid + '_r2').get()).exists).toBe(false);

    // r3：purgeAt 在未來，兩次都不動
    const r3d = (await db.doc(`competitions/${cid}/reports/r3`).get()).data()!;
    expect(r3d.reporterUid).toBe('tester');
    expect(r3d.detail).toBe('未來');
    expect((await db.doc('cpReportPurge/' + cid + '_r3').get()).exists).toBe(true);
  });

  // ── 案例 11：讀取預算 ───────────────────────────────────────────
  it('一般球員開賽後單場 requestMyDataRemoval 讀取 ≤ 30', async () => {
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER.uid, withStats: true });
    await seedMine(TESTER.uid, cid, ['player']);
    await adminDb().doc(`competitions/${cid}/audits/old1`).set({
      action: 'rosterAdd', actor: actorHash(cid, TESTER.uid), details: {},
      at: Timestamp.fromMillis(Date.now() - DAY)
    });

    const meter = new ReadMeter();
    const deps = makeDeps(21 * DAY, meter);
    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }, deps));
    expect(meter.reads).toBeLessThanOrEqual(30);
  });
});
