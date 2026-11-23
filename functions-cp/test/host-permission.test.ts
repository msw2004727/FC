/**
 * 主辦賽事開關（顧問 §3.612）：真值表與 createCompetition 守門（不需模擬器，用假 deps）。
 * 真值表與新站 src/features/profile/data/default-on-codes.test.ts 同一組。
 */
import { describe, expect, it } from 'vitest';
import { runCallable } from '../src/cp/callable.js';
import { ReadMeter, type Caller, type CpDeps, type GateResult } from '../src/cp/context.js';
import { CpError } from '../src/cp/errors.js';
import { HOST_ACTIONS, createCompetition, handleCpHost } from '../src/cp/host.js';
import {
  COMPETITION_HOST_CODE,
  USER_COMPETITION_HOST_CODE,
  assertCanHostCompetition,
  hostPermissionSource,
  isDefaultOnCodeEnabled
} from '../src/cp/host-permission.js';

describe('isDefaultOnCodeEnabled 真值表', () => {
  const code = COMPETITION_HOST_CODE;
  it.each([
    ['undefined（文件或欄位不存在）', undefined, true],
    ['陣列且含碼', [code], false],
    ['陣列且含碼（夾雜其他值）', ['other', 3, code], false],
    ['陣列且不含碼', ['other.code'], true],
    ['空陣列', [], true],
    ['null', null, false],
    ['字串（即使等於碼）', code, false],
    ['物件', { [code]: true }, false],
    ['數字', 0, false],
    ['布林', false, false]
  ] as const)('%s', (_name, raw, expected) => {
    expect(isDefaultOnCodeEnabled(raw, code)).toBe(expected);
  });
  it('只認完全相同的碼', () => {
    expect(isDefaultOnCodeEnabled([USER_COMPETITION_HOST_CODE], COMPETITION_HOST_CODE)).toBe(true);
    expect(isDefaultOnCodeEnabled([COMPETITION_HOST_CODE], USER_COMPETITION_HOST_CODE)).toBe(true);
  });
});

describe('hostPermissionSource', () => {
  it.each([
    [null, { path: 'roleActivityCapabilities/user', code: 'user.competition.host' }],
    ['', { path: 'roleActivityCapabilities/user', code: 'user.competition.host' }],
    ['user', { path: 'roleActivityCapabilities/user', code: 'user.competition.host' }],
    ['coach', { path: 'rolePermissions/coach', code: 'competition.host' }],
    ['admin', { path: 'rolePermissions/admin', code: 'competition.host' }],
    ['custom_x', { path: 'rolePermissions/custom_x', code: 'competition.host' }],
    ['super_admin', null]
  ] as const)('%j', (role, expected) => {
    expect(hostPermissionSource(role)).toEqual(expected);
  });
});

// ── 假 deps ───────────────────────────────────────────────────────────
type DocVal = Record<string, unknown> | 'throw';
const TX_REACHED = 'TX_REACHED';
const NOW = Date.UTC(2027, 0, 1, 4, 0);
const DAY = 86400_000;

function fakeDeps(mainDocs: Record<string, DocVal> = {}, cpDocs: Record<string, DocVal> = {}) {
  const meter = new ReadMeter();
  const reads: string[] = [];
  const makeDb = (name: string, docs: Record<string, DocVal>) => ({
    doc: (path: string) => ({
      path,
      get: async () => {
        reads.push(`${name}:${path}`);
        const v = docs[path];
        if (v === 'throw') throw new Error('synthetic-read-failure');
        return { exists: v !== undefined, get: (field: string) => (v === undefined ? undefined : v[field]) };
      }
    }),
    // 走到交易就停：證明主辦檢查已通過。
    runTransaction: async () => { throw new Error(TX_REACHED); }
  });
  const deps = {
    db: makeDb('cp', cpDocs),
    mainDb: makeDb('main', mainDocs),
    now: () => new Date(NOW),
    meter
  } as unknown as CpDeps;
  return { deps, meter, reads };
}

const GATE: GateResult = { isPublic: true, privileged: false, bannedWords: [] };
function input(over: Record<string, unknown> = {}) {
  return {
    action: 'create', name: '測試盃', hostType: 'personal', hostDisplay: '王示範', sport: 'football', timezone: 'Asia/Taipei',
    regOpenAt: NOW - DAY, regCloseAt: NOW + 10 * DAY, firstMatchAt: NOW + 20 * DAY, lastMatchAt: NOW + 21 * DAY,
    venues: [{ name: 'A 場', address: '台北市' }],
    divisions: [{ name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }],
    ...over
  };
}

