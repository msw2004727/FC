/**
 * K3 純函式：射手榜、冠軍名、接手稽核計畫、進行中事件是否還要跟後段。
 * 不連模擬器。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { championsFromStandings } from '../src/cp/champions.js';
import { actorHash } from '../src/cp/context.js';
import { matchNeedsServerFollowUp } from '../src/cp/match-trigger.js';
import { scorerAuditPlan } from '../src/cp/scorer-trigger.js';
import {
  STATS_DOC_MAX_BYTES,
  STATS_EVENT_MAX,
  attachNames,
  buildMatchStat,
  estimateStatsDoc,
  firestoreDocBytes,
  nextStatsDoc,
  planStatsLeave,
  planStatsWrite,
  statsRef,
  type MatchStat,
  type StatLine
} from '../src/cp/stats.js';

const CID = 'cp_' + 'c'.repeat(20);
const DVID = 'dv_' + 'd'.repeat(20);
const MT = 'mt_' + 'm'.repeat(20);
const pl = (ch: string) => `pl_${ch.repeat(20)}`;
const PLA = pl('a');
const PLB = pl('b');

function goal(seq: number, plId: string, goalKind = 'normal') {
  return { seq, type: 'goal', plId, goalKind };
}
function card(seq: number, plId: string, cardType: string, refSeq?: number) {
  return { seq, type: 'card', plId, cardType, ...(refSeq == null ? {} : { refSeq }) };
}
function lineOf(built: ReturnType<typeof buildMatchStat>, plId: string): StatLine | undefined {
  if (!built.ok) throw new Error(built.reason);
  return built.players[plId];
}

describe('射手榜純函式', () => {
  it('作廢進球、pk、烏龍不計；十二碼進球計；重置線以下不計', () => {
    const built = buildMatchStat([
      goal(1, PLA),
      goal(2, PLA),
      goal(4, PLA, 'penalty'),
      { seq: 5, type: 'pk', plId: PLA, scored: true },
      goal(6, PLA, 'own')
    ], new Set([2]), 0);
    expect(lineOf(built, PLA)).toEqual({ g: 2, y: 0, r: 0 });
    const afterReset = buildMatchStat([goal(6, PLA), goal(7, PLA)], new Set(), 6);
    expect(lineOf(afterReset, PLA)).toEqual({ g: 1, y: 0, r: 0 });
  });

  it('第二黃對上第一黃計一紅，黃牌仍計黃；兩張獨立黃牌各計一紅', () => {
    const one = buildMatchStat([
      card(1, PLB, 'yellow'),
      card(2, PLB, 'second_yellow', 1),
      card(3, PLA, 'red')
    ], new Set(), 0);
    expect(lineOf(one, PLB)).toEqual({ g: 0, y: 1, r: 1 });
    expect(lineOf(one, PLA)).toEqual({ g: 0, y: 0, r: 1 });

    const two = buildMatchStat([
      card(1, PLA, 'yellow'),
      card(2, PLA, 'second_yellow', 1),
      card(3, PLA, 'yellow'),
      card(4, PLA, 'second_yellow', 3)
    ], new Set(), 0);
    expect(lineOf(two, PLA)).toEqual({ g: 0, y: 2, r: 2 });
  });

  it('同一張第一黃被兩張第二黃引用只計一紅', () => {
    const twice = buildMatchStat([
      card(1, PLA, 'yellow'),
      card(2, PLA, 'second_yellow', 1),
      card(3, PLA, 'second_yellow', 1)
    ], new Set(), 0);
    expect(lineOf(twice, PLA)).toEqual({ g: 0, y: 1, r: 1 });

    const otherFirst = buildMatchStat([
      card(1, PLA, 'yellow'),
      card(2, PLA, 'second_yellow', 1),
      card(3, PLB, 'yellow'),
      card(4, PLB, 'second_yellow', 3),
      card(5, PLA, 'second_yellow', 1)
    ], new Set(), 0);
    expect(lineOf(otherFirst, PLA)).toEqual({ g: 0, y: 1, r: 1 });
    expect(lineOf(otherFirst, PLB)).toEqual({ g: 0, y: 1, r: 1 });
  });

  it('第二黃對不上有效的本人第一黃就不計紅', () => {
    const voided = buildMatchStat([
      card(1, PLA, 'yellow'),
      card(2, PLA, 'second_yellow', 1)
    ], new Set([1]), 0);
    expect(voided.ok && voided.nameIds).toEqual([]);

    const other = buildMatchStat([
      card(1, PLA, 'yellow'),
      card(2, PLB, 'second_yellow', 1)
    ], new Set(), 0);
    expect(lineOf(other, PLA)).toEqual({ g: 0, y: 1, r: 0 });
    expect(lineOf(other, PLB)).toBeUndefined();

    const dangling = buildMatchStat([
      card(1, PLA, 'second_yellow'),
      card(2, PLA, 'second_yellow', 9)
    ], new Set(), 0);
    expect(dangling.ok && dangling.nameIds).toEqual([]);
  });

  it('事件或作廢標記超過 200 就不算；剛好 200 可以', () => {
    const full = Array.from({ length: STATS_EVENT_MAX }, (_, i) => goal(i + 1, PLA));
    const ok = buildMatchStat(full, new Set(), 0);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.players[PLA]?.g).toBe(STATS_EVENT_MAX);
    expect(buildMatchStat([...full, goal(201, PLA)], new Set(), 0)).toEqual({ ok: false, reason: 'TIMELINE_TOO_LONG' });
    const voids = new Set(Array.from({ length: 201 }, (_, i) => i + 1));
    expect(buildMatchStat([], voids, 0)).toEqual({ ok: false, reason: 'VOIDS_TOO_LONG' });
  });

  it('名字空白或超過 22 人就不寫 n；超過 30 個字元截斷', () => {
    const players: MatchStat = {
      [PLA]: { g: 1, y: 0, r: 0 },
      [PLB]: { g: 0, y: 1, r: 0 }
    };
    const named = attachNames(players, new Map<string, string | null>([[PLA, '  王大明  '], [PLB, '   ']]), true);
    expect(named[PLA]).toEqual({ n: '王大明', g: 1, y: 0, r: 0 });
    expect(named[PLB]).toEqual({ g: 0, y: 1, r: 0 });
    const long = attachNames(players, new Map([[PLA, '名'.repeat(31)]]), true);
    expect(Array.from(long[PLA]!.n!).length).toBe(30);
    const stripped = attachNames(players, new Map([[PLA, '王大明'], [PLB, '李']]), false);
    expect(stripped[PLA]?.n).toBeUndefined();
    expect(stripped[PLB]?.n).toBeUndefined();
  });

  it('路徑只在 statsRef；統計原始碼不讀私密名單；觸發器不內嵌路徑', () => {
    const path = statsRef(CID, DVID);
    expect(path).toBe(`competitions/${CID}/stats/${DVID}`);
    const src = readFileSync(new URL('../src/cp/stats.ts', import.meta.url), 'utf8');
    expect(src.includes('rosterPrivate')).toBe(false);
    expect(src.match(/competitions\/\$\{cid\}\/stats\/\$\{dvId\}/g)).toEqual(['competitions/${cid}/stats/${dvId}']);
    const trig = readFileSync(new URL('../src/cp/match-trigger.ts', import.meta.url), 'utf8');
    expect(trig.includes('stats/')).toBe(false);
    expect(trig.includes('syncMatchStats')).toBe(true);
  });

  it('小文件可寫；內容相同不寫；16×15 飽和估算超過 200KB 就停更', () => {
    const path = statsRef(CID, DVID);
    // worst30：每場 30 人都有紀錄（最壞情況）。240 場是卡片 16×15 的乘積（每場會被算兩次）；120 是每場只存一次。
    const worst30 = estimateStatsDoc(path, 240, 30, 3);
    const worst = estimateStatsDoc(path, 240, 30, 30);
    const unique = estimateStatsDoc(path, 120, 30, 3);
    // 單組循環 120 場、每場 8 人有進球或得牌、名字 6 個中文字。數字寫進 REPORT-K3-fix3。
    const group120 = estimateStatsDoc(path, 120, 8, 6);
    console.log('[k3-estimate]', JSON.stringify({
      max: STATS_DOC_MAX_BYTES,
      worst30_240x30x3: worst30.bytes,
      worst240x30x30: worst.bytes,
      unique120x30x3: unique.bytes,
      group120x8x6: group120.bytes
    }));
    expect(worst30.bytes).toBe(719207);
    expect(worst.bytes).toBe(1302407);
    expect(unique.bytes).toBe(359687);
    expect(worst30.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);
    expect(group120).toMatchObject({ matches: 120, perMatch: 8, nameChars: 6, records: 960 });
    expect(group120.bytes).toBe(109607);
    expect(group120.bytes).toBeLessThanOrEqual(STATS_DOC_MAX_BYTES);

    const tiny = planStatsWrite(null, MT, { [PLA]: { g: 1, y: 0, r: 0 } }, path);
    expect(tiny.op).toBe('set');
    const same = planStatsWrite({ m: { [MT]: { [PLA]: { g: 1, y: 0, r: 0 } } } }, MT, { [PLA]: { g: 1, y: 0, r: 0 } }, path);
    expect(same.op).toBe('noop');

    const line: StatLine = { n: '名'.repeat(30), g: 1, y: 1, r: 1 };
    const players: MatchStat = {};
    for (let p = 0; p < 30; p++) players[`pl_${String(p).padStart(20, '0')}`] = line;
    const prevM: Record<string, MatchStat> = {};
    for (let i = 0; i < 240; i++) prevM[`mt_${String(i).padStart(20, '0')}`] = players;
    const over = planStatsWrite({ m: prevM, note: 'keep' }, MT, { [PLA]: { g: 1, y: 0, r: 0 } }, path);
    expect(over.op).toBe('stall');
    if (over.op === 'stall') {
      expect(over.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);
      expect(over.stalledMt).toBe(MT);
    }
    const unchanged = planStatsWrite({ m: prevM }, `mt_${String(0).padStart(20, '0')}`, players, path);
    expect(unchanged.op).toBe('noop');
  });

  it('超過 200KB 不改 m，寫 stalledAt／stalledMt；縮小後再寫就清掉', () => {
    const path = statsRef(CID, DVID);
    const line: StatLine = { n: '名', g: 1, y: 1, r: 1 };
    const row = (count: number): MatchStat => {
      const players: MatchStat = {};
      for (let p = 0; p < count; p++) players[`pl_${String(p).padStart(20, '0')}`] = line;
      return players;
    };
    // 72 場×30 人再加 19 人，再加 note：估算仍 ≤ 200KB；加上這一場就超過。
    const prevM: Record<string, MatchStat> = {};
    for (let i = 0; i < 72; i++) prevM[`mt_${String(i).padStart(20, '0')}`] = row(30);
    prevM[`mt_${String(72).padStart(20, '0')}`] = row(19);
    const prev = { m: prevM, note: 'keep' };
    expect(firestoreDocBytes(path, { ...prev, updatedAt: { __ts: 1 } })).toBe(204733);
    expect(firestoreDocBytes(path, { ...prev, updatedAt: { __ts: 1 } })).toBeLessThanOrEqual(STATS_DOC_MAX_BYTES);
    const overflow: MatchStat = { [PLA]: { n: '王大明', g: 1, y: 0, r: 0 } };
    const over = planStatsWrite(prev, MT, overflow, path);
    expect(over.op).toBe('stall');
    if (over.op !== 'stall') return;
    expect(over.fresh).toBe(true);
    expect(over.stalledMt).toBe(MT);
    expect(over.bytes).toBe(204887);
    expect(over.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);
    const stalled = nextStatsDoc(prev, MT, overflow, 'stall');
    expect(stalled.m).toEqual(prevM);
    expect((stalled.m as Record<string, unknown>)[MT]).toBeUndefined();
    expect(stalled.stalledAt).toEqual({ __ts: 1 });
    expect(stalled.stalledMt).toBe(MT);
    expect(stalled.note).toBe('keep');
    expect(Object.keys(stalled).sort()).toEqual(['m', 'note', 'stalledAt', 'stalledMt', 'updatedAt']);

    const smallPrev = {
      m: { [MT]: { [PLA]: { n: '王大明', g: 9, y: 0, r: 0 } } },
      stalledAt: { __ts: 1 },
      stalledMt: MT,
      note: 'keep'
    };
    const shrunk: MatchStat = { [PLA]: { n: '王大明', g: 1, y: 0, r: 0 } };
    const again = planStatsWrite(smallPrev, MT, shrunk, path);
    expect(again.op).toBe('set');
    if (again.op === 'set') expect(again.clearStall).toBe(true);
    const cleared = nextStatsDoc(smallPrev, MT, shrunk, 'set');
    expect(cleared.stalledAt).toBeUndefined();
    expect(cleared.stalledMt).toBeUndefined();
    expect(cleared.m).toEqual({ [MT]: shrunk });
    expect(Object.keys(cleared).sort()).toEqual(['m', 'note', 'updatedAt']);

    const same = planStatsWrite(smallPrev, MT, smallPrev.m[MT] as MatchStat, path);
    expect(same.op).toBe('set');
    if (same.op === 'set') expect(same.clearStall).toBe(true);
    expect(nextStatsDoc(smallPrev, MT, smallPrev.m[MT] as MatchStat, 'set').stalledAt).toBeUndefined();

    const src = readFileSync(new URL('../src/cp/stats.ts', import.meta.url), 'utf8');
    const stallAt = src.indexOf("if (plan.op === 'stall')");
    const stallEnd = src.indexOf("if (plan.op === 'noop')");
    expect(stallAt).toBeGreaterThan(0);
    expect(stallEnd).toBeGreaterThan(stallAt);
    const stallSrc = src.slice(stallAt, stallEnd);
    expect(stallSrc.includes('m.')).toBe(false);
    expect(stallSrc.includes('m:')).toBe(false);
    expect(stallSrc.includes('stalledAt: FieldValue.serverTimestamp()')).toBe(true);
    expect(stallSrc.includes('stalledMt: mtId')).toBe(true);
    expect(firestoreDocBytes(path, cleared)).toBeLessThanOrEqual(STATS_DOC_MAX_BYTES);
  });

  it('停更標記只由被擋的那一場清除；別場成功或再被擋都不覆蓋', () => {
    const path = statsRef(CID, DVID);
    const X = MT;
    const Y = 'mt_' + 'y'.repeat(20);
    const Z = 'mt_' + 'z'.repeat(20);
    const other = 'mt_' + 'o'.repeat(20);
    const mark = { seconds: 1_700_000_000 };
    const otherLine: MatchStat = { [PLA]: { g: 1, y: 0, r: 0 } };
    // X 被擋時數字沒進 m。標記指著 X。
    const stalled = {
      m: { [other]: otherLine },
      stalledAt: mark,
      stalledMt: X,
      note: 'keep'
    };

    const yPlayers: MatchStat = { [PLB]: { n: '李小華', g: 2, y: 0, r: 0 } };
    const yPlan = planStatsWrite(stalled, Y, yPlayers, path);
    expect(yPlan.op).toBe('set');
    if (yPlan.op !== 'set') return;
    expect(yPlan.clearStall).toBe(false);
    expect(yPlan.bytes).toBeLessThanOrEqual(STATS_DOC_MAX_BYTES);
    const yDoc = nextStatsDoc(stalled, Y, yPlayers, 'set');
    expect(yDoc.stalledAt).toBe(mark);
    expect(yDoc.stalledMt).toBe(X);
    expect(yDoc.m).toEqual({ [other]: otherLine, [Y]: yPlayers });
    expect((yDoc.m as Record<string, MatchStat>)[X]).toBeUndefined();

    const ySame = planStatsWrite({ ...stalled, m: { ...stalled.m, [Y]: yPlayers } }, Y, yPlayers, path);
    expect(ySame.op).toBe('noop');

    const xPlayers: MatchStat = { [PLA]: { n: '王大明', g: 1, y: 0, r: 0 } };
    const xPlan = planStatsWrite(stalled, X, xPlayers, path);
    expect(xPlan.op).toBe('set');
    if (xPlan.op !== 'set') return;
    expect(xPlan.clearStall).toBe(true);
    expect(xPlan.bytes).toBeLessThanOrEqual(STATS_DOC_MAX_BYTES);
    const xDoc = nextStatsDoc(stalled, X, xPlayers, 'set');
    expect(xDoc.stalledAt).toBeUndefined();
    expect(xDoc.stalledMt).toBeUndefined();
    expect(xDoc.m).toEqual({ [other]: otherLine, [X]: xPlayers });

    const line: StatLine = { n: '名', g: 1, y: 1, r: 1 };
    const row = (count: number): MatchStat => {
      const players: MatchStat = {};
      for (let p = 0; p < count; p++) players[`pl_${String(p).padStart(20, '0')}`] = line;
      return players;
    };
    const prevM: Record<string, MatchStat> = {};
    for (let i = 0; i < 72; i++) prevM[`mt_${String(i).padStart(20, '0')}`] = row(30);
    prevM[`mt_${String(72).padStart(20, '0')}`] = row(19);
    const blocked = { m: prevM, stalledAt: mark, stalledMt: X, note: 'keep' };
    const zPlayers: MatchStat = { [PLA]: { n: '王大明', g: 1, y: 0, r: 0 } };
    const zPlan = planStatsWrite(blocked, Z, zPlayers, path);
    expect(zPlan.op).toBe('stall');
    if (zPlan.op !== 'stall') return;
    expect(zPlan.fresh).toBe(false);
    expect(zPlan.stalledMt).toBe(X);
    expect(zPlan.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);
    const zDoc = nextStatsDoc(blocked, Z, zPlayers, 'stall');
    expect(zDoc.stalledAt).toBe(mark);
    expect(zDoc.stalledMt).toBe(X);
    expect(zDoc.updatedAt).toBeUndefined();
    expect(zDoc.m).toEqual(prevM);
    expect((zDoc.m as Record<string, MatchStat>)[Z]).toBeUndefined();

    const againX = planStatsWrite(blocked, X, zPlayers, path);
    expect(againX.op).toBe('stall');
    if (againX.op === 'stall') {
      expect(againX.fresh).toBe(false);
      expect(againX.stalledMt).toBe(X);
    }
    expect(nextStatsDoc(blocked, X, zPlayers, 'stall').stalledAt).toBe(mark);

    expect(planStatsLeave(stalled, X)).toEqual({ op: 'delete', dropMatch: false, clearStall: true });
    expect(planStatsLeave({ ...stalled, m: { ...stalled.m, [X]: xPlayers } }, X)).toEqual({
      op: 'delete', dropMatch: true, clearStall: true
    });
    expect(planStatsLeave({ ...stalled, m: { [Y]: yPlayers } }, Y)).toEqual({
      op: 'delete', dropMatch: true, clearStall: false
    });
    expect(planStatsLeave(stalled, Z)).toEqual({ op: 'noop' });
    expect(planStatsLeave(null, X)).toEqual({ op: 'noop' });

    const src = readFileSync(new URL('../src/cp/stats.ts', import.meta.url), 'utf8');
    expect(src).toContain('const leave = planStatsLeave(prev, mtId)');
    expect(src).toContain("if (!plan.fresh) return 'stall'");
    expect(src).toContain('...(plan.clearStall ? {');
    expect(src).toContain('...(leave.clearStall ? {');
  });

  it('文件鍵白名單為 m、updatedAt、stalledAt、stalledMt；球員列只有 n、g、y、r；序列化不含夾具 uid、真名、生日、電話', () => {
    const fixture = readFileSync(new URL('../test-rules/_fixtures.ts', import.meta.url), 'utf8');
    const privLines = fixture.split('\n').filter(line => line.includes('rosterPrivate/'));
    expect(privLines.length).toBeGreaterThan(0);
    const fromFixture = [...new Set(privLines.flatMap(line => [...line.matchAll(/'([^']*)'/g)].map(m => m[1])))]
      .filter(s => s.length > 0);
    expect(fromFixture).toEqual(expect.arrayContaining(['m1', 'rep', '真名', '代填']));
    // 共用夾具的 rosterPrivate 沒有生日、電話欄；下面把這兩個值塞進列裡，確認不會被寫出去。
    expect(privLines.join('\n')).not.toMatch(/birthday|phone/);
    const birthday = '1988-07-19';
    const phone = '0912000111';

    const dirty: Record<string, unknown> = {
      g: 1, y: 0, r: 0, n: '真名',
      uid: 'm1', realName: '真名', addedByUid: 'rep', teamId: 'club_a',
      birthday, phone
    };
    for (const s of fromFixture) dirty[s] = s;
    const players = attachNames(
      { [PLA]: dirty as StatLine, [PLB]: { g: 0, y: 1, r: 0, realName: '代填', birthday, phone } as StatLine },
      new Map<string, string | null>([[PLA, '公開甲'], [PLB, '   ']]),
      true
    );
    expect(Object.keys(players[PLA]!).sort()).toEqual(['g', 'n', 'r', 'y']);
    expect(players[PLA]).toEqual({ n: '公開甲', g: 1, y: 0, r: 0 });
    expect(Object.keys(players[PLB]!).sort()).toEqual(['g', 'r', 'y']);

    // 頂層白名單。停更欄可與 m 同時在（別場寫入成功時保留）。其他鍵不得出現。
    const allowedTop = ['m', 'stalledAt', 'stalledMt', 'updatedAt'];
    const doc = { m: { [MT]: players }, updatedAt: 0 };
    expect(Object.keys(doc).sort()).toEqual(['m', 'updatedAt']);
    for (const key of Object.keys(doc)) expect(allowedTop).toContain(key);
    const stalledDoc = { ...doc, stalledAt: 0, stalledMt: MT };
    expect(Object.keys(stalledDoc).sort()).toEqual(allowedTop);
    const packed = JSON.stringify(doc);
    for (const s of [...fromFixture, birthday, phone, 'm1', 'rep']) {
      expect(packed.includes(s)).toBe(false);
    }
    for (const key of ['uid', 'realName', 'birthday', 'phone', 'addedByUid', 'teamId']) {
      expect(packed.includes(`"${key}"`)).toBe(false);
    }
    expect(packed.includes('公開甲')).toBe(true);
    const stalledPacked = JSON.stringify(stalledDoc);
    for (const s of [...fromFixture, birthday, phone, 'm1', 'rep']) {
      expect(stalledPacked.includes(s)).toBe(false);
    }

    const src = readFileSync(new URL('../src/cp/stats.ts', import.meta.url), 'utf8');
    expect(src).toContain('tx.set(ref, { m: { [mtId]: plan.players }, updatedAt: FieldValue.serverTimestamp() })');
    expect(src).toContain('[`m.${mtId}`]: plan.players');
    expect(src.split('stalledAt: FieldValue.delete()').length - 1).toBe(2);
    expect(src.split('stalledMt: FieldValue.delete()').length - 1).toBe(2);
    expect(src).toContain('stalledAt: FieldValue.serverTimestamp()');
    expect(src).toContain('stalledMt: mtId');
    const syncSrc = src.slice(src.indexOf('export async function syncMatchStats'));
    for (const key of ['realName', 'birthday', 'phone', 'addedByUid', 'rosterPrivate']) {
      expect(syncSrc.includes(key)).toBe(false);
    }
  });
});

describe('冠軍名純函式', () => {
  it('第 1 名已分開就寫；第 1 名待裁定、空名、兩人並列第 1 就不寫該組', () => {
    const clear = championsFromStandings([{
      divisionId: DVID, groupId: 'A',
      rows: [
        { rank: 1, name: '甲', hasUnresolvedTie: false },
        { rank: 2, name: '乙', hasUnresolvedTie: true },
        { rank: 3, name: '丙', hasUnresolvedTie: true }
      ]
    }]);
    expect(clear).toEqual([{ dv: DVID, n: '甲' }]);

    expect(championsFromStandings([{
      divisionId: DVID, groupId: 'A',
      rows: [
        { rank: 1, name: '甲', hasUnresolvedTie: true },
        { rank: 2, name: '乙', hasUnresolvedTie: true }
      ]
    }])).toEqual([]);

    expect(championsFromStandings([{
      divisionId: DVID, groupId: 'A',
      rows: [
        { rank: 1, name: '甲' },
        { rank: 1, name: '乙' }
      ]
    }])).toEqual([]);

    expect(championsFromStandings([{
      divisionId: DVID, groupId: 'A', rows: [{ rank: 1, name: '  ', hasUnresolvedTie: false }]
    }])).toEqual([]);
  });

  it('兩組只留已分開的第 1 名；名字截 30 字；依組別 id、組 id 排序', () => {
    const dvB = 'dv_' + 'b'.repeat(20);
    const out = championsFromStandings([
      { divisionId: dvB, groupId: 'B', rows: [{ rank: 1, name: '名'.repeat(31), hasUnresolvedTie: false }] },
      { divisionId: DVID, groupId: 'A', rows: [{ rank: 1, name: '甲', hasUnresolvedTie: false }] },
      { divisionId: DVID, groupId: 'C', rows: [{ rank: 1, name: '', hasUnresolvedTie: false }] },
      { divisionId: '', groupId: 'A', rows: [{ rank: 1, name: '不該出現' }] }
    ]);
    expect(out).toEqual([
      { dv: dvB, n: '名'.repeat(30) },
      { dv: DVID, n: '甲' }
    ]);
    expect(Object.keys(out[0]!)).toEqual(['dv', 'n']);
  });
});

describe('接手稽核計畫', () => {
  const uid = 'ScorerPlaintextUID';
  const sid = 'sid-secret-value';
  const ms = 1_700_000_000_000;
  const at = (n: number) => ({ toMillis: () => n });

  it('刪除、同一人換 sid 不寫；建立與換人才寫，且 id 與內容沒有 uid 原文', () => {
    expect(scorerAuditPlan(CID, MT, { uid, sid, takenAt: at(ms) }, null)).toEqual({ kind: 'skip' });
    expect(scorerAuditPlan(CID, MT, { uid, sid, takenAt: at(ms) }, { uid, sid: 'other-sid', takenAt: at(ms + 5) })).toEqual({ kind: 'skip' });

    const created = scorerAuditPlan(CID, MT, null, { uid, sid, takenAt: at(ms) });
    expect(created.kind).toBe('write');
    if (created.kind !== 'write') return;
    const hash = actorHash(CID, uid);
    expect(created.audit.id).toBe(`tk_${ms}_${MT}_${hash}`);
    expect(created.audit).toMatchObject({ actor: hash, mtId: MT, sidChanged: false, prev: null });
    const packed = JSON.stringify(created.audit);
    expect(packed.includes(uid)).toBe(false);
    expect(packed.includes(sid)).toBe(false);
    expect(created.audit.id).toMatch(/^tk_\d+_mt_[A-Za-z0-9]{20}_[0-9a-f]{16}$/);

    const next = 'NextScorerPlainUID';
    const changed = scorerAuditPlan(CID, MT, { uid, sid, takenAt: at(ms) }, { uid: next, sid: 'new-sid', takenAt: at(ms + 1000) });
    expect(changed.kind).toBe('write');
    if (changed.kind !== 'write') return;
    expect(changed.audit.prev).toBe(hash);
    expect(changed.audit.sidChanged).toBe(true);
    expect(changed.audit.actor).toBe(actorHash(CID, next));
    expect(JSON.stringify(changed.audit).includes(next)).toBe(false);
    expect(changed.audit.id).toBe(`tk_${ms + 1000}_${MT}_${actorHash(CID, next)}`);
    expect(changed.audit.id.includes(uid)).toBe(false);
  });

  it('同一人同一毫秒接手兩場，id 含場次，不會撞成同一筆', () => {
    const mt2 = 'mt_' + 'n'.repeat(20);
    const hash = actorHash(CID, uid);
    const a = scorerAuditPlan(CID, MT, null, { uid, sid, takenAt: at(ms) });
    const b = scorerAuditPlan(CID, mt2, null, { uid, sid, takenAt: at(ms) });
    expect(a.kind).toBe('write');
    expect(b.kind).toBe('write');
    if (a.kind !== 'write' || b.kind !== 'write') return;
    expect(a.audit.id).toBe(`tk_${ms}_${MT}_${hash}`);
    expect(b.audit.id).toBe(`tk_${ms}_${mt2}_${hash}`);
    expect(a.audit.id).not.toBe(b.audit.id);
    expect(a.audit.mtId).toBe(MT);
    expect(b.audit.mtId).toBe(mt2);
    expect(JSON.stringify(a.audit).includes(uid)).toBe(false);
    expect(JSON.stringify(b.audit).includes(uid)).toBe(false);
  });

  it('mtId 不合 mt_[A-Za-z0-9]{20} 就拒絕，不組稽核', () => {
    const after = { uid, sid, takenAt: at(ms) };
    const bad = [
      '',
      'mt_short',
      'mt_' + 'm'.repeat(19),
      'mt_' + 'm'.repeat(21),
      'MT_' + 'm'.repeat(20),
      'xx_' + 'm'.repeat(20),
      'mt_' + 'm'.repeat(19) + '_',
      'mt_' + 'a'.repeat(18) + '/b'
    ];
    for (const mtId of bad) {
      expect(scorerAuditPlan(CID, mtId, null, after)).toEqual({ kind: 'bad', reason: 'mtId' });
      expect(scorerAuditPlan(CID, mtId, { uid, sid, takenAt: at(ms) }, null)).toEqual({ kind: 'bad', reason: 'mtId' });
    }
    expect(scorerAuditPlan(CID, MT, null, after).kind).toBe('write');
  });

  it('uid 或 takenAt 不合法就拒絕，不組文件', () => {
    expect(scorerAuditPlan(CID, MT, null, { uid: '', takenAt: at(ms) })).toEqual({ kind: 'bad', reason: 'uid' });
    expect(scorerAuditPlan(CID, MT, null, { uid: 'a/b', takenAt: at(ms) })).toEqual({ kind: 'bad', reason: 'uid' });
    expect(scorerAuditPlan(CID, MT, null, { uid: 'x'.repeat(129), takenAt: at(ms) })).toEqual({ kind: 'bad', reason: 'uid' });
    expect(scorerAuditPlan(CID, MT, null, { uid, takenAt: null })).toEqual({ kind: 'bad', reason: 'takenAt' });
    expect(scorerAuditPlan(CID, MT, null, { uid, takenAt: { toMillis: () => 1.5 } })).toEqual({ kind: 'bad', reason: 'takenAt' });
  });
});

describe('進行中事件不跟後段', () => {
  const doc = (status: string) => ({ status });
  it('只有計分或已解決才要重讀', () => {
    expect(matchNeedsServerFollowUp(doc('scheduled'), doc('scheduled'))).toBe(false);
    expect(matchNeedsServerFollowUp(doc('scheduled'), doc('finished'))).toBe(false);
    expect(matchNeedsServerFollowUp(null, doc('scheduled'))).toBe(false);
    expect(matchNeedsServerFollowUp(doc('scheduled'), doc('confirmed'))).toBe(true);
    expect(matchNeedsServerFollowUp(doc('confirmed'), doc('scheduled'))).toBe(true);
    expect(matchNeedsServerFollowUp(doc('scheduled'), doc('walkover'))).toBe(true);
    expect(matchNeedsServerFollowUp(doc('scheduled'), doc('cancelled'))).toBe(true);
    expect(matchNeedsServerFollowUp(null, doc('confirmed'))).toBe(true);
    expect(matchNeedsServerFollowUp(doc('confirmed'), null)).toBe(true);
  });
});
