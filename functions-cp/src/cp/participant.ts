/**
 * cpParticipant 第 2 步動作：reportCompetition（§5.4 檢舉）。
 * acceptInvite（第 4 步）、resyncMyClubs（G4 鏡像後）、requestMyDataRemoval（第 6 步前）尚未實作，回 UNKNOWN_ACTION。
 * 下架（hidden）與處理檢舉屬需要權限碼的管理動作，放主 codebase 的 cpAdminOps（不在本 codebase）。
 */
import { CpError, bad } from './errors.js';
import {
  CID_RE,
  FieldValue,
  actorHash,
  assertCompVisible,
  isHostOrCo,
  launchGate,
  loadComp,
  readDoc,
  requireId,
  type Caller,
  type CpDeps,
  type GateResult
} from './context.js';
import { optionalText } from './text.js';
import { asRecord, onlyKeys, requireEnum } from './validate.js';

export const REPORT_REASONS = ['impersonation', 'fake', 'inappropriate', 'privacy', 'other'] as const;
/** 每人每賽事每 24 小時 1 次 */
export const REPORT_WINDOW_MS = 24 * 3600 * 1000;

export async function reportCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'reason', 'detail']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const reason = requireEnum(input.reason, REPORT_REASONS, 'reason');
  const detail = optionalText(input.detail, 'detail', 300);
  if (reason === 'other' && !detail) throw bad('FIELD_REQUIRED', { field: 'detail' });
  const nowMs = deps.now().getTime();
  // 檢舉文件 id 用雜湊：每人每賽事一份（只有管理員可讀；不在 id 露 uid）
  const rid = `rp_${actorHash(cid, caller.uid)}`;

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    // 草稿只有主辦看得到，不接受檢舉（避免以檢舉探測草稿 id）
    if (comp.status === 'draft' && !(await isHostOrCo(deps, tx, cid, comp, caller))) throw new CpError('not-found', 'COMPETITION_NOT_FOUND');
    const ref = deps.db.doc(`competitions/${cid}/reports/${rid}`);
    const prev = await readDoc(deps, tx, ref);
    const last = prev.exists ? prev.get('lastAt') : null;
    if (last && typeof last.toMillis === 'function' && nowMs - last.toMillis() < REPORT_WINDOW_MS) {
      throw new CpError('resource-exhausted', 'REPORT_RATE_LIMITED');
    }
    tx.set(ref, {
      reporterUid: caller.uid, // 只有管理員可讀（Rules reports: isAdmin）；處理檢舉需要回查
      reason, detail, count: FieldValue.increment(1),
      lastAt: FieldValue.serverTimestamp(),
      // 不覆寫管理員已處理的狀態（Flash 交叉審 P2）；已處理過又被檢舉時標 reopened 讓管理員看到
      ...(prev.exists
        ? (prev.get('status') !== 'open' ? { reopened: true } : {})
        : { status: 'open', firstAt: FieldValue.serverTimestamp() })
    }, { merge: true });
  });
  return { cid, reported: true };
}

export const PARTICIPANT_ACTIONS = { reportCompetition } as const;

export async function handleCpParticipant(deps: CpDeps, caller: Caller, data: unknown) {
  const input = asRecord(data);
  const action = input.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(PARTICIPANT_ACTIONS, action)) {
    throw bad('UNKNOWN_ACTION');
  }
  const gate: GateResult = await launchGate(deps, caller);
  return PARTICIPANT_ACTIONS[action as keyof typeof PARTICIPANT_ACTIONS](deps, caller, gate, input);
}
