/**
 * §6.3 直寫記分：通過案例＋拒絕案例（§6.3-9 清單逐條對應，測試名稱以【R-xx】標號）
 * 基準：cp_pub/mt_1 進行中 score 1:0、rev 3；e1 開賽、e2 主隊進球、e3 客隊黃牌；目前記分者 s1。
 */
import { describe, it, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  collection, deleteDoc, doc, getDocs, limit, query, writeBatch, serverTimestamp, setDoc, updateDoc,
  Timestamp as CTimestamp, type Firestore
} from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, assertFails, assertSucceeds, adminDb, ago, later } from './_harness.js';
import { seedBase, setCurrentScorer, patchMatch, SID_S1, SID_S2, OP_OK } from './_fixtures.js';

type Ev = Record<string, unknown>;
interface ScoreOpts {
  cid?: string; mt?: string; fromRev?: number; ev: Ev; patch?: Record<string, unknown>;
  newRev?: number; seq?: number; evId?: string; withVoid?: boolean; voidId?: string; voidDoc?: Record<string, unknown>;
  skipEvent?: boolean; skipMatch?: boolean; noSid?: boolean; noOp?: boolean;
  cardLink?: { id: string; update?: boolean; doc?: Record<string, unknown> };
}
function scoreBatch(db: Firestore, o: ScoreOpts) {
  const cid = o.cid ?? 'cp_pub', mt = o.mt ?? 'mt_1', from = o.fromRev ?? 3;
  const newRev = o.newRev ?? from + 1;
  const seq = o.seq ?? newRev;
  const base = `competitions/${cid}/matches/${mt}`;
  const b = writeBatch(db);
  if (!o.skipMatch) b.update(doc(db, base), { rev: newRev, updatedAt: serverTimestamp(), ...(o.patch ?? {}) });
  if (!o.skipEvent) {
    const body: Ev = { seq, matchSecond: 900, createdAt: serverTimestamp(), ...o.ev };
    if (o.noSid) delete body.sid;
    else if (body.sid === undefined) body.sid = SID_S1;
    if (o.noOp) delete body.op;
    else if (body.op === undefined) body.op = OP_OK;
    b.set(doc(db, `${base}/timeline/${o.evId ?? `e${seq}`}`), body);
  }
  if (o.withVoid) {
    const target = String(o.voidId ?? (o.ev.targetSeq as number));
    b.set(doc(db, `${base}/voids/${target}`), o.voidDoc ?? { seq, createdAt: serverTimestamp() });
  }
  if (o.cardLink) {
    const ref = doc(db, `${base}/cardLinks/${o.cardLink.id}`);
    const body = o.cardLink.doc ?? { seq, createdAt: serverTimestamp() };
    if (o.cardLink.update) b.update(ref, body);
    else b.set(ref, body);
  }
  return b.commit();
}
const secondYellow = (extra: Partial<ScoreOpts> = {}): ScoreOpts => ({
  ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 },
  cardLink: { id: '3' },
  ...extra
});
const goal = (side: 'home' | 'away', extra: Ev = {}): Ev => ({ type: 'goal', side, plId: 'pl_1', goalKind: 'normal', ...extra });
const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
/** 合法第二黃同批再寫一筆 cardLinks。id 不合第二黃的 refSeq 時，用來隔離 cardLinks 子條件。 */
function extraLink(id: string) {
  const db = as('s1');
  const base = 'competitions/cp_pub/matches/mt_1';
  const seq = 4;
  const b = writeBatch(db);
  b.update(doc(db, base), { rev: seq, updatedAt: serverTimestamp() });
  b.set(doc(db, `${base}/timeline/e${seq}`), {
    seq, type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3,
    matchSecond: 900, createdAt: serverTimestamp(), sid: SID_S1, op: OP_OK
  });
  b.set(doc(db, `${base}/cardLinks/3`), { seq, createdAt: serverTimestamp() });
  b.set(doc(db, `${base}/cardLinks/${id}`), { seq, createdAt: serverTimestamp() });
  return b.commit();
}

beforeAll(async () => { await loadRules(); });
beforeEach(async () => { await clearDb(); await seedBase(); });
afterEach(async () => { await closeClients(); });

