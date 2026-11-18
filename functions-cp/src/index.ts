/**
 * 賽事 codebase（functions-cp）進入點。第 2 步：cpHost、cpEntry、cpParticipant 三支分組 Callable；
 * 第 3 步：觸發器 cpOnMatchWritten（積分增量重算、摘要片、末場確認結束）。
 * cpAdminOps 在主 codebase（§6.1）。尚未部署（G5 另送裁）；firebase.json 多 codebase 設定屬 G2。
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { handleMatchWritten } from './cp/match-trigger.js';
import { runCallable, type Handler } from './cp/callable.js';
import type { CpDeps } from './cp/context.js';
import { handleCpEntry } from './cp/entry.js';
import { handleCpHost } from './cp/host.js';
import { handleCpParticipant } from './cp/participant.js';

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
  await handleMatchWritten(getDeps(), event.params.cid, event.params.mtId, before, after);
});
