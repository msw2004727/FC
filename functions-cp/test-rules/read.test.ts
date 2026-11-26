/**
 * §5.2 讀取規則＋自己的清單（§3.248-5）＋V16（代表清單以 hostTeamId 組 get 路徑的查詢層級驗證）
 */
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';
import { doc, getDoc, getDocs, setDoc, collection, query, where, limit, type Firestore } from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, assertFails, assertSucceeds } from './_harness.js';
import { seedBase } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const anon = () => clientDb(null);
const get1 = (db: Firestore, p: string) => getDoc(doc(db, p));
const pubQ = (db: Firestore, n = 30) => query(collection(db, 'competitions'),
  where('visibility', '==', 'public'), where('hidden', '==', false),
  where('status', 'in', ['published', 'postponed', 'cancelled']), limit(n));

beforeAll(async () => { await loadRules(); await clearDb(); await seedBase(); });
afterEach(async () => { await closeClients(); });
afterAll(async () => { await clearDb(); });

describe('competitions 根文件 get', () => {
  it('訪客可讀公開已發布、延期、取消', async () => {
    for (const c of ['cp_pub', 'cp_post', 'cp_cancel']) await assertSucceeds(get1(anon(), `competitions/${c}`));
  });
  it('訪客、一般會員不可讀草稿、下架、內部', async () => {
    for (const c of ['cp_draft', 'cp_hidden', 'cp_int']) {
      await assertFails(get1(anon(), `competitions/${c}`));
      await assertFails(get1(as('stranger'), `competitions/${c}`));
    }
  });
  it('主辦可讀自己的草稿、下架、內部；共同主辦可讀草稿、下架', async () => {
    for (const c of ['cp_draft', 'cp_hidden']) await assertSucceeds(get1(as('host'), `competitions/${c}`));
    // §3.251：主辦本人讀內部賽事也要過內部期閘門（與 Callable 一致）
    await assertFails(get1(as('host'), 'competitions/cp_int'));
    for (const c of ['cp_draft', 'cp_hidden']) await assertSucceeds(get1(as('co'), `competitions/${c}`));
  });
  it('內部賽事：共同主辦（非測試者）不可讀；測試者可讀；管理員可讀', async () => {
    await assertFails(get1(as('co'), 'competitions/cp_int'));
    await assertSucceeds(get1(as('tester'), 'competitions/cp_int'));
    await assertSucceeds(get1(as('admin', 'admin'), 'competitions/cp_int'));
    await assertSucceeds(get1(as('sa', 'super_admin'), 'competitions/cp_draft'));
  });
  it('管理員只認 claims role：role 為其他值不算', async () => {
    await assertFails(get1(as('fake', 'coach'), 'competitions/cp_draft'));
  });
  it('俱樂部主辦：該隊代表可讀草稿；非代表不可', async () => {
    await assertSucceeds(get1(as('rep'), 'competitions/cp_club_draft'));
    await assertFails(get1(as('m1'), 'competitions/cp_club_draft'));
  });
  it('俱樂部主辦的內部賽事：代表（非測試者）不可讀', async () => {
    await assertFails(get1(as('rep'), 'competitions/cp_club_int'));
  });
});

