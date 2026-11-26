/**
 * 個資移除與保存期限每日排程（設計 §4.4）：續跑移除工作、等待項目到期、檢舉 180 天清除、
 * 稽核 expireAt 回填（含 cpAudits/del_、檢舉佇列）。全部唯讀或計數模式由 opts 控制；
 * log 只記數量與 cid，不記 uid。所有讀取經 readDoc／readQuery。
 */
import { FieldPath, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  FieldValue,
  Timestamp,
  readDoc,
  readQuery,
  type CpDeps
} from './context.js';
import { runRemovalJob } from './removal-actions.js';
import {
  DAILY_MAX_JOBS,
  REPORT_PURGE_BATCH,
  auditExpireAtMs,
  deleteAuditExpireAtMs,
  reportPurgeAtMs
} from './removal-plan.js';

// ── 預算與分頁常數（§4.4：1、2 合計 250 秒；3 60 秒；4 90 秒）───────────
const PHASE12_BUDGET_MS = 250_000;
const PHASE3_BUDGET_MS = 60_000;
const PHASE4_BUDGET_MS = 90_000;
const COMP_PAGE = 20;
const AUDIT_PAGE = 400;
const REPORT_PAGE = 400;
const MAX_COMPS_PER_JOB = 50;

export interface DailyOptions {
  /** true：只讀與計數，任何寫入都不做（含 runRemovalJob 不呼叫，只數工作數） */
  dryRun: boolean;
  /** 每項處理上限的總閘；正式第一次 D7 設 1 */
  max: number;
  /** 第 4 項稽核回填是否真的寫（D4 站長同意前 false）；false 時只計數 */
  auditBackfill: boolean;
  /** 檢舉佇列回填（D5）；false 時只計數 */
  reportBackfill: boolean;
}

export interface DailyReport {
  removalQueued: number;
  removalWaiting: number;
  removalProcessed: number;
  reportPurged: number;
  reportQueueDropped: number;
  auditBackfillComps: number;
  auditBackfillDocs: number;
  reportBackfillDocs: number;
  /** 哪幾項因時間預算用完提早停 */
  stoppedEarly: string[];
}

/**
 * 由環境變數組 DailyOptions。預設安全：
 * - CP_DAILY_DRY_RUN 不是字串 '0' → dryRun=true
 * - CP_DAILY_MAX 正整數才採用，否則 DAILY_MAX_JOBS
 * - CP_AUDIT_BACKFILL／CP_REPORT_BACKFILL === '1' 才 true
 */
export function dailyOptionsFromEnv(env: Record<string, string | undefined>): DailyOptions {
  const dryRun = env.CP_DAILY_DRY_RUN !== '0';
  const maxRaw = env.CP_DAILY_MAX;
  const n = maxRaw !== undefined && /^\d+$/.test(maxRaw) ? Number(maxRaw) : NaN;
  const max = Number.isInteger(n) && n > 0 ? n : DAILY_MAX_JOBS;
  return {
    dryRun,
    max,
    auditBackfill: env.CP_AUDIT_BACKFILL === '1',
    reportBackfill: env.CP_REPORT_BACKFILL === '1'
  };
}

export async function runDaily(deps: CpDeps, opts: DailyOptions): Promise<DailyReport> {
  const report: DailyReport = {
    removalQueued: 0,
    removalWaiting: 0,
    removalProcessed: 0,
    reportPurged: 0,
    reportQueueDropped: 0,
    auditBackfillComps: 0,
    auditBackfillDocs: 0,
    reportBackfillDocs: 0,
    stoppedEarly: []
  };
  await phase12RemovalJobs(deps, opts, report);
  await phase3ReportPurge(deps, opts, report);
  await phase4Backfill(deps, opts, report);
  return report;
}

