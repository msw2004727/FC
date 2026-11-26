/**
 * 審查突變缺口補測（施工卡 PII-P8c）：
 * - T2 三種欄位假名化與 tk_ 稽核換 id
 * - 兩位代表各自 contactClearKey（P1 回歸：不能由假名推導）
 * - 確認碼流程、cpHostQuota 清除、並行消耗
 * - 單場持續失敗不卡整份、查詢查滿續跑、P2-4、P2-5、P2-7
 * - 排程第 1/2 項非 dryRun、dryRun 完全不動資料
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../test-rules/_harness.js';
import {
  ADMIN,
  DAY,
  STRANGER,
  TESTER,
  TESTER2,
  TESTER3,
  call,
  fails,
  makeDeps,
  ok,
  resetAll
} from './_cp.js';
import { actorHash, launchGate } from '../src/cp/context.js';
import { ANON_HOST, ANON_PLAYER, removalJobId } from '../src/cp/removal-plan.js';
import {
  adminRemoveUserData,
  removeProxyPlayerData,
  requestMyDataRemoval,
  runRemovalJob
} from '../src/cp/removal-actions.js';
import { runDaily } from '../src/cp/daily.js';
import { type Handler } from '../src/cp/callable.js';

// ── 固定 id ───────────────────────────────────────────────────────────
const CID = `cp_${'a'.repeat(20)}`;
const CID2 = `cp_${'b'.repeat(20)}`;
const PLID = `pl_${'b'.repeat(20)}`;
const ENID = `en_${'c'.repeat(20)}`;
const DVID = `dv_${'d'.repeat(20)}`;
const MTID = `mt_${'a'.repeat(20)}`;

const EMPTY_COUNTS = {
  rosterDelete: 0, rosterDeidentify: 0, statsNameReplace: 0,
  entryRegistrantClear: 0, entryContactClear: 0, addedByClear: 0,
  staffNameClear: 0, staffDelete: 0, controlDelete: 0,
  hostDisplayReset: 0, publicByClear: 0, cpMineDelete: 0
};

// ── Handler 包裝 ─────────────────────────────────────────────────────
// 真的執行只認最高管理員（顧問 §3.816 ①）；試算仍由一般管理員 ADMIN 做
const SUPER_ADMIN = { uid: 'superadmin', role: 'super_admin' };
const reqRemovalHandler: Handler = async (d, c, i) =>
  requestMyDataRemoval(d, c, i as Record<string, unknown>);
const proxyHandler: Handler = async (d, c, i) => {
  const gate = await launchGate(d, c);
  return removeProxyPlayerData(d, c, gate, i as Record<string, unknown>);
};
const adminHandler: Handler = async (d, c, i) =>
  adminRemoveUserData(d, c, i as Record<string, unknown>);

// ── 種資料輔助（複製自 removal.test.ts，不 import）────────────────────
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
    const mtId = opts.mtId ?? MTID;
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

async function snapshotAll(cid: string, uid: string) {
  const db = adminDb();
  const snap = async (p: string) => (await db.collection(p).get()).docs.map(d => ({ id: d.id, data: d.data() }));
  return {
    roster: await snap(`competitions/${cid}/roster`),
    rosterPrivate: await snap(`competitions/${cid}/rosterPrivate`),
    entryPrivate: await snap(`competitions/${cid}/entryPrivate`),
    staff: await snap(`competitions/${cid}/staff`),
    stats: await snap(`competitions/${cid}/stats`),
    audits: await snap(`competitions/${cid}/audits`),
    cpMineItems: await snap(`cpMine/${uid}/items`)
  };
}

describe('賽事個資移除審查補測（PII-P8c）', () => {
  beforeEach(async () => {
    await resetAll({ isPublic: true });
    // 站長 uid 白名單（伺服器專用文件）：真的執行要 super_admin 且在名單（Opus 審 P11 P2）
    await adminDb().doc('cpOwnerConfig/removal').set({ uids: [SUPER_ADMIN.uid] });
  });

  // ── 1：T2 三種欄位與 tk_ 換 id ────────────────────────────────────
  it('T2：actor／details.target／prev 換同一個新假名；h2 不動；tk_ 舊 id 消失、新 id 帶原 expireAt', async () => {
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);
    const db = adminDb();
    const h = actorHash(cid, TESTER.uid);
    const h2 = actorHash(cid, TESTER2.uid);
    const tkMs = 1700000000000;
    const tkExpireMs = 1800000000000;

    await db.doc(`competitions/${cid}/audits/a_actor`).set({
      action: 'rosterAdd', actor: h, details: {}, at: Timestamp.fromMillis(Date.now() - DAY)
    });
    await db.doc(`competitions/${cid}/audits/a_target`).set({
      action: 'someAction', actor: 'someone', details: { target: h },
      at: Timestamp.fromMillis(Date.now() - DAY)
    });
    await db.doc(`competitions/${cid}/audits/a_prev`).set({
      action: 'edit', actor: 'someone2', prev: h, details: {},
      at: Timestamp.fromMillis(Date.now() - DAY)
    });
    await db.doc(`competitions/${cid}/audits/a_other`).set({
      action: 'other', actor: h2, prev: h2, details: {},
      at: Timestamp.fromMillis(Date.now() - DAY)
    });
    await db.doc(`competitions/${cid}/audits/tk_${tkMs}_${MTID}_${h}`).set({
      action: 'takeScorer', actor: h, mtId: MTID,
      expireAt: Timestamp.fromMillis(tkExpireMs), at: Timestamp.fromMillis(tkMs)
    });

    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }, makeDeps(21 * DAY)));

    const aAfter = (await db.doc(`competitions/${cid}/audits/a_actor`).get()).get('actor') as string;
    const tAfter = (await db.doc(`competitions/${cid}/audits/a_target`).get()).get('details.target') as string;
    const pAfter = (await db.doc(`competitions/${cid}/audits/a_prev`).get()).get('prev') as string;

    expect(aAfter).toMatch(/^[0-9a-f]{16}$/);
    expect(aAfter).not.toBe(h);
    expect(tAfter).toBe(aAfter);
    expect(pAfter).toBe(aAfter);

    const other = await db.doc(`competitions/${cid}/audits/a_other`).get();
    expect(other.get('actor')).toBe(h2);
    expect(other.get('prev')).toBe(h2);

    // tk_：舊 id 不存在、新 id 存在、actor 為 x、expireAt 原封不動
    expect((await db.doc(`competitions/${cid}/audits/tk_${tkMs}_${MTID}_${h}`).get()).exists).toBe(false);
    const tkNew = await db.doc(`competitions/${cid}/audits/tk_${tkMs}_${MTID}_${aAfter}`).get();
    expect(tkNew.exists).toBe(true);
    expect(tkNew.get('actor')).toBe(aAfter);
    expect((tkNew.get('expireAt') as Timestamp).toMillis()).toBe(tkExpireMs);
  });

  // ── 2：兩位代表同一賽事 ──────────────────────────────────────────
  it('兩位代表同一賽事：各自 registeredByUid null、各自 contactClearKey 不同；賽事結束後各自續跑只清自己', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    const ENID_A = ENID;
    const ENID_B = `en_${'e'.repeat(20)}`;

    await db.doc(`competitions/${cid}/entryPrivate/${ENID_A}`).set({
      registeredByUid: TESTER.uid, contactName: '代表A', contactPhone: '0911111111'
    });
    await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).set({
      registeredByUid: TESTER2.uid, contactName: '代表B', contactPhone: '0922222222'
    });
    await seedMine(TESTER.uid, cid, ['rep']);
    await seedMine(TESTER2.uid, cid, ['rep']);

    // A 移除（未結束）
    const rA = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' })
    );
    expect(rA.waiting).toContainEqual({ cid, reason: 'rep_contact_active' });

    const epA1 = await db.doc(`competitions/${cid}/entryPrivate/${ENID_A}`).get();
    expect(epA1.get('registeredByUid')).toBeNull();
    const keyA = epA1.get('contactClearKey') as string;
    expect(typeof keyA).toBe('string');
    expect(keyA).toMatch(/^[0-9a-f]{16}$/);

    // B 移除（未結束）
    const rB = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER2, { confirm: 'REMOVE' })
    );
    expect(rB.waiting).toContainEqual({ cid, reason: 'rep_contact_active' });

    const epB1 = await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).get();
    expect(epB1.get('registeredByUid')).toBeNull();
    const keyB = epB1.get('contactClearKey') as string;
    expect(typeof keyB).toBe('string');
    expect(keyB).toMatch(/^[0-9a-f]{16}$/);
    expect(keyB).not.toBe(keyA);

    // 賽事結束：先只跑 A
    const endDeps = makeDeps(21 * DAY + 8 * DAY);
    await runRemovalJob(endDeps, removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });

    const epA2 = await db.doc(`competitions/${cid}/entryPrivate/${ENID_A}`).get();
    expect(epA2.get('contactName')).toBeNull();
    expect(epA2.get('contactPhone')).toBeNull();
    expect(epA2.get('contactClearKey')).toBeUndefined();

    // 交叉檢查：A 不會清到 B
    const epB2 = await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).get();
    expect(epB2.get('contactName')).toBe('代表B');
    expect(epB2.get('contactPhone')).toBe('0922222222');
    expect(epB2.get('contactClearKey')).toBe(keyB);

    // 再跑 B
    await runRemovalJob(endDeps, removalJobId(TESTER2.uid), { maxComps: 5, budgetMs: 40_000 });
    const epB3 = await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).get();
    expect(epB3.get('contactName')).toBeNull();
    expect(epB3.get('contactPhone')).toBeNull();
    expect(epB3.get('contactClearKey')).toBeUndefined();
  });

  // ── 3：主辦拿不到聯絡鍵的線索（P1 回歸）──────────────────────────
  it('主辦拿不到聯絡鍵的線索：sha256("cc:"+v).slice(0,16) 都不等於 contactClearKey', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    const ENID_A = ENID;
    const ENID_B = `en_${'e'.repeat(20)}`;

    await db.doc(`competitions/${cid}/entryPrivate/${ENID_A}`).set({
      registeredByUid: TESTER.uid, contactName: '代表A', contactPhone: '0911111111'
    });
    await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).set({
      registeredByUid: TESTER2.uid, contactName: '代表B', contactPhone: '0922222222'
    });
    await seedMine(TESTER.uid, cid, ['rep']);
    await seedMine(TESTER2.uid, cid, ['rep']);

    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }));
    await ok(call(reqRemovalHandler, TESTER2, { confirm: 'REMOVE' }));

    const keyA = (await db.doc(`competitions/${cid}/entryPrivate/${ENID_A}`).get()).get('contactClearKey') as string;
    const keyB = (await db.doc(`competitions/${cid}/entryPrivate/${ENID_B}`).get()).get('contactClearKey') as string;
    expect(keyA).toBeTruthy();
    expect(keyB).toBeTruthy();

    // 讀出所有稽核的 actor，逐一比對「cc:」前綴雜湊，不能等於任何 contactClearKey
    const audits = await db.collection(`competitions/${cid}/audits`).get();
    const actors = audits.docs.map(d => d.get('actor')).filter((v): v is string => typeof v === 'string');
    expect(actors.length).toBeGreaterThan(0);
    for (const v of actors) {
      const guess = createHash('sha256').update('cc:' + v).digest('hex').slice(0, 16);
      expect(guess).not.toBe(keyA);
      expect(guess).not.toBe(keyB);
    }
  });

  // ── 4：確認碼 ─────────────────────────────────────────────────
  it('確認碼：A 的 token 拿去執行 B；reasonCode 變更→DRY_RUN_STALE；account_deleted 走 cpHostQuota 刪除；並行恰一次成功', async () => {
    const db = adminDb();

    // (1) A 的 dryRun token 拿去執行 B（uid 不同）
    const aDr = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true })
    );
    const crossRes = await call(adminHandler, SUPER_ADMIN, {
      uid: TESTER2.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: aDr.confirmToken
    });
    expect(crossRes.ok).toBe(false);
    if (!crossRes.ok) {
      expect(['DRY_RUN_STALE', 'DRY_RUN_REQUIRED']).toContain(crossRes.error.reason);
    }

    // (2) reasonCode 由 subject_request 改 account_deleted → DRY_RUN_STALE
    const bDr = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true })
    );
    const mismatch = await call(adminHandler, SUPER_ADMIN, {
      uid: TESTER.uid, reasonCode: 'account_deleted', dryRun: false, confirmToken: bDr.confirmToken
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.reason).toBe('DRY_RUN_STALE');

    // (3) account_deleted 正確流程：先種 cpHostQuota/{uid}
    const cid = await seedRoot({});
    await seedPlayer({ cid, uid: TESTER3.uid });
    await seedMine(TESTER3.uid, cid, ['player']);
    await db.doc(`cpHostQuota/${TESTER3.uid}`).set({ activeCids: [] });

    const cdDr = await ok<{
      confirmToken: string;
      collections: Array<{ path: string; op: string; count: number }>;
    }>(call(adminHandler, ADMIN, { uid: TESTER3.uid, reasonCode: 'account_deleted', dryRun: true }));
    expect(cdDr.collections.some(c => c.op === 'delete' && c.path.startsWith('cpHostQuota'))).toBe(true);

    // dryRun 後工作文件沒有 uid 欄位
    const jobAfterDr = await db.doc(`cpRemovalJobs/${removalJobId(TESTER3.uid)}`).get();
    expect(jobAfterDr.get('uid')).toBeUndefined();

    // 執行
    await ok(call(adminHandler, SUPER_ADMIN, {
      uid: TESTER3.uid, reasonCode: 'account_deleted', dryRun: false, confirmToken: cdDr.confirmToken
    }));
    expect((await db.doc(`cpHostQuota/${TESTER3.uid}`).get()).exists).toBe(false);

    // (4) 並行兩次用同一 token 執行 → 恰一次成功
    const parDr = await ok<{ confirmToken: string }>(
      call(adminHandler, ADMIN, { uid: TESTER2.uid, reasonCode: 'subject_request', dryRun: true })
    );
    const [r1, r2] = await Promise.all([
      call(adminHandler, SUPER_ADMIN, {
        uid: TESTER2.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: parDr.confirmToken
      }),
      call(adminHandler, SUPER_ADMIN, {
        uid: TESTER2.uid, reasonCode: 'subject_request', dryRun: false, confirmToken: parDr.confirmToken
      })
    ]);
    const successes = [r1, r2].filter(x => x.ok);
    expect(successes).toHaveLength(1);
  });

  // ── 5：某場一直失敗不卡住 ─────────────────────────────────────────
  it('單場失敗不卡整份：c1 破損→failed 累積 attempts、c2 完成；3 次後 status error、uid 保留', async () => {
    const db = adminDb();
    const c1 = CID;
    const c2 = CID2;
    await seedRoot({ cid: c1 });
    await seedRoot({ cid: c2 });
    // 破損：firstMatchAt 不是 Timestamp
    await db.doc(`competitions/${c1}`).update({ firstMatchAt: 'not-a-timestamp' });

    await seedPlayer({ cid: c1, uid: TESTER.uid });
    await seedPlayer({ cid: c2, uid: TESTER.uid });
    await seedMine(TESTER.uid, c1, ['player']);
    await seedMine(TESTER.uid, c2, ['player']);

    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }));

    const job1 = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(job1.get('status')).not.toBe('done');
    const failed1 = job1.get(`failed.${c1}`) as { attempts?: number } | undefined;
    expect(failed1).toBeTruthy();
    expect(failed1!.attempts).toBe(1);
    // c2 已處理（名單階段內 → roster/rosterPrivate 刪除）
    expect((await db.doc(`competitions/${c2}/roster/${PLID}`).get()).exists).toBe(false);
    expect((await db.doc(`competitions/${c2}/rosterPrivate/${PLID}`).get()).exists).toBe(false);

    // 第 2 次（先推租約）
    await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).update({ leaseUntil: null });
    await runRemovalJob(makeDeps(), removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });
    const job2 = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect((job2.get(`failed.${c1}`) as { attempts: number }).attempts).toBe(2);

    // 第 3 次
    await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).update({ leaseUntil: null });
    await runRemovalJob(makeDeps(), removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });
    const job3 = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect((job3.get(`failed.${c1}`) as { attempts: number }).attempts).toBe(3);
    expect(job3.get('status')).toBe('error');
    expect(job3.get('uid')).toBe(TESTER.uid);
  });

  // ── 6：查詢查滿會續跑 ────────────────────────────────────────────
  it('查詢查滿會續跑：61 筆 addedBy 分兩次清、工作最終 done', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedMine(TESTER.uid, cid, []); // 目標來源；roles 空由 addedBy 推論

    // 61 筆別人 rosterPrivate（source 'rep'、addedByUid=TESTER）
    for (let i = 0; i < 61; i += 1) {
      const suffix = i.toString(36).padStart(2, '0');
      const plId = `pl_${suffix}${'z'.repeat(18)}`;
      await db.doc(`competitions/${cid}/rosterPrivate/${plId}`).set({
        uid: 'someone', realName: `代填${i}`, enId: ENID, dvId: DVID,
        teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
      });
    }

    // 賽事已結束（lastMatchAt 21 天後 + 7 天寬限；推到 21+8 天）
    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }, makeDeps(21 * DAY + 8 * DAY)));

    const firstRun = await db.collection(`competitions/${cid}/rosterPrivate`).get();
    const nullCount1 = firstRun.docs.filter(d => d.get('addedByUid') === null).length;
    expect(nullCount1).toBeGreaterThanOrEqual(60);

    const job1 = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(job1.get('status')).not.toBe('done');
    const pending1 = job1.get('pending') as string[];
    expect(pending1).toContain(cid);

    await runRemovalJob(makeDeps(21 * DAY + 9 * DAY), removalJobId(TESTER.uid), { maxComps: 5, budgetMs: 40_000 });

    const secondRun = await db.collection(`competitions/${cid}/rosterPrivate`).get();
    const nullCount2 = secondRun.docs.filter(d => d.get('addedByUid') === null).length;
    expect(nullCount2).toBe(61);

    const job2 = await db.doc(`cpRemovalJobs/${removalJobId(TESTER.uid)}`).get();
    expect(job2.get('status')).toBe('done');
  });

  // ── 7：P2-4 查到就處理 ───────────────────────────────────────────
  it('P2-4：cpMine 只有 player、但代填過別人 → addedByUid 也被清', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);
    const otherPlId = `pl_${'q'.repeat(20)}`;
    await db.doc(`competitions/${cid}/rosterPrivate/${otherPlId}`).set({
      uid: 'other', realName: '代填人', enId: ENID, dvId: DVID,
      teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
    });

    await ok(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }));

    const after = await db.doc(`competitions/${cid}/rosterPrivate/${otherPlId}`).get();
    expect(after.get('addedByUid')).toBeNull();
  });

  // ── 8：代填球員授權（P2-5）───────────────────────────────────────
  it('P2-5：個人主辦下，球員所屬球隊（club_b）的代表可移除代填球員；別隊 club_a 代表 NOT_ROSTER_OWNER', async () => {
    // TESTER2 只是 club_b 代表，沒有任何 staff 角色：證明走的是 rosterPrivate.teamId 的代表判斷，不是主辦／共同主辦（Opus 複審 P2-C）
    const cid = await seedRoot({ hostType: 'personal' });
    const db = adminDb();
    await db.doc('cpClubs/club_b').set({ repUids: ['tester2'], name: '乙隊足球俱樂部' });
    await db.doc(`competitions/${cid}/roster/${PLID}`).set({
      displayName: '小球', enId: ENID, dvId: DVID, number: 10
    });
    await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).set({
      uid: 'someplayer', realName: '林小華', enId: ENID, dvId: DVID,
      teamId: 'club_b', source: 'rep', addedByUid: TESTER.uid
    });
    await db.doc(`competitions/${cid}/entries/${ENID}`).set({ rosterCount: 1, rosterConfirmed: true });

    // 別隊的 club_a 代表（TESTER）不行
    await fails(call(proxyHandler, TESTER, {
      action: 'removeProxyPlayerData', cid, plId: PLID, confirm: 'REMOVE'
    }), 'NOT_ROSTER_OWNER');

    expect((await db.doc(`competitions/${cid}/staff/${TESTER2.uid}`).get()).exists).toBe(false);
    // 球員所屬球隊 club_b 的代表（TESTER2）可以
    const r = await ok<{ deidentified: boolean }>(call(proxyHandler, TESTER2, {
      action: 'removeProxyPlayerData', cid, plId: PLID, confirm: 'REMOVE'
    }));
    expect(r.deidentified).toBe(true);

    const privAfter = await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).get();
    expect(privAfter.get('realName')).toBeNull();
    expect(privAfter.get('addedByUid')).toBeNull();
    const rosterAfter = await db.doc(`competitions/${cid}/roster/${PLID}`).get();
    expect(rosterAfter.get('displayName')).toBe(ANON_PLAYER);
  });

  // ── 9：invites.createdBy（P2-7）─────────────────────────────────
  it('invites.createdBy：used 與「已過期但仍 open」換假名；開放未到期保留且這場進入等待 invite_open，到期後續跑才換', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);
    const h = actorHash(cid, TESTER.uid);
    await db.doc(`competitions/${cid}/invites/iv_used`).set({
      createdBy: h, status: 'used', role: 'scorer', createdAt: Timestamp.fromMillis(Date.now() - DAY)
    });
    // 已過期：狀態仍是 open（邀請過期不改狀態），也要換（Opus 複審 P2-D）
    await db.doc(`competitions/${cid}/invites/iv_expired`).set({
      createdBy: h, status: 'open', role: 'scorer', expiresAt: Timestamp.fromMillis(Date.now() - DAY),
      createdAt: Timestamp.fromMillis(Date.now() - 2 * DAY)
    });
    await db.doc(`competitions/${cid}/invites/iv_open`).set({
      createdBy: h, status: 'open', role: 'coHost', expiresAt: Timestamp.fromMillis(Date.now() + 3 * DAY),
      createdAt: Timestamp.fromMillis(Date.now() - DAY)
    });

    // 管理員 dryRun 摘要也要列出要等邀請到期（Opus 確認審 P3-1）
    const sum = await ok<{ competitions: Array<{ later: { reasons: string[] } | null }> }>(
      call(adminHandler, ADMIN, { action: 'adminRemoveUserData', uid: TESTER.uid, reasonCode: 'subject_request' })
    );
    expect(sum.competitions[0]?.later?.reasons).toContain('invite_open');

    const r = await ok<{ status: string; waiting: Array<{ cid: string; reason: string }> }>(
      call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' })
    );
    expect(r.status).toBe('waiting');
    expect(r.waiting).toContainEqual({ cid, reason: 'invite_open' });

    for (const id of ['iv_used', 'iv_expired']) {
      const by = (await db.doc(`competitions/${cid}/invites/${id}`).get()).get('createdBy') as string;
      expect(by, id).toMatch(/^[0-9a-f]{16}$/);
      expect(by, id).not.toBe(h);
    }
    expect((await db.doc(`competitions/${cid}/invites/iv_open`).get()).get('createdBy')).toBe(h);

    // 邀請到期後續跑：開放那份也換成同一個假名，工作完成
    const jobId = removalJobId(TESTER.uid);
    const later = makeDeps(4 * DAY);
    const done = await runRemovalJob(later, jobId, { maxComps: 5, budgetMs: 40_000 });
    expect(done.status).toBe('done');
    const openBy = (await db.doc(`competitions/${cid}/invites/iv_open`).get()).get('createdBy') as string;
    expect(openBy).not.toBe(h);
    expect(openBy).toBe((await db.doc(`competitions/${cid}/invites/iv_used`).get()).get('createdBy'));
  });

  it('排程等待工作用游標輪替：max=2、3 份 waiting，第一輪游標停在第 2 份，第二輪拿到第 3 份後游標清空（Opus 複審 P2-B）', async () => {
    const db = adminDb();
    const ids = ['u_job_a', 'u_job_b', 'u_job_c'];
    for (const id of ids) {
      // 賽事不存在：processCompetition 會 skip，足以驗證輪替
      await db.doc(`cpRemovalJobs/${id}`).set({
        status: 'waiting', uid: `subj_${id}`, kind: 'self', pending: [],
        waiting: { [CID2]: ['host_active'] }, counts: {}, requestedAt: Timestamp.now()
      });
    }
    const opts = { dryRun: false, max: 2, auditBackfill: false, reportBackfill: false };
    await runDaily(makeDeps(), opts);
    expect((await db.doc('cpDailyState/waitingCursor').get()).get('after')).toBe('u_job_b');
    await runDaily(makeDeps(), opts);
    expect((await db.doc('cpDailyState/waitingCursor').get()).get('after')).toBeUndefined();
    const third = await db.doc('cpRemovalJobs/u_job_c').get();
    expect(third.get('lastRunAt')).toBeTruthy();
  });

  it('只代填過球員（沒有報隊、沒有聯絡標記）的人不被推定為代表、不會等到賽事結束（Opus 複審 P3-d）', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedMine(TESTER.uid, cid, []);
    await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).set({
      uid: null, realName: '代填甲', enId: ENID, dvId: DVID, teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
    });
    const r = await ok<{ status: string }>(call(reqRemovalHandler, TESTER, { confirm: 'REMOVE' }));
    expect(r.status).toBe('done');
    expect((await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).get()).get('addedByUid')).toBeNull();
  });

  // ── 10：排程第 1、2 項非 dryRun ─────────────────────────────────
  it('runDaily 非 dryRun：process 掉 queued 工作、該場處理、工作 done、removalProcessed ≥ 1', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedPlayer({ cid, uid: TESTER.uid });
    await seedMine(TESTER.uid, cid, ['player']);

    const jobId = removalJobId(TESTER.uid);
    await db.doc(`cpRemovalJobs/${jobId}`).set({
      kind: 'self', uid: TESTER.uid, status: 'queued',
      pending: [cid], waiting: {}, pseudo: {}, ccKey: {}, failed: {},
      leaseUntil: null, attempts: 0,
      requestedAt: Timestamp.fromMillis(Date.now() - 120_000),
      counts: EMPTY_COUNTS
    });

    const rep = await runDaily(makeDeps(), {
      dryRun: false, max: 50, auditBackfill: false, reportBackfill: false
    });
    expect(rep.removalProcessed).toBeGreaterThanOrEqual(1);

    const job = await db.doc(`cpRemovalJobs/${jobId}`).get();
    expect(job.get('status')).toBe('done');
    expect((await db.doc(`competitions/${cid}/roster/${PLID}`).get()).exists).toBe(false);
    expect((await db.doc(`competitions/${cid}/rosterPrivate/${PLID}`).get()).exists).toBe(false);
  });

  // ── 11：dryRun 完全不動資料 ─────────────────────────────────────
  it('管理員 dryRun 前後 roster/rosterPrivate/entryPrivate/staff/stats/audits/cpMine 全部文件 JSON 相等', async () => {
    const cid = await seedRoot({});
    const db = adminDb();
    await seedPlayer({ cid, uid: TESTER.uid, withStats: true });
    await seedMine(TESTER.uid, cid, ['player']);
    await db.doc(`competitions/${cid}/staff/${TESTER.uid}`).set({
      roles: ['host'], matchIds: [], expiresAt: null, displayName: '代表乙', memberNo: 1
    });
    await db.doc(`competitions/${cid}/entryPrivate/${ENID}`).set({
      registeredByUid: TESTER.uid, contactName: '代表乙', contactPhone: '0912345678'
    });
    await db.doc(`competitions/${cid}/audits/old1`).set({
      action: 'rosterAdd', actor: actorHash(cid, TESTER.uid), details: {},
      at: Timestamp.fromMillis(Date.now() - DAY)
    });

    const before = await snapshotAll(cid, TESTER.uid);

    await ok(call(adminHandler, ADMIN, {
      uid: TESTER.uid, reasonCode: 'subject_request', dryRun: true
    }));

    const after = await snapshotAll(cid, TESTER.uid);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
