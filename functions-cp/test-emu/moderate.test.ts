/**
 * cpHost moderate／reviewReport（模擬器，計畫書 §5.4）：管理員下架（hidden）寫稽核、主辦看得到下架原因、
 * 下架後一般人讀不到、主辦不能動、管理員恢復；檢舉處理狀態。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { adminDb, assertFails, assertSucceeds, clientDb, closeClients } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleCpParticipant } from '../src/cp/participant.js';
import { ADMIN, DAY, STRANGER, TESTER, TESTER2, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

const SUPER = { uid: 'admin', role: 'super_admin' };

describe('管理員下架與恢復', () => {
  let cid = '';
  let dvId = '';
  beforeEach(async () => {
    await resetAll();
    // 個人主辦＝TESTER（內部期測試者），發布後才是對外可見狀態
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput()));
    cid = c.cid;
    dvId = c.dvIds[0];
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
  });
  afterAll(() => closeClients());

  const hide = (who = ADMIN, over: Record<string, unknown> = {}, deps = makeDeps()) =>
    call(handleCpHost, who, { action: 'moderate', cid, hidden: true, reason: '冒用俱樂部名稱', ...over }, deps);
  const restore = (who = ADMIN) => call(handleCpHost, who, { action: 'moderate', cid, hidden: false });
  const root = async () => (await adminDb().doc(`competitions/${cid}`).get()).data()!;

  it('管理員下架：寫 hidden、原因、時間、stateVersion+1、稽核；讀取 閘門 1＋賽事 1', async () => {
    const before = await root();
    const meter = new ReadMeter();
    expect(await ok(hide(ADMIN, {}, makeDeps(0, meter)))).toEqual({ cid, hidden: true });
    expect(meter.reads).toBe(2);
    const d = await root();
    expect(d.hidden).toBe(true);
    expect(d.hiddenReason).toBe('冒用俱樂部名稱');
    expect(d.hiddenAt).toBeTruthy();
    expect(d.stateVersion).toBe(before.stateVersion + 1);
    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'moderateHide').get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].get('actorIsAdmin')).toBe(true);
    expect(audits.docs[0].get('details')).toEqual({ reason: '冒用俱樂部名稱' });
    expect(JSON.stringify(audits.docs[0].data())).not.toContain('"admin"');
  });

  it('超級管理員也可以；主辦、共同主辦、一般會員都不行（NOT_ADMIN／內部期閘門）', async () => {
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await fails(hide(TESTER), 'NOT_ADMIN', 'permission-denied');
    await fails(hide(TESTER2), 'NOT_ADMIN', 'permission-denied');
    await fails(hide(STRANGER), 'INTERNAL_PERIOD');
    await adminDb().doc('cpConfig/launch').set({ isPublic: true }, { merge: true });
    await fails(hide(STRANGER), 'NOT_ADMIN', 'permission-denied');
    await fails(call(handleCpHost, TESTER, { action: 'reviewReport', cid, reportId: 'rp_0123456789abcdef', status: 'resolved' }), 'NOT_ADMIN');
    // 近似字串的角色一律擋（isAdmin 嚴格比對；Opus 審 P3-3b）；俱樂部代表也擋（P3-3c）
    for (const role of ['Admin', 'administrator', 'host', 'super-admin', 'coach']) {
      await fails(hide({ uid: 'stranger', role }), 'NOT_ADMIN');
    }
    const clubCid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a' })))).cid;
    await fails(call(handleCpHost, TESTER, { action: 'moderate', cid: clubCid, hidden: true, reason: '冒用俱樂部名稱' }), 'NOT_ADMIN');
    expect((await root()).hidden).toBe(false);
    await ok(hide(SUPER));
    expect((await root()).hidden).toBe(true);
  });

  it('輸入檢查：原因必填 2～200 字（FIELD_LENGTH）、恢復不能帶原因、hidden 必須是布林、多帶鍵被拒、id 形狀', async () => {
    await fails(hide(ADMIN, { reason: undefined }), 'FIELD_REQUIRED');
    await fails(hide(ADMIN, { reason: '短' }), 'FIELD_LENGTH');
    await fails(hide(ADMIN, { reason: '字'.repeat(201) }), 'FIELD_LENGTH');
    await fails(call(handleCpHost, ADMIN, { action: 'moderate', cid, hidden: 'true', reason: '冒用俱樂部名稱' }), 'FIELD_TYPE');
    await fails(call(handleCpHost, ADMIN, { action: 'moderate', cid, hidden: false, reason: '恢復原因' }), 'UNKNOWN_FIELD');
    await fails(hide(ADMIN, { note: 'x' }), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, { action: 'moderate', cid: '../x', hidden: true, reason: '冒用俱樂部名稱' }), 'BAD_ID');
    await fails(call(handleCpHost, ADMIN, { action: 'moderate', cid: 'cp_' + 'z'.repeat(20), hidden: true, reason: '冒用俱樂部名稱' }), 'COMPETITION_NOT_FOUND', 'not-found');
    expect((await root()).hidden).toBe(false);
  });

  it('狀態沒變回 NO_CHANGE 不寫；刪除中的賽事不能下架或恢復', async () => {
    await fails(restore(), 'NO_CHANGE', 'failed-precondition');
    await ok(hide());
    const v = (await root()).stateVersion;
    await fails(hide(), 'NO_CHANGE');
    expect((await root()).stateVersion).toBe(v);
    await adminDb().doc(`competitions/${cid}`).update({ deletingAt: new Date() });
    await fails(restore(), 'COMPETITION_DELETING');
    await adminDb().doc(`competitions/${cid}`).update({ hidden: false });
    await fails(hide(), 'COMPETITION_DELETING');
  });

  it('顧問 11-20：舊文件沒有 hidden 欄位時恢復回 NO_CHANGE、不寫稽核；下架照常', async () => {
    const { FieldValue } = await import('firebase-admin/firestore');
    await adminDb().doc(`competitions/${cid}`).update({ hidden: FieldValue.delete() });
    await fails(restore(), 'NO_CHANGE', 'failed-precondition');
    expect((await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'moderateRestore').get()).size).toBe(0);
    await ok(hide());
    expect((await root()).hidden).toBe(true);
  });

  it('下架後：一般人與報隊者讀不到根文件；主辦讀得到下架原因；管理員讀得到', async () => {
    await adminDb().doc('cpConfig/launch').set({ isPublic: true }, { merge: true });
    await adminDb().doc(`competitions/${cid}`).update({ visibility: 'public' });
    await assertSucceeds(getDoc(doc(clientDb(STRANGER), `competitions/${cid}`)));
    await ok(hide());
    await assertFails(getDoc(doc(clientDb(STRANGER), `competitions/${cid}`)));
    await assertFails(getDoc(doc(clientDb(null as never), `competitions/${cid}`)));
    const host = await assertSucceeds(getDoc(doc(clientDb(TESTER), `competitions/${cid}`)));
    expect(host.get('hiddenReason')).toBe('冒用俱樂部名稱');
    const admin = await assertSucceeds(getDoc(doc(clientDb(ADMIN), `competitions/${cid}`)));
    expect(admin.get('hidden')).toBe(true);
  });

  it('顧問 11-20：下架後一般人讀不到根文件、組別、名單、場次、即時紀錄、射手榜，公開清單查詢不出現；主辦與管理員讀得到；恢復後回到原狀', async () => {
    await adminDb().doc('cpConfig/launch').set({ isPublic: true }, { merge: true });
    await adminDb().doc(`competitions/${cid}`).update({ visibility: 'public' });
    const mt = 'mt_' + 'a'.repeat(20);
    await adminDb().doc(`competitions/${cid}/roster/pl_${'a'.repeat(20)}`).set({ displayName: '球員甲', number: 7 });
    await adminDb().doc(`competitions/${cid}/matches/${mt}`).set({ status: 'scheduled', rev: 0 });
    await adminDb().doc(`competitions/${cid}/matches/${mt}/timeline/e1`).set({ type: 'goal', seq: 1 });
    await adminDb().doc(`competitions/${cid}/stats/${dvId}`).set({ players: [] });
    const paths = [
      `competitions/${cid}`,
      `competitions/${cid}/divisions/${dvId}`,
      `competitions/${cid}/roster/pl_${'a'.repeat(20)}`,
      `competitions/${cid}/matches/${mt}`,
      `competitions/${cid}/matches/${mt}/timeline/e1`,
      `competitions/${cid}/stats/${dvId}`,
    ];
    const publicList = (who: typeof STRANGER | null) => getDocs(query(collection(clientDb(who as never), 'competitions'),
      where('visibility', '==', 'public'), where('hidden', '==', false), where('status', 'in', ['published', 'postponed', 'cancelled']), limit(50)));
    // 回傳函式，逐一呼叫才發出查詢（避免先被拒的 promise 還沒掛上處理就報未處理錯誤）
    const lists = (who: typeof STRANGER | null) => [
      () => getDocs(query(collection(clientDb(who as never), `competitions/${cid}/roster`), limit(50))),
      () => getDocs(query(collection(clientDb(who as never), `competitions/${cid}/matches`), limit(50))),
      () => getDocs(query(collection(clientDb(who as never), `competitions/${cid}/matches/${mt}/timeline`), limit(50))),
    ];
    // 下架前：一般人、未登入都讀得到，清單有這場
    for (const who of [STRANGER, null]) {
      for (const p of paths) await assertSucceeds(getDoc(doc(clientDb(who as never), p)));
      for (const q of lists(who)) await assertSucceeds(q());
      expect((await assertSucceeds(publicList(who))).docs.map(d => d.id)).toContain(cid);
    }
    await ok(hide());
    for (const who of [STRANGER, null]) {
      for (const p of paths) await assertFails(getDoc(doc(clientDb(who as never), p)));
      for (const q of lists(who)) await assertFails(q());
      expect((await assertSucceeds(publicList(who))).docs.map(d => d.id)).not.toContain(cid);
      // Opus 審 P2-1：不帶 hidden 篩選的公開查詢、直接查 hidden==true，都要被 Rules 拒（不靠查詢條件本身）
      await assertFails(getDocs(query(collection(clientDb(who as never), 'competitions'),
        where('visibility', '==', 'public'), where('status', 'in', ['published', 'postponed', 'cancelled']), limit(50))));
      await assertFails(getDocs(query(collection(clientDb(who as never), 'competitions'), where('hidden', '==', true), limit(50))));
    }
    // 共同主辦、俱樂部主辦的代表也讀得到原因（Opus 審 P3-3d）
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    expect((await assertSucceeds(getDoc(doc(clientDb(TESTER2), `competitions/${cid}`)))).get('hiddenReason')).toBe('冒用俱樂部名稱');
    for (const who of [TESTER, ADMIN]) {
      for (const p of paths) await assertSucceeds(getDoc(doc(clientDb(who), p)));
      for (const q of lists(who)) await assertSucceeds(q());
      expect((await getDoc(doc(clientDb(who), `competitions/${cid}`))).get('hiddenReason')).toBe('冒用俱樂部名稱');
    }
    await ok(restore());
    for (const who of [STRANGER, null]) {
      for (const p of paths) await assertSucceeds(getDoc(doc(clientDb(who as never), p)));
      for (const q of lists(who)) await assertSucceeds(q());
      expect((await assertSucceeds(publicList(who))).docs.map(d => d.id)).toContain(cid);
    }
    expect((await getDoc(doc(clientDb(STRANGER), `competitions/${cid}`))).get('hiddenReason')).toBeNull();
  });

  it('下架期間主辦不能編輯、報隊被擋；恢復後清掉原因、主辦可再編輯', async () => {
    await ok(hide());
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, name: '改名逃避下架盃' }), 'COMPETITION_HIDDEN');
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a' }), 'COMPETITION_HIDDEN');
    // 下架期間主辦不能刪除（保留檢舉證據），管理員可以（既有行為，這裡只確認下架動作沒改到）
    await fails(call(handleCpHost, TESTER, { action: 'delete', cid }), 'COMPETITION_HIDDEN');
    await ok(restore());
    const d = await root();
    expect(d.hidden).toBe(false);
    expect(d.hiddenReason).toBeNull();
    expect(d.hiddenAt).toBeNull();
    const restored = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'moderateRestore').get();
    expect(restored.size).toBe(1);
    expect(restored.docs[0].get('details')).toEqual({});
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, name: '恢復後改名盃' }));
  });
});

describe('檢舉處理狀態 reviewReport', () => {
  let cid = '';
  beforeEach(async () => {
    await resetAll();
    cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
  });

  it('管理員標記 resolved／dismissed／open，清掉 reopened、寫稽核；再被檢舉時 reopened 回來且不覆寫狀態', async () => {
    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'impersonation' }));
    const ref = (await adminDb().collection(`competitions/${cid}/reports`).get()).docs[0].ref;
    await ref.update({ reopened: true });
    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: ref.id, status: 'resolved' }, makeDeps(0, meter)));
    expect(meter.reads).toBe(3);
    let d = (await ref.get()).data()!;
    expect(d.status).toBe('resolved');
    expect(d.reopened).toBe(false);
    expect(d.reviewedAt).toBeTruthy();
    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'reviewReport').get();
    expect(audits.docs[0].get('details')).toEqual({ reportId: ref.id, status: 'resolved' });
    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }, makeDeps(DAY + 60_000)));
    d = (await ref.get()).data()!;
    expect(d.status).toBe('resolved');
    expect(d.reopened).toBe(true);
    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: ref.id, status: 'dismissed' }));
    expect((await ref.get()).get('status')).toBe('dismissed');
    // 重新開啟（Opus 審 P3-3a）
    await ok(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: ref.id, status: 'open' }));
    expect((await ref.get()).get('status')).toBe('open');
    // 刪除中的賽事不能處理檢舉（P3-2）
    await adminDb().doc(`competitions/${cid}`).update({ deletingAt: new Date() });
    await fails(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: ref.id, status: 'resolved' }), 'COMPETITION_DELETING');
  });

  it('不存在回 REPORT_NOT_FOUND；狀態列舉、id 形狀、多帶鍵被拒', async () => {
    await fails(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: 'rp_0123456789abcdef', status: 'resolved' }), 'REPORT_NOT_FOUND', 'not-found');
    await fails(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: 'rp_0123456789abcdef', status: 'closed' }), 'FIELD_ENUM');
    await fails(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: 'tester2', status: 'resolved' }), 'BAD_ID');
    await fails(call(handleCpHost, ADMIN, { action: 'reviewReport', cid, reportId: 'rp_0123456789abcdef', status: 'resolved', note: 'x' }), 'UNKNOWN_FIELD');
  });
});
