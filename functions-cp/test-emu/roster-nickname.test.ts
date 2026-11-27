/**
 * cpEntry 名單暱稱（模擬器）：joinRoster 的 originalName/nickname/nameSource、updateRosterNickname、
 * syncRosterName、個資移除 deidentify 清原料欄位。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import {
  ADMIN, DAY, MAIN, STRANGER, TESTER, TESTER2, call, createInput, fails, makeDeps, ok, resetAll, setBannedWords
} from './_cp.js';
import type { Handler } from '../src/cp/callable.js';
import { ANON_PLAYER } from '../src/cp/removal-plan.js';
import { requestMyDataRemoval } from '../src/cp/removal-actions.js';

let cid = '';
let dvId = '';
let youthDv = '';

async function setupComp(over: Record<string, unknown> = {}) {
  const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, ADMIN, createInput({
    divisions: [
      { name: '成人組', playersOnField: 5, maxTeams: 2, rosterMin: 1, rosterMax: 5 },
      { name: 'U16', playersOnField: 5, maxTeams: 2, rosterMin: 1, rosterMax: 5, minAge: 10, maxAge: 15 }
    ],
    ...over
  })));
  cid = c.cid; dvId = c.dvIds[0]; youthDv = c.dvIds[1];
  await ok(call(handleCpHost, ADMIN, { action: 'publish', cid }));
}

const register = (who = TESTER, dv = dvId) =>
  call(handleCpEntry, who, { action: 'registerEntry', cid, dvId: dv, teamId: 'club_a' });

const join = (who: { uid: string; role?: string }, enId: string, over: Record<string, unknown> = {}) =>
  call(handleCpEntry, who, { action: 'joinRoster', cid, enId, number: 10, privacyAck: true, ...over });

async function setLineName(name: string) {
  await adminDb(MAIN).doc('users/tester2').set({ lineDisplayName: name }, { merge: true });
}
async function getRoster(plId: string) {
  return (await adminDb().doc(`competitions/${cid}/roster/${plId}`).get()).data()!;
}
async function getRosterPriv(plId: string) {
  return (await adminDb().doc(`competitions/${cid}/rosterPrivate/${plId}`).get()).data()!;
}
function birthdayForAge(n: number, firstMatchMs: number) {
  const d = new Date(firstMatchMs + 8 * 3600_000);
  return `${d.getUTCFullYear() - n}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

describe('名單暱稱（joinRoster 原料、updateRosterNickname、syncRosterName、移除）', () => {
  beforeEach(async () => { await resetAll({ isPublic: true }); await setupComp(); });

  it('1. 有 lineDisplayName、沒填暱稱 → displayName=originalName、nameSource=line', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    expect(await getRoster(plId)).toMatchObject({
      displayName: '阿傑LINE', originalName: '阿傑LINE', nickname: null, nameSource: 'line'
    });
  });

  it('2. 填暱稱 → displayName=暱稱(原始)、nickname 保留', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId, { nickname: '阿範' }));
    const pub = await getRoster(plId);
    expect(pub.displayName).toBe('阿範');
    expect(pub.nickname).toBe('阿範');
  });

  it('3. 暱稱等於 LINE 名 → nickname 存 null', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId, { nickname: '阿傑LINE' }));
    const pub = await getRoster(plId);
    expect(pub.nickname).toBeNull();
    expect(pub.displayName).toBe('阿傑LINE');
  });

  it('4. 暱稱形狀與長度：括號、換行 FIELD_FORMAT；21 字 FIELD_LENGTH；禁詞 BANNED_WORD', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    for (const nickname of ['a(b', 'a)b', 'a（b', 'a）b', 'a\nb', 'a\rb']) {
      await fails(join(TESTER2, enId, { nickname }), 'FIELD_FORMAT');
    }
    await fails(join(TESTER2, enId, { nickname: 'a'.repeat(21) }), 'FIELD_LENGTH');
    await setBannedWords();
    await fails(join(TESTER2, enId, { nickname: '官方' }), 'BANNED_WORD');
  });

  it('5. 暱稱含雙向控制與零寬 → 清掉後存入', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId, { nickname: '阿\u202E\u200B範' }));
    expect((await getRoster(plId)).nickname).toBe('阿範');
  });

  it('6. lineDisplayName 含雙向控制與超 20 字 → originalName 清理且截 20 碼位', async () => {
    await setLineName('阿\u202E' + '字'.repeat(25));
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    const pub = await getRoster(plId);
    expect(pub.originalName).toBe('阿' + '字'.repeat(19));
    expect(pub.nameSource).toBe('line');
  });

  it('7a. 沒有 lineDisplayName → nameSource=profile、originalName=displayName', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    expect(await getRoster(plId)).toMatchObject({ originalName: '球員丙', nameSource: 'profile' });
  });

  it('7b. line 與 displayName 都沒有 → 照現行、沒有新欄位', async () => {
    await adminDb(MAIN).doc('users/tester2').set({ birthday: '1995/07/07', teamIds: ['club_a'], teamId: 'club_a' });
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    const pub = await getRoster(plId);
    expect(pub.originalName).toBeUndefined();
    expect(pub.nickname).toBeUndefined();
    expect(pub.nameSource).toBeUndefined();
    expect(pub.displayName).toBe('球員');
  });

  it('8a. 未成年本人登錄 → 沒有三個新欄位', async () => {
    const fm = (await adminDb().doc(`competitions/${cid}`).get()).get('firstMatchAt').toMillis() as number;
    await adminDb(MAIN).doc('users/tester2').update({ birthday: birthdayForAge(14, fm) });
    const { enId } = await ok<{ enId: string }>(register(TESTER, youthDv));
    const { plId } = await ok<{ plId: string }>(call(handleCpEntry, TESTER2, {
      action: 'joinRoster', cid, enId, number: 7, privacyAck: true, realName: '歐陽小明', guardianConsent: true
    }));
    const pub = await getRoster(plId);
    expect(pub.originalName).toBeUndefined();
    expect(pub.nickname).toBeUndefined();
    expect(pub.nameSource).toBeUndefined();
  });

  it('8b. 代填帶 nickname → 沒有三個新欄位、displayName 照現行', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(call(handleCpEntry, TESTER, {
      action: 'addRosterByRep', cid, enId, number: 3, realName: '陳小安', birthday: '1990/01/01', privacyAck: true, nickname: '小安'
    }));
    const pub = await getRoster(plId);
    expect(pub.originalName).toBeUndefined();
    expect(pub.nickname).toBeUndefined();
    expect(pub.nameSource).toBeUndefined();
    expect(pub.displayName).toBe('小安');
  });

  it('9. updateRosterNickname：改暱稱、清掉、同字送', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    let r = await ok<{ changed: boolean; displayName: string }>(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: '小黑' }));
    expect(r.changed).toBe(true);
    expect((await getRoster(plId)).nickname).toBe('小黑');
    expect((await getRoster(plId)).displayName).toBe('小黑');
    expect((await getRosterPriv(plId)).nickEdits).toBe(1);
    r = await ok<{ changed: boolean }>(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: null }));
    expect(r.changed).toBe(true);
    expect((await getRoster(plId)).displayName).toBe('阿傑LINE');
    expect((await getRosterPriv(plId)).nickEdits).toBe(2);
    r = await ok<{ changed: boolean }>(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: null }));
    expect(r.changed).toBe(false);
    expect((await getRosterPriv(plId)).nickEdits).toBe(2);
  });

  it('10a. updateRosterNickname 權限：代表／管理員／陌生人 → NOT_ROSTER_OWNER', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    await fails(call(handleCpEntry, TESTER, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'NOT_ROSTER_OWNER');
    await fails(call(handleCpEntry, ADMIN, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'NOT_ROSTER_OWNER');
    await fails(call(handleCpEntry, STRANGER, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'NOT_ROSTER_OWNER');
  });

  it('10b. updateRosterNickname 代填列 → NOT_ROSTER_OWNER', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(call(handleCpEntry, TESTER, {
      action: 'addRosterByRep', cid, enId, number: 3, realName: '陳小安', birthday: '1990/01/01', privacyAck: true
    }));
    await fails(call(handleCpEntry, TESTER, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'NOT_ROSTER_OWNER');
  });

  it('11. updateRosterNickname 時間窗：鎖定／首場後／下架', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    await adminDb().doc(`competitions/${cid}`).update({ rostersLockedAt: new Date() });
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'ROSTERS_LOCKED');
    await adminDb().doc(`competitions/${cid}`).update({ rostersLockedAt: null });
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }, makeDeps(21 * DAY)), 'COMPETITION_STARTED');
    await adminDb().doc(`competitions/${cid}`).update({ hidden: true });
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'COMPETITION_HIDDEN');
  });

  it('12. updateRosterNickname 次數上限 5', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    for (let i = 0; i < 5; i++) {
      await ok(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: `n${i}` }));
    }
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'n6' }), 'NICK_EDIT_LIMIT', 'resource-exhausted');
  });

  it('13. updateRosterNickname 舊列 → NICKNAME_NOT_ALLOWED', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    await adminDb().doc(`competitions/${cid}/roster/${plId}`).update({
      originalName: FieldValue.delete(),
      nickname: FieldValue.delete(),
      nameSource: FieldValue.delete()
    });
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'x' }), 'NICKNAME_NOT_ALLOWED');
  });

  it('14. updateRosterNickname 暱稱含括號 FIELD_FORMAT；多帶 key UNKNOWN_FIELD', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'a(b' }), 'FIELD_FORMAT');
    await fails(call(handleCpEntry, TESTER2, { action: 'updateRosterNickname', cid, plId, nickname: 'x', extra: 1 }), 'UNKNOWN_FIELD');
  });

  it('15. syncRosterName：profile 列補正成 line、暱稱保留、冪等', async () => {
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId, { nickname: '阿範' }));
    let pub = await getRoster(plId);
    expect(pub.nameSource).toBe('profile');
    expect(pub.originalName).toBe('球員丙');
    await setLineName('阿傑LINE');
    let r = await ok<{ changed: boolean }>(call(handleCpEntry, TESTER2, { action: 'syncRosterName', cid, plId }));
    expect(r.changed).toBe(true);
    pub = await getRoster(plId);
    expect(pub.originalName).toBe('阿傑LINE');
    expect(pub.nameSource).toBe('line');
    expect(pub.nickname).toBe('阿範');
    expect(pub.displayName).toBe('阿範');
    expect((await getRosterPriv(plId)).nickEdits).toBeUndefined();
    r = await ok<{ changed: boolean }>(call(handleCpEntry, TESTER2, { action: 'syncRosterName', cid, plId }));
    expect(r.changed).toBe(false);
  });

  it('16. syncRosterName：line 列快照不變；別人 NOT_ROSTER_OWNER；鎖定後 ROSTERS_LOCKED', async () => {
    await setLineName('阿傑LINE');
    const { enId } = await ok<{ enId: string }>(register());
    const { plId } = await ok<{ plId: string }>(join(TESTER2, enId));
    await setLineName('別的LINE');
    const r = await ok<{ changed: boolean }>(call(handleCpEntry, TESTER2, { action: 'syncRosterName', cid, plId }));
    expect(r.changed).toBe(false);
    expect((await getRoster(plId)).originalName).toBe('阿傑LINE');
    await fails(call(handleCpEntry, TESTER, { action: 'syncRosterName', cid, plId }), 'NOT_ROSTER_OWNER');
    await adminDb().doc(`competitions/${cid}`).update({ rostersLockedAt: new Date() });
    await fails(call(handleCpEntry, TESTER2, { action: 'syncRosterName', cid, plId }), 'ROSTERS_LOCKED');
  });

  it('17. 個資移除：deidentify 清掉三個原料欄位', async () => {
    const SUPER_ADMIN = { uid: 'superadmin', role: 'super_admin' };
    await adminDb().doc('cpOwnerConfig/removal').set({ uids: [SUPER_ADMIN.uid] });
    const now = Date.now();
    const testCid = `cp_${'z'.repeat(20)}`;
    const testPlId = `pl_${'b'.repeat(20)}`;
    const testEnId = `en_${'c'.repeat(20)}`;
    const testDvId = `dv_${'d'.repeat(20)}`;
    await adminDb().doc(`competitions/${testCid}`).set({
      name: '測試', sport: 'football', hostType: 'personal', hostDisplay: '王主辦',
      visibility: 'public', status: 'published', hidden: false,
      regOpenAt: Timestamp.fromMillis(now - DAY), regCloseAt: Timestamp.fromMillis(now + 10 * DAY),
      firstMatchAt: Timestamp.fromMillis(now + 20 * DAY), lastMatchAt: Timestamp.fromMillis(now + 21 * DAY),
      endedAt: null, rostersLockedAt: null, notices: []
    });
    await adminDb().doc(`competitions/${testCid}/roster/${testPlId}`).set({
      displayName: '小(小飛)', enId: testEnId, dvId: testDvId, number: 10,
      originalName: '小飛', nickname: '小', nameSource: 'line'
    });
    await adminDb().doc(`competitions/${testCid}/rosterPrivate/${testPlId}`).set({
      uid: TESTER2.uid, realName: '王小明', enId: testEnId, dvId: testDvId, teamId: 'club_a',
      source: 'self', addedByUid: null
    });
    await adminDb().doc(`competitions/${testCid}/entries/${testEnId}`).set({ rosterCount: 1, rosterConfirmed: true });
    await adminDb().doc(`cpMine/${TESTER2.uid}/items/${testCid}`).set({
      cid: testCid, name: '測試', roles: ['player'], host: '王主辦'
    });
    const reqHandler: Handler = async (d, c, i) => requestMyDataRemoval(d, c, i as Record<string, unknown>);
    const deps = makeDeps(21 * DAY);
    const r = await ok<{ status: string }>(call(reqHandler, TESTER2, { confirm: 'REMOVE' }, deps));
    expect(r.status).toBe('done');
    const pub = (await adminDb().doc(`competitions/${testCid}/roster/${testPlId}`).get()).data()!;
    expect(pub.displayName).toBe(ANON_PLAYER);
    expect(pub.originalName).toBeUndefined();
    expect(pub.nickname).toBeUndefined();
    expect(pub.nameSource).toBeUndefined();
  });
});
