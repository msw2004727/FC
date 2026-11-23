/**
 * 記分路徑運算式預算 pad 量測（V5 作法常駐化，第 4 步卡 K1 的量測基準）。
 * ------------------------------------------------------------------
 * 作法：在 matchUpdateOk 與 takeoverOk 的 return 最前面插入 N 個恆真比較（每 25 個一組函式，
 * 避免單一運算式過長編譯失敗），逐級（0／25／50／75／100）重載 Rules，跑最重的通過案例。
 * 一個批次（場次 update＋事件 create＋作廢標記 create）共用 1000 個運算式，所以只墊在
 * matchUpdateOk 就涵蓋整批；接手是單獨請求，墊在 takeoverOk。
 * 門檻（plan §4）：PAD_FLOOR（25）以下所有通過案例都必須成功；K1 改 Rules 後同一檔重跑，
 * 報告附改前改後對照表（console 會印出每級結果與「預算耗盡」條數）。
 * 拒絕案例不在這裡：scoring.test.ts 的 assertFails 已把「預算耗盡」判為失敗，確保拒絕是被條件擋下。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, afterAll, afterEach, expect } from 'vitest';
import { doc, writeBatch, serverTimestamp, setDoc, Timestamp as CTimestamp, type Firestore } from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, ago, RULES_FILE } from './_harness.js';
import { seedBase, patchMatch, SID_S1, SID_S2, OP_OK, Timestamp } from './_fixtures.js';

export const PAD_FLOOR = 25;
// 基準（8cb7aeaaa，2026-11-19 實測）：批次類 60 全過、70 起進球／作廢／半場／終場／自撤回預算耗盡（黃牌 75 才耗盡）；
// 接手 75 過、100 耗盡。門檻 25 ⇒ K1 最多可再用約 35 個 pad 單位（約 100～140 個運算式）。
const LEVELS = [0, 25, 50, 60, 70, 75, 100];

// pad 單位與第 1 步 V5 量測相同：`request.resource.data.get('pX', i) == i`（約 3～4 個運算式，
// 讀請求內容、不能被常數化；`1 == 1` 這種常數比較實測 100 級仍全過，量不出餘裕）。
// broken = true 時最後一項故意不成立，用來證明 pad 真的插進評估路徑。
function padGroups(prefix: string, n: number, broken = false): { defs: string[]; call: string } {
  const defs: string[] = [];
  const calls: string[] = [];
  for (let g = 0; g * 25 < n; g++) {
    const terms: string[] = [];
    for (let i = g * 25; i < Math.min(n, (g + 1) * 25); i++) {
      const want = broken && i === n - 1 ? i + 2 : i + 1;
      terms.push(`request.resource.data.get('${prefix}_${i}', ${i + 1}) == ${want}`);
    }
    defs.push(`    function ${prefix}${g}() { return ${terms.join(' && ')}; }`);
    calls.push(`${prefix}${g}()`);
  }
  return { defs, call: calls.length ? calls.join(' && ') + ' && ' : '' };
}

/** 在指定函式的第一個 return 後插入 pad（K1 改寫函式內容後仍可用，只要函式名不變）。 */
export function paddedScoringRules(n: number, src = fs.readFileSync(RULES_FILE, 'utf8'), broken = false): string {
  let out = src;
  const allDefs: string[] = [];
  // 故意不成立時也要插進真正放行的函式：PK 改 penaltyScore 走 pkUpdateOk；
  // 只改 clockBase 的時鐘與停錶走 clockChangeUpdateOk。量測等級仍只墊 matchUpdateOk／takeoverOk，
  // 避免同一條路徑被墊兩次（matchUpdateOk 的 pad 在請求裡仍會先算）。
  const targets: [string, string][] = [['matchUpdateOk', 'cpPadM'], ['takeoverOk', 'cpPadT']];
  if (broken) {
    targets.push(['pkUpdateOk', 'cpPadP']);
    targets.push(['clockChangeUpdateOk', 'cpPadC']);
  }
  for (const [fn, prefix] of targets) {
    const re = new RegExp(`(function ${fn}\\(cid, mt\\) \\{[\\s\\S]*?return )`);
    if (!re.test(out)) throw new Error(`找不到 ${fn} 插入點`);
    const { defs, call } = padGroups(prefix, n, broken);
    allDefs.push(...defs);
    out = out.replace(re, `$1${call}`);
  }
  const anchor = '    function matchPath(cid, mt)';
  if (!out.includes(anchor)) throw new Error('找不到 pad 函式放置點');
  return out.replace(anchor, `${allDefs.join('\n')}\n${anchor}`);
}

