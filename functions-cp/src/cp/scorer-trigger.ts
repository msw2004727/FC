/**
 * 接手稽核。control/scorer 建立或換人時寫私密 audits/tk_{takenAtMs}_{mtId}_{actorHash}。
 * mtId 是場次路徑上的 id，建立場次時已過 mt_[A-Za-z0-9]{20}。同一毫秒接手兩場因此各寫一筆。
 * 文件 id 與內容都不含 uid 原文。同 id 已存在就不寫。刪除、同一人只換 sid 不寫。
 */
import { logger } from 'firebase-functions/v2';
import { actorHash, readDoc, type CpDeps } from './context.js';

const UID_MAX = 128;

export interface ScorerAuditWrite {
  id: string;
  actor: string;
  mtId: string;
  takenAt: unknown;
  sidChanged: boolean;
  prev: string | null;
}

export type ScorerAuditPlan =
  | { kind: 'skip' }
  | { kind: 'bad'; reason: 'uid' | 'takenAt' }
  | { kind: 'write'; audit: ScorerAuditWrite };

function sidOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function millisOf(value: unknown): number | null {
  let n: number | null = null;
  if (value instanceof Date) n = value.getTime();
  else if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const out = (value as { toMillis: () => unknown }).toMillis();
    n = typeof out === 'number' ? out : null;
  }
  if (n == null || !Number.isInteger(n) || n < 0 || n > 8_640_000_000_000_000) return null;
  return n;
}

export function scorerAuditPlan(
  cid: string,
  mtId: string,
  before: { uid?: unknown; sid?: unknown; takenAt?: unknown } | null,
  after: { uid?: unknown; sid?: unknown; takenAt?: unknown } | null
): ScorerAuditPlan {
  if (!after) return { kind: 'skip' };
  const uid = typeof after.uid === 'string' ? after.uid : '';
  const prevUid = before && typeof before.uid === 'string' ? before.uid : '';
  // 同一人（含只換 sid、重送）不另寫。建立、或 uid 從空值變成有人，算接手。
  if (before && prevUid === uid && uid !== '') return { kind: 'skip' };
  if (!uid || uid.length > UID_MAX || uid.includes('/')) return { kind: 'bad', reason: 'uid' };
  const ms = millisOf(after.takenAt);
  if (ms == null) return { kind: 'bad', reason: 'takenAt' };
  const actor = actorHash(cid, uid);
  const prev = prevUid && prevUid !== uid ? actorHash(cid, prevUid) : null;
  return {
    kind: 'write',
    audit: {
      id: `tk_${ms}_${mtId}_${actor}`,
      actor,
      mtId,
      takenAt: after.takenAt,
      sidChanged: !!before && sidOf(before.sid) !== sidOf(after.sid),
      prev
    }
  };
}

/** 冪等：同 id 已在就不寫。交易失敗照拋，讓觸發器重試。 */
export async function handleScorerWritten(
  deps: CpDeps,
  cid: string,
  mtId: string,
  before: { uid?: unknown; sid?: unknown; takenAt?: unknown } | null,
  after: { uid?: unknown; sid?: unknown; takenAt?: unknown } | null
): Promise<boolean> {
  const plan = scorerAuditPlan(cid, mtId, before, after);
  if (plan.kind === 'skip') return false;
  if (plan.kind === 'bad') {
    // 不記 uid。資料錯誤重試也不會好。
    logger.error('cpOnScorerWritten bad data', { cid, mtId, reason: plan.reason });
    return false;
  }
  const audit = plan.audit;
  const ref = deps.db.doc(`competitions/${cid}/audits/${audit.id}`);
  return deps.db.runTransaction(async tx => {
    const snap = await readDoc(deps, tx, ref);
    if (snap.exists) return false;
    tx.create(ref, {
      action: 'takeScorer',
      actor: audit.actor,
      mtId: audit.mtId,
      takenAt: audit.takenAt,
      sidChanged: audit.sidChanged,
      prev: audit.prev
    });
    return true;
  });
}