describe('competitions list', () => {
  it('公開清單：帶 visibility／hidden／status 篩選且 limit <= 50 → 允許', async () => {
    await assertSucceeds(getDocs(pubQ(anon())));
    await assertSucceeds(getDocs(pubQ(anon(), 50)));
  });
  it('【拒】limit 超過 50、不帶 limit', async () => {
    await assertFails(getDocs(pubQ(anon(), 51)));
    await assertFails(getDocs(query(collection(anon(), 'competitions'),
      where('visibility', '==', 'public'), where('hidden', '==', false),
      where('status', 'in', ['published', 'postponed', 'cancelled']))));
  });
  it('【拒】少帶任一篩選（hidden、status、visibility）', async () => {
    const db = anon();
    await assertFails(getDocs(query(collection(db, 'competitions'), where('visibility', '==', 'public'),
      where('status', 'in', ['published']), limit(10))));
    await assertFails(getDocs(query(collection(db, 'competitions'), where('visibility', '==', 'public'),
      where('hidden', '==', false), limit(10))));
    await assertFails(getDocs(query(collection(db, 'competitions'), where('hidden', '==', false),
      where('status', 'in', ['published']), limit(10))));
  });
  it('【拒】內部賽事清單：非管理員且非測試者', async () => {
    await assertFails(getDocs(query(collection(as('stranger'), 'competitions'), where('visibility', '==', 'internal'),
      where('hidden', '==', false), where('status', 'in', ['published']), limit(10))));
  });
  it('測試者可列內部賽事；管理員可不帶篩選列（limit <= 50）', async () => {
    await assertSucceeds(getDocs(query(collection(as('tester'), 'competitions'), where('visibility', '==', 'internal'),
      where('hidden', '==', false), where('status', 'in', ['published']), limit(10))));
    await assertSucceeds(getDocs(query(collection(as('admin', 'admin'), 'competitions'), limit(50))));
    await assertFails(getDocs(query(collection(as('admin', 'admin'), 'competitions'), limit(51))));
  });
  it('主辦自己的清單：改走 cpMine（§3.251 (c)）；以 hostUid 查詢已無規則可過', async () => {
    await assertSucceeds(getDocs(query(collection(as('host'), 'cpMine/host/items'), limit(50))));
    await assertFails(getDocs(query(collection(as('host'), 'competitions'), where('hostUid', '==', 'host'), limit(50))));
  });
  it('【拒】查別人的 hostUid', async () => {
    await assertFails(getDocs(query(collection(as('stranger'), 'competitions'), where('hostUid', '==', 'host'), limit(50))));
  });
  it('【V16】俱樂部代表清單：hostTeamId == T＋visibility == public（代表非測試者）→ 允許', async () => {
    await assertSucceeds(getDocs(query(collection(as('rep'), 'competitions'),
      where('hostTeamId', '==', 'club_a'), where('visibility', '==', 'public'), limit(50))));
  });
  it('【V16】測試者代表可只帶 hostTeamId（內部期）', async () => {
    // 讓 tester 也是 club_a 代表
    const { adminDb } = await import('./_harness.js');
    await adminDb().doc('cpClubs/club_a').set({ repUids: ['rep', 'tester'] }, { merge: true });
    await assertSucceeds(getDocs(query(collection(as('tester'), 'competitions'), where('hostTeamId', '==', 'club_a'), limit(50))));
    await adminDb().doc('cpClubs/club_a').set({ repUids: ['rep'] }, { merge: true });
  });
  it('【拒】不帶 hostTeamId 篩選（只帶 visibility）、帶了但不是代表、代表但 limit 超過、代表非測試者卻不帶 visibility', async () => {
    await assertFails(getDocs(query(collection(as('rep'), 'competitions'), where('visibility', '==', 'public'), limit(50))));
    await assertFails(getDocs(query(collection(as('m1'), 'competitions'),
      where('hostTeamId', '==', 'club_a'), where('visibility', '==', 'public'), limit(50))));
    await assertFails(getDocs(query(collection(as('rep'), 'competitions'),
      where('hostTeamId', '==', 'club_a'), where('visibility', '==', 'public'), limit(51))));
    await assertFails(getDocs(query(collection(as('rep'), 'competitions'), where('hostTeamId', '==', 'club_a'), limit(50))));
  });
});

