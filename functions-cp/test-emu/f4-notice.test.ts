/**
 * §3.272 F4（模擬器，寫好不跑）：公告額度、系統公告、聯絡文字、積分文件組別名稱。
 * 讀取預算用 ReadMeter。觸發器由測試直接呼叫。不跑 firebase。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter, actorHash } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { recomputeStanding } from '../src/cp/match-trigger.js';
import { NOTICE_LIMITS, cancelNoticeText, type Notice } from '../src/cp/notice.js';
import { ADMIN, DAY, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll, setBannedWords } from './_cp.js';
import { generate, matchesOf, record, setupComp, type Comp } from './_step3.js';

/** 契約上限。下面的 toBe 鎖住這條路徑實際讀了幾次。 */
const READ_BUDGET = {
  postNotice: 5,     // 閘門 ≤2＋賽事 1＋主辦判斷 ≤2。公告在已讀的根文件上，不多讀
  deleteNotice: 5,
  cancelMatch: 6,    // 與 F1 相同：系統公告不再讀
  contactNote: 5,    // 閘門 ≤2＋賽事 1＋主辦判斷 ≤2
  renameDivision: 12 // 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋組別查詢 ≤8＋每組改名的積分文件 ≤8
};

function nt(i: number): string {
  return `nt_${i.toString(36).padStart(20, '0')}`;
}

function seeded(kind: 'host' | 'system', i: number, text: string): Notice {
  return { id: nt(kind === 'host' ? i : 100 + i), text, kind, at: Timestamp.fromMillis(1_700_000_000_000 + i * 1000), by: '0123456789abcdef' };
}

async function noticesOf(cid: string): Promise<Notice[]> {
  const raw = (await adminDb().doc(`competitions/${cid}`).get()).get('notices');
  return Array.isArray(raw) ? raw as Notice[] : [];
}

async function auditOf(cid: string, action: string) {
  const snap = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', action).get();
  return snap.docs.map(d => d.data());
}

