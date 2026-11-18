/**
 * §3.272 F2（模擬器，寫好不跑）：改期延後末場、撞期、整天順延、兩場對調、系統公告。
 * 讀取預算用 ReadMeter。觸發器由測試直接呼叫。不跑 firebase。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter, actorHash } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { NOTICE_LIMITS, type Notice } from '../src/cp/notice.js';
import {
  addDaysYmd,
  kickoffBounds,
  rescheduleNoticeText,
  shiftDayNoticeText,
  shiftKickoffToDate,
  swapNoticeText,
  taipeiDayStartMs,
  taipeiYmd
} from '../src/cp/schedule-flex.js';
import { summaryShardIdOf } from '../src/cp/summary.js';
import {
  ADMIN, STRANGER, TESTER, TESTER2, TESTER3, call, fails, makeDeps, ok, resetAll, setBannedWords
} from './_cp.js';
import { generate, matchesOf, pairing, record, setupComp, type Comp, type MatchDoc } from './_step3.js';

/** 契約上限。下面的 toBe 鎖住這條路徑實際讀了幾次。 */
const READ_BUDGET = {
  reschedule: 2 + 1 + 2 + 1 + 8 + 200,
  shift: 2 + 1 + 2 + 200 + 8 + 200,
  swap: 2 + 1 + 2 + 2 + 8 + 200
};

function kickMs(m: MatchDoc): number | null {
  const k = m.kickoffAt as { toMillis?: () => number } | null | undefined;
  return k && typeof k.toMillis === 'function' ? k.toMillis() : null;
}

function venueIdx(m: MatchDoc): number | null {
  return typeof m.venueIdx === 'number' ? m.venueIdx : null;
}

function sharesTeam(a: MatchDoc, b: MatchDoc): boolean {
  const ids = new Set([a.home.teamId, a.away.teamId]);
  return ids.has(b.home.teamId) || ids.has(b.away.teamId);
}

function byTeams(c: Comp, ms: MatchDoc[], home: string, away: string): MatchDoc {
  return pairing(c, ms, home, away, 0, 0).m;
}

function busiestDay(ms: MatchDoc[]): { date: string; matches: MatchDoc[] } {
  const by = new Map<string, MatchDoc[]>();
  for (const m of ms) {
    const k = kickMs(m);
    if (k == null) continue;
    const date = taipeiYmd(k);
    const list = by.get(date) ?? [];
    list.push(m);
    by.set(date, list);
  }
  let best: { date: string; matches: MatchDoc[] } | null = null;
  for (const [date, matches] of by) {
    if (!best || matches.length > best.matches.length) best = { date, matches };
  }
  if (!best) throw new Error('沒有開賽日');
  return best;
}

async function compData(cid: string) {
  const snap = await adminDb().doc(`competitions/${cid}`).get();
  return snap.data()!;
}

async function noticesOf(cid: string): Promise<Notice[]> {
  const raw = (await adminDb().doc(`competitions/${cid}`).get()).get('notices');
  return Array.isArray(raw) ? raw as Notice[] : [];
}

async function auditsOf(cid: string, action: string) {
  const snap = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', action).get();
  return snap.docs.map(d => d.data());
}

function nt(i: number): string {
  return `nt_${i.toString(36).padStart(20, '0')}`;
}

