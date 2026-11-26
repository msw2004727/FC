/**
 * 賽事個資移除：純函式與型別（設計 §4.1～§4.8）。
 * 本檔不 import firebase-admin、不讀寫資料庫、不讀環境變數；
 * 供之後的交易與排程呼叫。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SCORE_ASSIGN_MS } from './staff-host.js';

/** 賽事結束寬限（與邀請到期上限相同，7 天）。 */
export const ENDED_GRACE_MS = SCORE_ASSIGN_MS;
/** 稽核保留 365 天。 */
export const AUDIT_KEEP_MS = 365 * 86400_000;
/** 稽核到期緩衝（末場延後上限 60 天）。 */
export const AUDIT_BUFFER_MS = 60 * 86400_000;
/** 檢舉 180 天後清除。 */
export const REPORT_PURGE_MS = 180 * 86400_000;
/** 管理員 dryRun 確認碼有效 72 小時。 */
export const DRY_RUN_TTL_MS = 72 * 3600_000;
/** 同一移除工作 60 秒內重按視為限流。 */
export const REMOVAL_RATE_MS = 60_000;
/** 工作租約 120 秒。 */
export const LEASE_MS = 120_000;
/** Callable 單次最多處理 5 場。 */
export const CALLABLE_MAX_COMPS = 5;
/** Callable 單次時間預算 40 秒。 */
export const CALLABLE_BUDGET_MS = 40_000;
/** 每日排程每輪最多 50 份工作。 */
export const DAILY_MAX_JOBS = 50;
/** 檢舉清除每批 200 筆。 */
export const REPORT_PURGE_BATCH = 200;
/** pending 清單分頁 200。 */
export const PENDING_PAGE = 200;
/** 名單去識別後的公開名（球員）。 */
export const ANON_PLAYER = '球員';
/** 主辦顯示名（去識別後）。 */
export const ANON_HOST = '主辦';

/** 判斷賽事是否結束：endedAt 有值，或已過 lastMatchAt＋7 天（剛好等於不算）。 */
export function competitionEnded(
  comp: {
    endedAt?: { toMillis(): number } | null;
    lastMatchAt?: { toMillis(): number } | null;
  },
  nowMs: number
): boolean {
  if (comp.endedAt) return true;
  if (comp.lastMatchAt) {
    return nowMs > comp.lastMatchAt.toMillis() + ENDED_GRACE_MS;
  }
  return false;
}

/** 稽核到期時間（§4.6 方案 T）：max(寫入, 末場) + 365 天 + 60 天緩衝。 */
export function auditExpireAtMs(writeAtMs: number, lastMatchAtMs: number | null): number {
  return Math.max(writeAtMs, lastMatchAtMs ?? writeAtMs) + AUDIT_KEEP_MS + AUDIT_BUFFER_MS;
}

/** cpAudits/del_* 到期時間：at + 365 天。 */
export function deleteAuditExpireAtMs(atMs: number): number {
  return atMs + AUDIT_KEEP_MS;
}

/** 檢舉清除時間：審核時間 + 180 天。 */
export function reportPurgeAtMs(reviewedAtMs: number): number {
  return reviewedAtMs + REPORT_PURGE_MS;
}

/** 由 uid 產生工作 id：'u_' + sha256('rm:' + uid) 前 24 碼 hex（共 26 碼）。 */
export function removalJobId(uid: string): string {
  return 'u_' + createHash('sha256').update('rm:' + uid).digest('hex').slice(0, 24);
}

/** 假名：16 碼小寫 hex。 */
export function newPseudonym(): string {
  return randomBytes(8).toString('hex');
}

/** 管理員確認碼：'dr_' + 24 碼 base64url。 */
export function newConfirmToken(): string {
  return 'dr_' + randomBytes(18).toString('base64url');
}

/** 遞迴排序物件鍵的 JSON（陣列保持順序；undefined 鍵略過）。 */
function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) {
    const val = src[k];
    if (val === undefined) continue;
    out[k] = sortValue(val);
  }
  return out;
}

/** 正規化 JSON：鍵排序、陣列保序、undefined 鍵略過。 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortValue(v)) ?? 'null';
}

/** dryRun 摘要：canonicalJson 的 sha256 hex。 */
export function dryRunDigest(summary: unknown): string {
  return createHash('sha256').update(canonicalJson(summary)).digest('hex');
}

/** 常數時間字串比較；長度不同直接不符。 */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * 檢查管理員確認碼：
 * - token 不是字串或空 → 'required'
 * - saved 缺、token 不符、issuedAtMs 缺、超過 72 小時（剛好等於仍 ok）、digest 不同 → 'stale'
 * - 都對 → 'ok'
 */
