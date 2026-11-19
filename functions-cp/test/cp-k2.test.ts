/**
 * K2 指派純函式（不需模擬器）：角色合併、移除保護、記分守門、到期、Rules assignedData 同一條件。
 */
import { describe, expect, it } from 'vitest';
import { CpError } from '../src/cp/errors.js';
import {
  SCORE_ASSIGN_MS,
  assertMayTouchStaff,
  assignedDataOk,
  decideRemoval,
  resolveExpiresAt,
  staffRolesAfterAssign
} from '../src/cp/staff-host.js';

const reasonOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof CpError ? e.reason : 'OTHER'; }
  return 'NO_ERROR';
};

describe('assignStaff 角色合併', () => {
  it('保留 host／coHost，記分角色整組換掉', () => {
    expect(staffRolesAfterAssign(['host'], ['scorer'])).toEqual(['host', 'scorer']);
    expect(staffRolesAfterAssign(['host', 'scorer', 'referee'], ['referee'])).toEqual(['host', 'referee']);
    expect(staffRolesAfterAssign(['coHost'], ['referee', 'scorer'])).toEqual(['coHost', 'scorer', 'referee']);
    expect(staffRolesAfterAssign([], ['scorer'])).toEqual(['scorer']);
  });
});

describe('removeStaff 保護', () => {
  it('主辦角色誰都不能拿掉', () => {
    expect(decideRemoval(['host'], ['host'], true)).toEqual({ ok: false, reason: 'STAFF_PROTECTED' });
    expect(decideRemoval(['host', 'scorer'], ['host', 'scorer'], true)).toEqual({ ok: false, reason: 'STAFF_PROTECTED' });
    expect(decideRemoval(['host'], ['host'], false)).toEqual({ ok: false, reason: 'STAFF_PROTECTED' });
  });
  it('共同主辦只有主辦能移除', () => {
    expect(decideRemoval(['coHost'], ['coHost'], false)).toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(decideRemoval(['coHost', 'scorer'], ['coHost'], false)).toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(decideRemoval(['coHost'], ['coHost'], true)).toEqual({
      ok: true, roles: [], scoreRoles: [], clearMatches: true
    });
  });
  it('預設只拿記分角色；主辦文件留下，純記分員刪光', () => {
    expect(decideRemoval(['host', 'scorer'], ['scorer', 'referee'], true)).toEqual({
      ok: true, roles: ['host'], scoreRoles: [], clearMatches: true
    });
    expect(decideRemoval(['scorer'], ['scorer', 'referee'], true)).toEqual({
      ok: true, roles: [], scoreRoles: [], clearMatches: true
    });
    expect(decideRemoval(['coHost', 'scorer', 'referee'], ['scorer'], false)).toEqual({
      ok: true, roles: ['coHost', 'referee'], scoreRoles: ['referee'], clearMatches: false
    });
  });
});

describe('記分指派守門', () => {
  it('四種組合', () => {
    // 1. 不是自己、不是主辦、對象有 host 或 coHost → 拒絕
    expect(reasonOf(() => assertMayTouchStaff(['host'], false, false))).toBe('FORBIDDEN');
    expect(reasonOf(() => assertMayTouchStaff(['host', 'scorer'], false, false))).toBe('FORBIDDEN');
    expect(reasonOf(() => assertMayTouchStaff(['coHost'], false, false))).toBe('FORBIDDEN');
    expect(reasonOf(() => assertMayTouchStaff(['coHost', 'referee'], false, false))).toBe('FORBIDDEN');
    // 2. 是自己、不是主辦（共同主辦改自己）→ 允許
    expect(reasonOf(() => assertMayTouchStaff(['coHost', 'scorer'], true, false))).toBe('NO_ERROR');
    expect(reasonOf(() => assertMayTouchStaff(['host'], true, false))).toBe('NO_ERROR');
    // 3. 不是自己、是主辦（個人主辦、俱樂部代表、管理員的 primary）→ 允許
    expect(reasonOf(() => assertMayTouchStaff(['host', 'scorer'], false, true))).toBe('NO_ERROR');
    expect(reasonOf(() => assertMayTouchStaff(['coHost'], false, true))).toBe('NO_ERROR');
    // 4. 是自己、又是主辦 → 允許
    expect(reasonOf(() => assertMayTouchStaff(['host', 'scorer'], true, true))).toBe('NO_ERROR');
  });
  it('對象只有記分角色時，共同主辦仍可改', () => {
    expect(reasonOf(() => assertMayTouchStaff(['scorer'], false, false))).toBe('NO_ERROR');
    expect(reasonOf(() => assertMayTouchStaff(['referee'], false, false))).toBe('NO_ERROR');
    expect(reasonOf(() => assertMayTouchStaff([], false, false))).toBe('NO_ERROR');
  });
});

describe('expiresAt', () => {
  const now = 1_700_000_000_000;
  const last = now + 21 * 86400_000;
  it('省略則末場加 7 天；有給且不早於現在就用', () => {
    expect(resolveExpiresAt(null, last, now)).toBe(last + SCORE_ASSIGN_MS);
    expect(SCORE_ASSIGN_MS).toBe(7 * 86400_000);
    expect(resolveExpiresAt(now, last, now)).toBe(now);
    expect(resolveExpiresAt(now + 1000, last, now)).toBe(now + 1000);
  });
  it('早於現在（含預設已經過去）拒絕', () => {
    expect(reasonOf(() => resolveExpiresAt(now - 1, last, now))).toBe('FIELD_RANGE');
    expect(reasonOf(() => resolveExpiresAt(null, now - 8 * 86400_000, now))).toBe('FIELD_RANGE');
  });
});

describe('assignedData（對照 Rules）', () => {
  const now = 1_700_000_000_000;
  const mt = 'mt_' + 'a'.repeat(20);
  it('scorer 或 referee、場次有列、未過期才成立', () => {
    expect(assignedDataOk({ roles: ['host', 'scorer'], matchIds: [mt], expiresAtMs: now + 1 }, mt, now)).toBe(true);
    expect(assignedDataOk({ roles: ['referee'], matchIds: [mt], expiresAtMs: null }, mt, now)).toBe(true);
    expect(assignedDataOk({ roles: ['host'], matchIds: [mt], expiresAtMs: null }, mt, now)).toBe(false);
    expect(assignedDataOk({ roles: ['scorer'], matchIds: [], expiresAtMs: null }, mt, now)).toBe(false);
    expect(assignedDataOk({ roles: ['scorer'], matchIds: ['mt_' + 'b'.repeat(20)], expiresAtMs: null }, mt, now)).toBe(false);
    expect(assignedDataOk({ roles: ['scorer'], matchIds: [mt], expiresAtMs: now }, mt, now)).toBe(false);
    expect(assignedDataOk({ roles: ['scorer'], matchIds: [mt], expiresAtMs: now - 1 }, mt, now)).toBe(false);
  });
});
