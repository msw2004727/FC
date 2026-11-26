/**
 * CP-PO-04 共同主辦邀請純函式測試（不需模擬器）：inviteRolesInput、coHostMatchIdsInput、
 * resolveCoHostInviteExpiresAt、coHostCountOf、decideCoHostAccept、issuerOf。
 */
import { describe, expect, it } from 'vitest';
import { CpError } from '../src/cp/errors.js';
import type { Caller, CompDoc } from '../src/cp/context.js';
import {
  COHOST_INVITE_MAX_MS,
  COHOST_INVITE_TTL_MS,
  coHostCountOf,
  coHostMatchIdsInput,
  decideCoHostAccept,
  inviteRolesInput,
  issuerOf,
  resolveCoHostInviteExpiresAt
} from '../src/cp/staff-host.js';

const DAY = 86400_000;
const reasonOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as CpError).reason; }
  return 'NO_ERROR';
};

describe('inviteRolesInput', () => {
  it("['coHost'] → { coHost: true }", () => {
    expect(inviteRolesInput(['coHost'])).toEqual({ coHost: true });
  });
  it('coHost 與 scorer／coHost 混用 → FIELD_ENUM', () => {
    expect(reasonOf(() => inviteRolesInput(['coHost', 'scorer']))).toBe('FIELD_ENUM');
    expect(reasonOf(() => inviteRolesInput(['coHost', 'coHost']))).toBe('FIELD_ENUM');
  });
  it("['host'] 沿用 scoreRolesInput → FIELD_ENUM", () => {
    expect(reasonOf(() => inviteRolesInput(['host']))).toBe('FIELD_ENUM');
  });
  it('非陣列 → FIELD_TYPE', () => {
    expect(reasonOf(() => inviteRolesInput('x'))).toBe('FIELD_TYPE');
  });
  it("['scorer'] 交給 scoreRolesInput", () => {
    expect(inviteRolesInput(['scorer'])).toEqual({ coHost: false, roles: ['scorer'] });
    expect(reasonOf(() => inviteRolesInput(['scorer', 'unknown']))).toBe('FIELD_ENUM');
  });
});

describe('coHostMatchIdsInput', () => {
  it('undefined 與 [] 過', () => {
    expect(coHostMatchIdsInput(undefined)).toEqual([]);
    expect(coHostMatchIdsInput(null)).toEqual([]);
    expect(coHostMatchIdsInput([])).toEqual([]);
  });
  it('非空陣列 → FIELD_RANGE', () => {
    expect(reasonOf(() => coHostMatchIdsInput(['mt_' + 'a'.repeat(20)]))).toBe('FIELD_RANGE');
    expect(reasonOf(() => coHostMatchIdsInput(['x']))).toBe('FIELD_RANGE');
  });
});

describe('resolveCoHostInviteExpiresAt', () => {
  const now = 1_000_000_000_000;
  it('預設 now+3 天（末場很遠）', () => {
    expect(resolveCoHostInviteExpiresAt(null, now + 10 * DAY, now)).toBe(now + COHOST_INVITE_TTL_MS);
  });
  it('末場 1 天後：預設 now+3 天，上限 min(now+7d, 末場+7d) = now+7d', () => {
    const last = now + DAY;
    const cap = Math.min(now + COHOST_INVITE_MAX_MS, last + 7 * DAY);
    expect(cap).toBe(now + 7 * DAY);
    expect(resolveCoHostInviteExpiresAt(null, last, now)).toBe(now + COHOST_INVITE_TTL_MS);
    expect(resolveCoHostInviteExpiresAt(cap, last, now)).toBe(cap);
  });
  it('now+8d 超上限 → FIELD_RANGE', () => {
    const last = now + 10 * DAY;
    expect(reasonOf(() => resolveCoHostInviteExpiresAt(now + 8 * DAY, last, now))).toBe('FIELD_RANGE');
    expect(reasonOf(() => resolveCoHostInviteExpiresAt(now + 7 * DAY + 1, last, now))).toBe('FIELD_RANGE');
  });
  it('過去 → FIELD_RANGE', () => {
    expect(reasonOf(() => resolveCoHostInviteExpiresAt(now - 1000, now + 10 * DAY, now))).toBe('FIELD_RANGE');
  });
  it('末場早已過 → cap < now → FIELD_RANGE（預設也算不出）', () => {
    const last = now - 10 * DAY;
    expect(reasonOf(() => resolveCoHostInviteExpiresAt(null, last, now))).toBe('FIELD_RANGE');
  });
});

describe('decideCoHostAccept', () => {
  it('含 host → ALREADY_HOST（即使有 scorer）', () => {
    expect(decideCoHostAccept(['host'])).toEqual({ ok: false, reason: 'ALREADY_HOST' });
    expect(decideCoHostAccept(['host', 'scorer'])).toEqual({ ok: false, reason: 'ALREADY_HOST' });
  });
  it('含 coHost → ALREADY_COHOST', () => {
    expect(decideCoHostAccept(['coHost'])).toEqual({ ok: false, reason: 'ALREADY_COHOST' });
    expect(decideCoHostAccept(['coHost', 'scorer'])).toEqual({ ok: false, reason: 'ALREADY_COHOST' });
  });
  it('空 → ok，coHost 為第一項', () => {
    expect(decideCoHostAccept([])).toEqual({ ok: true, roles: ['coHost'] });
  });
  it('scorer 保留在 coHost 之後', () => {
    expect(decideCoHostAccept(['scorer'])).toEqual({ ok: true, roles: ['coHost', 'scorer'] });
  });
});

describe('issuerOf', () => {
  const personal = { hostType: 'personal' } as unknown as CompDoc;
  const club = { hostType: 'club' } as unknown as CompDoc;
  const caller = (role: string | null): Caller => ({ uid: 'x', role });
  it('admin（含 super_admin）', () => {
    expect(issuerOf(caller('admin'), personal)).toBe('admin');
    expect(issuerOf(caller('super_admin'), club)).toBe('admin');
  });
  it('clubRep', () => {
    expect(issuerOf(caller(null), club)).toBe('clubRep');
  });
  it('host', () => {
    expect(issuerOf(caller(null), personal)).toBe('host');
  });
});

describe('coHostCountOf', () => {
  it('缺值、-1、1.5、NaN、字串 → 0', () => {
    expect(coHostCountOf(undefined)).toBe(0);
    expect(coHostCountOf(null)).toBe(0);
    expect(coHostCountOf(-1)).toBe(0);
    expect(coHostCountOf(1.5)).toBe(0);
    expect(coHostCountOf(NaN)).toBe(0);
    expect(coHostCountOf('2')).toBe(0);
  });
  it('2 → 2；0 → 0', () => {
    expect(coHostCountOf(2)).toBe(2);
    expect(coHostCountOf(0)).toBe(0);
  });
});
