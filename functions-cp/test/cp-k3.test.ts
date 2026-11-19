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

  it('小文件可寫；內容相同不寫；16×15 飽和估算超過 200KB 就拒絕', () => {
    const path = statsRef(CID, DVID);
    const typical = estimateStatsDoc(path, 240, 30, 3);
    const worst = estimateStatsDoc(path, 240, 30, 30);
    const unique = estimateStatsDoc(path, 120, 30, 3);
    // 數字寫進 REPORT-K3。240 場是卡片 16×15 的乘積（每場會被算兩次）；120 是每場只存一次。
    console.log('[k3-estimate]', JSON.stringify({
      max: STATS_DOC_MAX_BYTES,
      typical240x30x3: typical.bytes,
      worst240x30x30: worst.bytes,
      unique120x30x3: unique.bytes
    }));
    expect(typical.bytes).toBe(719207);
    expect(worst.bytes).toBe(1302407);
    expect(unique.bytes).toBe(359687);
    expect(typical.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);

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
    expect(over.op).toBe('reject');
    if (over.op === 'reject') expect(over.bytes).toBeGreaterThan(STATS_DOC_MAX_BYTES);
    const unchanged = planStatsWrite({ m: prevM }, `mt_${String(0).padStart(20, '0')}`, players, path);
    expect(unchanged.op).toBe('noop');
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
    expect(created.audit.id).toBe(`tk_${ms}_${hash}`);
    expect(created.audit).toMatchObject({ actor: hash, mtId: MT, sidChanged: false, prev: null });
    const packed = JSON.stringify(created.audit);
    expect(packed.includes(uid)).toBe(false);
    expect(packed.includes(sid)).toBe(false);
    expect(created.audit.id).toMatch(/^tk_\d+_[0-9a-f]{16}$/);

    const next = 'NextScorerPlainUID';
    const changed = scorerAuditPlan(CID, MT, { uid, sid, takenAt: at(ms) }, { uid: next, sid: 'new-sid', takenAt: at(ms + 1000) });
    expect(changed.kind).toBe('write');
    if (changed.kind !== 'write') return;
    expect(changed.audit.prev).toBe(hash);
    expect(changed.audit.sidChanged).toBe(true);
    expect(changed.audit.actor).toBe(actorHash(CID, next));
    expect(JSON.stringify(changed.audit).includes(next)).toBe(false);
    expect(changed.audit.id.includes(uid)).toBe(false);
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
