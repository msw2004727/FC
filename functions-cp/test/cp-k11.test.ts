/**
 * K11 邀請記分員純函式（不需模擬器）：代碼雜湊與比對、到期、額度、顯示名清理、接受時的指派合併。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CpError } from '../src/cp/errors.js';
import {
  INVITE_CODE_RE,
  SCORE_ASSIGN_MS,
  inviteCodeHash,
  inviteCodeMatches,
  inviteSeqOf,
  mergeInviteAssignment,
  newInviteCode,
  resolveInviteExpiresAt,
  staffDisplayName
} from '../src/cp/staff-host.js';

const reasonOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof CpError ? e.reason : 'OTHER'; }
  return 'NO_ERROR';
};

describe('邀請代碼', () => {
  it('22 字 base64url、每次不同；雜湊＝sha256 十六進位', () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a).toMatch(INVITE_CODE_RE);
    expect(a).not.toBe(b);
    expect(inviteCodeHash(a)).toBe(createHash('sha256').update(a).digest('hex'));
  });
  it('比對：相符才 true；錯碼、壞雜湊、非字串一律 false', () => {
    const code = newInviteCode();
    const h = inviteCodeHash(code);
    expect(inviteCodeMatches(code, h)).toBe(true);
    expect(inviteCodeMatches(newInviteCode(), h)).toBe(false);
    expect(inviteCodeMatches(code, h.toUpperCase())).toBe(false);
    expect(inviteCodeMatches(code, h.slice(0, 63))).toBe(false);
    expect(inviteCodeMatches(code, null)).toBe(false);
    expect(inviteCodeMatches(code, code)).toBe(false);
  });
});

describe('邀請到期與額度', () => {
  const last = Date.UTC(2026, 11, 1);
  it('沒帶＝末場＋7 天；帶了限現在～末場＋7 天', () => {
    expect(resolveInviteExpiresAt(null, last, last - 1000)).toBe(last + SCORE_ASSIGN_MS);
    expect(resolveInviteExpiresAt(last, last, last - 1000)).toBe(last);
    expect(reasonOf(() => resolveInviteExpiresAt(last + SCORE_ASSIGN_MS + 1, last, last - 1000))).toBe('FIELD_RANGE');
    expect(reasonOf(() => resolveInviteExpiresAt(last - 2000, last, last - 1000))).toBe('FIELD_RANGE');
    expect(reasonOf(() => resolveInviteExpiresAt(null, last, last + SCORE_ASSIGN_MS + 1))).toBe('FIELD_RANGE');
  });
  it('inviteSeq 缺值或壞值當 0', () => {
    expect(inviteSeqOf(undefined)).toBe(0);
    expect(inviteSeqOf(-1)).toBe(0);
    expect(inviteSeqOf(2.5)).toBe(0);
    expect(inviteSeqOf('3')).toBe(0);
    expect(inviteSeqOf(29)).toBe(29);
  });
});

describe('staff 顯示名', () => {
  it('清理、截 30 字；空或禁用字回 null', () => {
    expect(staffDisplayName('  小明​ ', [])).toBe('小明');
    expect(staffDisplayName('', [])).toBeNull();
    expect(staffDisplayName('   ', [])).toBeNull();
    expect(staffDisplayName(null, [])).toBeNull();
    expect(staffDisplayName(42, [])).toBeNull();
    expect(staffDisplayName('官 方記分', ['官方'])).toBeNull();
    expect([...staffDisplayName('字'.repeat(40), [])!].length).toBe(30);
  });
});

describe('接受邀請的指派合併', () => {
  const MT = (c: string) => 'mt_' + c.repeat(20);
  const NOW = 2000;
  it('新人：角色、場次、到期照邀請', () => {
    const r = mergeInviteAssignment({
      existing: { roles: [], matchIds: [], expiresAtMs: null },
      invite: { roles: ['referee'], matchIds: [MT('a')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(r).toEqual({ roles: ['referee'], scoreRoles: ['referee'], matchIds: [MT('a')], expiresAtMs: 9000 });
  });
  it('已是有效記分員：角色與場次聯集，到期不動（顧問「已有的不動」）；原本不過期保留 null', () => {
    const r = mergeInviteAssignment({
      existing: { roles: ['scorer'], matchIds: [MT('a')], expiresAtMs: 5000 },
      invite: { roles: ['referee'], matchIds: [MT('a'), MT('b')], expiresAtMs: 9000 }, nowMs: NOW
    });
    // Opus 審 P2：原本取較晚者會把舊場次延長到 9000；改為維持 5000
    expect(r).toEqual({ roles: ['scorer', 'referee'], scoreRoles: ['scorer', 'referee'], matchIds: [MT('a'), MT('b')], expiresAtMs: 5000 });
    const keep = mergeInviteAssignment({
      existing: { roles: ['referee'], matchIds: [], expiresAtMs: null },
      invite: { roles: ['scorer'], matchIds: [MT('c')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(keep.expiresAtMs).toBeNull();
  });
  it('原本的記分指派已過期：視同沒有指派，舊場次不復活，場次與到期只用邀請的（Opus 審 P2）', () => {
    const r = mergeInviteAssignment({
      existing: { roles: ['scorer'], matchIds: [MT('a')], expiresAtMs: 1500 },
      invite: { roles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(r).toEqual({ roles: ['scorer'], scoreRoles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 });
    // 剛好等於現在也算過期（與 Rules request.time < expiresAt 一致）
    const edge = mergeInviteAssignment({
      existing: { roles: ['referee'], matchIds: [MT('a')], expiresAtMs: NOW },
      invite: { roles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(edge).toEqual({ roles: ['scorer'], scoreRoles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 });
  });
  it('過期的舊指派不保留舊記分角色，host／coHost 照樣保留', () => {
    const r = mergeInviteAssignment({
      existing: { roles: ['coHost', 'referee'], matchIds: [MT('a')], expiresAtMs: 100 },
      invite: { roles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(r).toEqual({ roles: ['coHost', 'scorer'], scoreRoles: ['scorer'], matchIds: [MT('b')], expiresAtMs: 9000 });
  });
  it('主辦（host、expiresAt null、沒有記分角色）接受：host 保留、到期改用邀請', () => {
    const r = mergeInviteAssignment({
      existing: { roles: ['host'], matchIds: [], expiresAtMs: null },
      invite: { roles: ['scorer'], matchIds: [MT('a')], expiresAtMs: 9000 }, nowMs: NOW
    });
    expect(r).toEqual({ roles: ['host', 'scorer'], scoreRoles: ['scorer'], matchIds: [MT('a')], expiresAtMs: 9000 });
  });
  it('合併後超過 100 場回 FIELD_RANGE', () => {
    const many = Array.from({ length: 100 }, (_, i) => 'mt_' + String(i).padStart(20, 'x'));
    expect(reasonOf(() => mergeInviteAssignment({
      existing: { roles: ['scorer'], matchIds: many, expiresAtMs: 9000 },
      invite: { roles: ['scorer'], matchIds: [MT('z')], expiresAtMs: 9000 }, nowMs: NOW
    }))).toBe('FIELD_RANGE');
  });
});
