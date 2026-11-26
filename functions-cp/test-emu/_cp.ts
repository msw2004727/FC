/**
 * Callable 模擬器測試共用：兩個庫（asia-main＋(default)）、身分、呼叫、種資料。
 * 身分代號（不含真實 uid）：
 *  admin    claims role=admin
 *  tester   內部期測試者；club_a 代表＋成員
 *  tester2  內部期測試者；club_a 成員（非代表）
 *  tester3  內部期測試者；非任何俱樂部成員
 *  stranger 一般會員
 */
import { expect } from 'vitest';
import { adminDb, clearDb, loadRules } from '../test-rules/_harness.js';
import { runCallable, type Handler } from '../src/cp/callable.js';
import { ReadMeter, type CpDeps } from '../src/cp/context.js';

export const DAY = 86400_000;
export const MAIN = '(default)';

export function makeDeps(offsetMs = 0, meter?: ReadMeter): CpDeps {
  return { db: adminDb(), mainDb: adminDb(MAIN), now: () => new Date(Date.now() + offsetMs), ...(meter ? { meter } : {}) };
}

export type Who = { uid: string; role?: string };
export const ADMIN: Who = { uid: 'admin', role: 'admin' };
export const TESTER: Who = { uid: 'tester' };
export const TESTER2: Who = { uid: 'tester2' };
export const TESTER3: Who = { uid: 'tester3' };
export const STRANGER: Who = { uid: 'stranger' };

export async function call(handler: Handler, who: Who | null, data: Record<string, unknown>, deps: CpDeps = makeDeps()) {
  return runCallable(deps, who ? { uid: who.uid, token: who.role ? { role: who.role } : {} } : null, data, handler);
}

export async function ok<T = Record<string, unknown>>(p: ReturnType<typeof call>): Promise<T> {
  const out = await p;
  if (!out.ok) throw new Error(`預期成功卻失敗：${out.error.code} ${out.error.reason} ${JSON.stringify(out.error.params ?? {})} ${(out.cause as Error)?.message ?? ''}`);
  return out.result as T;
}

export async function fails(p: ReturnType<typeof call>, reason: string, code?: string): Promise<void> {
  const out = await p;
  expect(out.ok, `預期 ${reason} 卻成功`).toBe(false);
  if (!out.ok) {
    expect(out.error.reason).toBe(reason);
    if (code) expect(out.error.code).toBe(code);
  }
}

export const SUGGESTED = ['協會', '协会', '聯盟', '联盟', '官方', '足協', '足协', '總會', '总会', 'federation', 'association', 'official'];
/** 設定管理員禁用詞清單（預設空清單＝不擋） */
export async function setBannedWords(words: string[] = SUGGESTED): Promise<void> {
  await adminDb().doc('cpConfig/launch').set({ bannedWords: words }, { merge: true });
}

export async function resetAll(opts: { isPublic?: boolean } = {}): Promise<void> {
  await loadRules();
  await clearDb();
  await clearDb(MAIN);
  const db = adminDb();
  const b = db.batch();
  b.set(db.doc('cpConfig/launch'), { isPublic: opts.isPublic === true });
  for (const t of ['tester', 'tester2', 'tester3']) b.set(db.doc(`cpConfig/launch/testers/${t}`), { addedAt: new Date() });
  b.set(db.doc('cpClubs/club_a'), { repUids: ['tester'], name: '甲隊足球俱樂部', srcUpdatedAt: new Date() });
  b.set(db.doc('cpClubs/club_noname'), { repUids: ['tester'] });
  await b.commit();
  const m = adminDb(MAIN);
  const mb = m.batch();
  mb.set(m.doc('users/admin'), { displayName: '管理員甲', birthday: '1985/01/01' });
  // 俱樂部成員身分看主站 users 的 teamIds／teamId（規則 E，顧問 §3.839）；tester 是代表、不在 teamIds 也能登錄
  mb.set(m.doc('users/tester'), { displayName: '代表乙', birthday: '1990/05/05' });
  mb.set(m.doc('users/tester2'), { displayName: '球員丙', birthday: '1995/07/07', teamIds: ['club_a'], teamId: 'club_a' });
  mb.set(m.doc('users/tester3'), { displayName: '路人丁' });
  mb.set(m.doc('users/stranger'), { displayName: '陌生人', birthday: '1992/02/02', teamIds: ['club_a'], teamId: 'club_a' });
  await mb.commit();
}

/** 標準建賽輸入（相對現在：報名已開、10 天後截止、20 天後首場）。 */
export function createInput(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    action: 'create', name: '【測試】週末盃', hostType: 'personal', sport: 'football', timezone: 'Asia/Taipei',
    regOpenAt: now - DAY, regCloseAt: now + 10 * DAY, firstMatchAt: now + 20 * DAY, lastMatchAt: now + 21 * DAY,
    venues: [{ name: 'A 場', address: '台北市' }],
    divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }],
    ...over
  };
}

/** 掃描 asia-main 全部文件，回傳是否有任何欄位名稱或值命中 pred（驗證生日沒被寫入）。 */
export async function scanAll(paths: string[], pred: (k: string, v: unknown) => boolean): Promise<string[]> {
  const hits: string[] = [];
  const db = adminDb();
  const walk = (prefix: string, o: unknown) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (pred(k, v)) hits.push(`${prefix}.${k}`);
      if (v && typeof v === 'object' && !(v instanceof Date) && !('toMillis' in (v as object))) walk(`${prefix}.${k}`, v);
    }
  };
  for (const p of paths) {
    const snap = await db.collection(p).get();
    snap.docs.forEach(d => walk(d.ref.path, d.data()));
  }
  return hits;
}
