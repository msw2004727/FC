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
/** 同一賽事 LINE 推播冷卻：6 小時內第二筆以後的檢舉只發站內信（LINE OA 輕用量 200 則／月，每位收件者各算一則） */
export const REPORT_LINE_COOLDOWN_MS = 6 * 3600 * 1000;
/** 全站每日最多推幾則檢舉 LINE、每位檢舉者每日跨賽事最多觸發幾則（顧問 §3.254 B2；台北日期） */
export const REPORT_LINE_DAILY_MAX = 5;
export const REPORT_LINE_PER_REPORTER_DAILY_MAX = 2;
const taipeiDay = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);

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
    // 通知（站長 11-18：管理員與總管收官方 LINE 推播＋站內信）。賽事 codebase 只寫外送匣 cpOutbox，
    // 由主 codebase 的 cpOutboxRelay 走既有站內信投遞與 LINE 推播佇列（T-062 授權強化後的路徑）實際發送（G5／主站 Functions 交界，另送裁）。
    // 去重與上限（同一交易內判斷）：同一檢舉者同賽事 24 小時 1 次（上方）；同一賽事 6 小時內只推一次 LINE；
    // 全站每日 ≤ REPORT_LINE_DAILY_MAX、每位檢舉者每日跨賽事 ≤ REPORT_LINE_PER_REPORTER_DAILY_MAX；超過只發站內信。
    // 冷卻與計數放 cpLineThrottle（與外送匣 cpOutbox 分開；relay 只處理 cpOutbox 裡有 kind 的文件）。
    const day = taipeiDay(nowMs);
    const compRef = deps.db.doc(`cpLineThrottle/c_${cid}`);
    const globalRef = deps.db.doc('cpLineThrottle/global');
    const userRef = deps.db.doc(`cpLineThrottle/u_${actorHash('line', caller.uid)}`);
    const [compSnap, globalSnap, userSnap] = [
      await readDoc(deps, tx, compRef), await readDoc(deps, tx, globalRef), await readDoc(deps, tx, userRef)
    ];
    const lastLine = compSnap.exists ? compSnap.get('lastLineAt') : null;
    const compOk = !(lastLine && typeof lastLine.toMillis === 'function' && nowMs - lastLine.toMillis() < REPORT_LINE_COOLDOWN_MS);
    const countOf = (snap: typeof globalSnap) => (snap.exists && snap.get('day') === day ? Number(snap.get('count')) || 0 : 0);
    const globalCount = countOf(globalSnap);
    const userCount = countOf(userSnap);
    const lineOk = compOk && globalCount < REPORT_LINE_DAILY_MAX && userCount < REPORT_LINE_PER_REPORTER_DAILY_MAX;
    if (lineOk) {
      tx.set(compRef, { lastLineAt: FieldValue.serverTimestamp() });
      tx.set(globalRef, { day, count: globalCount + 1 });
      tx.set(userRef, { day, count: userCount + 1 });
    }
    tx.create(deps.db.collection('cpOutbox').doc(), {
      kind: 'cpReportFiled', audienceRoles: ['admin', 'super_admin'],
      channels: lineOk ? ['inbox', 'line'] : ['inbox'],
      // compName 截 60 字、relay 當純文字使用（不得當 HTML）
      cid, reportId: rid, reason, compName: [...comp.name].slice(0, 60).join(''),
      status: 'pending', createdAt: FieldValue.serverTimestamp()
    });
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
