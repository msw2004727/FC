/**
 * K9（模擬器，寫好不跑）：隊徽快照、確認後改分標記、摘要 vi。
 * 觸發器由測試直接呼叫。不跑 firebase。Rules 不改。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { addDaysYmd, taipeiYmd } from '../src/cp/schedule-flex.js';
import { ADMIN, DAY, call, makeDeps, ok, resetAll } from './_cp.js';
import { act, matchesOf, pairing, scheduleInput, setupComp, type Comp, type MatchDoc } from './_step3.js';

process.env.CP_LOGO_BUCKETS = 'demo-cp.firebasestorage.app';
const BUCKET = 'demo-cp.firebasestorage.app';
const LOGO_OK = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/teams%2Fa.png?alt=media`;
const LOGO_NEXT = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/teams%2Fb.png?alt=media`;
const LOGO_EXT = 'https://cdn.example/logo.png';
/** generateSchedule：閘門 1＋賽事 1＋組別 1＋報名 ≤16＋舊場次 1＋摘要 ≤2。多投影 teamLogo 不加讀。 */
const GENERATE_READS = 1 + 1 + 1 + 16 + 1 + 2;

type Side = { teamId: string; name: string; logo?: unknown };
type Sum = { h: { l: string | null }; a: { l: string | null }; vi: number | null; cx?: number; s: number[] };

function sideLogo(side: Side): string | null {
  return typeof side.logo === 'string' && side.logo.length > 0 ? side.logo : null;
}

function kickMs(m: MatchDoc): number | null {
  const k = m.kickoffAt as { toMillis?: () => number } | null | undefined;
  return k && typeof k.toMillis === 'function' ? k.toMillis() : null;
}

function venueOf(m: MatchDoc): number | null {
  const v = m.venueIdx;
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function atHm(ms: number, hm: string): number {
  return Date.parse(`${taipeiYmd(ms)}T${hm}:00+08:00`);
}

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 200));
}

async function summaryOf(cid: string, mtId: string): Promise<Sum | undefined> {
  const shards = await adminDb().collection(`competitions/${cid}/summary`).get();
  for (const d of shards.docs) {
    const m = d.get('m') as Record<string, Sum> | undefined;
    if (m && Object.prototype.hasOwnProperty.call(m, mtId)) return m[mtId];
  }
  return undefined;
}

async function matchData(c: Comp, mtId: string) {
  return (await adminDb().doc(`competitions/${c.cid}/matches/${mtId}`).get()).data()!;
}

async function byTeams(c: Comp, home: string, away: string) {
  return pairing(c, await matchesOf(c), home, away, 1, 0).m;
}

async function replay(c: Comp, before: Map<string, Record<string, unknown>>) {
  const deps = makeDeps();
  for (const m of await matchesOf(c)) {
    await handleMatchWritten(deps, c.cid, m.id, before.get(m.id) ?? null, m);
  }
}

async function snapBefore(c: Comp) {
  const out = new Map<string, Record<string, unknown>>();
  for (const m of await matchesOf(c)) out.set(m.id, await matchData(c, m.id));
  return out;
}

/** 產生當下的隊徽。之後改報名、改期、順延、對調、登錄、確認、棄權、重置、取消都不得變。 */
async function expectFrozen(c: Comp, frozen: Map<string, { home: Side; away: Side }>) {
  const ms = await matchesOf(c);
  expect(ms).toHaveLength(frozen.size);
  for (const m of ms) {
    const exp = frozen.get(m.id)!;
    const home = m.home as Side;
    const away = m.away as Side;
    expect(home.teamId).toBe(exp.home.teamId);
    expect(away.teamId).toBe(exp.away.teamId);
    expect(sideLogo(home)).toBe(sideLogo(exp.home));
    expect(sideLogo(away)).toBe(sideLogo(exp.away));
    expect(Object.prototype.hasOwnProperty.call(home, 'logo')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(away, 'logo')).toBe(true);
    const entry = await summaryOf(c.cid, m.id);
    expect(entry?.h.l).toBe(sideLogo(exp.home));
    expect(entry?.a.l).toBe(sideLogo(exp.away));
    expect(entry?.vi ?? null).toBe(venueOf(m));
  }
}

