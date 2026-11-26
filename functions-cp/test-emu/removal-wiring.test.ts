/**
 * 賽事個資移除派工表接線＋稽核 expireAt＋檢舉清除佇列（模擬器）。
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
  createInput,
  fails,
  makeDeps,
  ok,
  resetAll
} from './_cp.js';
import { actorHash } from '../src/cp/context.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleCpParticipant } from '../src/cp/participant.js';
import { handleScorerWritten } from '../src/cp/scorer-trigger.js';
import { auditExpireAtMs, deleteAuditExpireAtMs, reportPurgeAtMs } from '../src/cp/removal-plan.js';

const MTID = `mt_${'a'.repeat(20)}`;

describe('removal 派工表接線', () => {
  beforeEach(async () => {
    await resetAll({ isPublic: false });
  });

  it('requestMyDataRemoval 不過內部期閘門；同情境 reportCompetition 仍被擋', async () => {
    const r = await ok<{ status: string }>(
      call(handleCpParticipant, STRANGER, { action: 'requestMyDataRemoval', confirm: 'REMOVE' })
    );
    expect(typeof r.status).toBe('string');
    await fails(
      call(handleCpParticipant, STRANGER, { action: 'reportCompetition', cid: `cp_${'a'.repeat(20)}`, reason: 'fake' }),
      'INTERNAL_PERIOD'
    );
  });

  it('removeProxyPlayerData 與 adminRemoveUserData 接到動作層', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a' })))).cid;
    const plId = `pl_${'b'.repeat(20)}`;
    await adminDb().doc(`competitions/${cid}/roster/${plId}`).set({ displayName: '小明', enId: `en_${'c'.repeat(20)}`, dvId: `dv_${'d'.repeat(20)}`, number: 10 });
    await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).set({
      uid: 'someplayer', realName: '王小明', enId: `en_${'c'.repeat(20)}`, dvId: `dv_${'d'.repeat(20)}`,
      teamId: 'club_a', source: 'rep', addedByUid: TESTER.uid
    });
    const proxy = await ok<{ cid: string; plId: string; deidentified: boolean }>(
      call(handleCpEntry, TESTER, { action: 'removeProxyPlayerData', cid, plId, confirm: 'REMOVE' })
    );
    expect(proxy).toEqual({ cid, plId, deidentified: true });

    const dr = await ok<{ dryRun: boolean }>(
      call(handleCpHost, ADMIN, { action: 'adminRemoveUserData', uid: 'tester2', reasonCode: 'subject_request' })
    );
    expect(dr.dryRun).toBe(true);
  });
});

describe('稽核 expireAt', () => {
  beforeEach(async () => {
    await resetAll({ isPublic: true });
  });

  it('create 與 publish 稽核都帶 expireAt，等於 auditExpireAtMs(寫入時間, lastMatchAt) ±5 秒', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
    const comp = await adminDb().doc(`competitions/${cid}`).get();
    const lastMatchMs = (comp.get('lastMatchAt') as Timestamp).toMillis();
    const audits = await adminDb().collection(`competitions/${cid}/audits`).get();
    for (const action of ['create', 'publish']) {
      const d = audits.docs.find(x => x.get('action') === action);
      expect(d).toBeTruthy();
      const atMs = (d!.get('at') as Timestamp).toMillis();
      const exp = (d!.get('expireAt') as Timestamp).toMillis();
      expect(Math.abs(exp - auditExpireAtMs(atMs, lastMatchMs))).toBeLessThanOrEqual(5000);
    }
  });

  it('刪除賽事：cpAudits/del_{cid} 帶 expireAt ≈ now＋365 天', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()))).cid;
    await ok(call(handleCpHost, TESTER, { action: 'delete', cid }));
    const root = await adminDb().doc(`competitions/${cid}`).get();
    expect(root.exists).toBe(false);
    const del = await adminDb().doc(`cpAudits/del_${cid}`).get();
    expect(del.exists).toBe(true);
    const exp = (del.get('expireAt') as Timestamp).toMillis();
    expect(Math.abs(exp - deleteAuditExpireAtMs(Date.now()))).toBeLessThanOrEqual(5000);
  });

  it('接手稽核：handleScorerWritten 寫入的 tk_ 稽核帶 expireAt', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()))).cid;
    const takenAt = Timestamp.now();
    const wrote = await handleScorerWritten(makeDeps(), cid, MTID, null, { uid: 'tester', sid: 's1', takenAt });
    expect(wrote).toBe(true);
    const id = `tk_${takenAt.toMillis()}_${MTID}_${actorHash(cid, 'tester')}`;
    const audit = await adminDb().doc(`competitions/${cid}/audits/${id}`).get();
    expect(audit.exists).toBe(true);
    expect(audit.get('expireAt')).toBeTruthy();
  });

  it('updateCompetition 延後 lastMatchAt 超過緩衝 → 既有 create 稽核 expireAt 重算', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()))).cid;
    const comp = await adminDb().doc(`competitions/${cid}`).get();
    const oldLast = (comp.get('lastMatchAt') as Timestamp).toMillis();
    const newLast = oldLast + 100 * DAY;
    const first = (comp.get('firstMatchAt') as Timestamp).toMillis();
    const regOpen = (comp.get('regOpenAt') as Timestamp).toMillis();
    const regClose = (comp.get('regCloseAt') as Timestamp).toMillis();
    await ok(call(handleCpHost, TESTER, {
      action: 'update', cid,
      regOpenAt: regOpen, regCloseAt: regClose, firstMatchAt: first, lastMatchAt: newLast
    }));
    const createAudit = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'create').get();
    expect(createAudit.size).toBe(1);
    const atMs = (createAudit.docs[0].get('at') as Timestamp).toMillis();
    const exp = (createAudit.docs[0].get('expireAt') as Timestamp).toMillis();
    expect(exp).toBe(auditExpireAtMs(atMs, newLast));
  });
});

describe('檢舉 180 天清除佇列', () => {
  let cid = '';
  beforeEach(async () => {
    await resetAll({ isPublic: true });
    cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
  });

  it('resolved/dismissed 建立佇列、open 刪除；再檢舉 reopened 時刪除', async () => {
    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'impersonation' }));
    const reports = await adminDb().collection(`competitions/${cid}/reports`).get();
    expect(reports.size).toBe(1);
    const rid = reports.docs[0].id;
    const queueRef = adminDb().doc(`cpReportPurge/${cid}_${rid}`);

    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: rid, status: 'resolved' }));
    let q = await queueRef.get();
    expect(q.exists).toBe(true);
    const purgeMs = (q.get('purgeAt') as Timestamp).toMillis();
    expect(Math.abs(purgeMs - reportPurgeAtMs(Date.now()))).toBeLessThanOrEqual(5000);

    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: rid, status: 'open' }));
    expect((await queueRef.get()).exists).toBe(false);

    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: rid, status: 'dismissed' }));
    expect((await queueRef.get()).exists).toBe(true);

    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }, makeDeps(25 * 3600_000)));
    expect((await queueRef.get()).exists).toBe(false);
    const again = await adminDb().collection(`competitions/${cid}/reports`).get();
    expect(again.docs[0].get('reopened')).toBe(true);
  });
});