describe('通過案例（【P-1】既有記分事件都帶 sid／op）', () => {
  it('主隊進球：比分 +1、rev +1、事件 e4', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【P-1】op 長度邊界 8 與 24 的進球通過', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: goal('home', { op: 'op123456' }), patch: { score: { home: 2, away: 0 } } }));
    await assertSucceeds(scoreBatch(as('s1'), {
      fromRev: 4, ev: goal('home', { op: 'op-boundary-24chars-okay' }), patch: { score: { home: 3, away: 0 } }
    }));
  });
  it('客隊進球（不帶 plId、烏龍）', async () => {
    await assertSucceeds(scoreBatch(as('s1'), {
      ev: { type: 'goal', side: 'away', goalKind: 'own' }, patch: { score: { home: 1, away: 1 } }
    }));
  });
  it('黃牌、紅牌、換人：比分不變', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red' } }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'sub', side: 'home', inPlId: 'pl_3', outPlId: 'pl_4' } }));
  });
  it('【P-6】時鐘修正：live／半場只改 clockBase', async () => {
    const liveClock = { startedAt: CTimestamp.now(), pausedSec: 120, running: true, period: 'h1' };
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: liveClock } }));
    await patchMatch('cp_pub', { status: 'halftime', rev: 4 });
    const htClock = { startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'ht' };
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'clock' }, patch: { clockBase: htClock } }));
  });
  it('【P-9】球隊暫停：停錶、不停錶、live、半場', async () => {
    const stopped = { startedAt: CTimestamp.now(), pausedSec: 1800, running: false, period: 'h1' as const };
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home' }, patch: { clockBase: stopped } }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'timeout', side: 'away' } }));
    await patchMatch('cp_pub', { status: 'halftime' });
    const htStopped = { startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'ht' as const };
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 5, ev: { type: 'timeout', side: 'away' }, patch: { clockBase: htStopped } }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 6, ev: { type: 'timeout', side: 'home' } }));
  });
  it('半場→續賽（clockBase 可改）', async () => {
    const cb = { startedAt: CTimestamp.now(), pausedSec: 0, running: false, period: 'ht' };
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'halftime' }, patch: { status: 'halftime', clockBase: cb } }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'resume' }, patch: { status: 'live', clockBase: { ...cb, running: true, period: 'h2' } } }));
  });
  it('半場時仍可給牌（一般黃牌；第二黃改由【P-3】）', async () => {
    await patchMatch('cp_pub', { status: 'halftime' });
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' } }));
  });
  it('【P-3b】半場時記合法第二黃（帶 refSeq、同批 cardLinks）', async () => {
    await patchMatch('cp_pub', { status: 'halftime' });
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
  });
  it('【P-3】第二黃：refSeq 指向同人未作廢黃牌，同批建 cardLinks', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
  });
  it('【P-4】作廢第二黃後才能作廢第一黃', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 5, ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
  });
  it('【P-5】第二黃作廢後，同一黃牌可被新的第二黃重新引用', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('s1'), secondYellow({ fromRev: 5, cardLink: { id: '3', update: true } })));
  });
  it('【P-8】重置後第 200 筆通過；再重置後又可記 200 筆', async () => {
    // 不逐筆寫 200 次。把 rev 抬到窗口最後一筆的前一號，下一筆就是第 200 筆（rev - resetRev == 200）。
    const yellow = { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' };
    await patchMatch('cp_pub', { rev: 199 });
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 199, ev: yellow }));
    await patchMatch('cp_pub', { rev: 399, resetRev: 200 });
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 399, ev: yellow }));
  });
  it('開賽：scheduled → live', async () => {
    await patchMatch('cp_pub', { status: 'scheduled', score: { home: 0, away: 0 }, rev: 0 });
    await adminDb().recursiveDelete(adminDb().collection('competitions/cp_pub/matches/mt_1/timeline'));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 0, ev: { type: 'kickoff' }, patch: { status: 'live' } }));
  });
  it('終場：finished＋上鎖＋finishedAt＝伺服器時間', async () => {
    await assertSucceeds(scoreBatch(as('s1'), {
      ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() }
    }));
  });
  it('裁判（referee）被指派且為目前記分者也可記分與送終場', async () => {
    await setCurrentScorer('cp_pub', 'sref');
    await assertSucceeds(scoreBatch(as('sref'), {
      ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() }
    }));
  });
  it('【P-2】作廢紅牌、作廢未被引用的黃牌：比分不變', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('s1'), {
      fromRev: 4, ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red' }
    }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 5, ev: { type: 'void', targetSeq: 5 }, withVoid: true }));
  });
  it('作廢 e2 進球：主隊 -1、同批建立 voids/2', async () => {
    await assertSucceeds(scoreBatch(as('s1'), {
      ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true
    }));
  });
  it('自撤回：目前記分者、180 秒內 → live 解鎖', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertSucceeds(scoreBatch(as('s1'), {
      ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null }
    }));
  });
  it('接手：本場指派者寫 control/scorer（takenAt＝伺服器時間），之後原記分者被拒、新記分者可寫', async () => {
    await assertSucceeds(setDoc(doc(as('s2'), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await assertSucceeds(scoreBatch(as('s2'), { ev: goal('home', { sid: SID_S2 }), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【P-7】同 uid 第二裝置接手寫新 sid 後，舊 sid 被拒、新 sid 可寫', async () => {
    const next = 'scorer-sid-s1-device02';
    await assertSucceeds(setDoc(doc(as('s1'), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's1', takenAt: serverTimestamp(), sid: next }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { sid: SID_S1 }), patch: { score: { home: 2, away: 0 } } }));
    await assertSucceeds(scoreBatch(as('s1'), { ev: goal('home', { sid: next }), patch: { score: { home: 2, away: 0 } } }));
  });
  it('內部賽事：管理員（claims role）與測試者被指派即可記分', async () => {
    await setCurrentScorer('cp_int', 'admin');
    await assertSucceeds(scoreBatch(as('admin', 'admin'), { cid: 'cp_int', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await setCurrentScorer('cp_int', 'tester');
    await assertSucceeds(scoreBatch(as('tester'), { cid: 'cp_int', fromRev: 4, ev: goal('home'), patch: { score: { home: 3, away: 0 } } }));
  });
});

describe('拒絕案例（§6.3-9）', () => {
  it('【R-01】非本場指派', async () => {
    await setCurrentScorer('cp_pub', 'sother');
    await assertFails(scoreBatch(as('sother'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-02】指派已過期', async () => {
    await setCurrentScorer('cp_pub', 'sx');
    await assertFails(scoreBatch(as('sx'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-03】非目前記分者（已指派）', async () => {
    await assertFails(scoreBatch(as('s2'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-03b】未指派的主辦、共同主辦不能直接記分', async () => {
    await setCurrentScorer('cp_pub', 'host');
    await assertFails(scoreBatch(as('host'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await setCurrentScorer('cp_pub', 'co');
    await assertFails(scoreBatch(as('co'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-04】場次已鎖（終場後）不能再記進球', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { status: 'live', score: { home: 2, away: 0 } } }));
  });
  it('【R-05】已確認場次：自撤回與記分都拒', async () => {
    await patchMatch('cp_pub', { status: 'confirmed', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-06】內部賽事：一般會員（非管理員、非測試者）即使被指派且為目前記分者也拒', async () => {
    await setCurrentScorer('cp_int', 'stranger');
    await assertFails(scoreBatch(as('stranger'), { cid: 'cp_int', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-07】賽事已取消', async () => {
    await assertFails(scoreBatch(as('s1'), { cid: 'cp_cancel', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-07b】賽事已下架', async () => {
    await assertFails(scoreBatch(as('s1'), { cid: 'cp_hidden', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-07c】賽事延期、草稿不能記分', async () => {
    await assertFails(scoreBatch(as('s1'), { cid: 'cp_post', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { cid: 'cp_draft', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-08】場次欄位多帶（頂層多一個鍵）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 }, note: 'x' } }));
  });
  it('【R-08b】事件欄位多帶', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { uid: 's1' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red', extra: 1 } }));
  });
  it('【R-09】巢狀欄位多帶（score 多鍵、lock 多鍵、clockBase 多鍵）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0, pk: 1 } } }));
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true, by: 's1' }, finishedAt: serverTimestamp() }
    }));
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'halftime' },
      patch: { status: 'halftime', clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'ht', x: 1 } }
    }));
  });
  it('【R-09b】巢狀欄位型別錯（score 字串、score 負數、clockBase.period 非法）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: '2', away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: -1, away: 0 } }, withVoid: true }));
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'halftime' },
      patch: { status: 'halftime', clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'zz' } }
    }));
  });
  it('【R-10】rev 跳號（+2）', async () => {
    await assertFails(scoreBatch(as('s1'), { newRev: 5, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-11】rev 倒退', async () => {
    await assertFails(scoreBatch(as('s1'), { newRev: 2, seq: 2, evId: 'e2', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-12】rev 不變卻改比分（只改 score，不帶事件）', async () => {
    const db = as('s1');
    await assertFails(updateDoc(doc(db, 'competitions/cp_pub/matches/mt_1'), { score: { home: 2, away: 0 }, updatedAt: serverTimestamp() }));
    await assertFails(scoreBatch(db, { newRev: 3, seq: 4, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-13】事件缺失（只改場次 rev＋score）', async () => {
    await assertFails(scoreBatch(as('s1'), { skipEvent: true, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-13b】事件 id 與 rev 不符（rev 4 卻寫 e5）', async () => {
    await assertFails(scoreBatch(as('s1'), { evId: 'e5', ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-13c】只建事件、不改場次', async () => {
    await assertFails(scoreBatch(as('s1'), { skipMatch: true, ev: goal('home') }));
  });
  it('【R-14】事件 id 格式錯（e04、x4、4）', async () => {
    for (const id of ['e04', 'x4', '4']) {
      await assertFails(scoreBatch(as('s1'), { evId: id, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    }
  });
  it('【R-15】進球加錯邊', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 1, away: 1 } } }));
  });
  it('【R-15b】進球加 2 分、或同時動兩邊', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 3, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 1 } } }));
  });
  it('【R-15c】進球 side／goalKind 非法、缺 side', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { side: 'both' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { goalKind: 'x' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'goal', goalKind: 'normal' }, patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-15d】牌、換人卻改比分；未知事件類型', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red' }, patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'bonus' }, patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-45】時鐘修正同時改比分或狀態、賽程未開始或已結束、沒改時鐘、時鐘形狀錯', async () => {
    const ok = { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'h1' };
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: ok, score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: ok, status: 'halftime' } }));
    await patchMatch('cp_pub', { status: 'scheduled' });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: ok } }));
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: ok } }));
    await patchMatch('cp_pub', { status: 'live', lock: { locked: false }, finishedAt: null });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: {} }));
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'clock' },
      patch: { clockBase: { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'nope' } }
    }));
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'clock' },
      patch: { clockBase: { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'h1', note: 1 } }
    }));
    // 終場但鎖已解開：鎖條件不再擋，仍須被 live／半場狀態擋下。
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: false }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: ok } }));
  });
  it('【R-55】球隊暫停缺 side、side 非法、多鍵', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout' } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'both' } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home', note: 1 } }));
  });
  it('【R-56】球隊暫停同時改比分或狀態、賽程未開始、終場上鎖', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home' }, patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home' }, patch: { status: 'halftime' } }));
    await patchMatch('cp_pub', { status: 'scheduled' });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home' } }));
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'away' } }));
  });
  it('【R-57】作廢球隊暫停', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'timeout', side: 'home' } }));
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
  });
  it('【R-44】事件缺 op、op 太短、op 太長、op 含非法字元', async () => {
    await assertFails(scoreBatch(as('s1'), { noOp: true, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { op: 'short' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { op: 'op-too-long-value-xxxxxxx' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { op: 'bad op!!' }), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-41】事件缺 sid、sid 太短、sid 含非法字元', async () => {
    await assertFails(scoreBatch(as('s1'), { noSid: true, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    // 接手文件改成同一個壞 sid，讓「與接手文件相等」成立，只剩格式條件會擋。
    await setCurrentScorer('cp_pub', 's1', 'mt_1', 'short');
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { sid: 'short' }), patch: { score: { home: 2, away: 0 } } }));
    await setCurrentScorer('cp_pub', 's1', 'mt_1', 'bad sid!!!!!!!!!');
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { sid: 'bad sid!!!!!!!!!' }), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-42】事件 sid 與接手文件不符（同 uid、舊手機）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { sid: SID_S2 }), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-43】接手缺 sid、多帶欄位、sid 格式錯', async () => {
    const p = 'competitions/cp_pub/matches/mt_1/control/scorer';
    await assertFails(setDoc(doc(as('s2'), p), { uid: 's2', takenAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('s2'), p), { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2, extra: 1 }));
    await assertFails(setDoc(doc(as('s2'), p), { uid: 's2', takenAt: serverTimestamp(), sid: 'short' }));
    await assertFails(setDoc(doc(as('s2'), p), { uid: 's2', takenAt: serverTimestamp(), sid: 'has space in sid!!' }));
  });
  it('【R-40】作廢 targetSeq <= resetRev 的進球、黃牌被拒', async () => {
    // e2 是進球、e3 是黃牌。resetRev 抬到 2 或 3 後，這些序號不再大於重置線。
    await patchMatch('cp_pub', { resetRev: 2 });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    await patchMatch('cp_pub', { resetRev: 3 });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
  });
  it('【R-16】作廢非進球也非牌（開賽、換人、時鐘修正）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 1 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'sub', side: 'home', inPlId: 'pl_3', outPlId: 'pl_4' } }));
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
    const clock = { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'h1' };
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'clock' }, patch: { clockBase: clock } }));
    await assertFails(scoreBatch(as('s1'), { fromRev: 5, ev: { type: 'void', targetSeq: 5 }, withVoid: true }));
  });
  it('【C】內部賽事＋測試者作廢進球', async () => {
    await setCurrentScorer('cp_int', 'tester');
    await assertSucceeds(scoreBatch(as('tester'), {
      cid: 'cp_int', ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true
    }));
  });
  it('【P-3】【P-5】內部賽事＋測試者：第二黃與重新引用', async () => {
    await setCurrentScorer('cp_int', 'tester');
    await assertSucceeds(scoreBatch(as('tester'), secondYellow({ cid: 'cp_int' })));
    await assertSucceeds(scoreBatch(as('tester'), { cid: 'cp_int', fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('tester'), secondYellow({ cid: 'cp_int', fromRev: 5, cardLink: { id: '3', update: true } })));
  });
  it('【P-4】內部賽事＋測試者：作廢被釋放的第一黃', async () => {
    await setCurrentScorer('cp_int', 'tester');
    await assertSucceeds(scoreBatch(as('tester'), secondYellow({ cid: 'cp_int' })));
    await assertSucceeds(scoreBatch(as('tester'), { cid: 'cp_int', fromRev: 4, ev: { type: 'void', targetSeq: 4 }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('tester'), { cid: 'cp_int', fromRev: 5, ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
  });
  it('【R-47】作廢仍被有效第二黃引用的黃牌', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
  });
  it('【R-48】第二黃缺 refSeq；一般黃牌、紅牌帶 refSeq（含 null）', async () => {
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow' }, cardLink: { id: '3' }
    }));
    // 第二黃帶 refSeq: null：鍵存在，雙向條件通過，由 secondYellowOk 的「refSeq 是整數」擋下。
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: null }, cardLink: { id: '3' }
    }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow', refSeq: 3 } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red', refSeq: 3 } }));
    // 一般黃牌帶 refSeq: null。鍵存在，所以不是「讀不到欄位」；雙向條件才會擋。
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow', refSeq: null } }));
  });
  it('【R-49】第二黃 refSeq 指向別隊、別人、紅牌、進球、已作廢黃牌、未來序號、重置線上', async () => {
    const bad = (ev: Ev, o: Partial<ScoreOpts> = {}) => assertFails(scoreBatch(as('s1'), {
      ev, cardLink: { id: String(ev.refSeq) }, ...o
    }));
    await bad({ type: 'card', side: 'home', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 });
    await bad({ type: 'card', side: 'away', plId: 'pl_1', cardType: 'second_yellow', refSeq: 3 });
    await bad({ type: 'card', side: 'home', plId: 'pl_1', cardType: 'second_yellow', refSeq: 2 });
    await bad({ type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 9 });
    await patchMatch('cp_pub', { resetRev: 3 });
    await bad({ type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 });
    await patchMatch('cp_pub', { resetRev: 0 });
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red' } }));
    await bad({ type: 'card', side: 'home', plId: 'pl_1', cardType: 'second_yellow', refSeq: 4 }, { fromRev: 4 });
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 3 }, withVoid: true }));
    await bad({ type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 }, { fromRev: 5 });
  });
  it('【R-49b】未來序號的黃牌已存在、進球另帶 cardType 仍不能當 refSeq', async () => {
    // e10 已存在，get 不會出錯。只剩 refSeq < seq 會擋。
    await adminDb().doc('competitions/cp_pub/matches/mt_1/timeline/e10').set({
      seq: 10, type: 'card', side: 'away', plId: 'pl_9', cardType: 'yellow', matchSecond: 10, createdAt: ago(10)
    });
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 10 },
      cardLink: { id: '10' }
    }));
    // e2 是進球，補上 cardType yellow 後，讀 cardType 不再出錯。只剩 type == card 會擋。
    await adminDb().doc('competitions/cp_pub/matches/mt_1/timeline/e2').set({ cardType: 'yellow' }, { merge: true });
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'second_yellow', refSeq: 2 },
      cardLink: { id: '2' }
    }));
  });
  it('【R-50】同一黃牌已有有效第二黃，不能再建立第二張', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertFails(scoreBatch(as('s1'), secondYellow({ fromRev: 4, cardLink: { id: '3', update: true } })));
  });
  it('【R-51】第二黃沒同批建 cardLinks；cardLinks 單獨建立、序號錯、多欄位、刪除', async () => {
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 }
    }));
    const link = doc(as('s1'), 'competitions/cp_pub/matches/mt_1/cardLinks/3');
    await assertFails(setDoc(link, { seq: 4, createdAt: serverTimestamp() }));
    await assertFails(scoreBatch(as('s1'), secondYellow({ cardLink: { id: '3', doc: { seq: 9, createdAt: serverTimestamp() } } })));
    await assertFails(scoreBatch(as('s1'), secondYellow({
      cardLink: { id: '3', doc: { seq: 4, createdAt: serverTimestamp(), note: 1 } }
    })));
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertFails(deleteDoc(doc(as('s1'), 'competitions/cp_pub/matches/mt_1/cardLinks/3')));
  });
  it('【R-51b】cardLinks 的 createdAt 不是伺服器時間；多寫不合 id 的連結', async () => {
    await assertFails(scoreBatch(as('s1'), secondYellow({
      cardLink: { id: '3', doc: { seq: 4, createdAt: CTimestamp.fromMillis(Date.now()) } }
    })));
    // id「03」不合 ^[1-9]…。同批仍寫合法的 cardLinks/3，第二黃本身的條件都過。
    await assertFails(extraLink('03'));
    // id「9」的 int 是 9，第二黃 refSeq 是 3。只剩 refSeq == int(ySeq) 會擋。
    await assertFails(extraLink('9'));
  });
  it('【R-52】cardLinks update：舊連結的第二黃尚未作廢', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertFails(scoreBatch(as('s1'), secondYellow({ fromRev: 4, cardLink: { id: '3', update: true } })));
  });
  it('【R-54】cardLinks 不能 list', async () => {
    await assertSucceeds(scoreBatch(as('s1'), secondYellow()));
    await assertFails(getDocs(query(collection(as('s1'), 'competitions/cp_pub/matches/mt_1/cardLinks'), limit(10))));
  });
  it('【R-53】第 201 筆被拒，含終場；重置後第 201 筆仍被拒', async () => {
    const yellow = { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' };
    await patchMatch('cp_pub', { rev: 200 });
    await assertFails(scoreBatch(as('s1'), { fromRev: 200, ev: yellow }));
    await assertFails(scoreBatch(as('s1'), {
      fromRev: 200, ev: { type: 'fulltime' },
      patch: { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() }
    }));
    await patchMatch('cp_pub', { rev: 400, resetRev: 200 });
    await assertFails(scoreBatch(as('s1'), { fromRev: 400, ev: yellow }));
  });
  it('【R-46】作廢牌卻改比分', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 3 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
  });
  it('【R-16b】作廢一筆作廢事件', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
  });
  it('【R-17】createdAt 不是伺服器時間', async () => {
    await assertFails(scoreBatch(as('s1'), {
      ev: goal('home', { createdAt: CTimestamp.fromMillis(Date.now()) }), patch: { score: { home: 2, away: 0 } }
    }));
  });
  it('【R-17b】終場 finishedAt 不是伺服器時間；updatedAt 不是伺服器時間', async () => {
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true }, finishedAt: CTimestamp.fromMillis(Date.now()) }
    }));
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 }, updatedAt: CTimestamp.now() } }));
  });
  it('【R-17c】終場未上鎖', async () => {
    await assertFails(scoreBatch(as('s1'), {
      ev: { type: 'fulltime' }, patch: { status: 'finished', finishedAt: serverTimestamp() }
    }));
  });
  it('【R-18】matchSecond 超範圍（10801、-1、小數）', async () => {
    for (const ms of [10801, -1, 12.5]) {
      await assertFails(scoreBatch(as('s1'), { ev: goal('home', { matchSecond: ms }), patch: { score: { home: 2, away: 0 } } }));
    }
  });
  it('【R-19】空 matchIds', async () => {
    await setCurrentScorer('cp_pub', 'se');
    await assertFails(scoreBatch(as('se'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-20】三分鐘後自撤回', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(181) });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null } }));
  });
  it('【R-21】非目前記分者自撤回（已指派）', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(scoreBatch(as('s2'), { ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null } }));
  });
  it('【R-21b】撤回窗口內不能接手（避免搶撤回）', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    await assertFails(setDoc(doc(as('s2'), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 }));
  });
  it('【R-22】同一目標第二次作廢（voids 已存在）', async () => {
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    // 想再扣一次：比分改不下去（0 -1）以外，標記已存在也擋；這裡讓比分合法（先補一顆）再試
    await patchMatch('cp_pub', { score: { home: 1, away: 0 } });
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    // 不帶標記也一樣被拒
    await assertFails(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } } }));
  });
  it('【R-23】作廢扣錯邊（主隊進球卻扣客隊）', async () => {
    await patchMatch('cp_pub', { score: { home: 1, away: 1 } });
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 1, away: 0 } }, withVoid: true }));
  });
  it('【R-24】作廢未來序號、作廢自己（targetSeq >= seq）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 9 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 4 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
  });
  it('【R-25】作廢標記未同批建立', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } } }));
  });
  it('【R-25b】作廢標記單獨建立、或標記指向別的序號', async () => {
    const db = as('s1');
    await assertFails(setDoc(doc(db, 'competitions/cp_pub/matches/mt_1/voids/2'), { seq: 4, createdAt: serverTimestamp() }));
    await assertFails(scoreBatch(db, {
      ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true, voidId: '3'
    }));
  });
  it('【R-26】接手者非本場指派（sother、過期 sx、空 matchIds se、一般會員、主辦本人）', async () => {
    for (const u of ['sother', 'sx', 'se', 'host']) {
      await assertFails(setDoc(doc(as(u), 'competitions/cp_pub/matches/mt_1/control/scorer'),
        { uid: u, takenAt: serverTimestamp(), sid: SID_S2 }));
    }
    await assertFails(setDoc(doc(clientDb(null), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 'x', takenAt: serverTimestamp(), sid: SID_S2 }));
  });
  it('【R-26b】接手寫別人的 uid、takenAt 非伺服器時間、多帶欄位', async () => {
    const db = as('s2');
    const p = 'competitions/cp_pub/matches/mt_1/control/scorer';
    await assertFails(setDoc(doc(db, p), { uid: 's1x', takenAt: serverTimestamp(), sid: SID_S2 }));
    await assertFails(setDoc(doc(db, p), { uid: 's2', takenAt: CTimestamp.now(), sid: SID_S2 }));
    await assertFails(setDoc(doc(db, p), { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2, note: 1 }));
  });
  it('【R-27】用戶端改 result、standings、summary', async () => {
    const db = as('s1');
    await assertFails(scoreBatch(db, { ev: goal('home'), patch: { score: { home: 2, away: 0 }, result: { winner: 'home' } } }));
    await assertFails(setDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A'), { rows: [1] }));
    await assertFails(setDoc(doc(db, 'competitions/cp_pub/summary/d1'), { matches: {} }));
    await assertFails(setDoc(doc(as('admin', 'admin'), 'competitions/cp_pub/standings/x'), { rows: [] }));
  });
  it('【R-28】內部賽事非管理員且非測試者：記分與接手都拒', async () => {
    await assertFails(setDoc(doc(as('stranger'), 'competitions/cp_int/matches/mt_1/control/scorer'),
      { uid: 'stranger', takenAt: serverTimestamp(), sid: SID_S1 }));
    await setCurrentScorer('cp_int', 'stranger');
    await assertFails(scoreBatch(as('stranger'), { cid: 'cp_int', ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' } }));
  });
  it('【R-29】timeline 沒有 update／delete 路徑；場次不能 create／delete', async () => {
    const db = as('s1');
    await assertFails(updateDoc(doc(db, 'competitions/cp_pub/matches/mt_1/timeline/e2'), { voided: true }));
    await assertFails(setDoc(doc(db, 'competitions/cp_pub/matches/mt_9'), { status: 'live' }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'competitions/cp_pub/matches/mt_1/timeline/e2')));
    await assertFails(deleteDoc(doc(db, 'competitions/cp_pub/matches/mt_1')));
  });
  it('【R-30】狀態轉換非法（開賽事件但場次已進行中、續賽但不在半場、未登入）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'kickoff' }, patch: { status: 'live' } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'resume' }, patch: { status: 'live' } }));
    await assertFails(scoreBatch(clientDb(null), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-31】未來時效：指派 expiresAt 在未來仍有效（對照 R-02）', async () => {
    await adminDb().doc('competitions/cp_pub/staff/sx').set({ roles: ['scorer'], matchIds: ['mt_1'], expiresAt: later(600) });
    await setCurrentScorer('cp_pub', 'sx');
    await assertSucceeds(scoreBatch(as('sx'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
it('【R-32】場次進行中但 lock.locked 為 true：進球被拒（真正測到鎖，Opus 終審 P1-B／G5）', async () => {
    await patchMatch('cp_pub', { lock: { locked: true } });
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
  });
  it('【R-33】rev 退回既有事件序號重播（只改 rev＝2、主隊 +1、不寫事件）被拒（G1）', async () => {
    const db = as('s1'); const b = writeBatch(db);
    b.update(doc(db, 'competitions/cp_pub/matches/mt_1'), { rev: 2, updatedAt: serverTimestamp(), score: { home: 2, away: 0 } });
    await assertFails(b.commit());
  });
  it('【R-34】事件事先存在（例如重置後殘留 e4）：只改場次不能套用其效果（P1-A：進球與作廢）', async () => {
    await adminDb().doc('competitions/cp_pub/matches/mt_1/timeline/e4').set(
      { seq: 4, type: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1, createdAt: ago(5) });
    await assertFails(scoreBatch(as('s1'), { skipEvent: true, ev: goal('home'), patch: { score: { home: 2, away: 0 } } }));
    await adminDb().doc('competitions/cp_pub/matches/mt_1/timeline/e4').set(
      { seq: 4, type: 'void', targetSeq: 2, matchSecond: 1, createdAt: ago(5) });
    await assertFails(scoreBatch(as('s1'), { skipEvent: true, ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } } }));
  });
  it('【R-35】合法作廢同批多建別的標記（voids/5、voids/02）被拒（G2、G3）', async () => {
    for (const extra of ['5', '02']) {
      const db = as('s1'); const M = 'competitions/cp_pub/matches/mt_1'; const b = writeBatch(db);
      b.update(doc(db, M), { rev: 4, updatedAt: serverTimestamp(), score: { home: 0, away: 0 } });
      b.set(doc(db, `${M}/timeline/e4`), { seq: 4, type: 'void', targetSeq: 2, matchSecond: 1, createdAt: serverTimestamp(), sid: SID_S1, op: OP_OK });
      b.set(doc(db, `${M}/voids/2`), { seq: 4, createdAt: serverTimestamp() });
      b.set(doc(db, `${M}/voids/${extra}`), { seq: 4, createdAt: serverTimestamp() });
      await assertFails(b.commit());
    }
  });
  it('【R-36】已確認場次不能接手（G4）', async () => {
    await patchMatch('cp_pub', { status: 'confirmed', lock: { locked: true }, finishedAt: ago(9999) });
    await assertFails(setDoc(doc(as('s2'), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 }));
  });
  it('【R-37】plId 不是 pl_ 格式（任意文字／個資）被拒（P2-1）', async () => {
    await assertFails(scoreBatch(as('s1'), { ev: goal('home', { plId: '王小明0912' }), patch: { score: { home: 2, away: 0 } } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'x', cardType: 'red' } }));
    await assertFails(scoreBatch(as('s1'), { ev: { type: 'sub', side: 'home', inPlId: 'pl_3', outPlId: 'bad id' } }));
  });
  it('【R-38】score 超出範圍（100）被拒', async () => {
    await patchMatch('cp_pub', { score: { home: 99, away: 0 } });
    await assertFails(scoreBatch(as('s1'), { ev: goal('home'), patch: { score: { home: 100, away: 0 } } }));
  });
});
