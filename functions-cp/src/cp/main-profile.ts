/**
 * 讀主站（(default) 庫）會員資料：只取登錄需要的顯示名、生日與有效隊伍清單，生日算完即丟、不寫進賽事庫。
 *
 * 集中在這一支（顧問 §3.251 F4）：主站會員資料讀取強化（A3-02）第二段預計搬移生日欄位，
 * 搬移時只要改這裡（例如改讀 users/{uid}/profilePrivate/profile），呼叫端不動。
 * 目前來源：users/{uid}.birthday（字串 YYYY/MM/DD）、users/{uid}.displayName、users/{uid}.lineDisplayName、users/{uid}.teamIds／teamId。
 * 隊伍清單（顧問 §3.839 方案 C）：joinRoster 的成員判斷改看這裡，取代從沒有程式寫入的 cpClubs/{teamId}/members 鏡像。
 * 隊伍雙鍵（顧問 §3.846）：舊俱樂部的 teams 文件 id 與文件內 id 欄位（自訂 id）可能不同；報隊存文件 id、users.teamIds 存自訂 id，
 * 兩把鍵都由 readMainTeamKeys 換算（主站同一套退路見 R-ID-004、firebase-service.js fetchTeamIfMissing）。
 */
import { TEAM_ID_RE, readDoc, type CpDeps } from './context.js';

export interface MainProfileForAge {
  birthday: unknown;
  displayName: string | null;
  /** 登入函式寫的 LINE 暱稱（users/{uid}.lineDisplayName）；前端寫不到。沒有此欄回 null。 */
  lineDisplayName: string | null;
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
  if (!user.exists) return { birthday: null, displayName: null, lineDisplayName: null, teamIds: [] };
  const displayName = user.get('displayName');
  const lineDisplayName = user.get('lineDisplayName');
  return {
    birthday: user.get('birthday') ?? null,
    displayName: typeof displayName === 'string' ? displayName : null,
    lineDisplayName: typeof lineDisplayName === 'string' ? lineDisplayName : null,
    teamIds: teamIdsOfMainUser(user.get('teamIds'), user.get('teamId'))
  };
}

/**
 * 主站俱樂部的成員比對鍵（顧問 §3.846）：一定有文件 id；文件內 id 欄位是合法隊伍 id（TEAM_ID_RE）且不等於文件 id 時，加為第二把鍵。
 * id 欄位缺漏、不是字串、形狀錯或等於文件 id：只用文件 id 一把（與 §3.846 前行為相同）。
 * id 欄位只有 canManageAnyTeam（超管／team.manage_all）或 Admin SDK 能設成不等於文件 id（主站 firestore.rules teams：
 * 一般建立要 id == 文件 id，一般更新不得改 id），所以第二把鍵不是一般會員可偽造的。
 */
export function mainTeamKeysOf(docId: string, idField: unknown): string[] {
  if (typeof idField === 'string' && idField !== docId && TEAM_ID_RE.test(idField)) return [docId, idField];
  return [docId];
}

/**
 * 讀主站 teams/{teamId} 換算成員比對鍵（交易外讀；呼叫端不直接碰 teams）。
 * teamId 形狀不合 TEAM_ID_RE 時不讀、回 []（呼叫端本來就不會把它當成員）；teams 文件不存在時只回 [teamId]。
 */
export async function readMainTeamKeys(deps: CpDeps, teamId: string): Promise<string[]> {
  if (!TEAM_ID_RE.test(teamId)) return [];
  const team = await readDoc(deps, null, deps.mainDb.doc(`teams/${teamId}`));
  return mainTeamKeysOf(teamId, team.exists ? team.get('id') : undefined);
}