type Ev = Record<string, unknown>;
function scoreBatch(db: Firestore, ev: Ev, patch: Record<string, unknown> = {}, opts: { fromRev?: number; withVoid?: number; cardLink?: string; cardLinkUpdate?: boolean } = {}) {
  const from = opts.fromRev ?? 3;
  const seq = from + 1;
  const base = 'competitions/cp_pub/matches/mt_1';
  const b = writeBatch(db);
  b.update(doc(db, base), { rev: seq, updatedAt: serverTimestamp(), ...patch });
  b.set(doc(db, `${base}/timeline/e${seq}`), { seq, matchSecond: 900, createdAt: serverTimestamp(), sid: SID_S1, op: OP_OK, ...ev });
  if (opts.withVoid != null) b.set(doc(db, `${base}/voids/${opts.withVoid}`), { seq, createdAt: serverTimestamp() });
  if (opts.cardLink) {
    const ref = doc(db, `${base}/cardLinks/${opts.cardLink}`);
    const body = { seq, createdAt: serverTimestamp() };
    if (opts.cardLinkUpdate) b.update(ref, body);
    else b.set(ref, body);
  }
  return b.commit();
}
const sy = (fromRev = 3, update = false) => scoreBatch(as('s1'),
  { type: 'card', side: 'away', plId: 'pl_9', cardType: 'second_yellow', refSeq: 3 },
  {}, { fromRev, cardLink: '3', cardLinkUpdate: update });
const as = (uid: string) => clientDb({ uid });

// 基準（_fixtures seedBase）：cp_pub/mt_1 進行中 1:0、rev 3；e2 主隊進球、e3 客隊黃牌；目前記分者 s1；s2 也被指派。
const PROBES: [string, () => Promise<unknown>][] = [
  ['進球', () => scoreBatch(as('s1'), { type: 'goal', side: 'home', plId: 'pl_1', goalKind: 'normal' }, { score: { home: 2, away: 0 } })],
  ['黃牌', () => scoreBatch(as('s1'), { type: 'card', side: 'home', plId: 'pl_1', cardType: 'yellow' })],
  ['作廢進球（三筆同批）', () => scoreBatch(as('s1'), { type: 'void', targetSeq: 2 }, { score: { home: 0, away: 0 } }, { withVoid: 2 })],
  ['作廢未被引用黃牌', () => scoreBatch(as('s1'), { type: 'void', targetSeq: 3 }, {}, { withVoid: 3 })],
  ['作廢紅牌', async () => {
    await scoreBatch(as('s1'), { type: 'card', side: 'home', plId: 'pl_1', cardType: 'red' });
    return scoreBatch(as('s1'), { type: 'void', targetSeq: 4 }, {}, { fromRev: 4, withVoid: 4 });
  }],
  ['第二黃（建連結）', () => sy()],
  ['第二黃作廢後再作廢第一黃', async () => {
    await sy();
    await scoreBatch(as('s1'), { type: 'void', targetSeq: 4 }, {}, { fromRev: 4, withVoid: 4 });
    return scoreBatch(as('s1'), { type: 'void', targetSeq: 3 }, {}, { fromRev: 5, withVoid: 3 });
  }],
  ['第二黃作廢後重新引用', async () => {
    await sy();
    await scoreBatch(as('s1'), { type: 'void', targetSeq: 4 }, {}, { fromRev: 4, withVoid: 4 });
    return sy(5, true);
  }],
  ['半場（改時鐘）', () => scoreBatch(as('s1'), { type: 'halftime' }, {
    status: 'halftime', clockBase: { startedAt: CTimestamp.now(), pausedSec: 0, running: false, period: 'ht' }
  })],
  ['終場', () => scoreBatch(as('s1'), { type: 'fulltime' }, { status: 'finished', lock: { locked: true }, finishedAt: serverTimestamp() })],
  ['自撤回', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: ago(30) });
    return scoreBatch(as('s1'), { type: 'undoFinish' }, { status: 'live', lock: { locked: false }, finishedAt: null });
  }],
  ['時鐘修正', () => scoreBatch(as('s1'), { type: 'clock' }, {
    clockBase: { startedAt: CTimestamp.now(), pausedSec: 30, running: true, period: 'h1' }
  })],
  ['球隊暫停（停錶）', async () => {
    const started = Timestamp.fromMillis(1_700_000_000_000);
    await patchMatch('cp_pub', {
      clockBase: { startedAt: started, pausedSec: 0, running: true, period: 'h1' }
    });
    return scoreBatch(as('s1'), { type: 'timeout', side: 'home' }, {
      clockBase: { startedAt: CTimestamp.fromMillis(1_700_000_000_000), pausedSec: 0, running: false, period: 'h1' }
    });
  }],
  ['球隊暫停（不停錶）', () => scoreBatch(as('s1'), { type: 'timeout', side: 'away' })],
  ['PK 開始', async () => {
    await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: null });
    return scoreBatch(as('s1'), { type: 'pkStart' }, {
      penaltyScore: { home: 0, away: 0 },
      clockBase: { startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'pk' }
    });
  }],
  ['PK 進', async () => {
    await patchMatch('cp_pub', {
      score: { home: 1, away: 1 }, penaltyScore: { home: 0, away: 0 },
      clockBase: { startedAt: Timestamp.now(), pausedSec: 2700, running: false, period: 'pk' }
    });
    return scoreBatch(as('s1'), { type: 'pk', side: 'home', plId: 'pl_1', scored: true }, { penaltyScore: { home: 1, away: 0 } });
  }],
  ['PK 沒進', async () => {
    await patchMatch('cp_pub', {
      score: { home: 1, away: 1 }, penaltyScore: { home: 0, away: 0 },
      clockBase: { startedAt: Timestamp.now(), pausedSec: 2700, running: false, period: 'pk' }
    });
    return scoreBatch(as('s1'), { type: 'pk', side: 'away', scored: false });
  }],
  ['作廢 PK 進', async () => {
    await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: null });
    await scoreBatch(as('s1'), { type: 'pkStart' }, {
      penaltyScore: { home: 0, away: 0 },
      clockBase: { startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'pk' }
    });
    await scoreBatch(as('s1'), { type: 'pk', side: 'home', plId: 'pl_1', scored: true }, { penaltyScore: { home: 1, away: 0 } }, { fromRev: 4 });
    return scoreBatch(as('s1'), { type: 'void', targetSeq: 5 }, { penaltyScore: { home: 0, away: 0 } }, { fromRev: 5, withVoid: 5 });
  }],
  ['作廢 PK 沒進', async () => {
    await patchMatch('cp_pub', { score: { home: 1, away: 1 }, penaltyScore: null });
    await scoreBatch(as('s1'), { type: 'pkStart' }, {
      penaltyScore: { home: 0, away: 0 },
      clockBase: { startedAt: CTimestamp.now(), pausedSec: 2700, running: false, period: 'pk' }
    });
    await scoreBatch(as('s1'), { type: 'pk', side: 'away', scored: false }, {}, { fromRev: 4 });
    return scoreBatch(as('s1'), { type: 'void', targetSeq: 5 }, {}, { fromRev: 5, withVoid: 5 });
  }],
  ['帶 sid 接手', () => setDoc(doc(as('s2'), 'competitions/cp_pub/matches/mt_1/control/scorer'), { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 })]
];

