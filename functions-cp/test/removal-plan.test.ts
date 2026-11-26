/**
 * 第 PII-P1 純函式測試：賽事個資移除（結束判斷、到期時間、工作 id、假名／確認碼、
 * 正規化 JSON、確認碼檢查、每場規劃）。
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUFFER_MS,
  AUDIT_KEEP_MS,
  DRY_RUN_TTL_MS,
  ENDED_GRACE_MS,
  REPORT_PURGE_MS,
  auditExpireAtMs,
  canonicalJson,
  checkConfirmToken,
  competitionEnded,
  deleteAuditExpireAtMs,
  dryRunDigest,
  newConfirmToken,
  newContactKey,
  newPseudonym,
  planCompetition,
  removalJobId,
  reportPurgeAtMs,
  type CompPlan
} from '../src/cp/removal-plan.js';

const T = (ms: number) => ({ toMillis: () => ms });

describe('competitionEnded（§4.2 結束定義）', () => {
  it('endedAt 有值 → true', () => {
    expect(competitionEnded({ endedAt: T(1_000) }, 5_000)).toBe(true);
    expect(competitionEnded({ endedAt: T(1_000), lastMatchAt: T(2_000) }, 5_000)).toBe(true);
  });

  it('lastMatchAt + 7 天：剛好相等不算，多 1ms 才算', () => {
    const last = 1_000_000;
    const boundary = last + ENDED_GRACE_MS;
    expect(competitionEnded({ lastMatchAt: T(last) }, boundary)).toBe(false);
    expect(competitionEnded({ lastMatchAt: T(last) }, boundary + 1)).toBe(true);
  });

  it('都沒有 → false', () => {
    expect(competitionEnded({}, 5_000)).toBe(false);
    expect(competitionEnded({ endedAt: null, lastMatchAt: null }, 5_000)).toBe(false);
  });
});

describe('auditExpireAtMs（§4.6 方案 T）', () => {
  it('lastMatchAt 早於寫入 → 以寫入為基準', () => {
    expect(auditExpireAtMs(2_000, 1_000)).toBe(2_000 + AUDIT_KEEP_MS + AUDIT_BUFFER_MS);
  });
  it('lastMatchAt 晚於寫入 → 以末場為基準', () => {
    expect(auditExpireAtMs(1_000, 2_000)).toBe(2_000 + AUDIT_KEEP_MS + AUDIT_BUFFER_MS);
  });
  it('lastMatchAt 為 null → 以寫入為基準', () => {
    expect(auditExpireAtMs(1_000, null)).toBe(1_000 + AUDIT_KEEP_MS + AUDIT_BUFFER_MS);
  });
  it('值等於「365 天 + 60 天」加 max', () => {
    expect(AUDIT_KEEP_MS).toBe(365 * 86400_000);
    expect(AUDIT_BUFFER_MS).toBe(60 * 86400_000);
    const max = 42_000_000;
    expect(auditExpireAtMs(max, max)).toBe(max + 425 * 86400_000);
    expect(auditExpireAtMs(0, null)).toBe(425 * 86400_000);
  });
});

describe('deleteAuditExpireAtMs（cpAudits/del_*）', () => {
  it('at + 365 天', () => {
    expect(deleteAuditExpireAtMs(0)).toBe(AUDIT_KEEP_MS);
    expect(deleteAuditExpireAtMs(123)).toBe(123 + AUDIT_KEEP_MS);
  });
});

describe('reportPurgeAtMs（§4.7 檢舉 180 天）', () => {
  it('reviewedAt + 180 天', () => {
    expect(REPORT_PURGE_MS).toBe(180 * 86400_000);
    expect(reportPurgeAtMs(0)).toBe(REPORT_PURGE_MS);
    expect(reportPurgeAtMs(1_000)).toBe(1_000 + REPORT_PURGE_MS);
  });
});

describe('removalJobId（§4.3）', () => {
  it('長度 26、前綴 u_、格式 hex24', () => {
    const id = removalJobId('uid_abc');
    expect(id.length).toBe(26);
    expect(id.startsWith('u_')).toBe(true);
    expect(id).toMatch(/^u_[0-9a-f]{24}$/);
  });
  it('同 uid 相同、不同 uid 不同', () => {
    expect(removalJobId('a')).toBe(removalJobId('a'));
    expect(removalJobId('a')).not.toBe(removalJobId('b'));
  });
  it('輸出不含 uid 原文', () => {
    const uid = 'secretly_visible_uid_12345';
    const id = removalJobId(uid);
    expect(id).not.toContain(uid);
    expect(id).not.toContain('secretly');
  });
});

describe('newPseudonym / newConfirmToken（§4.5、§4.8）', () => {
  it('newPseudonym 為 16 碼小寫 hex；兩次不同', () => {
    const p = newPseudonym();
    expect(p).toMatch(/^[0-9a-f]{16}$/);
    expect(newPseudonym()).not.toBe(p);
  });
  it('newConfirmToken 為 dr_ + 24 碼 base64url；兩次不同', () => {
    const t = newConfirmToken();
    expect(t).toMatch(/^dr_[A-Za-z0-9_-]{24}$/);
    expect(newConfirmToken()).not.toBe(t);
  });
});

describe('canonicalJson / dryRunDigest', () => {
  it('鍵順序不同結果相同', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson({ b: { y: 2, x: 1 }, a: 0 })).toBe('{"a":0,"b":{"x":1,"y":2}}');
  });
  it('陣列保持順序', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });
  it('undefined 鍵略過', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it('dryRunDigest 改一個數字就不同，且為 64 碼 hex', () => {
    const d1 = dryRunDigest({ totals: { competitions: 1, writesNow: 14 } });
    const d2 = dryRunDigest({ totals: { competitions: 1, writesNow: 15 } });
    expect(d1).not.toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('checkConfirmToken（§4.8）', () => {
  const NOW = 1_000_000_000;
  const OK = { token: 'abc', issuedAtMs: NOW - 1_000, digest: 'deadbeef' };

  it('token 不是字串或空 → required', () => {
    expect(checkConfirmToken(OK, null, 'deadbeef', NOW)).toBe('required');
    expect(checkConfirmToken(OK, undefined, 'deadbeef', NOW)).toBe('required');
    expect(checkConfirmToken(OK, 123, 'deadbeef', NOW)).toBe('required');
    expect(checkConfirmToken(OK, '', 'deadbeef', NOW)).toBe('required');
  });
  it('saved 缺 → stale', () => {
    expect(checkConfirmToken(null, 'abc', 'deadbeef', NOW)).toBe('stale');
    expect(checkConfirmToken(undefined, 'abc', 'deadbeef', NOW)).toBe('stale');
  });
  it('token 不符 → stale', () => {
    expect(checkConfirmToken(OK, 'abd', 'deadbeef', NOW)).toBe('stale');
  });
  it('token 長度不同 → stale', () => {
    expect(checkConfirmToken(OK, 'abcdef', 'deadbeef', NOW)).toBe('stale');
  });
  it('剛好 72 小時仍 ok；多 1ms → stale', () => {
    const saved = { token: 'abc', issuedAtMs: NOW - DRY_RUN_TTL_MS, digest: 'deadbeef' };
    expect(checkConfirmToken(saved, 'abc', 'deadbeef', NOW)).toBe('ok');
    expect(checkConfirmToken({ ...saved, issuedAtMs: saved.issuedAtMs - 1 }, 'abc', 'deadbeef', NOW)).toBe('stale');
  });
  it('digest 不同 → stale', () => {
    expect(checkConfirmToken(OK, 'abc', 'cafebabe', NOW)).toBe('stale');
  });
  it('全對 → ok', () => {
    expect(checkConfirmToken(OK, 'abc', 'deadbeef', NOW)).toBe('ok');
  });
});

describe('planCompetition（§4.2 第 2～6 點）', () => {
  /** 全部 false/null/空，mineDelete=true（空 roles 的預設）。 */
  const EMPTY: CompPlan = {
    skip: false,
    roster: null,
    repRegistrantClear: false,
    repContactClear: false,
    staffNameClear: false,
    staffDelete: false,
    hostPublicReset: false,
    hostDisplayReset: false,
    mineDelete: true,
    waiting: []
  };
  /** deleting 時：skip=true，其他全 false/空。 */
  const SKIP: CompPlan = {
    skip: true,
    roster: null,
    repRegistrantClear: false,
    repContactClear: false,
    staffNameClear: false,
    staffDelete: false,
    hostPublicReset: false,
    hostDisplayReset: false,
    mineDelete: false,
    waiting: []
  };
  const plan = (
    roles: ReadonlyArray<'host' | 'coHost' | 'rep' | 'player' | 'scorer' | 'referee'>,
    opts: Partial<{ ended: boolean; rosterPhaseOpen: boolean; staffActive: boolean; deleting: boolean }> = {}
  ) => planCompetition({
    roles,
    ended: opts.ended ?? false,
    rosterPhaseOpen: opts.rosterPhaseOpen ?? false,
    staffActive: opts.staffActive ?? false,
    deleting: opts.deleting ?? false
  });

  it('player 名單階段內 → roster=delete', () => {
    expect(plan(['player'], { rosterPhaseOpen: true })).toEqual({ ...EMPTY, roster: 'delete' });
  });

  it('player 已過名單階段 → roster=deidentify', () => {
    expect(plan(['player'], { rosterPhaseOpen: false })).toEqual({ ...EMPTY, roster: 'deidentify' });
  });

  it('rep 賽事未結束 → 立即清 registrant；聯絡人等待 rep_contact_active', () => {
    expect(plan(['rep'], { ended: false })).toEqual({
      ...EMPTY,
      repRegistrantClear: true,
      mineDelete: false,
      waiting: ['rep_contact_active']
    });
  });

  it('rep 賽事已結束 → 聯絡人與電話一併清', () => {
    expect(plan(['rep'], { ended: true })).toEqual({
      ...EMPTY,
      repRegistrantClear: true,
      repContactClear: true,
      mineDelete: true,
      waiting: []
    });
  });

  it('scorer 且 staffActive → 清 displayName、等待 staff_active', () => {
    expect(plan(['scorer'], { staffActive: true })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      mineDelete: false,
      waiting: ['staff_active']
    });
  });

  it('scorer 且 !staffActive → 立即刪整份 staff', () => {
    expect(plan(['scorer'], { staffActive: false })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      staffDelete: true,
      mineDelete: true,
      waiting: []
    });
  });

  it('referee 走同一條 staff 規則', () => {
    expect(plan(['referee'], { staffActive: false })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      staffDelete: true,
      mineDelete: true,
      waiting: []
    });
  });

  it('host 賽事未結束 → 保留職務、等待 host_active', () => {
    expect(plan(['host'], { ended: false })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      hostPublicReset: true,
      hostDisplayReset: true,
      mineDelete: false,
      waiting: ['host_active']
    });
  });

  it('host 賽事已結束 → 刪整份 staff、公開欄位改「主辦」', () => {
    expect(plan(['host'], { ended: true })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      staffDelete: true,
      hostPublicReset: true,
      hostDisplayReset: true,
      mineDelete: true,
      waiting: []
    });
  });

  it('coHost：不動 hostDisplay，只做 hostPublicReset', () => {
    expect(plan(['coHost'], { ended: false })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      hostPublicReset: true,
      hostDisplayReset: false,
      mineDelete: false,
      waiting: ['host_active']
    });
  });

  it('coHost 賽事已結束 → 刪整份 staff', () => {
    expect(plan(['coHost'], { ended: true })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      staffDelete: true,
      hostPublicReset: true,
      hostDisplayReset: false,
      mineDelete: true,
      waiting: []
    });
  });

  it('player＋scorer，staffActive → 同時去識別與保留 staff', () => {
    expect(plan(['player', 'scorer'], { rosterPhaseOpen: false, staffActive: true })).toEqual({
      ...EMPTY,
      roster: 'deidentify',
      staffNameClear: true,
      mineDelete: false,
      waiting: ['staff_active']
    });
  });

  it('player＋scorer，!staffActive → 立即刪 staff、可刪 cpMine', () => {
    expect(plan(['player', 'scorer'], { rosterPhaseOpen: true, staffActive: false })).toEqual({
      ...EMPTY,
      roster: 'delete',
      staffNameClear: true,
      staffDelete: true,
      mineDelete: true,
      waiting: []
    });
  });

  it('host＋scorer，staffActive 且未結束 → 兩項等待，保 staff 不刪', () => {
    expect(plan(['host', 'scorer'], { ended: false, staffActive: true })).toEqual({
      ...EMPTY,
      staffNameClear: true,
      hostPublicReset: true,
      hostDisplayReset: true,
      mineDelete: false,
      waiting: ['staff_active', 'host_active']
    });
  });

  it('deleting → skip=true，其他全 false/空', () => {
    expect(plan(['host', 'player', 'scorer', 'rep'], { deleting: true })).toEqual(SKIP);
  });

  it('空 roles → skip=false、全 false、mineDelete=true、waiting=[]', () => {
    expect(plan([])).toEqual(EMPTY);
  });
});

describe('newContactKey（Opus 審 P1）', () => {
  it('16 碼小寫 hex；兩次不同', () => {
    const k = newContactKey();
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(newContactKey()).not.toBe(k);
  });
});