// ── 第 1、2 項：續跑移除工作（1：queued、2：waiting；共用 250 秒）───────
async function phase12RemovalJobs(
  deps: CpDeps,
  opts: DailyOptions,
  report: DailyReport
): Promise<void> {
  const startMs = deps.now().getTime();
  const limitN = Math.min(opts.max, DAILY_MAX_JOBS);

  // 第 1 項：queued
  try {
    const snap = await readQuery(
      deps, null,
      deps.db.collection('cpRemovalJobs').where('status', '==', 'queued').limit(limitN)
    );
    if (opts.dryRun) {
      report.removalQueued = snap.size;
    } else {
      for (const doc of snap.docs) {
        const elapsed = deps.now().getTime() - startMs;
        if (elapsed >= PHASE12_BUDGET_MS) {
          if (!report.stoppedEarly.includes('removalQueued')) report.stoppedEarly.push('removalQueued');
          break;
        }
        report.removalQueued += 1;
        const r = await runRemovalJob(deps, doc.id, {
          maxComps: MAX_COMPS_PER_JOB,
          budgetMs: Math.max(0, PHASE12_BUDGET_MS - elapsed)
        });
        report.removalProcessed += r.processed;
      }
    }
  } catch (e) {
    logger.error('cpDaily phase1 error', { error: (e as Error)?.name ?? 'Error' });
  }

  // 第 2 項：waiting
  try {
    const snap = await readQuery(
      deps, null,
      deps.db.collection('cpRemovalJobs').where('status', '==', 'waiting').limit(limitN)
    );
    if (opts.dryRun) {
      report.removalWaiting = snap.size;
    } else {
      for (const doc of snap.docs) {
        const elapsed = deps.now().getTime() - startMs;
        if (elapsed >= PHASE12_BUDGET_MS) {
          if (!report.stoppedEarly.includes('removalWaiting')) report.stoppedEarly.push('removalWaiting');
          break;
        }
        report.removalWaiting += 1;
        const r = await runRemovalJob(deps, doc.id, {
          maxComps: MAX_COMPS_PER_JOB,
          budgetMs: Math.max(0, PHASE12_BUDGET_MS - elapsed)
        });
        report.removalProcessed += r.processed;
      }
    }
  } catch (e) {
    logger.error('cpDaily phase2 error', { error: (e as Error)?.name ?? 'Error' });
  }
}

// ── 第 3 項：檢舉 180 天清除（設計 §4.7；60 秒）───────────────────────
async function phase3ReportPurge(
  deps: CpDeps,
  opts: DailyOptions,
  report: DailyReport
): Promise<void> {
  const startMs = deps.now().getTime();
  const limitN = Math.min(REPORT_PURGE_BATCH, opts.max);
  try {
    const snap = await readQuery(
      deps, null,
      deps.db.collection('cpReportPurge')
        .where('purgeAt', '<=', Timestamp.fromDate(deps.now()))
        .orderBy('purgeAt')
        .limit(limitN)
    );
    for (const doc of snap.docs) {
      if (deps.now().getTime() - startMs >= PHASE3_BUDGET_MS) {
        if (!report.stoppedEarly.includes('reportPurge')) report.stoppedEarly.push('reportPurge');
        break;
      }
      const cid = doc.get('cid');
      const rid = doc.get('rid');
      if (typeof cid !== 'string' || typeof rid !== 'string') {
        // 資料異常：只算 dropped；非 dryRun 時盡力清掉佇列
        report.reportQueueDropped += 1;
        if (!opts.dryRun) {
          try { await doc.ref.delete(); } catch (e) {
            logger.error('cpDaily phase3 badpurge delete', { error: (e as Error)?.name ?? 'Error' });
          }
        }
        continue;
      }
      const reportRef = deps.db.doc(`competitions/${cid}/reports/${rid}`);

      if (opts.dryRun) {
        // 只讀與計數：讀報告判斷 purged 或 dropped
        try {
          const rSnap = await readDoc(deps, null, reportRef);
          const st = rSnap.exists ? rSnap.get('status') : null;
          if (rSnap.exists && (st === 'resolved' || st === 'dismissed')) report.reportPurged += 1;
          else report.reportQueueDropped += 1;
        } catch (e) {
          logger.error('cpDaily phase3 dryRun', { cid, error: (e as Error)?.name ?? 'Error' });
        }
        continue;
      }

      // 交易內：讀報告＋佇列 → 依 status 清或只丟佇列 → 刪佇列（冪等）
      try {
        const result = await deps.db.runTransaction(async tx => {
          const rSnap = await readDoc(deps, tx, reportRef);
          const pSnap = await readDoc(deps, tx, doc.ref);
          if (!pSnap.exists) return null;
          let kind: 'purged' | 'dropped';
          if (rSnap.exists) {
            const st = rSnap.get('status');
            if (st === 'resolved' || st === 'dismissed') {
              tx.update(reportRef, {
                reporterUid: null,
                detail: null,
                piiClearedAt: FieldValue.serverTimestamp()
              });
              kind = 'purged';
            } else {
              kind = 'dropped';
            }
          } else {
            kind = 'dropped';
          }
          tx.delete(doc.ref);
          return kind;
        });
        if (result === 'purged') report.reportPurged += 1;
        else if (result === 'dropped') report.reportQueueDropped += 1;
      } catch (e) {
        logger.error('cpDaily phase3 error', { cid, error: (e as Error)?.name ?? 'Error' });
      }
    }
  } catch (e) {
    logger.error('cpDaily phase3 outer error', { error: (e as Error)?.name ?? 'Error' });
  }
}

