/**
 * 主辦賽事開關（顧問 §3.612）：createCompetition 建賽前的伺服器守門。
 *
 * 例外說明：context.ts 的原則是「賽事 codebase 不寫權限碼判斷」。這兩個碼是預設開、只記「關」的開關，
 * 不讀 permissions／capabilities 陣列，也不讀個別授權（userPermissionGrants），只讀主站角色文件的 disabledCodes。
 *
 * 真值表與新站前端 src/features/profile/data/default-on-codes.ts 一字不差：
 * - undefined（文件或欄位不存在）→ 開
 * - 陣列且含 code → 關；陣列且不含 code（含 []）→ 開
 * - 其他（null、字串、物件、數字…）→ 關（fail-closed）
 * 整個 disabledCodes 欄位被刪掉時回到預設開，這是接受的行為。
 */
import { readDoc, type Caller, type CpDeps } from './context.js';
import { deny, unavailable } from './errors.js';

/** 教練以上（rolePermissions 系統）的主辦賽事碼。 */
export const COMPETITION_HOST_CODE = 'competition.host';
/** 一般用戶（roleActivityCapabilities 系統）的主辦賽事碼。 */
export const USER_COMPETITION_HOST_CODE = 'user.competition.host';

export function isDefaultOnCodeEnabled(disabledRaw: unknown, code: string): boolean {
  if (disabledRaw === undefined) return true;
  if (!Array.isArray(disabledRaw)) return false;
  return !disabledRaw.includes(code);
}

/** 依角色決定要讀哪份文件、看哪個碼。role 為 null 或空字串當 'user'。 */
export function hostPermissionSource(role: string | null): { path: string; code: string } | null {
  const key = role ? role : 'user';
  if (key === 'super_admin') return null;
  if (key === 'user') return { path: 'roleActivityCapabilities/user', code: USER_COMPETITION_HOST_CODE };
  return { path: `rolePermissions/${key}`, code: COMPETITION_HOST_CODE };
}

/**
 * super_admin 不讀、直接通過；其他角色（含 admin、自訂角色）讀主站 1 份文件（計入 deps.meter）。
 * 關 → permission-denied HOST_DISABLED；讀取失敗 → unavailable HOST_PERMISSION_UNAVAILABLE。
 */
export async function assertCanHostCompetition(deps: CpDeps, caller: Caller): Promise<void> {
  const source = hostPermissionSource(caller.role);
  if (!source) return;
  // ASSUMPTION: claims role 含「/」會讓文件路徑跑到別的集合，當成沒有合法角色文件，直接拒絕（不讀）。
  if (source.path.split('/').length !== 2) throw deny('HOST_DISABLED');
  let disabledRaw: unknown;
  try {
    const snap = await readDoc(deps, null, deps.mainDb.doc(source.path));
    disabledRaw = snap.exists ? snap.get('disabledCodes') : undefined;
  } catch {
    throw unavailable('HOST_PERMISSION_UNAVAILABLE');
  }
  if (!isDefaultOnCodeEnabled(disabledRaw, source.code)) throw deny('HOST_DISABLED');
}