export function checkConfirmToken(
  saved: { token?: unknown; issuedAtMs?: unknown; digest?: unknown } | null | undefined,
  token: unknown,
  digest: string,
  nowMs: number
): 'ok' | 'required' | 'stale' {
  if (typeof token !== 'string' || token === '') return 'required';
  if (!saved) return 'stale';
  if (typeof saved.token !== 'string') return 'stale';
  if (!safeEqualStr(saved.token, token)) return 'stale';
  if (typeof saved.issuedAtMs !== 'number') return 'stale';
  if (nowMs - saved.issuedAtMs > DRY_RUN_TTL_MS) return 'stale';
  if (typeof saved.digest !== 'string') return 'stale';
  if (!safeEqualStr(saved.digest, digest)) return 'stale';
  return 'ok';
}

export type MineRole = 'host' | 'coHost' | 'rep' | 'player' | 'scorer' | 'referee';

export interface PlanInput {
  /** cpMine items 的 roles。 */
  roles: readonly MineRole[];
  /** competitionEnded 結果。 */
  ended: boolean;
  /** 名單階段內（呼叫端先用既有 assertRosterPhase 判斷後傳入）。 */
  rosterPhaseOpen: boolean;
  /** staff 指派仍有效：staff.expiresAtMs > now 且 !ended。 */
  staffActive: boolean;
  /** 賽事根文件 deletingAt 有值。 */
  deleting: boolean;
}

export type WaitReason = 'staff_active' | 'rep_contact_active' | 'host_active';

export interface CompPlan {
  /** deleting → true，其他欄位全 false/空。 */
  skip: boolean;
  /** player：名單階段內 → 'delete'，已過 → 'deidentify'；否則 null。 */
  roster: 'delete' | 'deidentify' | null;
  /** rep：立即清 registeredByUid、addedByUid。 */
  repRegistrantClear: boolean;
  /** rep 且 ended：一併清聯絡人與電話。 */
  repContactClear: boolean;
  /** scorer/referee/coHost/host 任一：立即清 staff.displayName。 */
  staffNameClear: boolean;
  /** scorer/referee 且 !staffActive 且沒有 host/coHost；或 host/coHost 且 ended。 */
  staffDelete: boolean;
  /** host/coHost：notices/standings.by 清 null（hostDisplay 僅 host 改）。 */
  hostPublicReset: boolean;
  /** 只有 host 才改 hostDisplay = ANON_HOST。 */
  hostDisplayReset: boolean;
  /** 沒有任何 waiting 時 true（可刪 cpMine 條目）。 */
  mineDelete: boolean;
  /** 依序去重：scorer/referee 且 staffActive、rep 且 !ended、host/coHost 且 !ended。 */
  waiting: WaitReason[];
}

/**
 * 依設計 §4.2 第 2～6 點規劃一場的處理方式。
 * 注意：呼叫端負責先判斷 ended／rosterPhaseOpen／staffActive／deleting，本函式只看輸入。
 */
export function planCompetition(input: PlanInput): CompPlan {
  if (input.deleting) {
    return {
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
  }

  const roles = new Set<MineRole>(input.roles);
  const hasHost = roles.has('host');
  const hasCoHost = roles.has('coHost');
  const hasHostOrCoHost = hasHost || hasCoHost;
  const hasRep = roles.has('rep');
  const hasPlayer = roles.has('player');
  const hasScorer = roles.has('scorer');
  const hasReferee = roles.has('referee');
  const hasScorerOrReferee = hasScorer || hasReferee;
  const hasStaffRole = hasScorerOrReferee || hasHostOrCoHost;

  if (roles.size === 0) {
    return {
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
  }

  const waiting: WaitReason[] = [];
  if (hasScorerOrReferee && input.staffActive) waiting.push('staff_active');
  if (hasRep && !input.ended) waiting.push('rep_contact_active');
  if (hasHostOrCoHost && !input.ended) waiting.push('host_active');

  const roster: 'delete' | 'deidentify' | null = hasPlayer
    ? (input.rosterPhaseOpen ? 'delete' : 'deidentify')
    : null;

  const staffDelete =
    (hasScorerOrReferee && !input.staffActive && !hasHostOrCoHost)
    || (hasHostOrCoHost && input.ended);

  return {
    skip: false,
    roster,
    repRegistrantClear: hasRep,
    repContactClear: hasRep && input.ended,
    staffNameClear: hasStaffRole,
    staffDelete,
    hostPublicReset: hasHostOrCoHost,
    hostDisplayReset: hasHost,
    mineDelete: waiting.length === 0,
    waiting
  };
}
