/**
 * 管理員下架／恢復與檢舉處理（計畫書 §5.4：管理員下架 hidden 寫稽核、主辦看得到下架原因）。
 * 位置：計畫書 §6.1 原放主 codebase 的 cpAdminOps；2026-11-20 顧問同意改放賽事 codebase 的 cpHost（§6.5 的 cpAdminOps 屬目錄安排，搬回列待辦），
 * 因為只認 claims role admin／super_admin（與本 codebase 既有的管理員判斷相同，不涉及權限碼），部署不必動主站。
 *
 * moderate：{ cid, hidden: true, reason } 下架；{ cid, hidden: false } 恢復。
 *   - 只有管理員（NOT_ADMIN）。刪除中的賽事不能動（COMPETITION_DELETING：刪除流程本身會把 hidden 設 true）。
 *   - 狀態沒變（已下架再下架、未下架再恢復）回 NO_CHANGE，不寫。
 *   - 下架原因 2～200 字（statusReasonOf）寫在賽事根文件 hiddenReason：下架後一般人讀不到根文件
 *     （asia-main.rules isPubLike 要求 hidden == false），主辦、共同主辦、俱樂部代表與管理員讀得到。恢復時清成 null。
 *   - stateVersion +1（分享卡與 OG 依此失效）。稽核記下架原因全文（管理員寫給主辦看的說明，不含 uid）；恢復的稽核 details 為空。
 *   - 讀取：閘門（管理員 1）＋賽事 1。
 * reviewReport：{ cid, reportId, status: 'resolved' | 'dismissed' | 'open' } 管理員標記檢舉處理狀態，清掉 reopened。
 *   - 讀取：閘門 1＋賽事 1＋檢舉 1。檢舉文件 id 形狀 rp_＋雜湊；不存在回 REPORT_NOT_FOUND；刪除中的賽事回 COMPETITION_DELETING
 *     （recursiveDelete 不保證順序，避免在已刪的 audits 留孤兒稽核；Opus 審 P3-2）。
 */
import type { Transaction } from 'firebase-admin/firestore';
import { bad, deny, notFound, pre } from './errors.js';
import { CID_RE, FieldValue, isAdmin, loadComp, readDoc, requireId, writeAudit, type Caller, type CpDeps, type GateResult } from './context.js';
import { onlyKeys, requireEnum, statusReasonOf } from './validate.js';

const REPORT_ID_RE = /^rp_[A-Za-z0-9_-]{8,64}$/;
const REVIEW_STATUSES = ['open', 'resolved', 'dismissed'] as const;

function assertAdmin(caller: Caller): void {
  if (!isAdmin(caller)) throw deny('NOT_ADMIN');
}

export async function moderate(deps: CpDeps, caller: Caller, _gate: GateResult, input: Record<string, unknown>) {
  assertAdmin(caller);
  onlyKeys(input, ['action', 'cid', 'hidden', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  if (typeof input.hidden !== 'boolean') throw bad('FIELD_TYPE', { field: 'hidden' });
  const hide = input.hidden;
  let reason: string | null = null;
  if (hide) reason = statusReasonOf(input.reason);
  else if (input.reason != null) throw bad('UNKNOWN_FIELD', { field: 'reason' });

  return deps.db.runTransaction(async (tx: Transaction) => {
    const comp = await loadComp(deps, tx, cid);
    if (comp.deletingAt) throw pre('COMPETITION_DELETING');
    // 舊文件可能沒有 hidden 欄位：先轉布林（缺值＝未下架）再比，避免恢復時誤寫一筆稽核（顧問 11-20）
    if ((comp.hidden === true) === hide) throw pre('NO_CHANGE');
    const now = FieldValue.serverTimestamp();
    tx.update(deps.db.doc(`competitions/${cid}`), {
      hidden: hide,
      hiddenReason: reason,
      hiddenAt: hide ? now : null,
      stateVersion: FieldValue.increment(1),
      updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, hide ? 'moderateHide' : 'moderateRestore', hide ? { reason } : {});
    return { cid, hidden: hide };
  });
}

export async function reviewReport(deps: CpDeps, caller: Caller, _gate: GateResult, input: Record<string, unknown>) {
  assertAdmin(caller);
  onlyKeys(input, ['action', 'cid', 'reportId', 'status']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const reportId = requireId(input.reportId, REPORT_ID_RE, 'reportId');
  const status = requireEnum(input.status, REVIEW_STATUSES, 'status');

  return deps.db.runTransaction(async (tx: Transaction) => {
    const comp = await loadComp(deps, tx, cid);
    if (comp.deletingAt) throw pre('COMPETITION_DELETING');
    const ref = deps.db.doc(`competitions/${cid}/reports/${reportId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) throw notFound('REPORT_NOT_FOUND');
    tx.update(ref, { status, reopened: false, reviewedAt: FieldValue.serverTimestamp() });
    writeAudit(deps, tx, cid, caller, 'reviewReport', { reportId, status });
    return { cid, reportId, status };
  });
}

export const MODERATE_ACTIONS = { moderate, reviewReport } as const;