describe('K9 隊徽快照、確認後改分、摘要 vi', () => {
  beforeEach(async () => {
    process.env.CP_LOGO_BUCKETS = BUCKET;
    await resetAll();
  });

  it('產生時快照隊徽；八個動作與改報名都不改快照；讀取仍 ≤22', async () => {
    const c = await setupComp(['甲', '乙', '丙', '丁']);
    const db = adminDb();
    await db.doc(`competitions/${c.cid}/entries/${c.enIdOf['甲']}`).update({ teamLogo: LOGO_OK });
    await db.doc(`competitions/${c.cid}/entries/${c.enIdOf['乙']}`).update({ teamLogo: LOGO_EXT });

    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, scheduleInput(c), makeDeps(0, meter)));
    expect(meter.reads).toBeLessThanOrEqual(GENERATE_READS);
    expect(GENERATE_READS).toBe(22);

    const ms = await matchesOf(c);
    expect(ms).toHaveLength(6);
    for (const m of ms) {
      const r = await handleMatchWritten(makeDeps(), c.cid, m.id, null, m);
      expect(r.summary).toBe(false);
      for (const which of ['home', 'away'] as const) {
        const side = m[which] as Side;
        const name = c.nameOf[side.teamId];
        expect(sideLogo(side)).toBe(name === '甲' ? LOGO_OK : null);
      }
      const entry = await summaryOf(c.cid, m.id);
      expect(entry?.h.l).toBe(sideLogo(m.home as Side));
      expect(entry?.a.l).toBe(sideLogo(m.away as Side));
      expect(entry?.vi).toBe(venueOf(m));
      expect('cx' in (entry ?? {})).toBe(false);
    }

    const frozen = new Map(ms.map(m => [m.id, { home: m.home as Side, away: m.away as Side }]));
    await db.doc(`competitions/${c.cid}/entries/${c.enIdOf['甲']}`).update({ teamLogo: LOGO_NEXT });
    await db.doc(`competitions/${c.cid}/entries/${c.enIdOf['乙']}`).update({ teamLogo: LOGO_OK });
    await db.doc(`competitions/${c.cid}/entries/${c.enIdOf['丙']}`).update({ teamLogo: LOGO_OK });
    await expectFrozen(c, frozen);

    const ab = await byTeams(c, '甲', '乙');
    const cd = await byTeams(c, '丙', '丁');
    const beforeSwap = await snapBefore(c);
    await ok(call(handleCpHost, ADMIN, {
      action: 'swapMatches', cid: c.cid, mtIdA: ab.id, mtIdB: cd.id,
      expectedRevA: ab.rev, expectedRevB: cd.rev, reason: '場地對調'
    }, makeDeps()));
    await replay(c, beforeSwap);
    const abAfter = await matchData(c, ab.id);
    const cdAfter = await matchData(c, cd.id);
    expect(abAfter.venueIdx ?? null).toBe(cd.venueIdx ?? null);
    expect(cdAfter.venueIdx ?? null).toBe(ab.venueIdx ?? null);
    expect(abAfter.venueName ?? null).toBe(cd.venueName ?? null);
    expect((abAfter.home as Side).teamId).toBe(ab.home.teamId);
    expect(sideLogo(abAfter.home as Side)).toBe(sideLogo(ab.home as Side));
    expect(sideLogo(abAfter.away as Side)).toBe(sideLogo(ab.away as Side));
    expect(sideLogo(cdAfter.home as Side)).toBe(sideLogo(cd.home as Side));
    const abEntry = await summaryOf(c.cid, ab.id);
    expect(abEntry?.h.l).toBe(sideLogo(ab.home as Side));
    expect(abEntry?.a.l).toBe(sideLogo(ab.away as Side));
    expect(abEntry?.vi ?? null).toBe(typeof abAfter.venueIdx === 'number' ? abAfter.venueIdx : null);
    await expectFrozen(c, frozen);

    const onDay = (await matchesOf(c)).filter(m => kickMs(m) != null);
    const fromDate = taipeiYmd(kickMs(onDay[0]!)!);
    const toDate = addDaysYmd(fromDate, 1)!;
    const beforeShift = await snapBefore(c);
    const shifted = await ok<{ moved: number }>(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate, toDate, reason: '大雨順延'
    }, makeDeps()));
    expect(shifted.moved).toBeGreaterThan(0);
    await replay(c, beforeShift);
    await expectFrozen(c, frozen);

    const ac = await byTeams(c, '甲', '丙');
    await act(c, ADMIN, {
      action: 'rescheduleMatch', mtId: ac.id, expectedRev: ac.rev,
      kickoffAt: atHm(kickMs(ac)!, '18:00'), venueIdx: venueOf(ac) ?? 0
    }, makeDeps());
    await expectFrozen(c, frozen);

    const ad = await byTeams(c, '甲', '丁');
    await act(c, ADMIN, {
      action: 'rescheduleMatch', mtId: ad.id, expectedRev: ad.rev, kickoffAt: null, venueIdx: null
    }, makeDeps());
    const adDoc = await matchData(c, ad.id);
    expect(adDoc.status).toBe('postponed');
    expect(adDoc.venueIdx ?? null).toBeNull();
    expect(sideLogo(adDoc.home as Side)).toBe(sideLogo((frozen.get(ad.id)!.home)));
    await expectFrozen(c, frozen);

    const bc = await byTeams(c, '乙', '丙');
    await act(c, ADMIN, {
      action: 'recordResult', mtId: bc.id, expectedRev: bc.rev, score: { home: 1, away: 0 }, confirm: false
    });
    let doc = await matchData(c, bc.id);
    expect(doc.scoreCorrectedAt).toBeUndefined();
    expect('cx' in (await summaryOf(c.cid, bc.id) ?? {})).toBe(false);
    await act(c, ADMIN, { action: 'resetMatch', mtId: bc.id, expectedRev: (doc.rev as number), reason: '比分登錄錯誤' });
    doc = await matchData(c, bc.id);
    expect(doc.scoreCorrectedAt).toBeUndefined();
    expect('cx' in (await summaryOf(c.cid, bc.id) ?? {})).toBe(false);
    await expectFrozen(c, frozen);

    const cdNow = await byTeams(c, '丙', '丁');
    await act(c, ADMIN, {
      action: 'recordResult', mtId: cdNow.id, expectedRev: cdNow.rev, score: { home: 0, away: 2 }, confirm: false
    });
    doc = await matchData(c, cdNow.id);
    expect(doc.scoreCorrectedAt).toBeUndefined();
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: cdNow.id, expectedRev: doc.rev as number });
    doc = await matchData(c, cdNow.id);
    expect(doc.status).toBe('confirmed');
    expect(doc.scoreCorrectedAt).toBeUndefined();
    expect('cx' in (await summaryOf(c.cid, cdNow.id) ?? {})).toBe(false);

    const abNow = await byTeams(c, '甲', '乙');
    await act(c, ADMIN, {
      action: 'recordResult', mtId: abNow.id, expectedRev: abNow.rev, score: { home: 3, away: 1 }, confirm: true
    });
    doc = await matchData(c, abNow.id);
    expect(doc.status).toBe('confirmed');
    expect(doc.scoreCorrectedAt).toBeUndefined();
    expect('cx' in (await summaryOf(c.cid, abNow.id) ?? {})).toBe(false);
    await act(c, ADMIN, { action: 'resetMatch', mtId: abNow.id, expectedRev: doc.rev as number, reason: '比分登錄錯誤' });
    doc = await matchData(c, abNow.id);
    expect(doc.score).toEqual({ home: 0, away: 0 });
    expect(doc.scoreCorrectedAt).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(doc).includes(ADMIN.uid)).toBe(false);
    expect(JSON.stringify(doc).includes('"uid"')).toBe(false);
    let msStamp = (doc.scoreCorrectedAt as Timestamp).toMillis();
    expect((await summaryOf(c.cid, abNow.id))?.cx).toBe(msStamp);
    expect(sideLogo(doc.home as Side)).toBe(sideLogo(frozen.get(abNow.id)!.home));
    expect(sideLogo(doc.away as Side)).toBe(sideLogo(frozen.get(abNow.id)!.away));
    const revAfterReset = doc.rev as number;
    await tick();
    await act(c, ADMIN, {
      action: 'recordResult', mtId: abNow.id, expectedRev: revAfterReset, score: { home: 2, away: 0 }, confirm: false
    });
    doc = await matchData(c, abNow.id);
    expect(doc.rev).toBe(revAfterReset + 1);
    const msNext = (doc.scoreCorrectedAt as Timestamp).toMillis();
    expect(msNext).toBeGreaterThan(msStamp);
    expect((await summaryOf(c.cid, abNow.id))?.cx).toBe(msNext);
    await act(c, ADMIN, {
      action: 'setWalkover', mtId: abNow.id, expectedRev: doc.rev as number, forfeitSide: 'home', reason: '未到場'
    });
    doc = await matchData(c, abNow.id);
    expect(doc.status).toBe('walkover');
    expect((doc.scoreCorrectedAt as Timestamp).toMillis()).toBe(msNext);

    const bd = await byTeams(c, '乙', '丁');
    await act(c, ADMIN, {
      action: 'setWalkover', mtId: bd.id, expectedRev: bd.rev, forfeitSide: 'away', reason: '未到場'
    });
    doc = await matchData(c, bd.id);
    expect(doc.status).toBe('walkover');
    expect(doc.scoreCorrectedAt).toBeUndefined();
    await act(c, ADMIN, { action: 'resetMatch', mtId: bd.id, expectedRev: doc.rev as number, reason: '判錯隊' });
    doc = await matchData(c, bd.id);
    expect(doc.scoreCorrectedAt).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(doc).includes(ADMIN.uid)).toBe(false);
    msStamp = (doc.scoreCorrectedAt as Timestamp).toMillis();
    expect((await summaryOf(c.cid, bd.id))?.cx).toBe(msStamp);
    const revWo = doc.rev as number;
    await tick();
    await act(c, ADMIN, {
      action: 'recordResult', mtId: bd.id, expectedRev: revWo, score: { home: 1, away: 1 }, confirm: false
    });
    doc = await matchData(c, bd.id);
    expect(doc.rev).toBe(revWo + 1);
    const msWo = (doc.scoreCorrectedAt as Timestamp).toMillis();
    expect(msWo).toBeGreaterThan(msStamp);
    expect((await summaryOf(c.cid, bd.id))?.cx).toBe(msWo);
    await act(c, ADMIN, { action: 'cancelMatch', mtId: bd.id, expectedRev: doc.rev as number, reason: '場地積水' });
    doc = await matchData(c, bd.id);
    expect(doc.status).toBe('cancelled');
    expect((doc.scoreCorrectedAt as Timestamp).toMillis()).toBe(msWo);
    expect((await summaryOf(c.cid, bd.id))?.cx).toBe(msWo);

    const acNow = await byTeams(c, '甲', '丙');
    await act(c, ADMIN, {
      action: 'recordResult', mtId: acNow.id, expectedRev: acNow.rev, score: { home: 4, away: 0 }, confirm: true
    });
    doc = await matchData(c, acNow.id);
    expect(doc.scoreCorrectedAt).toBeUndefined();
    await act(c, ADMIN, { action: 'resetMatch', mtId: acNow.id, expectedRev: doc.rev as number, reason: '比分登錄錯誤' });
    doc = await matchData(c, acNow.id);
    msStamp = (doc.scoreCorrectedAt as Timestamp).toMillis();
    const revAc = doc.rev as number;
    await tick();
    await act(c, ADMIN, {
      action: 'recordResult', mtId: acNow.id, expectedRev: revAc, score: { home: 1, away: 0 }, confirm: false
    });
    doc = await matchData(c, acNow.id);
    const msAc = (doc.scoreCorrectedAt as Timestamp).toMillis();
    expect(msAc).toBeGreaterThan(msStamp);
    await tick();
    await act(c, ADMIN, { action: 'resetMatch', mtId: acNow.id, expectedRev: doc.rev as number, reason: '再改期' });
    doc = await matchData(c, acNow.id);
    expect(doc.status).toBe('scheduled');
    expect((doc.scoreCorrectedAt as Timestamp).toMillis()).toBe(msAc);
    await act(c, ADMIN, {
      action: 'rescheduleMatch', mtId: acNow.id, expectedRev: doc.rev as number,
      kickoffAt: atHm(kickMs({ ...doc, id: acNow.id } as MatchDoc)!, '19:00'),
      venueIdx: typeof doc.venueIdx === 'number' ? doc.venueIdx : 0
    }, makeDeps());
    doc = await matchData(c, acNow.id);
    expect((doc.scoreCorrectedAt as Timestamp).toMillis()).toBe(msAc);
    expect((await summaryOf(c.cid, acNow.id))?.cx).toBe(msAc);

    await expectFrozen(c, frozen);
  });
});
