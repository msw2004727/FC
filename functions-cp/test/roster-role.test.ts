import { describe, expect, it } from 'vitest';
import { ROSTER_ROLES, rosterRoleOf } from '../src/cp/main-profile.js';

describe('rosterRoleOf（名單身分快照，FC-B 活動名單算法）', () => {
  it('白名單 7 個各自原樣回傳', () => {
    for (const r of ROSTER_ROLES) {
      expect(rosterRoleOf(r, undefined)).toBe(r);
    }
    expect(rosterRoleOf('user', undefined)).toBe('user');
    expect(rosterRoleOf('coach', undefined)).toBe('coach');
    expect(rosterRoleOf('captain', undefined)).toBe('captain');
    expect(rosterRoleOf('team_leader', undefined)).toBe('team_leader');
    expect(rosterRoleOf('venue_owner', undefined)).toBe('venue_owner');
    expect(rosterRoleOf('admin', undefined)).toBe('admin');
    expect(rosterRoleOf('super_admin', undefined)).toBe('super_admin');
  });

  it('白名單外與非字串一律回 user', () => {
    expect(rosterRoleOf('hacker', undefined)).toBe('user');
    expect(rosterRoleOf('', undefined)).toBe('user');
    expect(rosterRoleOf(null, undefined)).toBe('user');
    expect(rosterRoleOf(undefined, undefined)).toBe('user');
    expect(rosterRoleOf(123, undefined)).toBe('user');
  });

  it('admin／super_admin 開隱身（stealth true）→ user', () => {
    expect(rosterRoleOf('admin', true)).toBe('user');
    expect(rosterRoleOf('super_admin', true)).toBe('user');
  });

  it('隱身只對管理員：coach＋stealth true → coach', () => {
    expect(rosterRoleOf('coach', true)).toBe('coach');
    expect(rosterRoleOf('team_leader', true)).toBe('team_leader');
  });

  it('stealth 是字串 \'true\' 不算隱身', () => {
    expect(rosterRoleOf('admin', 'true')).toBe('admin');
    expect(rosterRoleOf('super_admin', 'true')).toBe('super_admin');
  });
});