describe('§3.272 F2 賽程彈性', () => {
  let c: Comp;
  beforeEach(async () => {
    await resetAll();
    c = await setupComp(['甲', '乙', '丙', '丁']);
    await generate(c);
  });

  it('待定不改末場但仍發公告；省略場地會清掉', async () => {
    const m = (await matchesOf(c))[0]!;
    const before = await compData(c.cid);
    const meter = new ReadMeter();
    const r = await ok<{ mtId: string; status: string; rev: number; noticeId: string }>(call(
      handleCpHost, ADMIN,
      { action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: null },
      makeDeps(0, meter)
    ));
    expect(meter.reads).toBe(3);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.reschedule);
    expect(r).toMatchObject({ status: 'postponed', rev: m.rev + 1 });
    const doc = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    expect(doc.kickoffAt).toBeNull();
    expect(doc.venueIdx).toBeNull();
    expect(doc.venueName).toBeNull();
    const after = await compData(c.cid);
    expect(after.lastMatchAt.toMillis()).toBe(before.lastMatchAt.toMillis());
    expect(after.lastMatchOriginAt).toBeUndefined();
    expect(after.stateVersion).toBe(before.stateVersion);
    const list = await noticesOf(c.cid);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: r.noticeId, kind: 'system', by: actorHash(c.cid, ADMIN.uid),
      text: rescheduleNoticeText({
        kickoffMs: kickMs(m), homeName: m.home.name, awayName: m.away.name, toMs: null, venueName: null
      })
    });
    expect(list[0]?.text).toContain('改至待定');
    expect(JSON.stringify(list[0])).not.toContain(ADMIN.uid);
  });

  it('可延到原末場後，上限當天成功，超過與早於首場日拒絕，不能把末場提前', async () => {
    const m = (await matchesOf(c))[0]!;
    const before = await compData(c.cid);
    const originMs = before.lastMatchAt.toMillis();
    const bounds = kickoffBounds(before.firstMatchAt.toMillis(), originMs);
    const earlyMeter = new ReadMeter();
    const early = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev,
      kickoffAt: bounds.lo - 1, venueIdx: venueIdx(m)
    }, makeDeps(0, earlyMeter));
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.error.reason).toBe('SCHEDULE_OUT_OF_RANGE');
      expect(early.error.params).toEqual({ field: 'kickoffAt', min: bounds.minYmd, max: bounds.maxYmd });
    }
    expect(earlyMeter.reads).toBe(2);

    const hiMeter = new ReadMeter();
    const hi = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev,
      kickoffAt: bounds.hi, venueIdx: venueIdx(m)
    }, makeDeps(0, hiMeter));
    expect(hi.ok).toBe(false);
    if (!hi.ok) expect(hi.error.params).toMatchObject({ field: 'kickoffAt', max: bounds.maxYmd });
    expect(hiMeter.reads).toBe(2);

    const kick = Date.parse(`${bounds.maxYmd}T14:00:00+08:00`);
    const okMeter = new ReadMeter();
    const moved = await ok<{ noticeId: string; rev: number }>(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev,
      kickoffAt: kick, venueIdx: 1
    }, makeDeps(0, okMeter)));
    expect(okMeter.reads).toBe(5);
    const extended = await compData(c.cid);
    expect(extended.lastMatchAt.toMillis()).toBe(taipeiDayStartMs(kick));
    expect(extended.lastMatchOriginAt.toMillis()).toBe(originMs);
    expect(extended.stateVersion).toBe(before.stateVersion + 1);
    const note = (await noticesOf(c.cid)).find(n => n.id === moved.noticeId);
    expect(note?.text).toBe(rescheduleNoticeText({
      kickoffMs: kickMs(m), homeName: m.home.name, awayName: m.away.name, toMs: kick, venueName: 'B 場'
    }));
    expect(note?.kind).toBe('system');

    const again = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: moved.rev,
      kickoffAt: bounds.hi, venueIdx: 1
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.params).toMatchObject({ max: bounds.maxYmd });

    const back = kickMs(m)!;
    await ok(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: moved.rev,
      kickoffAt: back, venueIdx: venueIdx(m)
    }));
    const stayed = await compData(c.cid);
    expect(stayed.lastMatchAt.toMillis()).toBe(taipeiDayStartMs(kick));
    expect(stayed.lastMatchOriginAt.toMillis()).toBe(originMs);
    expect(stayed.stateVersion).toBe(extended.stateVersion);
  });

  it('同一末場日內改時間不延後 lastMatchAt，摘要片改掛新日期', async () => {
    const m = (await matchesOf(c))[0]!;
    const before = await compData(c.cid);
    const lastDay = taipeiYmd(before.lastMatchAt.toMillis());
    const kick = Date.parse(`${lastDay}T07:00:00+08:00`);
    const oldKick = kickMs(m)!;
    const beforeMatch = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    await ok(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: kick, venueIdx: venueIdx(m)
    }));
    const after = await compData(c.cid);
    expect(after.lastMatchAt.toMillis()).toBe(before.lastMatchAt.toMillis());
    expect(after.lastMatchOriginAt).toBeUndefined();
    expect(after.stateVersion).toBe(before.stateVersion);
    const afterMatch = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    await handleMatchWritten(makeDeps(), c.cid, m.id, beforeMatch, afterMatch);
    const nextShard = summaryShardIdOf(kick);
    const prevShard = summaryShardIdOf(oldKick);
    expect((await adminDb().doc(`competitions/${c.cid}/summary/${nextShard}`).get()).get('m')[m.id]).toBeTruthy();
    if (nextShard !== prevShard) {
      const old = await adminDb().doc(`competitions/${c.cid}/summary/${prevShard}`).get();
      if (old.exists) expect(old.get('m')?.[m.id]).toBeUndefined();
    }
  });

  it('不同隊同一場地回 venue；同一隊回 team，force 放行並寫稽核', async () => {
    const ms = await matchesOf(c);
    const ab = byTeams(c, ms, '甲', '乙');
    const cd = byTeams(c, ms, '丙', '丁');
    const venueHit = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: cd.id, expectedRev: cd.rev,
      kickoffAt: kickMs(ab), venueIdx: venueIdx(ab)
    });
    expect(venueHit.ok).toBe(false);
    if (!venueHit.ok) expect(venueHit.error).toMatchObject({
      reason: 'SCHEDULE_CONFLICT', params: { mtId: ab.id, type: 'venue' }
    });

    const ac = byTeams(c, ms, '甲', '丙');
    const blocked = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: ac.id, expectedRev: ac.rev,
      kickoffAt: kickMs(ab), venueIdx: venueIdx(ab)
    });
    expect(blocked.ok).toBe(false);
    // 同時撞到不只一場時回報其中一場即可（查詢窗涵蓋跨午夜後可能先找到別場同隊衝突）
    if (!blocked.ok) expect(blocked.error).toMatchObject({
      reason: 'SCHEDULE_CONFLICT', params: { type: 'team' }
    });
    const forced = await ok<{ rev: number }>(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: ac.id, expectedRev: ac.rev,
      kickoffAt: kickMs(ab), venueIdx: venueIdx(ab), force: true
    }));
    expect(forced.rev).toBe(ac.rev + 1);
    const audit = await auditsOf(c.cid, 'rescheduleMatch');
    expect(audit.some(a => a.details?.force === true && typeof a.details?.conflictMtId === 'string' && a.details?.conflictType === 'team')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(ADMIN.uid);
  });

  it('共同主辦空窗改期讀 7；非主辦、路人、草稿、rev、已開賽', async () => {
    await adminDb().doc(`competitions/${c.cid}/staff/${TESTER2.uid}`).set({ roles: ['coHost'], matchIds: [] });
    const comp = await compData(c.cid);
    const day = addDaysYmd(taipeiYmd(comp.lastMatchAt.toMillis()), 10)!;
    const kick = Date.parse(`${day}T14:00:00+08:00`);
    const m = (await matchesOf(c))[0]!;
    const coMeter = new ReadMeter();
    await ok(call(handleCpHost, TESTER2, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: kick, venueIdx: 0
    }, makeDeps(0, coMeter)));
    expect(coMeter.reads).toBe(7);
    const extended = await compData(c.cid);
    expect(extended.lastMatchAt.toMillis()).toBe(Date.parse(`${day}T00:00:00+08:00`));

    const strangerMeter = new ReadMeter();
    await fails(call(handleCpHost, STRANGER, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev + 1, kickoffAt: null, venueIdx: null
    }, makeDeps(0, strangerMeter)), 'INTERNAL_PERIOD');
    expect(strangerMeter.reads).toBe(2);

    const hostMeter = new ReadMeter();
    await fails(call(handleCpHost, TESTER3, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev + 1, kickoffAt: null, venueIdx: null
    }, makeDeps(0, hostMeter)), 'NOT_HOST');
    expect(hostMeter.reads).toBe(4);

    const revMeter = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: 99, kickoffAt: null, venueIdx: null
    }, makeDeps(0, revMeter)), 'REV_CONFLICT');
    expect(revMeter.reads).toBe(3);

    const reasonMeter = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev + 1, kickoffAt: null, venueIdx: null, reason: '雨'
    }, makeDeps(0, reasonMeter)), 'UNKNOWN_FIELD');
    expect(reasonMeter.reads).toBe(1);

    await adminDb().doc(`competitions/${c.cid}`).update({ status: 'draft' });
    const draftMeter = new ReadMeter();
    const draft = await call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev + 1, kickoffAt: null, venueIdx: null
    }, makeDeps(0, draftMeter));
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.error).toMatchObject({ reason: 'STATUS_NOT_EDITABLE', params: { status: 'draft' } });
    expect(draftMeter.reads).toBe(2);
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: day, toDate: addDaysYmd(day, 1), reason: '草稿'
    }), 'STATUS_NOT_EDITABLE');
    await fails(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: m.id, mtIdB: (await matchesOf(c))[1]!.id,
      expectedRevA: 0, expectedRevB: 0, reason: '草稿'
    }), 'STATUS_NOT_EDITABLE');
  });

  it('已開賽不能改期', async () => {
    await record(c, '甲', '乙', 1, 0);
    const m = byTeams(c, await matchesOf(c), '甲', '乙');
    const meter = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: null, venueIdx: null
    }, makeDeps(0, meter)), 'MATCH_STATE');
    expect(meter.reads).toBe(3);
  });

  it('手動額度用完時改期仍寫系統公告', async () => {
    const host = Array.from({ length: NOTICE_LIMITS.hostMax }, (_, i) => ({
      id: nt(i), text: `手動${i}`, kind: 'host' as const,
      at: Timestamp.fromMillis(1_700_000_000_000 + i * 1000), by: '0123456789abcdef'
    }));
    await adminDb().doc(`competitions/${c.cid}`).update({ notices: host });
    await fails(call(handleCpHost, ADMIN, { action: 'postNotice', cid: c.cid, text: '第 21 則' }), 'NOTICE_LIMIT');
    const m = (await matchesOf(c))[0]!;
    const r = await ok<{ noticeId: string }>(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: null, venueIdx: null
    }));
    const list = await noticesOf(c.cid);
    expect(list.filter(n => n.kind === 'host')).toHaveLength(20);
    const system = list.filter(n => n.kind === 'system');
    expect(system).toHaveLength(1);
    expect(system[0]?.id).toBe(r.noticeId);
    expect(system[0]?.text).toContain('改至待定');
  });

  it('整天順延：時刻與場地不變、延後末場、空目標日讀取 4+N', async () => {
    const ms = await matchesOf(c);
    const { date: fromDate, matches: onDay } = busiestDay(ms);
    const toDate = addDaysYmd(fromDate, 10)!;
    const before = await compData(c.cid);
    const meter = new ReadMeter();
    const r = await ok<{ moved: number; noticeId: string }>(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate, toDate, reason: '大雨順延'
    }, makeDeps(0, meter)));
    expect(r.moved).toBe(onDay.length);
    expect(meter.reads).toBe(4 + onDay.length);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.shift);
    const after = await compData(c.cid);
    expect(after.lastMatchAt.toMillis()).toBe(Date.parse(`${toDate}T00:00:00+08:00`));
    expect(after.lastMatchOriginAt.toMillis()).toBe(before.lastMatchAt.toMillis());
    expect(after.stateVersion).toBe(before.stateVersion + 1);
    for (const m of onDay) {
      const doc = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
      expect(doc.status).toBe('scheduled');
      expect(doc.rev).toBe(m.rev + 1);
      expect(doc.kickoffAt.toMillis()).toBe(shiftKickoffToDate(kickMs(m)!, fromDate, toDate));
      expect(doc.venueIdx ?? null).toBe(venueIdx(m));
      expect(doc.venueName ?? null).toBe(m.venueName ?? null);
    }
    const list = await noticesOf(c.cid);
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe(shiftDayNoticeText(fromDate, toDate));
    expect(list[0]?.text).not.toContain('大雨');
    const audit = await auditsOf(c.cid, 'shiftMatchDay');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ fromDate, toDate, reason: '大雨順延', moved: onDay.length });
    expect(audit[0]?.details.force).toBeUndefined();
    expect(JSON.stringify(audit[0])).not.toContain(ADMIN.uid);
  });

  it('已開賽留在原日；沒有開賽時間的延期場不搬', async () => {
    const { date: fromDate, matches: onDay } = busiestDay(await matchesOf(c));
    expect(onDay.length).toBeGreaterThanOrEqual(2);
    const stay = onDay[0]!;
    const drop = onDay[1]!;
    await record(c, c.nameOf[stay.home.teamId]!, c.nameOf[stay.away.teamId]!, 1, 0);
    await ok(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: drop.id, expectedRev: drop.rev, kickoffAt: null, venueIdx: null
    }));
    const toDate = addDaysYmd(fromDate, 8)!;
    const shifted = await ok<{ moved: number }>(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate, toDate, reason: '保留已開賽'
    }));
    expect(shifted.moved).toBe(onDay.length - 2);
    const stayAfter = (await adminDb().doc(`competitions/${c.cid}/matches/${stay.id}`).get()).data()!;
    expect(stayAfter.status).toBe('confirmed');
    expect(stayAfter.kickoffAt.toMillis()).toBe(kickMs(stay));
    const dropAfter = (await adminDb().doc(`competitions/${c.cid}/matches/${drop.id}`).get()).data()!;
    expect(dropAfter.kickoffAt).toBeNull();
    expect(dropAfter.status).toBe('postponed');
  });

  it('目標日撞同一隊就擋下，force 才搬走', async () => {
    const ms = await matchesOf(c);
    const pair = ms.find(a => ms.some(b => a.id !== b.id && sharesTeam(a, b)));
    if (!pair) throw new Error('找不到同隊的兩場');
    const other = ms.find(b => b.id !== pair.id && sharesTeam(pair, b))!;
    const fromDate = taipeiYmd(kickMs(pair)!);
    const toDate = addDaysYmd(fromDate, 5)!;
    const landed = shiftKickoffToDate(kickMs(pair)!, fromDate, toDate)!;
    await adminDb().doc(`competitions/${c.cid}/matches/${other.id}`).update({
      kickoffAt: Timestamp.fromMillis(landed), status: 'scheduled'
    });
    const blocked = await call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate, toDate, reason: '撞期'
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatchObject({
      reason: 'SCHEDULE_CONFLICT', params: { mtId: other.id, type: 'team' }
    });
    const still = (await adminDb().doc(`competitions/${c.cid}/matches/${pair.id}`).get()).data()!;
    expect(still.kickoffAt.toMillis()).toBe(kickMs(pair));
    await ok(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate, toDate, reason: '仍要順延', force: true
    }));
    const moved = (await adminDb().doc(`competitions/${c.cid}/matches/${pair.id}`).get()).data()!;
    expect(moved.kickoffAt.toMillis()).toBe(landed);
    const audit = await auditsOf(c.cid, 'shiftMatchDay');
    expect(audit.some(a => a.details?.force === true && a.details?.conflictMtId === other.id)).toBe(true);
    const note = (await noticesOf(c.cid)).find(n => n.text === shiftDayNoticeText(fromDate, toDate));
    expect(note?.text).not.toContain('仍要順延');
  });

  it('空日 NOTHING_TO_SHIFT；超過上限；缺原因、禁用詞、同一天、force 型別', async () => {
    const { date } = busiestDay(await matchesOf(c));
    const empty = addDaysYmd(date, 3)!;
    const emptyMeter = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: empty, toDate: addDaysYmd(empty, 1), reason: '沒比賽'
    }, makeDeps(0, emptyMeter)), 'NOTHING_TO_SHIFT');
    expect(emptyMeter.reads).toBe(3);

    const comp = await compData(c.cid);
    const bounds = kickoffBounds(comp.firstMatchAt.toMillis(), comp.lastMatchAt.toMillis());
    const onDay = (await matchesOf(c)).filter(m => { const k = kickMs(m); return k != null && taipeiYmd(k) === date; });
    const farMeter = new ReadMeter();
    const far = await call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: addDaysYmd(bounds.maxYmd, 1), reason: '太遠'
    }, makeDeps(0, farMeter));
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.error).toMatchObject({
      reason: 'SCHEDULE_OUT_OF_RANGE', params: { field: 'toDate', max: bounds.maxYmd }
    });
    expect(farMeter.reads).toBe(2 + onDay.length);

    const miss = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: addDaysYmd(date, 1)
    }, makeDeps(0, miss)), 'FIELD_REQUIRED');
    expect(miss.reads).toBe(1);
    const badDate = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: '2026-02-31', toDate: addDaysYmd(date, 1), reason: '日期'
    }, makeDeps(0, badDate)), 'FIELD_FORMAT');
    expect(badDate.reads).toBe(1);
    const same = new ReadMeter();
    const sameOut = await call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: date, reason: '同一天'
    }, makeDeps(0, same));
    expect(sameOut.ok).toBe(false);
    if (!sameOut.ok) expect(sameOut.error).toMatchObject({ reason: 'FIELD_RANGE', params: { field: 'toDate' } });
    expect(same.reads).toBe(1);
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: addDaysYmd(date, 1), reason: '可以', force: 'yes'
    }), 'FIELD_TYPE');
    await setBannedWords();
    const banned = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: addDaysYmd(date, 1), reason: '官方延期'
    }, makeDeps(0, banned)), 'BANNED_WORD');
    expect(banned.reads).toBe(1);

    const notHost = new ReadMeter();
    await fails(call(handleCpHost, TESTER3, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: date, toDate: addDaysYmd(date, 1), reason: '非主辦'
    }, makeDeps(0, notHost)), 'NOT_HOST');
    expect(notHost.reads).toBe(4);
  });

  it('兩場對調交換時間與場地，不延後末場，公告用對調前的時間', async () => {
    const ms = await matchesOf(c);
    const a = byTeams(c, ms, '甲', '乙');
    const b = byTeams(c, ms, '丙', '丁');
    const before = await compData(c.cid);
    const ka = kickMs(a)!;
    const kb = kickMs(b)!;
    const meter = new ReadMeter();
    const r = await ok<{ revA: number; revB: number; noticeId: string }>(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: a.rev, expectedRevB: b.rev, reason: '場地對調'
    }, makeDeps(0, meter)));
    const days = new Set([taipeiYmd(ka), taipeiYmd(kb)]);
    // 當日場次查詢會回傳同日其他場次（每筆計讀），不是空查詢：只鎖下限與預算上限（PM 收件修正）
    expect(meter.reads).toBeGreaterThanOrEqual(5 + days.size);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.swap);
    expect(r).toMatchObject({ revA: a.rev + 1, revB: b.rev + 1 });
    const da = (await adminDb().doc(`competitions/${c.cid}/matches/${a.id}`).get()).data()!;
    const db = (await adminDb().doc(`competitions/${c.cid}/matches/${b.id}`).get()).data()!;
    expect(da.kickoffAt.toMillis()).toBe(kb);
    expect(db.kickoffAt.toMillis()).toBe(ka);
    expect(da.venueIdx ?? null).toBe(venueIdx(b));
    expect(db.venueIdx ?? null).toBe(venueIdx(a));
    expect(da.venueName ?? null).toBe(b.venueName ?? null);
    expect(db.venueName ?? null).toBe(a.venueName ?? null);
    const after = await compData(c.cid);
    expect(after.lastMatchAt.toMillis()).toBe(before.lastMatchAt.toMillis());
    expect(after.lastMatchOriginAt).toBeUndefined();
    expect(after.stateVersion).toBe(before.stateVersion);
    const note = (await noticesOf(c.cid)).find(n => n.id === r.noticeId);
    expect(note?.text).toBe(swapNoticeText(
      { kickoffMs: ka, homeName: a.home.name, awayName: a.away.name },
      { kickoffMs: kb, homeName: b.home.name, awayName: b.away.name }
    ));
    expect(note?.text).not.toContain('場地對調');
    const audit = await auditsOf(c.cid, 'swapMatches');
    expect(audit[0]?.details).toMatchObject({ mtIdA: a.id, mtIdB: b.id, reason: '場地對調' });
    expect(JSON.stringify(audit[0])).not.toContain(ADMIN.uid);
  });

  it('對調後撞期擋下，force 才交換', async () => {
    const ms = await matchesOf(c);
    const a = byTeams(c, ms, '甲', '乙');
    const b = byTeams(c, ms, '丙', '丁');
    const third = byTeams(c, ms, '甲', '丙');
    await adminDb().doc(`competitions/${c.cid}/matches/${third.id}`).update({
      kickoffAt: Timestamp.fromMillis(kickMs(b)!),
      venueIdx: venueIdx(b),
      venueName: b.venueName ?? null,
      status: 'scheduled'
    });
    const blocked = await call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: a.rev, expectedRevB: b.rev, reason: '會撞'
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatchObject({
      reason: 'SCHEDULE_CONFLICT', params: { mtId: third.id, type: 'team' }
    });
    await ok(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: a.rev, expectedRevB: b.rev, reason: '仍要對調', force: true
    }));
    const da = (await adminDb().doc(`competitions/${c.cid}/matches/${a.id}`).get()).data()!;
    expect(da.kickoffAt.toMillis()).toBe(kickMs(b));
    expect(da.venueName ?? null).toBe(b.venueName ?? null);
    const audit = await auditsOf(c.cid, 'swapMatches');
    expect(audit.some(row => row.details?.force === true && row.details?.conflictMtId === third.id)).toBe(true);
  });

  it('對調拒絕：同一場、缺原因、禁用詞、rev、已開賽、兩場都待定不查當日', async () => {
    const ms = await matchesOf(c);
    const a = ms[0]!;
    const b = ms[1]!;
    const sameMeter = new ReadMeter();
    const same = await call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: a.id,
      expectedRevA: a.rev, expectedRevB: a.rev, reason: '同一場'
    }, makeDeps(0, sameMeter));
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error).toMatchObject({ reason: 'FIELD_RANGE', params: { field: 'mtIdB' } });
    expect(sameMeter.reads).toBe(1);

    const miss = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id, expectedRevA: 0, expectedRevB: 0
    }, makeDeps(0, miss)), 'FIELD_REQUIRED');
    expect(miss.reads).toBe(1);
    await setBannedWords();
    await fails(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: 0, expectedRevB: 0, reason: '官方對調'
    }), 'BANNED_WORD');

    const revMeter = new ReadMeter();
    await fails(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: 9, expectedRevB: b.rev, reason: '舊版本'
    }, makeDeps(0, revMeter)), 'REV_CONFLICT');
    expect(revMeter.reads).toBe(3);

    const notHost = new ReadMeter();
    await fails(call(handleCpHost, TESTER3, {
      action: 'swapMatches', cid: c.cid, mtIdA: a.id, mtIdB: b.id,
      expectedRevA: 0, expectedRevB: 0, reason: '非主辦'
    }, makeDeps(0, notHost)), 'NOT_HOST');
    expect(notHost.reads).toBe(4);

    await record(c, '甲', '乙', 1, 0);
    const played = byTeams(c, await matchesOf(c), '甲', '乙');
    const other = (await matchesOf(c)).find(m => m.id !== played.id)!;
    await fails(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: played.id, mtIdB: other.id,
      expectedRevA: played.rev, expectedRevB: other.rev, reason: '已開賽'
    }), 'MATCH_STATE');

    const rest = (await matchesOf(c)).filter(m => m.status === 'scheduled').slice(0, 2);
    expect(rest).toHaveLength(2);
    await ok(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: rest[0]!.id, expectedRev: rest[0]!.rev, kickoffAt: null, venueIdx: null
    }));
    await ok(call(handleCpHost, ADMIN, {
      action: 'rescheduleMatch', cid: c.cid, mtId: rest[1]!.id, expectedRev: rest[1]!.rev, kickoffAt: null, venueIdx: null
    }));
    const before = await compData(c.cid);
    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: rest[0]!.id, mtIdB: rest[1]!.id,
      expectedRevA: rest[0]!.rev + 1, expectedRevB: rest[1]!.rev + 1, reason: '都待定'
    }, makeDeps(0, meter)));
    expect(meter.reads).toBe(4);
    const after = await compData(c.cid);
    expect(after.lastMatchAt.toMillis()).toBe(before.lastMatchAt.toMillis());
    const note = (await noticesOf(c.cid)).map(n => n.text).find(t => t.startsWith('兩場對調：'));
    expect(note).toBe(`兩場對調：${rest[0]!.home.name}對${rest[0]!.away.name} 與 ${rest[1]!.home.name}對${rest[1]!.away.name}`);
  });
});