// ── 第 4 項：回填（稽核 expireAt、cpAudits del_、檢舉佇列；共用 90 秒）───
async function phase4Backfill(
  deps: CpDeps,
  opts: DailyOptions,
  report: DailyReport
): Promise<void> {
  const startMs = deps.now().getTime();
  const writeAudits = !opts.dryRun && opts.auditBackfill;
  const writeReports = !opts.dryRun && opts.reportBackfill;
  await phase4AuditExpireAt(deps, report, startMs, writeAudits);
  await phase4DelAudits(deps, report, startMs, writeAudits);
  await phase4ReportQueue(deps, report, startMs, writeReports);
}

/**
 * 稽核 expireAt 回填：游標 cpDailyState/auditBackfill 欄位 after。
 * 逐場讀 competitions/{cid}/audits limit 400（分頁 documentId 游標），無 expireAt 者補值。
 * 到底就把 after 清空（下次從頭，已有欄位的會被跳過）。
 * dryRun 或 auditBackfill=false → 只計數、不動游標。
 */
async function phase4AuditExpireAt(
  deps: CpDeps,
  report: DailyReport,
  phase4Start: number,
  writeEnabled: boolean
): Promise<void> {
  const cursorRef = deps.db.doc('cpDailyState/auditBackfill');
  let after = '';
  try {
    const cur = await readDoc(deps, null, cursorRef);
    if (cur.exists && typeof cur.get('after') === 'string') after = cur.get('after') as string;
  } catch (e) {
    logger.error('cpDaily phase4a cursor', { error: (e as Error)?.name ?? 'Error' });
    return;
  }

  let lastScannedCid = after;
  let reachedEnd = false;
  let timeStopped = false;

  try {
    let q = deps.db.collection('competitions').orderBy(FieldPath.documentId()).limit(COMP_PAGE);
    if (after) q = q.startAfter(after);
    const compsSnap = await readQuery(deps, null, q);
    reachedEnd = compsSnap.size < COMP_PAGE;

    for (const compDoc of compsSnap.docs) {
      if (deps.now().getTime() - phase4Start >= PHASE4_BUDGET_MS) { timeStopped = true; break; }
      const cid = compDoc.id;
      const lastMatchAtRaw = compDoc.get('lastMatchAt');
      const lastMatchAtMs = lastMatchAtRaw && typeof (lastMatchAtRaw as { toMillis?: unknown }).toMillis === 'function'
        ? (lastMatchAtRaw as { toMillis(): number }).toMillis()
        : null;

      let compHadBackfill = false;
      let fullyProcessed = true;
      try {
        let auditAfter = '';
        while (true) {
          if (deps.now().getTime() - phase4Start >= PHASE4_BUDGET_MS) {
            timeStopped = true;
            fullyProcessed = false;
            break;
          }
          let aq = deps.db.collection(`competitions/${cid}/audits`)
            .orderBy(FieldPath.documentId()).limit(AUDIT_PAGE);
          if (auditAfter) aq = aq.startAfter(auditAfter);
          const aSnap = await readQuery(deps, null, aq);
          if (aSnap.empty) break;

          const updates: Array<{ ref: DocumentReference; expireAt: Timestamp }> = [];
          for (const aDoc of aSnap.docs) {
            if (aDoc.get('expireAt') != null) continue;
            const atRaw = aDoc.get('at');
            const atMs = atRaw && typeof (atRaw as { toMillis?: unknown }).toMillis === 'function'
              ? (atRaw as { toMillis(): number }).toMillis()
              : deps.now().getTime();
            report.auditBackfillDocs += 1;
            compHadBackfill = true;
            if (writeEnabled) {
              updates.push({
                ref: aDoc.ref,
                expireAt: Timestamp.fromMillis(auditExpireAtMs(atMs, lastMatchAtMs))
              });
            }
          }
          if (writeEnabled) {
            for (const u of updates) {
              try { await u.ref.update({ expireAt: u.expireAt }); } catch (e) {
                logger.error('cpDaily phase4a write', { cid, error: (e as Error)?.name ?? 'Error' });
              }
            }
          }
          const lastDoc = aSnap.docs[aSnap.docs.length - 1];
          if (lastDoc) auditAfter = lastDoc.id;
          if (aSnap.size < AUDIT_PAGE) break;
        }
      } catch (e) {
        fullyProcessed = false;
        logger.error('cpDaily phase4a audits', { cid, error: (e as Error)?.name ?? 'Error' });
      }

      if (fullyProcessed) {
        lastScannedCid = cid;
        if (compHadBackfill) report.auditBackfillComps += 1;
      }
      if (timeStopped) break;
    }
  } catch (e) {
    logger.error('cpDaily phase4a scan', { error: (e as Error)?.name ?? 'Error' });
  }

  if (timeStopped && !report.stoppedEarly.includes('auditBackfill')) {
    report.stoppedEarly.push('auditBackfill');
  }

  if (writeEnabled) {
    const update: Record<string, unknown> = {};
    if (timeStopped) {
      if (lastScannedCid) update.after = lastScannedCid;
    } else if (reachedEnd) {
      update.after = FieldValue.delete();
    } else if (lastScannedCid) {
      update.after = lastScannedCid;
    }
    if (Object.keys(update).length > 0) {
      try { await cursorRef.set(update, { merge: true }); } catch (e) {
        logger.error('cpDaily phase4a cursorwrite', { error: (e as Error)?.name ?? 'Error' });
      }
    }
  }
}

