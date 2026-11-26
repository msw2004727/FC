/**
 * S1：賽事結束後禁止記分（compScorableData 加 `c.get('endedAt', null) == null`）。
 * 基準：cp_pub/mt_1 進行中 1:0、rev 3；e2 主隊進球、e3 客隊黃牌；目前記分者 s1；s2 也被指派。
 * 三種結束方式（endedBy host／auto／confirm）一律看 endedAt，不分 endedBy；記分員沒有寬限。
 * 拒絕案例沿用 harness 的 assertFails：預算耗盡不算被條件擋下。
 */
import { describe, it, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  doc, getDoc, getDocs, collection, limit, query, writeBatch, serverTimestamp, setDoc,
  Timestamp as CTimestamp, type Firestore
} from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, assertFails, assertSucceeds, adminDb, ago } from './_harness.js';
import { seedBase, patchMatch, SID_S1, SID_S2, OP_OK, Timestamp } from './_fixtures.js';

type Ev = Record<string, unknown>;
interface ScoreOpts {
  fromRev?: number; ev: Ev; patch?: Record<string, unknown>;
  withVoid?: boolean; cardLink?: { id: string; update?: boolean };
}
const M = 'competitions/cp_pub/matches/mt_1';
function scoreBatch(db: Firestore, o: ScoreOpts) {
  const from = o.fromRev ?? 3;
  const seq = from + 1;
  const b = writeBatch(db);
  b.update(doc(db, M), { rev: seq, updatedAt: serverTimestamp(), ...(o.patch ?? {}) });
  b.set(doc(db, `${M}/timeline/e${seq}`), { seq, matchSecond: 900, createdAt: serverTimestamp(), sid: SID_S1, op: OP_OK, ...o.ev });
  if (o.withVoid) b.set(doc(db, `${M}/voids/${String(o.ev.targetSeq)}`), { seq, createdAt: serverTimestamp() });
  if (o.cardLink) {
    const ref = doc(db, `${M}/cardLinks/${o.cardLink.id}`);
    const body = { seq, createdAt: serverTimestamp() };
    if (o.cardLink.update) b.update(ref, body);
    else b.set(ref, body);
  }
  return b.commit();
}
const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const pkClock = () => ({ startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'pk' });
const adminPkClock = () => ({ startedAt: Timestamp.now(), pausedSec: 2700, running: false, period: 'pk' });

// 四種動作（進球、時鐘、PK、接手）；PK 先把場次放到 PK 階段
const goal = () => scoreBatch(as('s1'), { ev: { type: 'goal', side: 'home', plId: 'pl_1', goalKind: 'normal' }, patch: { score: { home: 2, away: 0 } } });
const clockFix = () => scoreBatch(as('s1'), { ev: { type: 'clock' }, patch: { clockBase: { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'h1' } } });
async function pkPrep() {
  await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: { home: 0, away: 0 }, clockBase: adminPkClock() });
}
const pkScored = () => scoreBatch(as('s1'), { ev: { type: 'pk', side: 'home', plId: 'pl_1', scored: true }, patch: { penaltyScore: { home: 1, away: 0 } } });
const takeover = () => setDoc(doc(as('s2'), `${M}/control/scorer`), { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 });

async function endComp(endedBy: 'host' | 'auto' | 'confirm', endedAt: unknown = ago(60)) {
  await adminDb().doc('competitions/cp_pub').set({ endedAt, endedBy }, { merge: true });
}
async function unendComp() {
  await adminDb().doc('competitions/cp_pub').set({ endedAt: null, endedBy: null }, { merge: true });
}

beforeAll(async () => { await loadRules(); });
beforeEach(async () => { await clearDb(); await seedBase(); });
afterEach(async () => { await closeClients(); });

describe('S1 允許：未結束時四種動作照常', () => {
  it('【A1】endedAt 明寫 null：進球、時鐘修正、PK 進、接手都成功', async () => {
    await unendComp();
    await assertSucceeds(goal());
    await clearDb(); await seedBase(); await unendComp();
    await assertSucceeds(clockFix());
    await clearDb(); await seedBase(); await unendComp(); await pkPrep();
    await assertSucceeds(pkScored());
    await clearDb(); await seedBase(); await unendComp();
    await assertSucceeds(takeover());
  });
  it('【A1b】endedAt 明寫 null：作廢、半場、終場、撤回終場、PK 開始都成功', async () => {
    await unendComp();
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }));
    await assertSucceeds(scoreBatch(as('s1'), {
      fromRev: 4, ev: { type: 'halftime' },
      patch: { status: 'halftime', clockBase: { startedAt: CTimestamp.now(), pausedSec: 0, running: false, period: 'ht' } }
    }));
    await clearDb(); await seedBase(); await unendComp();
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() } }));
    await assertSucceeds(scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null } }));
    await clearDb(); await seedBase(); await unendComp();
    await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: null });
    await assertSucceeds(scoreBatch(as('s1'), { ev: { type: 'pkStart' }, patch: { penaltyScore: { home: 0, away: 0 }, clockBase: pkClock() } }));
  });
  it('【A2】賽事文件沒有 endedAt 鍵（舊文件）：進球成功', async () => {
    const snap = await adminDb().doc('competitions/cp_pub').get();
    if (snap.get('endedAt') !== undefined) throw new Error('種子不應含 endedAt 鍵');
    await assertSucceeds(goal());
  });
});

