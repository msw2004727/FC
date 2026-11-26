/**
 * 賽事 codebase（functions-cp）進入點。第 2 步：cpHost、cpEntry、cpParticipant 三支分組 Callable；
 * 第 3 步：觸發器 cpOnMatchWritten（積分增量重算、摘要片、末場確認結束）。
 * 第 4 步 K3：cpOnScorerWritten（接手稽核）。射手榜與冠軍名在 cpOnMatchWritten 的處理函式。
 * cpAdminOps 在主 codebase（§6.1）。尚未部署（G5 另送裁）；firebase.json 多 codebase 設定屬 G2。
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { handleMatchWritten } from './cp/match-trigger.js';
import { handleScorerWritten } from './cp/scorer-trigger.js';
import { runCallable, type Handler } from './cp/callable.js';
import type { CpDeps } from './cp/context.js';
import { handleCpEntry } from './cp/entry.js';
import { handleCpHost } from './cp/host.js';
import { handleCpParticipant } from './cp/participant.js';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runDaily, dailyOptionsFromEnv } from './cp/daily.js';

export const CP_DATABASE_ID = 'asia-main';

let deps: CpDeps | null = null;
function getDeps(): CpDeps {
  if (!deps) {
    const app = getApps()[0] ?? initializeApp();
    deps = { db: getFirestore(app, CP_DATABASE_ID), mainDb: getFirestore(app), now: () => new Date() };
  }
  return deps;
}

const OPTIONS: CallableOptions = {
  region: 'asia-east1',
  memory: '256MiB',
  timeoutSeconds: 60,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 40
};

function wrap(name: string, handler: Handler) {
  return onCall(OPTIONS, async (req: CallableRequest) => {
    const out = await runCallable(getDeps(), req.auth ? { uid: req.auth.uid, token: req.auth.token } : null, req.data, handler);
    if (out.ok) return out.result;
    if (out.error.code === 'internal') {
      // 只記錯誤類型與動作名，不記輸入（可能含真名、生日）
      const action = (req.data && typeof req.data === 'object' && typeof (req.data as { action?: unknown }).action === 'string')
        ? (req.data as { action: string }).action : '';
      logger.error(`${name} internal`, { action, error: (out.cause as Error)?.name ?? 'Error' });
    }
    throw new HttpsError(out.error.code, out.error.reason, out.error.params ? { reason: out.error.reason, ...out.error.params } : { reason: out.error.reason });
  });
}

export const cpHost = wrap('cpHost', handleCpHost);
export const cpEntry = wrap('cpEntry', handleCpEntry);
export const cpParticipant = wrap('cpParticipant', handleCpParticipant);

/**
 * §6.2 cpOnMatchWritten：只監聽 asia-main 的場次；status／score／rev／時間場地等變動才處理（§6.4）。
 * 失敗時拋出讓平台重試（處理函式冪等：每次都讀目前狀態重算）。
 */
export const cpOnMatchWritten = onDocumentWritten({
  document: 'competitions/{cid}/matches/{mtId}',
  database: CP_DATABASE_ID,
  region: 'asia-east1',
  memory: '256MiB',
  timeoutSeconds: 60,
  minInstances: 0,
  maxInstances: 10,
  retry: true
}, async event => {
  const before = event.data?.before?.exists ? event.data.before.data() ?? null : null;
  const after = event.data?.after?.exists ? event.data.after.data() ?? null : null;
  try {
    await handleMatchWritten(getDeps(), event.params.cid, event.params.mtId, before, after);
  } catch (e) {
    // 資料錯誤（TypeError／RangeError，例如場次欄位壞掉）重試也不會好：記 log 後吞掉，避免連續重試 7 天
    // （Opus 終審 P3-6）。交易衝突、逾時等其他錯誤照拋，讓平台重試（處理函式冪等）。
    if (e instanceof TypeError || e instanceof RangeError) {
      // cid／mtId 是隨機 id、不是個資；上線後要對這條 log 設告警（TypeError 也可能是程式錯誤）
      logger.error('cpOnMatchWritten data error', { cid: event.params.cid, mtId: event.params.mtId, error: e.name, message: e.message.slice(0, 200) });
      return;
    }
    throw e;
  }
});

/**
 * K3 接手稽核：只監聽記分者控制文件。建立或換人時寫私密稽核；刪除與同一人不寫。
 * 失敗時拋出讓平台重試（同 id 已存在則不寫）。資料錯誤記 log 後吞掉。
 */
export const cpOnScorerWritten = onDocumentWritten({
  document: 'competitions/{cid}/matches/{mtId}/control/scorer',
  database: CP_DATABASE_ID,
  region: 'asia-east1',
  memory: '256MiB',
  timeoutSeconds: 60,
  minInstances: 0,
  maxInstances: 10,
  retry: true
}, async event => {
  const before = event.data?.before?.exists ? event.data.before.data() ?? null : null;
  const after = event.data?.after?.exists ? event.data.after.data() ?? null : null;
  try {
    await handleScorerWritten(getDeps(), event.params.cid, event.params.mtId, before, after);
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      logger.error('cpOnScorerWritten data error', { cid: event.params.cid, mtId: event.params.mtId, error: e.name, message: e.message.slice(0, 200) });
      return;
    }
    throw e;
  }
});

/**
 * 個資移除與保存期限每日排程（設計卡 ① §4.4）：續跑移除工作、等待項目到期、檢舉 180 天清除、稽核 expireAt 回填。
 * 預設只計數（CP_DAILY_DRY_RUN 不是 '0' 就不寫）；正式開啟 D7、回填 D4／D5 各自另送站長。
 */
export const cpDaily = onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'Asia/Taipei',
  region: 'asia-east1',
  memory: '256MiB',
  timeoutSeconds: 540,
  maxInstances: 1,
  retryCount: 0
}, async () => {
  const report = await runDaily(getDeps(), dailyOptionsFromEnv(process.env));
  logger.info('cpDaily', report);
});
