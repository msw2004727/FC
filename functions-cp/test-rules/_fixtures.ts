/**
 * 共用種子資料（全部用代號，不含真實 uid／人名）
 *
 * 身分
 *  host     個人主辦（個人主辦賽事的 staff/host roles=['host']；§3.251 (c) 主文件不放 uid）
 *  co       共同主辦（staff.roles = ['coHost']）
 *  rep      俱樂部 club_a 代表（cpClubs/club_a.repUids）
 *  s1       cp_pub/mt_1 的指派記分員＋目前記分者
 *  s2       cp_pub/mt_1 的指派記分員，但不是目前記分者
 *  sref     裁判，指派 mt_1（用來測接手）
 *  sother   只指派 mt_2
 *  sx       指派 mt_1 但已過期
 *  se       roles 有 scorer 但 matchIds 空陣列
 *  stranger 一般會員
 *  tester   內部期測試者（cpConfig/launch/testers/tester）
 *  admin    claims role = 'admin'
 */
import { adminDb, ago, Timestamp } from './_harness.js';

export const CLOCK0 = { startedAt: null, pausedSec: 0, running: false, period: 'pre' };

export function compDoc(over: Record<string, unknown> = {}) {
  return {
    name: '【測試】盃', sport: 'football', hostType: 'personal',
    hostDisplay: '主辦', visibility: 'public', status: 'published', hidden: false,
    regOpenAt: ago(86400 * 10), regCloseAt: ago(86400 * 2),
    firstMatchAt: ago(3600), lastMatchAt: ago(-86400), timezone: 'Asia/Taipei',
    stateVersion: 1, createdAt: ago(86400 * 20), updatedAt: ago(60),
    ...over
  };
}

export function liveMatch(over: Record<string, unknown> = {}) {
  return {
    divisionId: 'dv_1', stageId: 'group', groupId: 'A',
    home: { entryId: 'en_h', name: '主隊' }, away: { entryId: 'en_a', name: '客隊' },
    kickoffAt: ago(1800), venue: 'A 場',
    status: 'live', score: { home: 1, away: 0 }, rev: 3, lock: { locked: false },
    clockBase: { startedAt: ago(1800), pausedSec: 0, running: true, period: 'h1' },
    finishedAt: null, updatedAt: ago(60),
    ...over
  };
}