/**
 * cpAudits/del_ 回填：游標 cpDailyState/auditBackfill 欄位 delAfter。
 * 查 cpAudits 中 id 於 ['del_','dem_') 範圍、無 expireAt 者補 deleteAuditExpireAtMs(at)。
 * dryRun 或 auditBackfill=false → 只計數、不動游標。筆數累到 auditBackfillDocs。
 */
async function phase4DelAudits(
  deps: CpDeps,
  report: DailyReport,
  phase4Start: number,
  writeEnabled: boolean
): Promise<void> {
  const cursorRef = deps.db.doc('cpDailyState/auditBackfill');
  let delAfter = '';
  try {
    const cur = await readDoc(deps, null, cursorRef);
    if (cur.exists && typeof cur.get('delAfter') === 'string') delAfter = cur.get('delAfter') as string;
  } catch (e) {
    logger.error('cpDaily phase4b cursor', { error: (e as Error)?.name ?? 'Error' });
    return;
  }

  let lastScannedId = delAfter;
  let reachedEnd = false;
  let timeStopped = false;

  try {
    while (true) {
      if (deps.now().getTime() - phase4Start >= PHASE4_BUDGET_MS) { timeStopped = true; break; }
      let q = deps.db.collection('cpAudits')
        .where(FieldPath.documentId(), '>=', 'del_')
        .where(FieldPath.documentId(), '<', 'dem_')
        .orderBy(FieldPath.documentId())
        .limit(AUDIT_PAGE);
      if (lastScannedId) q = q.startAfter(lastScannedId);
      const snap = await readQuery(deps, null, q);
      if (snap.empty) { reachedEnd = true; break; }

      const updates: Array<{ ref: DocumentReference; expireAt: Timestamp }> = [];
      for (const d of snap.docs) {
        if (d.get('expireAt') != null) continue;
        const atRaw = d.get('at');
        const atMs = atRaw && typeof (atRaw as { toMillis?: unknown }).toMillis === 'function'
          ? (atRaw as { toMillis(): number }).toMillis()
          : deps.now().getTime();
        report.auditBackfillDocs += 1;
        if (writeEnabled) {
          updates.push({ ref: d.ref, expireAt: Timestamp.fromMillis(deleteAuditExpireAtMs(atMs)) });
        }
      }
      if (writeEnabled) {
        for (const u of updates) {
          try { await u.ref.update({ expireAt: u.expireAt }); } catch (e) {
            logger.error('cpDaily phase4b write', { error: (e as Error)?.name ?? 'Error' });
          }
        }
      }
      const lastDoc = snap.docs[snap.docs.length - 1];
      if (lastDoc) lastScannedId = lastDoc.id;
      if (snap.size < AUDIT_PAGE) { reachedEnd = true; break; }
    }
  } catch (e) {
    logger.error('cpDaily phase4b scan', { error: (e as Error)?.name ?? 'Error' });
  }

  if (timeStopped && !report.stoppedEarly.includes('auditBackfill')) {
    report.stoppedEarly.push('auditBackfill');
  }

  if (writeEnabled) {
    const update: Record<string, unknown> = {};
    if (timeStopped) {
      if (lastScannedId) update.delAfter = lastScannedId;
    } else if (reachedEnd) {
      update.delAfter = FieldValue.delete();
    } else if (lastScannedId) {
      update.delAfter = lastScannedId;
    }
    if (Object.keys(update).length > 0) {
      try { await cursorRef.set(update, { merge: true }); } catch (e) {
        logger.error('cpDaily phase4b cursorwrite', { error: (e as Error)?.name ?? 'Error' });
      }
    }
  }
}

