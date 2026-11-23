/**
 * cpParticipant.reportCompetition（模擬器，§5.4）：每人每賽事每 24 小時 1 次、文件 id 不含 uid、草稿不收檢舉。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleCpParticipant } from '../src/cp/participant.js';
import { ADMIN, DAY, STRANGER, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

describe('檢舉', () => {
  let cid = '';
  beforeEach(async () => {
    await resetAll();
    cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
  });
  const report = (who = TESTER2, over: Record<string, unknown> = {}, deps = makeDeps()) =>
    call(handleCpParticipant, who, { action: 'reportCompetition', cid, reason: 'impersonation', ...over }, deps);

  it('草稿不收他人檢舉（not-found，避免探測）', async () => {
    await fails(report(), 'COMPETITION_NOT_FOUND', 'not-found');
  });
  it('24 小時內同一人同賽事只能 1 次；隔天可再檢舉並累計次數', async () => {
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
    await ok(report());
    await fails(report(TESTER2, { reason: 'fake' }), 'REPORT_RATE_LIMITED', 'resource-exhausted');
    await ok(report(TESTER)); // 不同人不受影響
    await ok(report(TESTER2, { reason: 'fake' }, makeDeps(DAY + 60_000)));
    const docs = await adminDb().collection(`competitions/${cid}/reports`).get();
    expect(docs.size).toBe(2);
    for (const d of docs.docs) {
      expect(d.id).toMatch(/^rp_[0-9a-f]{16}$/);
      expect(d.id).not.toContain('tester');
    }
    const t2 = docs.docs.find(d => d.get('reporterUid') === 'tester2')!;
    expect(t2.get('count')).toBe(2);
    expect(t2.get('reason')).toBe('fake');
    expect(t2.get('status')).toBe('open');
  });
  it('管理員已處理的檢舉，再被檢舉時不覆寫狀態、標 reopened', async () => {
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
    await ok(report());
    const ref = (await adminDb().collection(`competitions/${cid}/reports`).get()).docs[0].ref;
    await ref.update({ status: 'closed', adminNote: '已查證' });
    await ok(report(TESTER2, {}, makeDeps(DAY + 60_000)));
    const d = (await ref.get()).data()!;
    expect(d.status).toBe('closed');
    expect(d.adminNote).toBe('已查證');
    expect(d.reopened).toBe(true);
  });
  it('原因列舉、其他須附說明、內部期一般會員被擋', async () => {
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
    await fails(report(TESTER2, { reason: 'spam' }), 'FIELD_ENUM');
    await fails(report(TESTER2, { reason: 'other' }), 'FIELD_REQUIRED');
    await fails(report(STRANGER), 'INTERNAL_PERIOD');
    await fails(report(TESTER2, { reporterUid: 'x' }), 'UNKNOWN_FIELD');
  });
});

describe('檢舉通知外送匣（站長 11-18：管理員與總管收 LINE＋站內信）', () => {
  let cid = '';
  beforeEach(async () => {
    await resetAll();
    cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
  });
  const outbox = async () => (await adminDb().collection('cpOutbox').where('kind', '==', 'cpReportFiled').get()).docs.map(d => d.data());

  it('每筆檢舉寫一筆外送；同一賽事 6 小時內第二筆起只發站內信；被頻率限制擋下的不寫', async () => {
    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }));
    await fails(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }), 'REPORT_RATE_LIMITED');
    await ok(call(handleCpParticipant, TESTER, { action: 'reportCompetition', cid, reason: 'impersonation' }));
    const out = await outbox();
    expect(out).toHaveLength(2);
    expect(out.map(o => o.channels).sort((a, b) => b.length - a.length)).toEqual([['inbox', 'line'], ['inbox']]);
    for (const o of out) {
      expect(o.audienceRoles).toEqual(['admin', 'super_admin']);
      expect(JSON.stringify(o)).not.toMatch(/tester/);
    }
    // 6 小時後再推 LINE
    await ok(call(handleCpParticipant, TESTER3, { action: 'reportCompetition', cid, reason: 'fake' }, makeDeps(6 * 3600_000 + 60_000)));
    expect((await outbox()).filter(o => o.channels.includes('line'))).toHaveLength(2);
  });
});

describe('顧問 §3.254 B2：檢舉 LINE 全站與每人每日上限；草稿檢舉走主辦判斷', () => {
  beforeEach(() => resetAll());
  const mk = async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput()))).cid;
    await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
    return cid;
  };
  const lineCount = async () => (await adminDb().collection('cpOutbox').where('kind', '==', 'cpReportFiled').get())
    .docs.filter(d => (d.get('channels') as string[]).includes('line')).length;

  it('同一檢舉者跨賽事每日最多觸發 2 則 LINE，之後只發站內信；冷卻計數不放外送匣', async () => {
    const cids = [await mk(), await mk(), await mk()];
    for (const cid of cids) await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }));
    expect(await lineCount()).toBe(2);
    expect((await adminDb().collection('cpOutbox').get()).docs.every(d => typeof d.get('kind') === 'string')).toBe(true);
    expect((await adminDb().doc('cpLineThrottle/global').get()).get('count')).toBe(2);
  });
  it('全站每日最多 5 則 LINE（不同檢舉者、不同賽事）', async () => {
    const who = [TESTER, TESTER2, TESTER3];
    for (let i = 0; i < 7; i++) {
      const cid = await mk();
      await ok(call(handleCpParticipant, who[i % 3], { action: 'reportCompetition', cid, reason: 'fake' }));
    }
    expect(await lineCount()).toBe(5);
  });
  it('隔天（台北日期）計數重來', async () => {
    const cids = [await mk(), await mk(), await mk()];
    for (const cid of cids.slice(0, 2)) await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }));
    await ok(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid: cids[2], reason: 'fake' }, makeDeps(DAY + 60_000)));
    expect(await lineCount()).toBe(3);
  });
  it('草稿：主辦（staff host）與共同主辦可檢舉自己的草稿，其他人 not-found', async () => {
    const cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()))).cid;
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['coHost'], matchIds: [] });
    await ok(call(handleCpParticipant, TESTER, { action: 'reportCompetition', cid, reason: 'other', detail: '測試' }));
    await ok(call(handleCpParticipant, TESTER3, { action: 'reportCompetition', cid, reason: 'other', detail: '測試' }));
    await fails(call(handleCpParticipant, TESTER2, { action: 'reportCompetition', cid, reason: 'fake' }), 'COMPETITION_NOT_FOUND', 'not-found');
  });
});
