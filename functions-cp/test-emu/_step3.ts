/**
 * 第 3 步模擬器測試共用：用真的 Callable 建好「已發布、已核准 N 隊、名單已鎖」的賽事，
 * 以及「呼叫動作後模擬觸發器」的包裝（模擬器只有 Firestore，觸發器由測試直接呼叫處理函式）。
 */
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import type { CpDeps } from '../src/cp/context.js';
import { ADMIN, DAY, TESTER, call, createInput, makeDeps, ok, type Who } from './_cp.js';

/** 開賽後（首場＝現在＋20 天），登錄比分要在開賽時間之後 */
export const LATER = 25 * DAY;
export const later = () => makeDeps(LATER);

export function taipeiYmd(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

export interface Comp { cid: string; dvId: string; enIdOf: Record<string, string>; nameOf: Record<string, string>; days: string[] }

/** teams：隊名（同時當俱樂部名稱）；代表一律 tester（測試者）。 */
export async function setupComp(teams: string[], opts: { host?: Who } = {}): Promise<Comp> {
  const db = adminDb();
  const b = db.batch();
  teams.forEach((name, i) => b.set(db.doc(`cpClubs/club_t${i}`), { repUids: ['tester'], name, srcUpdatedAt: new Date() }));
  await b.commit();
  const host = opts.host ?? ADMIN;
  const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, host, createInput({
    name: '【測試】第 3 步盃',
    venues: [{ name: 'A 場', address: '台北市' }, { name: 'B 場', address: '台北市' }],
    divisions: [{ name: '成人組', playersOnField: 5, maxTeams: Math.max(2, teams.length), rosterMin: 1, rosterMax: 10 }]
  })));
  const cid = created.cid;
  const dvId = created.dvIds[0];
  await ok(call(handleCpHost, host, { action: 'publish', cid }));
  const enIdOf: Record<string, string> = {};
  for (let i = 0; i < teams.length; i++) {
    const r = await ok<{ enId: string }>(call(handleCpEntry, TESTER, { action: 'registerEntry', cid, dvId, teamId: `club_t${i}` }));
    enIdOf[teams[i]] = r.enId;
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: r.enId, decision: 'approve' }));
  }
  await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
  const comp = (await db.doc(`competitions/${cid}`).get()).data()!;
  const first = comp.firstMatchAt.toMillis();
  const last = comp.lastMatchAt.toMillis();
  const days = [taipeiYmd(first), taipeiYmd(last)].filter((d, i, a) => a.indexOf(d) === i);
  const nameOf = Object.fromEntries(Object.entries(enIdOf).map(([n, id]) => [id, n]));
  return { cid, dvId, enIdOf, nameOf, days };
}

export function scheduleInput(c: Comp, over: Record<string, unknown> = {}) {
  return {
    action: 'generateSchedule', cid: c.cid, dvId: c.dvId, legs: 1, matchMinutes: 20, bufferMinutes: 5,
    days: c.days.map(date => ({ date, start: '08:00', end: '20:00' })), venueIdx: [0, 1], seed: 7, ...over
  };
}

export interface MatchDoc { id: string; status: string; rev: number; home: { teamId: string; name: string }; away: { teamId: string; name: string }; [k: string]: unknown }

export async function matchesOf(c: Comp): Promise<MatchDoc[]> {
  const s = await adminDb().collection(`competitions/${c.cid}/matches`).where('divisionId', '==', c.dvId).get();
  return s.docs.map(d => ({ id: d.id, ...d.data() }) as MatchDoc).sort((a, b) => Number(a.matchNo) - Number(b.matchNo));
}

/** 產生賽程，並對每一場模擬一次觸發器（before = null）。 */
export async function generate(c: Comp, who: Who = ADMIN, over: Record<string, unknown> = {}, deps: CpDeps = makeDeps()) {
  const r = await ok<Record<string, unknown>>(call(handleCpHost, who, scheduleInput(c, over), deps));
  for (const m of await matchesOf(c)) await handleMatchWritten(deps, c.cid, m.id, null, m);
  return r;
}

/** 對單場動作：呼叫前讀 before，成功後跑觸發器處理函式。 */
export async function act<T = Record<string, unknown>>(c: Comp, who: Who, data: Record<string, unknown>, deps: CpDeps = later()): Promise<T> {
  const ref = adminDb().doc(`competitions/${c.cid}/matches/${String(data.mtId)}`);
  const before = (await ref.get()).data() ?? null;
  const r = await ok<T>(call(handleCpHost, who, { cid: c.cid, ...data }, deps));
  const after = (await ref.get()).data() ?? null;
  await handleMatchWritten(deps, c.cid, String(data.mtId), before, after);
  return r;
}

/** 找某兩隊的那一場，並依主客方向回傳比分寫法。 */
export function pairing(c: Comp, ms: MatchDoc[], home: string, away: string, hs: number, as: number) {
  const h = c.enIdOf[home];
  const a = c.enIdOf[away];
  const m = ms.find(x => (x.home.teamId === h && x.away.teamId === a) || (x.home.teamId === a && x.away.teamId === h));
  if (!m) throw new Error(`找不到 ${home} vs ${away}`);
  const flipped = m.home.teamId === a;
  return { m, score: flipped ? { home: as, away: hs } : { home: hs, away: as } };
}

export async function record(c: Comp, home: string, away: string, hs: number, as: number, confirm = true, who: Who = ADMIN) {
  const ms = await matchesOf(c);
  const { m, score } = pairing(c, ms, home, away, hs, as);
  return act(c, who, { action: 'recordResult', mtId: m.id, expectedRev: m.rev, score, confirm });
}

export async function standingOf(c: Comp) {
  const s = await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get();
  return s.data() as { rows: Array<{ teamId: string; name: string; points: number; played: number; win: number; draw: number; loss: number; goalsFor: number; goalsAgainst: number; goalDiff: number; rank?: number }>; version: number; hasUnresolvedTie: boolean } | undefined;
}

export const orderNames = (c: Comp, rows: Array<{ teamId: string }>) => rows.map(r => c.nameOf[r.teamId]);
