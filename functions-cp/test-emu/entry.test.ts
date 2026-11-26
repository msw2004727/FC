/**
 * cpEntry（模擬器）：報隊、審核、撤隊、成員登錄、代表代填（無帳號）、退出、確認、鎖定；cpMine；生日不入庫。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import {
  ADMIN, DAY, MAIN, STRANGER, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll, scanAll, setBannedWords
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
  it('審核：只有主辦方（管理員可代）；拒絕必填原因；核准不超過上限；拒絕已核准會扣回', async () => {
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
    expect(Object.keys(pub).sort()).toEqual(['createdAt', 'displayName', 'dvId', 'enId', 'isMinor', 'number', 'position', 'positionText']);
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
    await setBannedWords();
    await fails(join(TESTER2, { nickname: '官方代表' }), 'BANNED_WORD');
    await fails(join(TESTER2, { publicName: '球' }), 'UNKNOWN_FIELD');
  });
  it('非成員、未勾告知、生日缺漏、重複登錄、背號重複、名單已滿都被拒', async () => {
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    await fails(join(TESTER2, { privacyAck: false }), 'PRIVACY_ACK_REQUIRED');
    await adminDb(MAIN).doc('users/tester3').set({ displayName: '路人丁', teamIds: ['club_a'] });
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
  it('其他俱樂部的成員或代表身分不能拿來登錄：只看本隊 teamId', async () => {
    await adminDb().doc('cpClubs/club_b').set({ repUids: ['tester3'], name: '乙隊' });
    await adminDb(MAIN).doc('users/tester3').set({ displayName: '路人丁', birthday: '1991/01/01', teamIds: ['club_b'], teamId: 'club_b' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER');
  });
  // 顧問 §3.839 方案 C：成員＝主站 users 有效隊伍清單（規則 E：teamIds 非空只認 teamIds，否則 [teamId]，不取聯集）含本隊，或本隊代表
  const setMain = (uid: string, data: Record<string, unknown>) =>
    adminDb(MAIN).doc(`users/${uid}`).set({ displayName: '路人丁', birthday: '1991/01/01', ...data });
  it('規則 E-1：只有 teamIds 命中（沒有 teamId）就能登錄', async () => {
    await setMain('tester3', { teamIds: ['club_x', 'club_a'] });
    await ok(join(TESTER3));
  });
  it('規則 E-2：沒有 teamIds、只有舊 teamId 命中也能登錄', async () => {
    await setMain('tester3', { teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('規則 E-2b：teamIds 是空陣列時退回舊 teamId', async () => {
    await setMain('tester3', { teamIds: [], teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('規則 E-3：teamIds 非空但只有 teamId 命中要擋（不取聯集）', async () => {
    await setMain('tester3', { teamIds: ['club_x'], teamId: 'club_a' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
  });
  it('規則 E-4：非成員（兩欄都沒有本隊）被擋', async () => {
    await setMain('tester3', { teamIds: ['club_x'], teamId: 'club_x' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
  });
  it('規則 E-5：代表不在 teamIds 仍可登錄', async () => {
    await setMain('tester', { displayName: '代表乙', birthday: '1990/05/05', teamIds: ['club_x'], teamId: 'club_x' });
    await ok(join(TESTER));
  });
  it('規則 E-6：主站 users 文件不存在被擋，錯誤碼不變', async () => {
    await adminDb(MAIN).doc('users/tester3').delete();
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
  });
  it('規則 E-7：teamIds 形狀錯被擋（字串、非字串元素、物件都不算）', async () => {
    for (const data of [
      { teamIds: 'club_a' },
      { teamIds: [123, { id: 'club_a' }], teamId: 'club_a' },
      { teamIds: { 0: 'club_a' } },
      { teamId: ['club_a'] },
      { teamId: 42 }
    ]) {
      await setMain('tester3', data);
      await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    }
  });
  // 顧問 §3.846 隊伍雙鍵：報隊存 teams 文件 id（club_a），舊俱樂部成員的 users.teamIds 可能只有文件內 id 欄位（自訂 id）
  const setTeam = (docId: string, data: Record<string, unknown>) => adminDb(MAIN).doc(`teams/${docId}`).set({ name: '測試隊', ...data });
  it('雙鍵 B-1：文件 id 等於自訂 id，成員有文件 id 就能登錄', async () => {
    await setTeam('club_a', { id: 'club_a' });
    await setMain('tester3', { teamIds: ['club_a'], teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('雙鍵 B-2（主案）：兩者不相等、成員資料只有自訂 id 也能登錄', async () => {
    await setTeam('club_a', { id: 'legacy_a' });
    await setMain('tester3', { teamIds: ['legacy_a'], teamId: 'legacy_a' });
    await ok(join(TESTER3));
  });
  it('雙鍵 B-3：兩者不相等、成員資料只有文件 id 也能登錄', async () => {
    await setTeam('club_a', { id: 'legacy_a' });
    await setMain('tester3', { teamIds: ['club_a'], teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('雙鍵 B-4：teams 文件不存在只認文件 id（自訂 id 擋、文件 id 過）', async () => {
    await setMain('tester3', { teamIds: ['legacy_a'], teamId: 'legacy_a' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    await setMain('tester3', { teamIds: ['club_a'], teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('雙鍵 B-5：id 欄位形狀錯只認文件 id', async () => {
    await setMain('tester3', { teamIds: ['legacy_a'], teamId: 'legacy_a' });
    for (const id of [42, ['legacy_a'], { v: 'legacy_a' }, 'legacy a', '', 'x'.repeat(65), null]) {
      await setTeam('club_a', { id });
      await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    }
    await adminDb(MAIN).doc('teams/club_a').set({ name: '測試隊' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
    await setMain('tester3', { teamIds: ['club_a'], teamId: 'club_a' });
    await ok(join(TESTER3));
  });
  it('雙鍵 B-6：別隊的自訂 id 不能拿來進本隊', async () => {
    await setTeam('club_a', { id: 'legacy_a' });
    await setTeam('club_b', { id: 'legacy_b' });
    await setMain('tester3', { teamIds: ['legacy_b', 'club_b'], teamId: 'legacy_b' });
    await fails(join(TESTER3), 'NOT_CLUB_MEMBER', 'permission-denied');
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
  it('未成年：必填真名、必勾監護人同意、公開名一律遮字（站長 11-18）', async () => {
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(14, fm) });
    await fails(join(), 'REAL_NAME_REQUIRED');
    await fails(join({ realName: '歐陽小明' }), 'GUARDIAN_CONSENT_REQUIRED');
    await fails(join({ realName: '歐陽小明', guardianConsent: true, publicName: '歐陽小明' }), 'UNKNOWN_FIELD');
    await fails(join({ realName: '歐陽小明', guardianConsent: true, nickname: '小飛' }), 'UNKNOWN_FIELD');
    const r = await ok<{ plId: string; isMinor: boolean }>(join({ realName: '歐陽小明', guardianConsent: true }));
    expect(r.isMinor).toBe(true);
    const pub = (await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).data()!;
    expect(pub.displayName).toBe('歐陽O明');
    expect(pub.isMinor).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('小明');
    expect(JSON.stringify(pub)).not.toContain('歐陽小');
    const priv = (await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).data()!;
    expect(priv).toMatchObject({ realName: '歐陽小明', isMinor: true, guardianConsent: true, ageEligible: true });
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

  it('代表可代填：uid 為 null、記 addedByUid、公開遮字、生日不入庫', async () => {
    const r = await ok<{ plId: string; isMinor: boolean }>(add());
    expect(r.isMinor).toBe(true);
    const priv = (await adminDb().doc(`competitions/${cid}/rosterPrivate/${r.plId}`).get()).data()!;
    expect(priv).toMatchObject({ uid: null, addedByUid: 'tester', source: 'rep', realName: '陳小安', guardianConsent: true });
    expect((await adminDb().doc(`competitions/${cid}/roster/${r.plId}`).get()).get('displayName')).toBe('陳O安');
    const bd = birthdayForAge(12, fm);
    const hits = await scanAll([`competitions/${cid}/roster`, `competitions/${cid}/rosterPrivate`, `competitions/${cid}/audits`, `competitions/${cid}/entries`],
      (k, v) => /birth/i.test(k) || v === bd || v === bd.replace(/\//g, '-'));
    expect(hits).toEqual([]);
    // 無帳號球員不建 cpMine
    // （admin＝個人主辦的 host 索引、tester＝報隊者）
    expect((await adminDb().collection('cpMine').listDocuments()).map(d => d.id).sort()).toEqual(['admin', 'tester']);
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
  it('同隊同真名不能重複代填（換背號也一樣）', async () => {
    await ok(add());
    await fails(add(TESTER, { number: 4 }), 'PLAYER_DUPLICATE', 'already-exists');
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

describe('Opus 終審退修：拒絕清名單、隊名冒名、並行登錄', () => {
  beforeEach(async () => { await resetAll(); await setupComp(); });

  it('拒絕時清掉該隊名單與球員 cpMine，報隊者索引保留；球員可改報他組', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 9, privacyAck: true }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'reject', reason: '資料不完整' }));
    expect((await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('entryIds')).toEqual([enId]);
    expect(await entry(enId)).toMatchObject({ status: 'rejected', rosterCount: 0 });
    const other = await ok<{ enId: string }>(register(TESTER, youthDv));
    const fm = await firstMatchMs();
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(13, fm) });
    await ok(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId: other.enId, number: 9, privacyAck: true, realName: '林小丙', guardianConsent: true }));
  });
  it('隊名只能是俱樂部名稱或加後綴', async () => {
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a', teamName: '乙隊足球俱樂部' }), 'TEAM_NAME_MISMATCH');
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: 'club_a', teamName: '甲隊足球俱樂部 A' }));
    expect((await entry(enId)).name).toBe('甲隊足球俱樂部 A');
  });
  it('並行：同一人同時登錄兩隊只會成功一筆', async () => {
    const a = await ok<{ enId: string }>(register());
    const fm = await firstMatchMs();
    const b = await ok<{ enId: string }>(register(TESTER, youthDv));
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(13, fm) });
    const outs = await Promise.all([a.enId, b.enId].map((enId, i) =>
      call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 20 + i, privacyAck: true, realName: '林小丙', guardianConsent: true })));
    expect(outs.filter(o => o.ok)).toHaveLength(1);
    expect((await adminDb().collection(`competitions/${cid}/rosterPrivate`).where('uid', '==', 'tester2').get()).size).toBe(1);
  });
});

describe('顧問 §3.251：代填成年預設遮字、解鎖名單、被拒撤隊上限、年齡基準日', () => {
  beforeEach(async () => { await resetAll(); await setupComp(); });

  it('F1：代填成年球員沒填暱稱時公開名遮字（王O明式），不含真名全文；填暱稱用暱稱', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const a = await ok<{ plId: string; isMinor: boolean }>(call(handleCpEntry, TESTER, {
      action: 'addRosterByRep', cid, enId, number: 3, realName: '張大成', birthday: '1990/01/01', privacyAck: true }));
    expect(a.isMinor).toBe(false);
    const b = await ok<{ plId: string }>(call(handleCpEntry, TESTER, {
      action: 'addRosterByRep', cid, enId, number: 4, realName: 'Kevin Lee', birthday: '1991/02/02', privacyAck: true, nickname: '阿凱' }));
    await fails(call(handleCpEntry, TESTER, {
      action: 'addRosterByRep', cid, enId, number: 5, realName: '李四海', birthday: '1992/03/03', privacyAck: true, publicName: '李四海' }), 'UNKNOWN_FIELD');
    expect((await adminDb().doc(`competitions/${cid}/roster/${a.plId}`).get()).get('displayName')).toBe('張O成');
    expect((await adminDb().doc(`competitions/${cid}/roster/${b.plId}`).get()).get('displayName')).toBe('阿凱');
    const hits = await scanAll([`competitions/${cid}/roster`, `competitions/${cid}/entries`],
      (_k, v) => typeof v === 'string' && (v.includes('張大成') || v.includes('Kevin Lee')));
    expect(hits).toEqual([]);
  });
  it('F3：首場前主辦可解鎖名單（必填原因、寫稽核）；首場後只有管理員', async () => {
    await fails(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid, reason: '補登球員' }), 'ROSTERS_NOT_LOCKED');
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    await fails(call(handleCpEntry, TESTER, { action: 'unlockRosters', cid, reason: '補登球員' }), 'NOT_HOST');
    await fails(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid }), 'FIELD_REQUIRED');
    await ok(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid, reason: '補登球員' }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('rostersLockedAt')).toBeNull();
    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'unlockRosters').get();
    expect(audits.size).toBe(1);
    // 解鎖後可再報隊；首場後主辦（個人主辦本人）不能解鎖、管理員可以
    await ok(register());
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['host'], matchIds: [] });
    await fails(call(handleCpEntry, TESTER3, { action: 'unlockRosters', cid, reason: '補登球員' }, makeDeps(25 * DAY)), 'COMPETITION_STARTED');
    await ok(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid, reason: '補登球員' }, makeDeps(25 * DAY)));
  });
  it('(d)：同隊同組被拒或撤隊累計 3 次不得再報', async () => {
    for (let i = 0; i < 3; i++) {
      const { enId } = await ok<{ enId: string }>(register());
      if (i === 1) await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'reject', reason: '資料不完整' }));
      else await ok(call(handleCpEntry, TESTER, { action: 'withdrawEntry', cid, enId }));
    }
    await fails(register(), 'ENTRY_RETRY_LIMIT', 'resource-exhausted');
    // 別組不受影響
    await ok(register(TESTER, youthDv));
  });
});

describe('站長 11-18：位置「無／自訂」、報隊審核屬主辦方', () => {
  beforeEach(async () => { await resetAll(); await setupComp(); });

  it('位置可為無（null）或自訂（≤ 5 字）；自訂必填文字、非自訂不得帶文字', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const a = await ok<{ plId: string }>(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 1, privacyAck: true, position: 'custom', positionText: '自由人後衛' }));
    expect((await adminDb().doc(`competitions/${cid}/roster/${a.plId}`).get()).data()).toMatchObject({ position: 'custom', positionText: '自由人後衛' });
    await fails(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 2, privacyAck: true, position: 'custom', positionText: '自由人邊後衛' }), 'FIELD_LENGTH');
    await fails(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 2, privacyAck: true, position: 'custom' }), 'FIELD_REQUIRED');
    await fails(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 2, privacyAck: true, position: 'GK', positionText: '守門' }), 'UNKNOWN_FIELD');
    const b = await ok<{ plId: string }>(call(handleCpEntry, TESTER, { action: 'joinRoster', cid, enId, number: 2, privacyAck: true }));
    expect((await adminDb().doc(`competitions/${cid}/roster/${b.plId}`).get()).data()).toMatchObject({ position: null, positionText: null });
  });
  it('俱樂部賽事審核屬主辦方（站長選乙）：建賽者被撤換代表後不能審；目前代表、共同主辦可以', async () => {
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a' })));
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: c.cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await adminDb().doc('cpClubs/club_a').update({ repUids: ['tester3'] });
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await fails(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid: c.cid, enId, decision: 'approve' }), 'NOT_HOST');
    await ok(call(handleCpEntry, TESTER3, { action: 'reviewEntry', cid: c.cid, enId, decision: 'reject', reason: '名額已滿' }));
    const { enId: en2 } = await ok<{ enId: string }>(call(handleCpEntry, TESTER3, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await ok(call(handleCpEntry, TESTER2, { action: 'reviewEntry', cid: c.cid, enId: en2, decision: 'approve' }));
  });
});

describe('setPaymentStatus（支付接點，只限俱樂部主辦，顧問 §3.257）', () => {
  beforeEach(async () => {
    await resetAll();
    // 主辦俱樂部 club_h（代表 tester3）；報隊的是 club_a（代表 tester）
    await adminDb().doc('cpClubs/club_h').set({ repUids: ['tester3'], name: '主辦俱樂部' });
  });
  it('俱樂部主辦可標示已繳費／未繳費；報隊代表、待定與退款值不能手動設', async () => {
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER3, createInput({ hostType: 'club', hostTeamId: 'club_h',
      divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, feePerTeam: 1500 }] })));
    await ok(call(handleCpHost, TESTER3, { action: 'publish', cid: c.cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await fails(call(handleCpEntry, TESTER, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }), 'NOT_HOST');
    await fails(call(handleCpEntry, TESTER3, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'refunded' }), 'FIELD_ENUM');
    await ok(call(handleCpEntry, TESTER3, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }));
    expect((await adminDb().doc(`competitions/${c.cid}/entryPrivate/${enId}`).get()).get('paymentStatus')).toBe('paid');
    await ok(call(handleCpEntry, ADMIN, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'none' }));
    expect((await adminDb().doc(`competitions/${c.cid}/entryPrivate/${enId}`).get()).get('paymentStatus')).toBe('none');
    // ENTRY_STATE：撤隊後不能標繳費
    await ok(call(handleCpEntry, TESTER, { action: 'withdrawEntry', cid: c.cid, enId }));
    await fails(call(handleCpEntry, TESTER3, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }), 'ENTRY_STATE');
  });
  it('個人主辦賽事一律拒絕標繳費（含管理員）；個人主辦的組別報名費只能是 0', async () => {
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER2, createInput()));
    await ok(call(handleCpHost, TESTER2, { action: 'publish', cid: c.cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await fails(call(handleCpEntry, TESTER2, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }), 'PAYMENT_NOT_ALLOWED', 'failed-precondition');
    await fails(call(handleCpEntry, ADMIN, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }), 'PAYMENT_NOT_ALLOWED');
    // 建立帶正數報名費被拒；0 可以
    await fails(call(handleCpHost, ADMIN, createInput({ divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, feePerTeam: 500 }] })), 'FEE_NOT_ALLOWED', 'invalid-argument');
    await ok(call(handleCpHost, ADMIN, createInput({ divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, feePerTeam: 0 }] })));
    // 編輯改成正數也被拒
    const d = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, ADMIN, createInput()));
    await fails(call(handleCpHost, ADMIN, { action: 'update', cid: d.cid, divisions: [
      { dvId: d.dvIds[0], name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, feePerTeam: 300 }
    ] }), 'FEE_NOT_ALLOWED');
  });
});

describe('顧問 §3.254 B3：主辦方成功路徑與拒絕案例', () => {
  let pcid = '';
  let pen = '';
  beforeEach(async () => {
    await resetAll();
    // 個人主辦（非管理員，staff host）＝ tester；報隊者也是 tester（club_a 代表）
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({
      divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }] })));
    pcid = c.cid;
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: pcid }));
    pen = (await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: pcid, dvId: c.dvIds[0], teamId: 'club_a' }))).enId;
  });

  it('非管理員的 staff host：審核、鎖定名單成功；個人主辦不能標繳費（§3.257）', async () => {
    await ok(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid: pcid, enId: pen, decision: 'approve' }));
    await fails(call(handleCpEntry, TESTER, { action: 'setPaymentStatus', cid: pcid, enId: pen, paymentStatus: 'paid' }), 'PAYMENT_NOT_ALLOWED');
    await ok(call(handleCpEntry, TESTER, { action: 'lockRosters', cid: pcid }));
  });
  it('共同主辦（非管理員）：審核、鎖定名單成功；俱樂部主辦賽事的共同主辦可標繳費', async () => {
    await adminDb().doc(`competitions/${pcid}/staff/tester3`).set({ roles: ['coHost'], matchIds: [] });
    await ok(call(handleCpEntry, TESTER3, { action: 'reviewEntry', cid: pcid, enId: pen, decision: 'approve' }));
    await ok(call(handleCpEntry, TESTER3, { action: 'lockRosters', cid: pcid }));
    await adminDb().doc('cpClubs/club_h').set({ repUids: ['tester2'], name: '主辦俱樂部' });
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER2, createInput({ hostType: 'club', hostTeamId: 'club_h' })));
    await ok(call(handleCpHost, TESTER2, { action: 'publish', cid: c.cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await adminDb().doc(`competitions/${c.cid}/staff/tester3`).set({ roles: ['coHost'], matchIds: [] });
    await ok(call(handleCpEntry, TESTER3, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }));
  });
  it('ENTRY_STATE：已拒絕的不能再核准（撤隊後標繳費見 setPaymentStatus 俱樂部案例）', async () => {
    await ok(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid: pcid, enId: pen, decision: 'reject', reason: '資料不完整' }));
    await fails(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid: pcid, enId: pen, decision: 'approve' }), 'ENTRY_STATE');
  });
  it('COMPETITION_HIDDEN：下架中主辦不能標繳費', async () => {
    await adminDb().doc(`competitions/${pcid}`).update({ hidden: true });
    await fails(call(handleCpEntry, TESTER, { action: 'setPaymentStatus', cid: pcid, enId: pen, paymentStatus: 'paid' }), 'COMPETITION_HIDDEN');
  });
  it('俱樂部前代表：審核、鎖定、標繳費都 NOT_HOST', async () => {
    const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a' })));
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: c.cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid: c.cid, dvId: c.dvIds[0], teamId: 'club_a' }));
    await adminDb().doc('cpClubs/club_a').update({ repUids: ['tester3'] });
    await fails(call(handleCpEntry, TESTER, { action: 'reviewEntry', cid: c.cid, enId, decision: 'approve' }), 'NOT_HOST');
    await fails(call(handleCpEntry, TESTER, { action: 'lockRosters', cid: c.cid }), 'NOT_HOST');
    await fails(call(handleCpEntry, TESTER, { action: 'setPaymentStatus', cid: c.cid, enId, paymentStatus: 'paid' }), 'NOT_HOST');
  });
});
