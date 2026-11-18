/**
 * 讀主站（(default) 庫）會員資料：只取登錄需要的顯示名與生日，生日算完即丟、不寫進賽事庫。
 *
 * 集中在這一支（顧問 §3.251 F4）：主站會員資料讀取強化（A3-02）第二段預計搬移生日欄位，
 * 搬移時只要改這裡（例如改讀 users/{uid}/profilePrivate/profile），呼叫端不動。
 * 目前來源：users/{uid}.birthday（字串 YYYY/MM/DD）、users/{uid}.displayName。
 */
import { readDoc, type CpDeps } from './context.js';

export interface MainProfileForAge {
  birthday: unknown;
  displayName: string | null;
}

export async function readMainProfileForAge(deps: CpDeps, uid: string): Promise<MainProfileForAge> {
  const user = await readDoc(deps, null, deps.mainDb.doc(`users/${uid}`));
  if (!user.exists) return { birthday: null, displayName: null };
  const displayName = user.get('displayName');
  return {
    birthday: user.get('birthday') ?? null,
    displayName: typeof displayName === 'string' ? displayName : null
  };
}
