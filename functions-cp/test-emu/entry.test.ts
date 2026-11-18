/**
 * cpEntry（模擬器）：報隊、審核、撤隊、成員登錄、代表代填（無帳號）、退出、確認、鎖定；cpMine；生日不入庫。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import {
  ADMIN, DAY, MAIN, STRANGER, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll, scanAll
} from './_cp.js';

let cid = '';
let dvId = '';
let youthDv = '';

async function setupComp(over: Record<string, unknown> = {}) {
  const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, ADMIN, createInput({
    divisions: [
      { name: '成人組', playersOnField: 5, maxTeams: 2, rosterMin: 2, rosterMax: 5 },
      { name: 'U16', playersOnField: 5, maxTeams: 2, rosterMin: 1, rosterMax: 5, minAge: 10, maxAge: 15 }
    ],
    ...over
  })));
  cid = c.cid; dvId = c.dvIds[0]; youthDv = c.dvIds[1];
  await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
}
const register = (who = TESTER, dv = dvId, deps = makeDeps()) =>
  call(handleCpEntry, who, { action: 'registerEntry', cid, dvId: dv, teamId: 'club_a', contactName: '聯絡人', contactPhone: '0912-000-000' }, deps);
const entry = (enId: string) => adminDb().doc(`competitions/${cid}/entries/${enId}`).get().then(s => s.data()!);
/** 首場日期當天剛好 n 歲的生日（台北） */
function birthdayForAge(n: number, firstMatchMs: number) {
  const d = new Date(firstMatchMs + 8 * 3600_000);
  return `${d.getUTCFullYear() - n}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}
async function firstMatchMs() {
  return (await adminDb().doc(`competitions/${cid}`).get()).get('firstMatchAt').toMillis() as number;
}

describe('報隊與審核', () => {
  beforeEach(async () => { await resetAll(); await setupComp(); });

  it('只有俱樂部代表能報隊；寫公開＋私密＋cpMine＋計數', async () => {
    await fails(register(TESTER2), 'NOT_CLUB_REP', 'permission-denied');
    const { enId } = await ok<{ enId: string }>(register());
    expect(await entry(enId)).toMatchObject({ dvId, teamId: 'club_a', name: '甲隊足球俱樂部', status: 'pending', rosterCount: 0 });
    const priv = (await adminDb().doc(`competitions/${cid}/entryPrivate/${enId}`).get()).data()!;
    expect(priv).toMatchObject({ teamId: 'club_a', registeredByUid: 'tester', paymentStatus: 'none', contactPhone: '0912-000-000' });
    // 公開文件不含聯絡資料與 uid
    expect(JSON.stringify(await entry(enId))).not.toMatch(/tester|0912/);
    const mine = (await adminDb().doc(`cpMine/tester/items/${cid}`).get()).data()!;
    expect(mine).toMatchObject({ cid, roles: ['rep'], entryIds: [enId] });
    expect((await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).get()).get('entryCount')).toBe(1);
  });
  it('同隊同組不能重複報；報名期間外、草稿、取消、下架都被拒', async () => {
    await ok(register());
    await fails(register(), 'ENTRY_EXISTS', 'already-exists');
    await fails(register(TESTER, dvId, makeDeps(11 * DAY)), 'REG_CLOSED');
    await adminDb().doc(`competitions/${cid}`).update({ regOpenAt: new Date(Date.now() + DAY) });
    await fails(register(TESTER, youthDv), 'REG_NOT_OPEN');
    for (const patch of [{ status: 'draft' }, { status: 'cancelled' }, { status: 'postponed' }]) {
      await adminDb().doc(`competitions/${cid}`).update({ regOpenAt: new Date(Date.now() - DAY), ...patch });
      await fails(register(TESTER, youthDv), 'COMPETITION_NOT_OPEN');
    }
    await adminDb().doc(`competitions/${cid}`).update({ status: 'published', hidden: true });
    await fails(register(TESTER, youthDv), 'COMPETITION_HIDDEN');
  });
  it('多帶鍵、電話格式、teamId 形狀被拒', async () => {
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a', status: 'approved' }), 'UNKNOWN_FIELD');
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a', contactPhone: 'call me' }), 'FIELD_FORMAT');
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'a/b' }), 'BAD_ID');
  });
  it('審核：只有主辦；拒絕必填原因；核准不超過上限；拒絕已核准會扣回', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    await fails(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid, enId, decision: 'approve' }), 'NOT_HOST');
    await fails(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'reject' }), 'FIELD_REQUIRED');
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' }));
    await fails(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' }), 'ENTRY_STATE');
    await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).update({ approvedCount: 2 });
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'reject', reason: '資格不符' }));
    const dv = (await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).get()).data()!;
    expect(dv.approvedCount).toBe(1);
    expect(dv.entryCount).toBe(0);
    expect((await adminDb().doc(`competitions/${cid}/entryPrivate/${enId}`).get()).get('reviewNote')).toBe('資格不符');
  });
  it('組別已達核准上限時不能再核准；報隊總數上限為 maxTeams×2', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).update({ approvedCount: 2 });
    await fails(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' }), 'DIVISION_APPROVED_FULL', 'resource-exhausted');
    await adminDb().doc(`competitions/${cid}/divisions/${youthDv}`).update({ entryCount: 4 });
    await fails(register(TESTER, youthDv), 'DIVISION_FULL', 'resource-exhausted');
  });
});

describe('成員登錄（joinRoster）', () => {
  let enId = '';
  beforeEach(async () => {
    await resetAll();
    await setupComp();
    enId = (await ok<{ enId: string }>(register())).enId;
  });
  const join = (who = TESTER2, over: Record<string, unknown> = {}, deps = makeDeps()) =>
    call(handleCpEntry, who, { action: 'joinRoster', cid, enId, number: 10, position: 'MF', privacyAck: true, ...over }, deps);

  it('成年成員：公開名預設主站顯示名，私密存 uid，cpMine 加 player，生日不入庫', async () => {
    const r = await ok<{ plId: string; isMinor: boolean }>(join());
    expect(r.isMinor).toBe(false);
    const pub = (await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).data()!;
    expect(pub).toMatchObject({ enId, displayName: '球員丙', number: 10, position: 'MF', isMinor: false });
    expect(Object.keys(pub).sort()).toEqual(['createdAt', 'displayName', 'dvId', 'enId', 'isMinor', 'number', 'position']);
    const priv = (await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).data()!;
    expect(priv).toMatchObject({ uid: 'tester2', teamId: 'club_a', source: 'self', ageEligible: true, realName: null });
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).get('roles')).toEqual(['player']);
    expect((await entry(enId)).rosterCount).toBe(1);
    const hits = await scanAll([`competitions/${cid}/roster`, `competitions/${cid}/rosterPrivate`, `competitions/${cid}/audits`, 'cpMine/tester2/items'],
      (k, v) => /birth/i.test(k) || v === '1995/07/07');
    expect(hits).toEqual([]);
  });
  it('可用暱稱；暱稱禁用字被拒；成年不能帶 publicName', async () => {
    const r = await ok<{ plId: string }>(join(TESTER2, { nickname: '小飛俠' }));
    expect((await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).get('displayName')).toBe('小飛俠');
    await ok(call(handleCpEntry, TESTER2, { action: 'leaveRoster', cid, plId: r.plId }));
    await fails(join(TESTER2, { nickname: '官方代表' }), 'BANNED_WORD');
    await fails(join(TESTER2, { publicName: '球' }), 'UNKNOWN_FIELD');
  });
  it('非成員、未勾告知、生日缺漏、重複登錄、背號重複、名單已滿都被拒', async () => {
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    await fails(join(TESTER2, { privacyAck: false }), 'PRIVACY_ACK_REQUIRED');
    await adminDb().doc('cpClubs/club_a/members/tester3').set({ since: new Date() });
    await fails(join(TESTER3), 'BIRTHDAY_REQUIRED', 'failed-precondition');
    await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).update({ rosterMax: 3 });
    await ok(join(TESTER2));
    await fails(join(TESTER2, { number: 11 }), 'ALREADY_IN_ROSTER', 'already-exists');
    await fails(join(TESTER, { number: 10 }), 'NUMBER_TAKEN', 'already-exists');
    await ok(join(TESTER, { number: 11 }));
    await ok(call(handleCpEntry, TESTER, { action: 'addRosterByRep', cid, enId, number: 12, realName: '代填戊', birthday: '1990/01/01', privacyAck: true }));
    await adminDb(MAIN).doc('users/tester3').set({ displayName: '路人丁', birthday: '1991/01/01' });
    await fails(join(TESTER3, { number: 13 }), 'ROSTER_FULL', 'resource-exhausted');
  });
  it('背號範圍與位置列舉', async () => {
    await fails(join(TESTER2, { number: 100 }), 'FIELD_RANGE');
    await fails(join(TESTER2, { number: 1.5 }), 'FIELD_RANGE');
    await fails(join(TESTER2, { position: 'ST' }), 'FIELD_ENUM');
  });
  it('其他賽事的成員身分不能拿來登錄：鏡像只看本隊 teamId', async () => {
    await adminDb().doc('cpClubs/club_b').set({ repUids: ['tester3'], name: '乙隊' });
    await adminDb().doc('cpClubs/club_b/members/tester3').set({ since: new Date() });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER');
  });
});

describe('未成年與年齡（U16 組）', () => {
  let enId = '';
  let fm = 0;
  beforeEach(async () => {
    await resetAll();
    await setupComp();
    enId = (await ok<{ enId: string }>(register(TESTER, youthDv))).enId;
    fm = await firstMatchMs();
  });
  const join = (over: Record<string, unknown> = {}) =>
    call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 7, privacyAck: true, ...over });

  it('年齡不符被拒（成年成員報 U16）', async () => {
    await fails(join({ realName: '林大明' }), 'AGE_NOT_ELIGIBLE', 'failed-precondition');
  });
  it('未成年：必填真名、必勾監護人同意、公開名只能是姓氏候選', async () => {
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(14, fm) });
    await fails(join(), 'REAL_NAME_REQUIRED');
    await fails(join({ realName: '歐陽小明' }), 'GUARDIAN_CONSENT_REQUIRED');
    await fails(join({ realName: '歐陽小明', guardianConsent: true, publicName: '歐陽小明' }), 'MINOR_PUBLIC_NAME');
    await fails(join({ realName: '歐陽小明', guardianConsent: true, publicName: '小明' }), 'MINOR_PUBLIC_NAME');
    const r = await ok<{ plId: string; isMinor: boolean }>(join({ realName: '歐陽小明', guardianConsent: true }));
    expect(r.isMinor).toBe(true);
    const pub = (await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).data()!;
    expect(pub.displayName).toBe('歐陽');
    expect(pub.isMinor).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('小明');
    const priv = (await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).data()!;
    expect(priv).toMatchObject({ realName: '歐陽小明', isMinor: true, guardianConsent: true, ageEligible: true });
  });
  it('未成年可把公開名修正為第一字', async () => {
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(14, fm) });
    const r = await ok<{ plId: string }>(join({ realName: '歐陽小明', guardianConsent: true, publicName: '歐' }));
    expect((await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).get('displayName')).toBe('歐');
  });
  it('邊界：首場當天滿 16 歲不符 maxAge 15；剛好 15 歲可', async () => {
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(16, fm) });
    await fails(join({ realName: '林小華', guardianConsent: true }), 'AGE_NOT_ELIGIBLE');
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(15, fm) });
    await ok(join({ realName: '林小華', guardianConsent: true }));
  });
});

describe('代表代填無帳號球員（addRosterByRep，§4.4）', () => {
  let enId = '';
  let fm = 0;
  beforeEach(async () => {
    await resetAll();
    await setupComp();
    enId = (await ok<{ enId: string }>(register(TESTER, youthDv))).enId;
    fm = await firstMatchMs();
  });
  const add = (who = TESTER, over: Record<string, unknown> = {}) =>
    call(handleCpEntry, who, {
      action: 'addRosterByRep', cid, enId, number: 3, realName: '陳小安', birthday: birthdayForAge(12, fm).replace(/\//g, '-'),
      guardianConsent: true, privacyAck: true, ...over
    });

  it('代表可代填：uid 為 null、記 addedByUid、公開只放姓氏、生日不入庫', async () => {
    const r = await ok<{ plId: string; isMinor: boolean }>(add());
    expect(r.isMinor).toBe(true);
    const priv = (await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).data()!;
    expect(priv).toMatchObject({ uid: null, addedByUid: 'tester', source: 'rep', realName: '陳小安', guardianConsent: true });
    expect((await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).get('displayName')).toBe('陳');
    const bd = birthdayForAge(12, fm);
    const hits = await scanAll([`competitions/${cid}/roster`, `competitions/${cid}/rosterPrivate`, `competitions/${cid}/audits`, `competitions/${cid}/entries`],
      (k, v) => /birth/i.test(k) || v === bd || v === bd.replace(/\//g, '-'));
    expect(hits).toEqual([]);
    // 無帳號球員不建 cpMine
    expect((await adminDb().collection('cpMine').listDocuments()).map(d => d.id)).toEqual(['tester']);
  });
  it('成員（非代表）、非成員、主辦都不能代填', async () => {
    await fails(add(TESTER2), 'NOT_CLUB_REP');
    await fails(add(STRANGER), 'INTERNAL_PERIOD');
    await fails(add(ADMIN), 'NOT_CLUB_REP');
  });
  it('未成年未勾監護人同意、真名缺、生日格式錯、年齡不符被拒', async () => {
    await fails(add(TESTER, { guardianConsent: false }), 'GUARDIAN_CONSENT_REQUIRED');
    await fails(add(TESTER, { realName: '' }), 'FIELD_REQUIRED');
    await fails(add(TESTER, { birthday: '2014/13/40' }), 'BIRTHDAY_INVALID');
    await fails(add(TESTER, { birthday: undefined }), 'FIELD_REQUIRED');
    await fails(add(TESTER, { birthday: birthdayForAge(9, fm) }), 'AGE_NOT_ELIGIBLE');
  });
  it('代表可移除代填球員；球員本人以外的會員不能移除', async () => {
    const r = await ok<{ plId: string }>(add());
    await fails(call(handleCpEntry, TESTER2, { action: 'leaveRoster', cid, plId: r.plId }), 'NOT_ROSTER_OWNER');
    await ok(call(handleCpEntry, TESTER, { action: 'leaveRoster', cid, plId: r.plId }));
    expect((await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).exists).toBe(false);
    expect((await entry(enId)).rosterCount).toBe(0);
  });
});

describe('確認、鎖定（檢錄）、退出、撤隊', () => {
  let enId = '';
  let plId = '';
  beforeEach(async () => {
    await resetAll();
    await setupComp();
    enId = (await ok<{ enId: string }>(register())).enId;
    plId = (await ok<{ plId: string }>(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 9, privacyAck: true }))).plId;
  });

  it('確認：待審不能確認、人數不足被拒、核准且人數夠才成立；之後名單異動會取消確認', async () => {
    await fails(call(handleCpEntry, TESTER, { action: 'confirmRoster', cid, enId }), 'ENTRY_NOT_APPROVED');
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' }));
    await fails(call(handleCpEntry, TESTER, { action: 'confirmRoster', cid, enId }), 'ROSTER_SIZE');
    await ok(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 1, privacyAck: true }));
    await fails(call(handleCpEntry, TESTER2, { action: 'confirmRoster', cid, enId }), 'NOT_CLUB_REP');
    await ok(call(handleCpEntry, TESTER, { action: 'confirmRoster', cid, enId }));
    expect((await entry(enId)).rosterConfirmed).toBe(true);
    // 代表自己也是球員：cpMine 角色兩個
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('roles')).toEqual(['rep', 'player']);
    await ok(call(handleCpEntry, TESTER2, { action: 'leaveRoster', cid, plId }));
    expect((await entry(enId)).rosterConfirmed).toBe(false);
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).exists).toBe(false);
  });
  it('鎖定：只有主辦；鎖定後報隊、登錄、退出、確認、編輯組別都被拒', async () => {
    await fails(call(handleCpEntry, TESTER, { action: 'lockRosters', cid }), 'NOT_HOST');
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    await fails(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }), 'ROSTERS_LOCKED');
    await fails(register(TESTER, youthDv), 'ROSTERS_LOCKED');
    await fails(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 1, privacyAck: true }), 'ROSTERS_LOCKED');
    await fails(call(handleCpEntry, TESTER2, { action: 'leaveRoster', cid, plId }), 'ROSTERS_LOCKED');
    await fails(call(handleCpEntry, TESTER, { action: 'confirmRoster', cid, enId }), 'ROSTERS_LOCKED');
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid, divisions: [
      { name: '成人組', playersOnField: 5, maxTeams: 2, rosterMin: 2, rosterMax: 5 }
    ] }), 'ROSTERS_LOCKED');
  });
  it('首場後不能再異動名單', async () => {
    await fails(call(handleCpEntry, TESTER2, { action: 'leaveRoster', cid, plId }, makeDeps(25 * DAY)), 'COMPETITION_STARTED');
  });
  it('撤隊：只有代表；連同名單與球員 cpMine 一起移除，球員可改報他隊', async () => {
    await fails(call(handleCpEntry, TESTER2, { action: 'withdrawEntry', cid, enId }), 'NOT_CLUB_REP');
    await ok(call(handleCpEntry, TESTER, { action: 'withdrawEntry', cid, enId }));
    expect(await entry(enId)).toMatchObject({ status: 'withdrawn', rosterCount: 0 });
    expect((await adminDb().collection(`competitions/${cid}/roster`).get()).size).toBe(0);
    expect((await adminDb().collection(`competitions/${cid}/rosterPrivate`).get()).size).toBe(0);
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).get()).get('entryCount')).toBe(0);
    await fails(call(handleCpEntry, TESTER, { action: 'withdrawEntry', cid, enId }), 'ENTRY_STATE');
    // 撤隊後可重新報同組
    const again = await ok<{ enId: string }>(register());
    await ok(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId: again.enId, number: 9, privacyAck: true }));
  });
});