describe('§3.272 F4 公告', () => {
  let c: Comp;
  beforeEach(async () => { await resetAll(); c = await setupComp(['甲', '乙'], { host: TESTER }); });

  it('主辦、共同主辦、管理員可發；非主辦、禁用詞、超長、空文字拒絕；稽核不含 uid', async () => {
    const meter = new ReadMeter();
    const posted = await ok<{ noticeId: string; kind: string }>(call(
      handleCpHost, TESTER, { action: 'postNotice', cid: c.cid, text: '  第一行\n第二行  ' }, makeDeps(0, meter)
    ));
    expect(posted.kind).toBe('host');
    expect(posted.noticeId).toMatch(/^nt_[A-Za-z0-9]{20}$/);
    expect(meter.reads).toBe(4);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.postNotice);
    const list = await noticesOf(c.cid);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: posted.noticeId, text: '第一行\n第二行', kind: 'host', by: actorHash(c.cid, TESTER.uid)
    });
    expect(JSON.stringify(list[0])).not.toContain(TESTER.uid);
    const audits = await auditOf(c.cid, 'postNotice');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: actorHash(c.cid, TESTER.uid), actorIsAdmin: false });
    expect(JSON.stringify(audits[0])).not.toContain(TESTER.uid);

    await adminDb().doc(`competitions/${c.cid}/staff/${TESTER2.uid}`).set({ roles: ['coHost'], matchIds: [] });
    const coMeter = new ReadMeter();
    await ok(call(handleCpHost, TESTER2, { action: 'postNotice', cid: c.cid, text: '共同主辦公告' }, makeDeps(0, coMeter)));
    expect(coMeter.reads).toBe(4);
    const adminMeter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, { action: 'postNotice', cid: c.cid, text: '管理員公告' }, makeDeps(0, adminMeter)));
    expect(adminMeter.reads).toBe(2);

    await fails(call(handleCpHost, TESTER3, { action: 'postNotice', cid: c.cid, text: '路人' }), 'NOT_HOST');
    await setBannedWords();
    await fails(call(handleCpHost, TESTER, { action: 'postNotice', cid: c.cid, text: '這是官方公告' }), 'BANNED_WORD');
    await fails(call(handleCpHost, TESTER, { action: 'postNotice', cid: c.cid, text: '字'.repeat(301) }), 'FIELD_LENGTH');
    await fails(call(handleCpHost, TESTER, { action: 'postNotice', cid: c.cid, text: '   ' }), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, TESTER, { action: 'postNotice', cid: c.cid, text: '好', phone: '0912' }), 'UNKNOWN_FIELD');
  });

  it('手動 20 則用完再發回 NOTICE_LIMIT，但取消場次仍成功且系統公告照發', async () => {
    await generate(c);
    const host = Array.from({ length: NOTICE_LIMITS.hostMax }, (_, i) => seeded('host', i, `手動${i}`));
    await adminDb().doc(`competitions/${c.cid}`).update({ notices: host });
    const meter = new ReadMeter();
    await fails(
      call(handleCpHost, ADMIN, { action: 'postNotice', cid: c.cid, text: '第 21 則' }, makeDeps(0, meter)),
      'NOTICE_LIMIT',
      'resource-exhausted'
    );
    expect(meter.reads).toBe(2);

    const ms = await matchesOf(c);
    const m = ms[0];
    const reason = '場地淹水';
    const cancelMeter = new ReadMeter();
    const cancelled = await ok<{ noticeId: string; status: string }>(call(handleCpHost, ADMIN, {
      action: 'cancelMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, reason
    }, atKickoff(cancelMeter)));
    expect(cancelled.status).toBe('cancelled');
    expect(cancelMeter.reads).toBe(3);
    expect(cancelMeter.reads).toBeLessThanOrEqual(READ_BUDGET.cancelMatch);
    const list = await noticesOf(c.cid);
    expect(list.filter(n => n.kind === 'host')).toHaveLength(20);
    const system = list.filter(n => n.kind === 'system');
    expect(system).toHaveLength(1);
    const kickoff = m.kickoffAt && typeof (m.kickoffAt as { toMillis?: () => number }).toMillis === 'function'
      ? (m.kickoffAt as { toMillis: () => number }).toMillis() : null;
    expect(system[0]?.text).toBe(cancelNoticeText({
      kickoffMs: kickoff, homeName: m.home.name, awayName: m.away.name, reason
    }));
    expect(system[0]?.by).toBe(actorHash(c.cid, ADMIN.uid));
    expect(system[0]?.id).toBe(cancelled.noticeId);
    expect(JSON.stringify(system[0])).not.toContain(ADMIN.uid);
  });

  it('系統公告超過 20 則時最舊的被汰換；系統公告也可以刪', async () => {
    await generate(c);
    const host = seeded('host', 1, '留著的手動');
    const system = Array.from({ length: NOTICE_LIMITS.systemMax }, (_, i) => seeded('system', i, `系統${i}`));
    await adminDb().doc(`competitions/${c.cid}`).update({ notices: [host, ...system] });
    const m = (await matchesOf(c))[0];
    await ok(call(handleCpHost, ADMIN, {
      action: 'cancelMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, reason: '改期再戰'
    }, atKickoff()));
    const list = await noticesOf(c.cid);
    expect(list.filter(n => n.kind === 'host').map(n => n.text)).toEqual(['留著的手動']);
    const sys = list.filter(n => n.kind === 'system');
    expect(sys).toHaveLength(20);
    expect(sys.some(n => n.text === '系統0')).toBe(false);
    expect(sys.some(n => n.text === '系統1')).toBe(true);
    expect(sys[sys.length - 1]?.text).toContain('已取消：改期再戰');

    const victim = sys[0]!;
    const delMeter = new ReadMeter();
    const deleted = await ok<{ noticeId: string; kind: string }>(call(
      handleCpHost, TESTER, { action: 'deleteNotice', cid: c.cid, noticeId: victim.id }, makeDeps(0, delMeter)
    ));
    expect(deleted).toEqual({ noticeId: victim.id, kind: 'system' });
    expect(delMeter.reads).toBe(4);
    expect(delMeter.reads).toBeLessThanOrEqual(READ_BUDGET.deleteNotice);
    expect((await noticesOf(c.cid)).some(n => n.id === victim.id)).toBe(false);
    const audits = await auditOf(c.cid, 'deleteNotice');
    expect(audits[0]).toMatchObject({ actor: actorHash(c.cid, TESTER.uid) });
    expect(JSON.stringify(audits[0])).not.toContain(TESTER.uid);

    await fails(call(handleCpHost, TESTER3, { action: 'deleteNotice', cid: c.cid, noticeId: sys[1]!.id }), 'NOT_HOST');
    await fails(call(handleCpHost, TESTER, { action: 'deleteNotice', cid: c.cid, noticeId: nt(999) }), 'NOTICE_NOT_FOUND');
  });
});