// 拒絕動作逐項一案：HEAD（未加 endedAt 條件）下每案都會「預期被拒卻成功」，證明拒絕來自 endedAt。
const DENY: Record<string, { prep?: () => Promise<unknown>; run: () => Promise<unknown> }> = {
  '進球': { run: goal },
  '時鐘修正': { run: clockFix },
  'PK 進': { prep: pkPrep, run: pkScored },
  '接手 update': { run: takeover },
  '接手 create（control/scorer 不存在）': { prep: () => adminDb().doc(`${M}/control/scorer`).delete(), run: takeover },
  '黃牌': { run: () => scoreBatch(as('s1'), { ev: { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' } }) },
  '作廢進球（voids 三筆同批）': { run: () => scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 2 }, patch: { score: { home: 0, away: 0 } }, withVoid: true }) },
  '作廢黃牌（voids 同批）': { run: () => scoreBatch(as('s1'), { ev: { type: 'void', targetSeq: 3 }, withVoid: true }) },
  '第二黃（cardLinks 三筆同批）': {
    run: () => scoreBatch(as('s1'), { ev: { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 }, cardLink: { id: '3' } })
  },
  '半場': {
    run: () => scoreBatch(as('s1'), {
      ev: { type: 'halftime' },
      patch: { status: 'halftime', clockBase: { startedAt: CTimestamp.now(), pausedSec: 0, running: false, period: 'ht' } }
    })
  },
  '終場': { run: () => scoreBatch(as('s1'), { ev: { type: 'fulltime' }, patch: { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() } }) },
  '撤回終場（180 秒內）': {
    prep: () => patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) }),
    run: () => scoreBatch(as('s1'), { ev: { type: 'undoFinish' }, patch: { status: 'live', lock: { locked: false }, finishedAt: null } })
  },
  '停錶（球隊暫停）': {
    prep: () => patchMatch('cp_pub', { clockBase: { startedAt: Timestamp.fromMillis(1_700_000_000_000), pausedSec: 0, running: true, period: 'h1' } }),
    run: () => scoreBatch(as('s1'), {
      ev: { type: 'timeout', side: 'home' },
      patch: { clockBase: { startedAt: CTimestamp.fromMillis(1_700_000_000_000), pausedSec: 0, running: false, period: 'h1' } }
    })
  },
  'PK 開始': {
    prep: () => patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: null }),
    run: () => scoreBatch(as('s1'), { ev: { type: 'pkStart' }, patch: { penaltyScore: { home: 0, away: 0 }, clockBase: pkClock() } })
  },
  '作廢 PK 進': {
    // e4 是已記的 PK 進（PK 1:0）
    prep: async () => {
      await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: { home: 1, away: 0 }, clockBase: adminPkClock(), rev: 4 });
      await adminDb().doc(`${M}/timeline/e4`).set({ seq: 4, type: 'pk', side: 'home', plId: 'pl_1', scored: true, matchSecond: 2700, createdAt: ago(10) });
    },
    run: () => scoreBatch(as('s1'), { fromRev: 4, ev: { type: 'void', targetSeq: 4 }, patch: { penaltyScore: { home: 0, away: 0 } }, withVoid: true })
  },
  'walkover 場次接手': { prep: () => patchMatch('cp_pub', { status: 'walkover', lock: { locked: true } }), run: takeover },
  'cancelled 場次接手': { prep: () => patchMatch('cp_pub', { status: 'cancelled', lock: { locked: true } }), run: takeover }
};
const CORE = ['進球', '時鐘修正', 'PK 進', '接手 update', '接手 create（control/scorer 不存在）'];
const PLAN: Record<'host' | 'auto' | 'confirm', string[]> = {
  host: Object.keys(DENY),
  auto: [...CORE, '終場'],
  confirm: CORE
};

for (const endedBy of ['host', 'auto', 'confirm'] as const) {
  // confirm 結束 1 小時（主辦 3 天寬限內）：記分員沒有寬限，一樣拒
  describe(`S1 拒絕：endedBy ${endedBy}${endedBy === 'confirm' ? '（3 天寬限內）' : ''}`, () => {
    for (const name of PLAN[endedBy]) {
      it(`【D】${name}`, async () => {
        const a = DENY[name];
        if (a.prep) await a.prep();
        await endComp(endedBy, endedBy === 'confirm' ? ago(3600) : ago(60));
        await assertFails(a.run());
      });
    }
  });
}

describe('S1 唯讀不受影響', () => {
  it('【A5】手動結束後記分員仍可讀 control/scorer、場次、timeline', async () => {
    await endComp('host');
    const db = as('s1');
    await assertSucceeds(getDoc(doc(db, `${M}/control/scorer`)));
    await assertSucceeds(getDoc(doc(db, M)));
    await assertSucceeds(getDocs(query(collection(db, `${M}/timeline`), limit(100))));
  });
});
describe('S1 拒絕：endedAt 型別奇怪', () => {

  it('【D6】endedAt 型別奇怪（字串）：當已結束，進球拒', async () => {
    await endComp('host', 'x');
    await assertFails(goal());
  });
});

describe('S1 恢復：endedAt 清掉後恢復允許', () => {
  it('【A3】管理員恢復（endedAt 改回 null）後：進球、接手都成功', async () => {
    await endComp('host');
    await assertFails(goal());
    await unendComp();
    await assertSucceeds(goal());
    await assertSucceeds(takeover());
  });
  it('【A4】末場確認結束後主辦重置、endedAt 被清掉：開賽成功（清掉前拒）', async () => {
    await endComp('confirm');
    // 主辦重置：場次回 scheduled、清 timeline（Callable 用 Admin 寫，這裡直接種）
    await patchMatch('cp_pub', { status: 'scheduled', score: { home: 0, away: 0 }, rev: 0, lock: { locked: false }, finishedAt: null });
    await adminDb().recursiveDelete(adminDb().collection(`${M}/timeline`));
    const kickoff = () => scoreBatch(as('s1'), { fromRev: 0, ev: { type: 'kickoff' }, patch: { status: 'live' } });
    await assertFails(kickoff());
    await unendComp();
    await assertSucceeds(kickoff());
  });
});
