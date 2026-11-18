/**
 * Callable 外殼：身分取出、錯誤轉換（只回 code＋reason＋params，不回堆疊與內部訊息）。
 * 與 onCall 分開，讓單元測試不必載入 firebase-functions 執行環境。
 */
import { CpError } from './errors.js';
import { callerOf, type CpDeps } from './context.js';

export interface CallableErrorShape {
  code: CpError['code'] | 'internal';
  reason: string;
  params?: Record<string, string | number | boolean>;
}

export function toErrorShape(e: unknown): CallableErrorShape {
  if (e instanceof CpError) return { code: e.code, reason: e.reason, ...(e.params ? { params: e.params } : {}) };
  // Firestore 交易競爭過多等：不外露訊息
  return { code: 'internal', reason: 'INTERNAL' };
}

export type Handler = (deps: CpDeps, caller: ReturnType<typeof callerOf>, data: unknown) => Promise<unknown>;

export async function runCallable(
  deps: CpDeps,
  auth: { uid?: unknown; token?: Record<string, unknown> } | null | undefined,
  data: unknown,
  handler: Handler
): Promise<{ ok: true; result: unknown } | { ok: false; error: CallableErrorShape; cause: unknown }> {
  try {
    const caller = callerOf(auth);
    return { ok: true, result: await handler(deps, caller, data) };
  } catch (e) {
    return { ok: false, error: toErrorShape(e), cause: e };
  }
}
