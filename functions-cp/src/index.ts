/**
 * 賽事 codebase（functions-cp）進入點。第 2 步：cpHost、cpEntry、cpParticipant 三支分組 Callable。
 * cpAdminOps 在主 codebase（§6.1）。尚未部署（G5 另送裁）；firebase.json 多 codebase 設定屬 G2。
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
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