describe('§3.272 F2 主辦權限', () => {
  let c: Comp;
  beforeEach(async () => {
    await resetAll();
    c = await setupComp(['甲', '乙', '丙', '丁'], { host: TESTER });
    await generate(c);
  });

  it('個人主辦空窗改期讀 7', async () => {
    const comp = await compData(c.cid);
    const day = addDaysYmd(taipeiYmd(comp.lastMatchAt.toMillis()), 9)!;
    const m = (await matchesOf(c))[0]!;
    const meter = new ReadMeter();
    await ok(call(handleCpHost, TESTER, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev,
      kickoffAt: Date.parse(`${day}T14:00:00+08:00`), venueIdx: 0
    }, makeDeps(0, meter)));
    expect(meter.reads).toBe(7);
    expect((await compData(c.cid)).lastMatchAt.toMillis()).toBe(Date.parse(`${day}T00:00:00+08:00`));
  });

  it('已結束後主辦不能改期', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'endCompetition', cid: c.cid, reason: '提前結束' }));
    const m = (await matchesOf(c))[0]!;
    const meter = new ReadMeter();
    await fails(call(handleCpHost, TESTER, {
      action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt: null, venueIdx: null
    }, makeDeps(0, meter)), 'COMPETITION_ENDED');
    expect(meter.reads).toBe(4);
  });
});
