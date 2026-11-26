/**
 * 讀主站（(default) 庫）會員資料：只取登錄需要的顯示名、生日與有效隊伍清單，生日算完即丟、不寫進賽事庫。
 *
 * 集中在這一支（顧問 §3.251 F4）：主站會員資料讀取強化（A3-02）第二段預計搬移生日欄位，
 * 搬移時只要改這裡（例如改讀 users/{uid}/profilePrivate/profile），呼叫端不動。
 * 目前來源：users/{uid}.birthday（字串 YYYY/MM/DD）、users/{uid}.displayName、users/{uid}.teamIds／teamId。
 * 隊伍清單（顧問 §3.839 方案 C）：joinRoster 的成員判斷改看這裡，取代從沒有程式寫入的 cpClubs/{teamId}/members 鏡像。
 */
import { readDoc, type CpDeps } from './context.js';

export interface MainProfileForAge {
  birthday: unknown;
  displayName: string | null;
  /** 主站有效隊伍清單（規則 E，見 teamIdsOfMainUser）；users 不存在時為 [] */
  teamIds: string[];
}

/**
 * 主站 users 文件的有效隊伍清單（規則 E，顧問 11-06 §1.13；與主站 firestore.rules userTeamKeysOf、
 * functions getUserTeamIds 同一規則）：teamIds 是非空陣列就只認 teamIds；否則 teamId 是非空字串就認 [teamId]；
 * 否則 []。元素只認字串。不取聯集：teamIds 非空時舊 teamId 不能掩護已被移出 teamIds 的隊伍。
 */
export function teamIdsOfMainUser(teamIds: unknown, teamId: unknown): string[] {
  if (Array.isArray(teamIds) && teamIds.length > 0) {
    return teamIds.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  if (typeof teamId === 'string' && teamId.length > 0) return [teamId];
  return [];
}

export async function readMainProfileForAge(deps: CpDeps, uid: string): Promise<MainProfileForAge> {
  const user = await readDoc(deps, null, deps.mainDb.doc(`users/${uid}`));
  if (!user.exists) return { birthday: null, displayName: null, teamIds: [] };
  const displayName = user.get('displayName');
  return {
    birthday: user.get('birthday') ?? null,
    displayName: typeof displayName === 'string' ? displayName : null,
    teamIds: teamIdsOfMainUser(user.get('teamIds'), user.get('teamId'))
  };
}