describe('pad 量測：記分路徑（第 4 步 K1 基準）', () => {
  const tmp = path.join(os.tmpdir(), `cp-scoring-pad-${process.pid}.rules`);
  afterEach(async () => { await closeClients(); });
  afterAll(async () => { fs.rmSync(tmp, { force: true }); await loadRules(); });

  async function runProbes(): Promise<Record<string, string>> {
    const row: Record<string, string> = {};
    for (const [label, run] of PROBES) {
      await clearDb();
      await seedBase();
      try {
        await run();
        row[label] = '過';
      } catch (e) {
        row[label] = /maximum of 1000/i.test(String((e as Error).message)) ? '預算耗盡' : '拒';
      }
      await closeClients();
    }
    return row;
  }

  it('插入點檢查：pad 最後一項故意不成立時，每個通過案例都被拒', async () => {
    fs.writeFileSync(tmp, paddedScoringRules(1, undefined, true), 'utf8');
    await loadRules(undefined, tmp);
    const row = await runProbes();
    expect(Object.entries(row).filter(([, v]) => v === '過'), 'pad 沒有插進評估路徑').toEqual([]);
  });

  const table: Record<number, Record<string, string>> = {};
  for (const n of LEVELS) {
    it(`pad ${n}`, async () => {
      fs.writeFileSync(tmp, paddedScoringRules(n), 'utf8');
      await loadRules(undefined, tmp);
      table[n] = await runProbes();
      // eslint-disable-next-line no-console
      console.log(`[scoring pad ${n}]`, JSON.stringify(table[n]));
      if (n <= PAD_FLOOR) {
        expect(Object.entries(table[n]).filter(([, v]) => v !== '過'), `pad ${n} 有通過案例失敗`).toEqual([]);
      }
    });
  }
});