/** 種下標準情境；回傳後各測試可再用 adminDb() 覆寫個別文件。 */
export async function seedBase(): Promise<void> {
  const db = adminDb();
  const b = db.batch();
  b.set(db.doc('cpConfig/launch'), { isPublic: false });
  b.set(db.doc('cpConfig/launch/testers/tester'), { addedAt: ago(100) });
  b.set(db.doc('cpClubs/club_a'), { repUids: ['rep'], name: '甲隊', srcUpdatedAt: ago(100) });
  b.set(db.doc('cpClubs/club_a/members/m1'), { since: ago(100) });
  b.set(db.doc('cpHostQuota/host'), { open: 1 });
  b.set(db.doc('cpOutbox/o1'), { templateId: 't', toUid: 'host' });

  for (const [cid, over] of [
    ['cp_pub', {}],
    ['cp_draft', { status: 'draft' }],
    ['cp_hidden', { hidden: true }],
    ['cp_cancel', { status: 'cancelled' }],
    ['cp_post', { status: 'postponed' }],
    ['cp_int', { visibility: 'internal' }],
    ['cp_club', { hostType: 'club', hostTeamId: 'club_a' }],
    ['cp_club_draft', { hostType: 'club', hostTeamId: 'club_a', status: 'draft' }],
    ['cp_club_int', { hostType: 'club', hostTeamId: 'club_a', visibility: 'internal' }]
  ] as const) {
    b.set(db.doc(`competitions/${cid}`), compDoc(over as Record<string, unknown>));
    b.set(db.doc(`competitions/${cid}/divisions/dv_1`), { name: '公開組', formatId: 'RR' });
    b.set(db.doc(`competitions/${cid}/entries/en_h`), { teamId: 'club_a', name: '主隊' });
    b.set(db.doc(`competitions/${cid}/entryPrivate/en_h`), { teamId: 'club_a', contact: '聯絡' });
    b.set(db.doc(`competitions/${cid}/roster/pl_1`), { displayName: '球員', number: 7, isMinor: false });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_1`), { teamId: 'club_a', uid: 'm1', realName: '真名' });
    b.set(db.doc(`competitions/${cid}/rosterPrivate/pl_2`), { teamId: 'club_a', uid: null, realName: '代填', addedByUid: 'rep' });
    b.set(db.doc(`competitions/${cid}/standings/dv_1__group__A`), { rows: [] });
    b.set(db.doc(`competitions/${cid}/summary/d1`), { matches: {} });
    b.set(db.doc(`competitions/${cid}/invites/iv_1`), { hash: 'h' });
    b.set(db.doc(`competitions/${cid}/audits/a1`), { action: 'x' });
    b.set(db.doc(`competitions/${cid}/reports/r1`), { reason: 'x' });
    b.set(db.doc(`competitions/${cid}/staff/co`), { roles: ['coHost'], matchIds: [], expiresAt: null });
    // 個人主辦：staff host；俱樂部主辦只認目前代表（不寫 host）
    if (!('hostType' in (over as Record<string, unknown>))) {
      b.set(db.doc(`competitions/${cid}/staff/host`), { roles: ['host'], matchIds: [], expiresAt: null });
    }
    b.set(db.doc(`competitions/${cid}/staff/s1`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/s2`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/sref`), { roles: ['referee'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/sother`), { roles: ['scorer'], matchIds: ['mt_2'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/sx`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: ago(60) });
    b.set(db.doc(`competitions/${cid}/staff/se`), { roles: ['scorer'], matchIds: [], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/admin`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/tester`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/staff/stranger`), { roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null });
    b.set(db.doc(`competitions/${cid}/matches/mt_1`), liveMatch());
    b.set(db.doc(`competitions/${cid}/matches/mt_1/control/scorer`), { uid: 's1', takenAt: ago(1800) });
    b.set(db.doc(`competitions/${cid}/matches/mt_1/timeline/e1`), { seq: 1, type: 'kickoff', matchSecond: 0, createdAt: ago(1800) });
    b.set(db.doc(`competitions/${cid}/matches/mt_1/timeline/e2`), { seq: 2, type: 'goal', side: 'home', plId: 'pl_1', goalKind: 'normal', matchSecond: 300, createdAt: ago(1500) });
    b.set(db.doc(`competitions/${cid}/matches/mt_1/timeline/e3`), { seq: 3, type: 'card', side: 'away', plId: 'pl_9', cardType: 'yellow', matchSecond: 600, createdAt: ago(1200) });
    b.set(db.doc(`competitions/${cid}/matches/mt_2`), liveMatch({ score: { home: 0, away: 0 }, rev: 1 }));
    b.set(db.doc(`competitions/${cid}/matches/mt_2/control/scorer`), { uid: 'sother', takenAt: ago(1800) });
    b.set(db.doc(`competitions/${cid}/matches/mt_2/timeline/e1`), { seq: 1, type: 'kickoff', matchSecond: 0, createdAt: ago(1800) });
  }
  b.set(db.doc('cpMine/host/items/cp_draft'), { cid: 'cp_draft', roles: ['host'], host: true });
  b.set(db.doc('cpMine/m1/items/cp_pub'), { cid: 'cp_pub', role: 'player', firstMatchAt: ago(3600) });
  b.set(db.doc('cpMine/s1/items/cp_pub'), { cid: 'cp_pub', role: 'scorer', firstMatchAt: ago(3600) });
  await b.commit();
}

/** 讓指定身分成為 mt_1 的目前記分者（測試要隔離「其他條件」時用）。 */
export async function setCurrentScorer(cid: string, uid: string, mt = 'mt_1') {
  await adminDb().doc(`competitions/${cid}/matches/${mt}/control/scorer`).set({ uid, takenAt: ago(10) });
}
export async function patchMatch(cid: string, patch: Record<string, unknown>, mt = 'mt_1') {
  await adminDb().doc(`competitions/${cid}/matches/${mt}`).set(patch, { merge: true });
}
export { Timestamp };