describe('§3.272 F4 聯絡文字', () => {
  beforeEach(() => resetAll());

  it('建賽與改賽可帶；禁用詞、超長、多行、電話欄位拒絕', async () => {
    const meter = new ReadMeter();
    const { cid } = await ok<{ cid: string }>(call(
      handleCpHost, ADMIN, createInput({ contactNote: '  線上表單  ' }), makeDeps(0, meter)
    ));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('contactNote')).toBe('線上表單');
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('notices')).toEqual([]);
    // 建賽本身還有配額讀取，這裡只鎖「有寫進去」。改賽的讀取另測。
    expect(meter.reads).toBeGreaterThan(0);

    const upd = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '改成信箱' }, makeDeps(0, upd)));
    expect(upd.reads).toBe(2);
    expect(upd.reads).toBeLessThanOrEqual(READ_BUDGET.contactNote);
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('contactNote')).toBe('改成信箱');

    await ok(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '聯'.repeat(60) }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('contactNote')).toBe('聯'.repeat(60));
    await ok(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '' }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('contactNote')).toBeNull();

    await setBannedWords();
    await fails(call(handleCpHost, ADMIN, createInput({ contactNote: '官方窗口' })), 'BANNED_WORD');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '官方窗口' }), 'BANNED_WORD');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '聯'.repeat(61) }), 'FIELD_LENGTH');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '第一行\n第二行' }), 'FIELD_FORMAT');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: '第一行\r\n第二行' }), 'FIELD_FORMAT');
    await fails(call(handleCpHost, ADMIN, createInput({ contactPhone: '0912345678' })), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, phone: '0912345678' }), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, contactNote: 1 }), 'FIELD_TYPE');
  });
});

describe('§3.272 F4 積分文件組別名稱', () => {
  beforeEach(() => resetAll());

  it('recomputeStanding 寫入 divisionName，且沒有為了名稱多讀', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const before = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    expect(before.divisionName).toBe('成人組');
    const version0 = before.version;

    await record(c, '甲', '乙', 1, 0);
    const afterRecord = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    expect(afterRecord.divisionName).toBe('成人組');
    expect(afterRecord.version).toBeGreaterThan(version0 as number);

    await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).update({ name: '少年組' });
    const meter = new ReadMeter();
    const wrote = await recomputeStanding(makeDeps(0, meter), c.cid, c.dvId, 'group', 'A');
    expect(wrote).toBe(true);
    // 賽事 1＋組別 1＋舊積分 1＋該組 1 場。名稱來自已讀的組別文件。
    expect(meter.reads).toBe(4);
    const after = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    expect(after.divisionName).toBe('少年組');
  });

  it('updateCompetition 改組別名稱時同步積分文件，未改名的組別不讀積分', async () => {
    const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, ADMIN, createInput({
      divisions: [
        { name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 },
        { name: '青少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }
      ]
    })));
    const [adult, youth] = created.dvIds;
    const db = adminDb();
    await db.doc(`competitions/${created.cid}/standings/${adult}__group__A`).set({ divisionName: '成人組', version: 3, rows: [] });
    await db.doc(`competitions/${created.cid}/standings/${youth}__group__A`).set({ divisionName: '青少年組', version: 3, rows: [] });

    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, {
      action: 'update', cid: created.cid, divisions: [
        { dvId: adult, name: '社會組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 },
        { dvId: youth, name: '青少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }
      ]
    }, makeDeps(0, meter)));
    // 閘門 1＋賽事 1＋組別查詢 2＋只讀被改名的那一份積分
    expect(meter.reads).toBe(5);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.renameDivision);
    const adultSt = (await db.doc(`competitions/${created.cid}/standings/${adult}__group__A`).get()).data()!;
    const youthSt = (await db.doc(`competitions/${created.cid}/standings/${youth}__group__A`).get()).data()!;
    expect(adultSt.divisionName).toBe('社會組');
    expect(adultSt.version).toBe(3);
    expect(youthSt.divisionName).toBe('青少年組');
    expect((await db.doc(`competitions/${created.cid}/divisions/${adult}`).get()).get('name')).toBe('社會組');
  });

  it('名單鎖定後可以只改組別名稱並同步積分；改規則仍被拒', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const before = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    const version = before.version;
    await fails(call(handleCpHost, ADMIN, {
      action: 'update', cid: c.cid, divisions: [
        { dvId: c.dvId, name: '青年組', playersOnField: 5, maxTeams: 8, rosterMin: 1, rosterMax: 10 }
      ]
    }), 'ROSTERS_LOCKED');

    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, {
      action: 'update', cid: c.cid, divisions: [
        { dvId: c.dvId, name: '青年組', playersOnField: 5, maxTeams: 2, rosterMin: 1, rosterMax: 10 }
      ]
    }, makeDeps(0, meter)));
    expect(meter.reads).toBe(4);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.renameDivision);
    const st = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    expect(st.divisionName).toBe('青年組');
    expect(st.version).toBe(version);
    expect((await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('name')).toBe('青年組');
  });
});

/** 開賽之後才取消（與 _step3 的 LATER 相同）。 */
function atKickoff(meter?: ReadMeter) {
  return makeDeps(25 * DAY, meter);
}