async function outcome(deps: CpDeps, caller: Caller, data = input()): Promise<string> {
  try {
    await createCompetition(deps, caller, GATE, data);
    return 'NO_ERROR';
  } catch (e) {
    if (e instanceof CpError) return `${e.code}:${e.reason}`;
    return (e as Error).message;
  }
}

const USER_DOC = 'roleActivityCapabilities/user';
describe('createCompetition 主辦開關', () => {
  it('super_admin 不讀文件即通過', async () => {
    const { deps, reads, meter } = fakeDeps({ 'rolePermissions/super_admin': { disabledCodes: [COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: 'super_admin' })).toBe(TX_REACHED);
    expect(reads).toEqual([]);
    expect(meter.reads).toBe(0);
  });
  it('user 文件不存在 → 通過，多 1 讀', async () => {
    const { deps, reads, meter } = fakeDeps();
    expect(await outcome(deps, { uid: 'u1', role: null })).toBe(TX_REACHED);
    expect(reads).toEqual([`main:${USER_DOC}`]);
    expect(meter.reads).toBe(1);
  });
  it('空字串角色當 user', async () => {
    const { deps, reads } = fakeDeps({ [USER_DOC]: { disabledCodes: [USER_COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: '' })).toBe('permission-denied:HOST_DISABLED');
    expect(reads).toEqual([`main:${USER_DOC}`]);
  });
  it('user 文件存在但沒有欄位 → 通過', async () => {
    const { deps } = fakeDeps({ [USER_DOC]: { capabilities: [] } });
    expect(await outcome(deps, { uid: 'u1', role: 'user' })).toBe(TX_REACHED);
  });
  it('user disabledCodes 含碼 → HOST_DISABLED，不進交易', async () => {
    const { deps, reads } = fakeDeps({ [USER_DOC]: { disabledCodes: [USER_COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: 'user' })).toBe('permission-denied:HOST_DISABLED');
    expect(reads).toEqual([`main:${USER_DOC}`]);
  });
  it('user 只關教練碼 → 通過', async () => {
    const { deps } = fakeDeps({ [USER_DOC]: { disabledCodes: [COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: 'user' })).toBe(TX_REACHED);
  });
  it.each([null, 'user.competition.host', { a: 1 }, 3])('user 壞值 %j → HOST_DISABLED', async bad => {
    const { deps } = fakeDeps({ [USER_DOC]: { disabledCodes: bad } });
    expect(await outcome(deps, { uid: 'u1', role: 'user' })).toBe('permission-denied:HOST_DISABLED');
  });
  it('coach 文件缺欄位 → 通過；空陣列 → 通過', async () => {
    expect(await outcome(fakeDeps({ 'rolePermissions/coach': { permissions: [] } }).deps, { uid: 'u1', role: 'coach' })).toBe(TX_REACHED);
    expect(await outcome(fakeDeps({ 'rolePermissions/coach': { disabledCodes: [] } }).deps, { uid: 'u1', role: 'coach' })).toBe(TX_REACHED);
    expect(await outcome(fakeDeps().deps, { uid: 'u1', role: 'coach' })).toBe(TX_REACHED);
  });
  it('coach 含碼 → 拒絕；coach 不看 user 碼也不看 permissions 陣列', async () => {
    const { deps, reads } = fakeDeps({ 'rolePermissions/coach': { disabledCodes: [COMPETITION_HOST_CODE], permissions: [COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: 'coach' })).toBe('permission-denied:HOST_DISABLED');
    expect(reads).toEqual(['main:rolePermissions/coach']);
    expect(await outcome(fakeDeps({ 'rolePermissions/coach': { disabledCodes: [USER_COMPETITION_HOST_CODE], permissions: [] } }).deps,
      { uid: 'u1', role: 'coach' })).toBe(TX_REACHED);
  });
  it('admin 也照開關（不特別放行）', async () => {
    const { deps } = fakeDeps({ 'rolePermissions/admin': { disabledCodes: [COMPETITION_HOST_CODE] } });
    expect(await outcome(deps, { uid: 'u1', role: 'admin' })).toBe('permission-denied:HOST_DISABLED');
  });
  it('自訂角色讀 rolePermissions/{role}', async () => {
    const off = fakeDeps({ 'rolePermissions/custom_x': { disabledCodes: [COMPETITION_HOST_CODE] } });
    expect(await outcome(off.deps, { uid: 'u1', role: 'custom_x' })).toBe('permission-denied:HOST_DISABLED');
    expect(off.reads).toEqual(['main:rolePermissions/custom_x']);
    expect(await outcome(fakeDeps().deps, { uid: 'u1', role: 'custom_x' })).toBe(TX_REACHED);
  });
  it('角色含「/」不讀、直接拒絕', async () => {
    const { deps, reads } = fakeDeps();
    expect(await outcome(deps, { uid: 'u1', role: 'a/b/c' })).toBe('permission-denied:HOST_DISABLED');
    expect(reads).toEqual([]);
  });
  it('讀取失敗 → unavailable HOST_PERMISSION_UNAVAILABLE', async () => {
    expect(await outcome(fakeDeps({ [USER_DOC]: 'throw' }).deps, { uid: 'u1', role: 'user' }))
      .toBe('unavailable:HOST_PERMISSION_UNAVAILABLE');
    expect(await outcome(fakeDeps({ 'rolePermissions/coach': 'throw' }).deps, { uid: 'u1', role: 'coach' }))
      .toBe('unavailable:HOST_PERMISSION_UNAVAILABLE');
  });
  it('個別授權（userPermissionGrants）不讀', async () => {
    const { deps, reads } = fakeDeps();
    await outcome(deps, { uid: 'u1', role: 'coach' });
    expect(reads.some(path => path.includes('userPermissionGrants'))).toBe(false);
  });
  it('assertCanHostCompetition 單獨呼叫：通過不丟錯', async () => {
    await expect(assertCanHostCompetition(fakeDeps().deps, { uid: 'u1', role: 'user' })).resolves.toBeUndefined();
  });
});

describe('Callable 外殼', () => {
  it('未登入照舊擋在 callerOf（SIGN_IN_REQUIRED），不讀任何文件', async () => {
    const { deps, reads } = fakeDeps();
    const out = await runCallable(deps, null, input(), handleCpHost);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatchObject({ code: 'unauthenticated', reason: 'SIGN_IN_REQUIRED' });
    expect(reads).toEqual([]);
  });
  it('內部期一般會員照舊由 launchGate 擋（INTERNAL_PERIOD），不讀主辦文件', async () => {
    const { deps, reads } = fakeDeps({}, { 'cpConfig/launch': { isPublic: false } });
    const out = await runCallable(deps, { uid: 'u1', token: {} }, input(), handleCpHost);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatchObject({ code: 'permission-denied', reason: 'INTERNAL_PERIOD' });
    expect(reads.some(path => path.startsWith('main:'))).toBe(false);
  });
  it('關閉時錯誤外形是 permission-denied HOST_DISABLED；讀取失敗是 unavailable', async () => {
    const off = fakeDeps({ [USER_DOC]: { disabledCodes: [USER_COMPETITION_HOST_CODE] } }, { 'cpConfig/launch': { isPublic: true } });
    const a = await runCallable(off.deps, { uid: 'u1', token: {} }, input(), handleCpHost);
    expect(a.ok ? null : a.error).toEqual({ code: 'permission-denied', reason: 'HOST_DISABLED' });
    const fail = fakeDeps({ [USER_DOC]: 'throw' }, { 'cpConfig/launch': { isPublic: true } });
    const b = await runCallable(fail.deps, { uid: 'u1', token: {} }, input(), handleCpHost);
    expect(b.ok ? null : b.error).toEqual({ code: 'unavailable', reason: 'HOST_PERMISSION_UNAVAILABLE' });
  });
  it('只有 create 會讀主辦文件：update 等其他動作不經過這個檢查', async () => {
    expect(Object.keys(HOST_ACTIONS)).toContain('update');
    const { deps, reads } = fakeDeps({ [USER_DOC]: { disabledCodes: [USER_COMPETITION_HOST_CODE] } }, { 'cpConfig/launch': { isPublic: true } });
    const out = await runCallable(deps, { uid: 'u1', token: {} }, { action: 'update', cid: 'cp_' + 'A'.repeat(20) }, handleCpHost);
    expect(out.ok ? null : out.error.reason).not.toBe('HOST_DISABLED');
    expect(reads).not.toContain(`main:${USER_DOC}`);
  });
});
