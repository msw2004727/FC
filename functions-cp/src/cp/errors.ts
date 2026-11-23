/**
 * 賽事 Callable 錯誤：code 對應 HttpsError 的 FunctionsErrorCode；reason 是給前端對照文案的
 * 大寫代碼（照主站 R-CF-002 safe reason 格式 ^[A-Z][A-Z0-9_]{1,63}$），不放中文句子、不放 uid。
 */
export type CpErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'not-found'
  | 'already-exists'
  | 'resource-exhausted'
  // 主辦權限文件讀取失敗（host-permission.ts，fail-closed 拒絕建賽）
  | 'unavailable';

export class CpError extends Error {
  readonly code: CpErrorCode;
  readonly reason: string;
  readonly params?: Record<string, string | number | boolean>;

  constructor(code: CpErrorCode, reason: string, params?: Record<string, string | number | boolean>) {
    super(reason);
    this.code = code;
    this.reason = reason;
    if (params) this.params = params;
  }
}

export const deny = (reason: string) => new CpError('permission-denied', reason);
export const bad = (reason: string, params?: Record<string, string | number | boolean>) =>
  new CpError('invalid-argument', reason, params);
export const pre = (reason: string, params?: Record<string, string | number | boolean>) =>
  new CpError('failed-precondition', reason, params);
export const notFound = (reason: string) => new CpError('not-found', reason);
export const unavailable = (reason: string) => new CpError('unavailable', reason);