/**
 * 檢舉佇列回填：游標 cpDailyState/reportBackfill 欄位 after。
 * 逐場讀 competitions/{cid}/reports 中 status in ['resolved','dismissed']，沒有對應 cpReportPurge 文件的補一份。
 * dryRun 或 reportBackfill=false → 只計數、不動游標。
 */
async function phase4ReportQueue(
  deps: CpDeps,
  report: DailyReport,
  phase4Start: number,
  writeEnabled: boolean
): Promise<void> {
  const cursorRef = deps.db.doc('cpDailyState/reportBackfill');
  let after = '';
  try {
    const cur = await readDoc(deps, null, cursorRef);
    if (cur.exists && typeof cur.get('after') === 'string') after = cur.get('after') as string;
  } catch (e) {
    logger.error('cpDaily phase4c cursor', { error: (e as Error)?.name ?? 'Error' });
    return;
  }

  let lastScannedCid = after;
  let reachedEnd = false;
  let timeStopped = false;

  try {
    let q = deps.db.collection('competitions').orderBy(FieldPath.documentId()).limit(COMP_PAGE);
    if (after) q = q.startAfter(after);
    const compsSnap = await readQuery(deps, null, q);
    reachedEnd = compsSnap.size < COMP_PAGE;

    for (const compDoc of compsSnap.docs) {
      if (deps.now().getTime() - phase4Start >= PHASE4_BUDGET_MS) { timeStopped = true; break; }
      const cid = compDoc.id;
      let fullyProcessed = true;
      try {
        const rq = deps.db.collection(`competitions/${cid}/reports`)
          .where('status', 'in', ['resolved', 'dismissed'])
          .limit(REPORT_PAGE);
        const rSnap = await readQuery(deps, null, rq);
        for (const rDoc of rSnap.docs) {
          if (deps.now().getTime() - phase4Start >= PHASE4_BUDGET_MS) {
            timeStopped = true;
            fullyProcessed = false;
            break;
          }
          const rid = rDoc.id;
          const purgeRef = deps.db.doc(`cpReportPurge/${cid}_${rid}`);
          let existsAlready = false;
          try {
            const pSnap = await readDoc(deps, null, purgeRef);
            existsAlready = pSnap.exists;
          } catch (e) {
            logger.error('cpDaily phase4c purgecheck', { cid, error: (e as Error)?.name ?? 'Error' });
            continue;
          }
          if (existsAlready) continue;

          report.reportBackfillDocs += 1;
          if (writeEnabled) {
            const reviewedAt = rDoc.get('reviewedAt') ?? rDoc.get('lastAt');
            const reviewedAtMs = reviewedAt && typeof (reviewedAt as { toMillis?: unknown }).toMillis === 'function'
              ? (reviewedAt as { toMillis(): number }).toMillis()
              : deps.now().getTime();
            try {
              await purgeRef.set(
                { cid, rid, purgeAt: Timestamp.fromMillis(reportPurgeAtMs(reviewedAtMs)) },
                { merge: true }
              );
            } catch (e) {
              logger.error('cpDaily phase4c write', { cid, error: (e as Error)?.name ?? 'Error' });
            }
          }
        }
      } catch (e) {
        fullyProcessed = false;
        logger.error('cpDaily phase4c comp', { cid, error: (e as Error)?.name ?? 'Error' });
      }

      if (fullyProcessed) lastScannedCid = cid;
      if (timeStopped) break;
    }
  } catch (e) {
    logger.error('cpDaily phase4c scan', { error: (e as Error)?.name ?? 'Error' });
  }

  if (timeStopped && !report.stoppedEarly.includes('reportBackfill')) {
    report.stoppedEarly.push('reportBackfill');
  }

  if (writeEnabled) {
    const update: Record<string, unknown> = {};
    if (timeStopped) {
      if (lastScannedCid) update.after = lastScannedCid;
    } else if (reachedEnd) {
      update.after = FieldValue.delete();
    } else if (lastScannedCid) {
      update.after = lastScannedCid;
    }
    if (Object.keys(update).length > 0) {
      try { await cursorRef.set(update, { merge: true }); } catch (e) {
        logger.error('cpDaily phase4c cursorwrite', { error: (e as Error)?.name ?? 'Error' });
      }
    }
  }
}