describe('子集合', () => {
  const pub = ['divisions/dv_1', 'entries/en_h', 'roster/pl_1', 'standings/dv_1__group__A', 'summary/d1',
    'matches/mt_1', 'matches/mt_1/timeline/e1'];
  it('公開子集合：父文件公開即可讀（訪客）', async () => {
    for (const p of pub) await assertSucceeds(get1(anon(), `competitions/cp_pub/${p}`));
  });
  it('【拒】父文件草稿／下架／內部時，訪客讀公開子集合', async () => {
    for (const c of ['cp_draft', 'cp_hidden', 'cp_int']) {
      for (const p of pub) await assertFails(get1(anon(), `competitions/${c}/${p}`));
    }
  });
  it('公開子集合 list：單一 cid、limit <= 100；超過被拒', async () => {
    const db = anon();
    await assertSucceeds(getDocs(query(collection(db, 'competitions/cp_pub/matches'), limit(100))));
    await assertSucceeds(getDocs(query(collection(db, 'competitions/cp_pub/matches/mt_1/timeline'), limit(60))));
    await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/matches'), limit(101))));
    await assertFails(getDocs(collection(db, 'competitions/cp_pub/entries')));
  });
  it('私密 entryPrivate：主辦、共同主辦、管理員、該隊代表可讀；其他不可', async () => {
    const p = 'competitions/cp_pub/entryPrivate/en_h';
    for (const w of [as('host'), as('co'), as('admin', 'admin'), as('rep')]) await assertSucceeds(get1(w, p));
    for (const w of [anon(), as('stranger'), as('m1'), as('s1')]) await assertFails(get1(w, p));
  });
  it('私密 rosterPrivate：本人可讀自己的；代填（uid null）只有代表與主辦；他人不可', async () => {
    await assertSucceeds(get1(as('m1'), 'competitions/cp_pub/rosterPrivate/pl_1'));
    await assertSucceeds(get1(as('rep'), 'competitions/cp_pub/rosterPrivate/pl_2'));
    await assertSucceeds(get1(as('host'), 'competitions/cp_pub/rosterPrivate/pl_2'));
    await assertFails(get1(as('m1'), 'competitions/cp_pub/rosterPrivate/pl_2'));
    await assertFails(get1(as('stranger'), 'competitions/cp_pub/rosterPrivate/pl_1'));
    await assertFails(get1(anon(), 'competitions/cp_pub/rosterPrivate/pl_1'));
  });
  it('rosterPrivate list：本人帶 uid 篩選、代表帶 teamId 篩選可；不帶篩選的一般會員被拒', async () => {
    await assertSucceeds(getDocs(query(collection(as('m1'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'm1'), limit(10))));
    await assertSucceeds(getDocs(query(collection(as('rep'), 'competitions/cp_pub/rosterPrivate'), where('teamId', '==', 'club_a'), limit(50))));
    await assertFails(getDocs(query(collection(as('m1'), 'competitions/cp_pub/rosterPrivate'), limit(10))));
    await assertFails(getDocs(query(collection(as('stranger'), 'competitions/cp_pub/rosterPrivate'), where('uid', '==', 'm1'), limit(10))));
  });
  it('staff：本人可讀自己的；主辦、共同主辦可讀全部；其他人不可讀別人的', async () => {
    await assertSucceeds(get1(as('s1'), 'competitions/cp_pub/staff/s1'));
    await assertFails(get1(as('s1'), 'competitions/cp_pub/staff/s2'));
    await assertSucceeds(get1(as('host'), 'competitions/cp_pub/staff/s2'));
    await assertSucceeds(get1(as('co'), 'competitions/cp_pub/staff/s2'));
    await assertSucceeds(getDocs(query(collection(as('host'), 'competitions/cp_pub/staff'), limit(50))));
    await assertFails(getDocs(query(collection(as('s1'), 'competitions/cp_pub/staff'), limit(50))));
  });
  it('control/scorer：主辦、共同主辦、本場指派者可讀；未指派者、訪客不可', async () => {
    const p = 'competitions/cp_pub/matches/mt_1/control/scorer';
    for (const w of [as('host'), as('co'), as('s1'), as('s2'), as('sref')]) await assertSucceeds(get1(w, p));
    for (const w of [as('sother'), as('se'), as('sx'), as('m1'), anon()]) await assertFails(get1(w, p));
  });
  it('control/scorer：內部賽事被指派的一般會員（非測試者）不可讀（P2-2）', async () => {
    await assertFails(get1(as('stranger'), 'competitions/cp_int/matches/mt_1/control/scorer'));
    await assertSucceeds(get1(as('tester'), 'competitions/cp_int/matches/mt_1/control/scorer'));
  });
  it('invites、audits：主辦、共同主辦、管理員；reports 只有管理員', async () => {
    for (const p of ['invites/iv_1', 'audits/a1']) {
      for (const w of [as('host'), as('co'), as('admin', 'admin')]) await assertSucceeds(get1(w, `competitions/cp_pub/${p}`));
      for (const w of [as('s1'), as('stranger'), anon()]) await assertFails(get1(w, `competitions/cp_pub/${p}`));
    }
    await assertSucceeds(get1(as('admin', 'admin'), 'competitions/cp_pub/reports/r1'));
    for (const w of [as('host'), as('co')]) await assertFails(get1(w, 'competitions/cp_pub/reports/r1'));
  });
});

describe('其他集合', () => {
  it('cpConfig/launch 公開讀；測試者文件只有本人可讀', async () => {
    await assertSucceeds(get1(anon(), 'cpConfig/launch'));
    await assertSucceeds(get1(as('tester'), 'cpConfig/launch/testers/tester'));
    await assertFails(get1(as('stranger'), 'cpConfig/launch/testers/tester'));
    await assertFails(getDocs(collection(as('admin', 'admin'), 'cpConfig/launch/testers')));
  });
  it('cpMine：本人可讀與 list（limit <= 50）', async () => {
    await assertSucceeds(get1(as('m1'), 'cpMine/m1/items/cp_pub'));
    await assertSucceeds(getDocs(query(collection(as('m1'), 'cpMine/m1/items'), limit(50))));
  });
  it('【拒】讀別人的 cpMine、limit 超過', async () => {
    await assertFails(get1(as('s1'), 'cpMine/m1/items/cp_pub'));
    await assertFails(getDocs(query(collection(as('s1'), 'cpMine/m1/items'), limit(10))));
    await assertFails(getDocs(query(collection(as('m1'), 'cpMine/m1/items'), limit(51))));
  });
  it('【拒】cpClubs、members、cpHostQuota、cpOutbox 用戶端一律不可讀（含管理員）', async () => {
    for (const p of ['cpClubs/club_a', 'cpClubs/club_a/members/m1', 'cpHostQuota/host', 'cpOutbox/o1']) {
      await assertFails(get1(as('admin', 'admin'), p));
      await assertFails(get1(as('rep'), p));
    }
  });
  it('【拒】cpRemovalJobs、cpReportPurge、cpDailyState 用戶端一律不可讀寫（含管理員、本人）', async () => {
    for (const p of ['cpRemovalJobs/u_job', 'cpReportPurge/c_r', 'cpDailyState/auditBackfill']) {
      for (const db of [as('admin', 'admin'), as('m1'), anon()]) {
        await assertFails(get1(db, p));
        await assertFails(setDoc(doc(db, p), { x: 1 }));
      }
    }
    await assertFails(getDocs(query(collection(as('admin', 'admin'), 'cpRemovalJobs'), limit(10))));
  });
  it('【拒】不開 collectionGroup 讀取', async () => {
    const { collectionGroup } = await import('firebase/firestore');
    await assertFails(getDocs(query(collectionGroup(anon(), 'matches'), limit(10))));
    await assertFails(getDocs(query(collectionGroup(as('admin', 'admin'), 'timeline'), limit(10))));
  });
  it('【拒】用戶端寫任何伺服器專用集合（含管理員）', async () => {
    const { setDoc } = await import('firebase/firestore');
    const a = as('admin', 'admin');
    for (const p of ['competitions/cp_new', 'competitions/cp_pub/entries/en_x', 'competitions/cp_pub/staff/x',
      'cpConfig/launch', 'cpConfig/launch/testers/x', 'cpMine/admin/items/x', 'cpClubs/club_x']) {
      await assertFails(setDoc(doc(a, p), { x: 1 }));
    }
  });
});
