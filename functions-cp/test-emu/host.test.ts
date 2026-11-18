/**
 * cpHost（模擬器）：內部期閘門、強制 internal、建賽限制、冒名、編輯、發布、狀態、刪除。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { HOST_QUOTA, handleCpHost } from '../src/cp/host.js';
import {
  ADMIN, DAY, STRANGER, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll
} from './_cp.js';

type Created = { cid: string; dvIds: string[] };
const create = (who = TESTER, over: Record<string, unknown> = {}) =>
  ok<Created>(call(handleCpHost, who, createInput(over)));

describe('內部期閘門（§12.2 a、b）', () => {
  beforeEach(() => resetAll());

  it('一般會員任何動作都被擋', async () => {
    await fails(call(handleCpHost, STRANGER, createInput()), 'INTERNAL_PERIOD', 'permission-denied');
    await fails(call(handleCpEntry, STRANGER, { action: 'registerEntry', cid: 'cp_' + 'a'.repeat(20) }), 'INTERNAL_PERIOD');
  });
  it('cpConfig/launch 不存在時 fail-closed', async () => {
    await adminDb().doc('cpConfig/launch').delete();
    await fails(call(handleCpHost, STRANGER, createInput()), 'INTERNAL_PERIOD');
  });
  it('isPublic 不是 true（字串 "true"）仍視為內部期', async () => {
    await adminDb().doc('cpConfig/launch').set({ isPublic: 'true' });
    await fails(call(handleCpHost, STRANGER, createInput()), 'INTERNAL_PERIOD');
  });
  it('測試者與管理員可建賽，內部期一律 internal（用戶端不能指定）', async () => {
    const a = await create(TESTER);
    const b = await create(ADMIN);
    for (const { cid } of [a, b]) {
      const d = (await adminDb().doc(`competitions/${cid}`).get()).data()!;
      expect(d.visibility).toBe('internal');
      expect(d.status).toBe('draft');
      expect(d.endedAt).toBeNull();
    }
    await fails(call(handleCpHost, TESTER, createInput({ visibility: 'public' })), 'UNKNOWN_FIELD');
  });
  it('對外後新賽事為 public；內部賽事仍只限管理員與測試者', async () => {
    const internal = await create(TESTER);
    await adminDb().doc('cpConfig/launch').set({ isPublic: true });
    const pub = await create(STRANGER);
    expect((await adminDb().doc(`competitions/${pub.cid}`).get()).get('visibility')).toBe('public');
    // 把 stranger 設成內部賽事的主辦也一樣被擋（防繞過）
    await adminDb().doc(`competitions/${internal.cid}`).update({ hostUid: 'stranger' });
    await fails(call(handleCpHost, STRANGER, { action: 'publish', cid: internal.cid }), 'INTERNAL_COMPETITION');
  });
});

describe('建賽與冒名（§5.4、§5.5）', () => {
  beforeEach(() => resetAll());

  it('個人主辦顯示名預設帶主站顯示名；禁用字擋名稱與顯示名', async () => {
    const { cid } = await create(TESTER);
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('hostDisplay')).toBe('代表乙');
    await fails(call(handleCpHost, TESTER, createInput({ name: '台北市足球協會盃' })), 'BANNED_WORD');
    await fails(call(handleCpHost, TESTER, createInput({ hostDisplay: 'Official 主辦' })), 'BANNED_WORD');
  });
  it('集團主辦本期拒絕', async () => {
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'group' })), 'HOST_TYPE_NOT_SUPPORTED');
  });
  it('個人主辦不可帶繳費說明；俱樂部可', async () => {
    await fails(call(handleCpHost, TESTER, createInput({ feeNote: '每隊 500' })), 'FEE_NOTE_NOT_ALLOWED');
    const { cid } = await create(TESTER, { hostType: 'club', hostTeamId: 'club_a', feeNote: '每隊 500' });
    const d = (await adminDb().doc(`competitions/${cid}`).get()).data()!;
    expect(d.feeNote).toBe('每隊 500');
    expect(d.hostDisplay).toBe('甲隊足球俱樂部');
    expect(d.hostTeamId).toBe('club_a');
  });
  it('俱樂部主辦：非代表被拒、不能自訂顯示名、鏡像缺名稱時提示同步中', async () => {
    await fails(call(handleCpHost, TESTER2, createInput({ hostType: 'club', hostTeamId: 'club_a' })), 'NOT_CLUB_REP');
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a', hostDisplay: '假名' })), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_noname' })), 'CLUB_SYNC_PENDING');
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_none' })), 'NOT_CLUB_REP');
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: '../x' })), 'BAD_ID');
  });
  it(`個人主辦同時進行中 ≤ ${HOST_QUOTA.personalActiveMax}；刪除或取消後釋出名額`, async () => {
    const a = await create(TESTER);
    const b = await create(TESTER);
    await fails(call(handleCpHost, TESTER, createInput()), 'HOST_QUOTA_ACTIVE', 'resource-exhausted');
    // 草稿不能取消（只能刪除）；刪一場後可再建
    await ok(call(handleCpHost, TESTER, { action: 'delete', cid: a.cid }));
    await create(TESTER);
    // 30 天新建已用 3 次（30 天上限先判斷）
    await fails(call(handleCpHost, TESTER, createInput()), 'HOST_QUOTA_30D');
    // 30 天新建已用 3 次：取消釋出「進行中」名額，但第 4 次新建仍被 30 天上限擋下
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: b.cid }));
    await ok(call(handleCpHost, TESTER, { action: 'setStatus', cid: b.cid, status: 'cancelled', reason: '人數不足取消' }));
    await fails(call(handleCpHost, TESTER, createInput()), 'HOST_QUOTA_30D');
    // 31 天後 30 天上限解除：進行中只剩 1 場草稿（取消的不計）→ 可建
    await ok(call(handleCpHost, TESTER, createInput({
      regOpenAt: Date.now() + 30 * DAY, regCloseAt: Date.now() + 40 * DAY,
      firstMatchAt: Date.now() + 50 * DAY, lastMatchAt: Date.now() + 51 * DAY
    }), makeDeps(31 * DAY)));
  });
  it(`個人主辦 30 天新建 ≤ ${HOST_QUOTA.personalCreates30dMax}（刪除不退名額）`, async () => {
    for (let i = 0; i < 3; i++) {
      const c = await create(TESTER);
      await ok(call(handleCpHost, TESTER, { action: 'delete', cid: c.cid }));
    }
    await fails(call(handleCpHost, TESTER, createInput()), 'HOST_QUOTA_30D', 'resource-exhausted');
    // 31 天後恢復
    await ok(call(handleCpHost, TESTER, createInput({
      regOpenAt: Date.now() + 30 * DAY, regCloseAt: Date.now() + 40 * DAY,
      firstMatchAt: Date.now() + 50 * DAY, lastMatchAt: Date.now() + 51 * DAY
    }), makeDeps(31 * DAY)));
  });
  it(`俱樂部同時進行中 ≤ ${HOST_QUOTA.clubActiveMax}；已結束不計`, async () => {
    const db = adminDb();
    const b = db.batch();
    for (let i = 0; i < HOST_QUOTA.clubActiveMax; i++) {
      b.set(db.doc(`competitions/cp_q${String(i).padStart(19, '0')}`), {
        hostType: 'club', hostTeamId: 'club_a', hostUid: 'x', status: i % 2 ? 'published' : 'draft', endedAt: null
      });
    }
    await b.commit();
    await fails(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a' })), 'CLUB_QUOTA_ACTIVE');
    await db.doc(`competitions/cp_q${'0'.repeat(19)}`).update({ endedAt: new Date() });
    await create(TESTER, { hostType: 'club', hostTeamId: 'club_a' });
  });
  it('管理員不受建賽限制', async () => {
    for (let i = 0; i < 4; i++) await create(ADMIN);
  });
});

describe('編輯、發布、狀態', () => {
  let cid = '';
  let dvId = '';
  beforeEach(async () => {
    await resetAll();
    const c = await create(TESTER);
    cid = c.cid; dvId = c.dvIds[0];
  });

  it('只有主辦／共同主辦可編輯；共同主辦來自 staff.roles', async () => {
    await fails(call(handleCpHost, TESTER2, { action: 'update', cid, name: '新名稱盃' }), 'NOT_HOST');
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await ok(call(handleCpHost, TESTER2, { action: 'update', cid, name: '新名稱盃' }));
    const d = (await adminDb().doc(`competitions/${cid}`).get()).data()!;
    expect(d.name).toBe('新名稱盃');
    expect(d.stateVersion).toBe(2);
  });
  it('時間要四個一起改；多帶鍵與禁用字被拒；沒有變更被拒', async () => {
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, regCloseAt: Date.now() + 5 * DAY }), 'SCHEDULE_ALL_REQUIRED');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, hostUid: 'tester2' }), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, name: '官方盃' }), 'BANNED_WORD');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid }), 'NOTHING_TO_UPDATE');
  });
  it('組別：新增、更新、刪除；有報隊時不能刪、不能改年齡規則、上限不能低於已核准', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, divisions: [
      { dvId, name: '成人組', playersOnField: 5, maxTeams: 6, rosterMin: 1, rosterMax: 5 },
      { name: '青少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, minAge: 12, maxAge: 15 }
    ] }));
    const divs = await adminDb().collection(`competitions/${cid}/divisions`).orderBy('order').get();
    expect(divs.docs.map(d => d.get('name'))).toEqual(['成人組', '青少年組']);
    expect(divs.docs[1].get('requireRealName')).toBe(true);
    await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).update({ entryCount: 1, approvedCount: 1 });
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, divisions: [
      { dvId: divs.docs[1].id, name: '青少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5, minAge: 12, maxAge: 15 }
    ] }), 'DIVISION_HAS_ENTRIES');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, divisions: [
      { dvId, name: '成人組', playersOnField: 5, maxTeams: 6, rosterMin: 1, rosterMax: 5, minAge: 18 }
    ] }), 'DIVISION_RULES_LOCKED');
    await adminDb().doc(`competitions/${cid}/divisions/${dvId}`).update({ approvedCount: 3 });
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, divisions: [
      { dvId, name: '成人組', playersOnField: 5, maxTeams: 2, rosterMin: 1, rosterMax: 5 }
    ] }), 'DIVISION_BELOW_APPROVED');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, divisions: [
      { dvId: 'dv_' + 'z'.repeat(20), name: '成人組', playersOnField: 5, maxTeams: 6, rosterMin: 1, rosterMax: 5 }
    ] }), 'BAD_ID');
  });
  it('發布：草稿才能發布；報名已截止不能發布', async () => {
    await fails(call(handleCpHost, TESTER, { action: 'publish', cid }, makeDeps(11 * DAY)), 'REG_CLOSED');
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('status')).toBe('published');
    await fails(call(handleCpHost, TESTER, { action: 'publish', cid }), 'NOT_DRAFT');
  });
  it('延期與取消必填原因；延期可恢復；取消後不能恢復或編輯', async () => {
    await fails(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'postponed', reason: '下雨延期' }), 'STATUS_TRANSITION');
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    await fails(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'postponed' }), 'FIELD_REQUIRED');
    await ok(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'postponed', reason: '颱風延期' }));
    await ok(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'published' }));
    await ok(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'cancelled', reason: '場地無法使用' }));
    const d = (await adminDb().doc(`competitions/${cid}`).get()).data()!;
    expect(d.status).toBe('cancelled');
    expect(d.statusReason).toBe('場地無法使用');
    await fails(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'published' }), 'STATUS_TRANSITION');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, name: '再改盃' }), 'COMPETITION_CLOSED');
  });
  it('每個寫入動作都留稽核，稽核不含 uid 原文', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    const audits = await adminDb().collection(`competitions/${cid}/audits`).get();
    expect(audits.docs.map(d => d.get('action')).sort()).toEqual(['create', 'publish']);
    for (const d of audits.docs) expect(JSON.stringify(d.data())).not.toContain('tester');
  });
});

describe('刪除（§6.1 必修 7）', () => {
  beforeEach(() => resetAll());

  it('首場前主辦（含俱樂部其他代表）可刪，連同子集合與 cpMine，頂層留稽核', async () => {
    const { cid, dvIds } = await create(TESTER, { hostType: 'club', hostTeamId: 'club_a' });
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a' }));
    await ok(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 9, privacyAck: true }));
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).exists).toBe(true);
    // 非代表的俱樂部成員不能刪；俱樂部其他代表（非 hostUid）屬主辦（§5.1），可刪
    await fails(call(handleCpHost, TESTER2, { action: 'delete', cid }), 'NOT_PRIMARY_HOST');
    await adminDb().doc('cpClubs/club_a').update({ repUids: ['tester', 'tester3'] });
    await ok(call(handleCpHost, TESTER3, { action: 'delete', cid }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).exists).toBe(false);
    expect((await adminDb().collection(`competitions/${cid}/rosterPrivate`).get()).size).toBe(0);
    expect((await adminDb().collection(`competitions/${cid}/divisions`).get()).size).toBe(0);
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).exists).toBe(false);
    const audit = await adminDb().doc(`cpAudits/del_${cid}`).get();
    expect(audit.get('action')).toBe('deleteCompetition');
    expect(JSON.stringify(audit.data())).not.toContain('tester');
  });
  it('共同主辦不能刪；首場後主辦只能取消、管理員可刪', async () => {
    const { cid } = await create(TESTER);
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await fails(call(handleCpHost, TESTER2, { action: 'delete', cid }), 'NOT_PRIMARY_HOST');
    await fails(call(handleCpHost, TESTER, { action: 'delete', cid }, makeDeps(25 * DAY)), 'DELETE_AFTER_START');
    await ok(call(handleCpHost, ADMIN, { action: 'delete', cid }, makeDeps(25 * DAY)));
  });
  it('不存在的賽事回 not-found；id 形狀錯回 BAD_ID', async () => {
    await fails(call(handleCpHost, TESTER, { action: 'delete', cid: 'cp_' + 'n'.repeat(20) }), 'COMPETITION_NOT_FOUND', 'not-found');
    await fails(call(handleCpHost, TESTER, { action: 'delete', cid: 'cp_../x' }), 'BAD_ID');
  });
});

describe('刪除的封鎖與重跑、下架後的狀態變更', () => {
  beforeEach(() => resetAll());

  it('刪除中途失敗：根文件已下架並標 deletingAt，並行報隊被擋；重跑保留第一次稽核', async () => {
    const { cid, dvIds } = await create(TESTER, { hostType: 'club', hostTeamId: 'club_a' });
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    // 模擬「第 1 步已完成、後續失敗」：只做交易那一段（下架＋稽核）
    await adminDb().doc(`competitions/${cid}`).update({ hidden: true, deletingAt: new Date() });
    await adminDb().doc(`cpAudits/del_${cid}`).set({ action: 'deleteCompetition', cid, retries: 0, actor: 'first' });
    await fails(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a' }), 'COMPETITION_HIDDEN');
    await ok(call(handleCpHost, TESTER, { action: 'delete', cid }));
    const audit = (await adminDb().doc(`cpAudits/del_${cid}`).get()).data()!;
    expect(audit.actor).toBe('first');
    expect(audit.retries).toBe(1);
    expect((await adminDb().doc(`competitions/${cid}`).get()).exists).toBe(false);
  });
  it('下架期間主辦不能改狀態，管理員可以', async () => {
    const { cid } = await create(TESTER);
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    await adminDb().doc(`competitions/${cid}`).update({ hidden: true });
    await fails(call(handleCpHost, TESTER, { action: 'setStatus', cid, status: 'cancelled', reason: '主辦自行取消' }), 'COMPETITION_HIDDEN');
    await ok(call(handleCpHost, ADMIN, { action: 'setStatus', cid, status: 'cancelled', reason: '管理員處理' }));
  });
});
