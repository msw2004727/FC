/**
 * 建賽精靈輸入驗證（純函式）。時間一律 epoch 毫秒整數；伺服器轉 Timestamp。
 * 錯誤回 CpError('invalid-argument', reason, { field })，前端以 reason 對照文案。
 */
import { bad } from './errors.js';
import { cleanLine, findBannedWord, isAllowedLiveLink, optionalLine, optionalText, requireLine } from './text.js';
import { isAllowedLogoUrl } from './logo-hosts.js';

/** 賽事分類（顧問 §3.264）。讀取端缺值用 categoryOf，不在這裡默認。 */
export const CATEGORIES = ['league', 'cup', 'friendly'] as const;
export type CompetitionCategory = (typeof CATEGORIES)[number];

export const SPORTS = ['football'] as const;
export const TIMEZONES = ['Asia/Taipei'] as const;
export const PLAYERS_ON_FIELD = [5, 7, 8, 9, 11] as const;
export const LIMITS = Object.freeze({
  nameMax: 60,
  hostDisplayMax: 30,
  venuesMax: 10,
  venueNameMax: 40,
  venueAddressMax: 100,
  feeNoteMax: 500,
  liveLinksMax: 5,
  divisionsMax: 8,
  divisionNameMax: 30,
  contactNoteMax: 60,
  teamsMin: 2,
  teamsMax: 64,
  rosterMaxCap: 40,
  regSpanMaxDays: 120,
  matchSpanMaxDays: 180,
  futureMaxDays: 730,
  statusReasonMax: 200,
  feePerTeamMax: 1_000_000
});

const DAY = 86400_000;

/** 場地：比照活動的地點欄（FC-B use-event-location：lat／lng／mapPlaceId／mapProvider），站長 11-18 */
export interface VenueInput {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  mapPlaceId: string | null;
  mapProvider: 'google' | 'manual' | null;
}
export interface DivisionInput {
  dvId?: string;
  name: string;
  playersOnField: number;
  maxTeams: number;
  rosterMin: number;
  rosterMax: number;
  minAge: number | null;
  maxAge: number | null;
  requireRealName: boolean;
  /** 每隊報名費（新台幣，整數，可為 0；站長 11-18） */
  feePerTeam: number;
}
export interface Schedule { regOpenAt: number; regCloseAt: number; firstMatchAt: number; lastMatchAt: number }

function isInt(v: unknown): v is number { return typeof v === 'number' && Number.isInteger(v); }

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (!isInt(v) || v < min || v > max) throw bad('FIELD_RANGE', { field, min, max });
  return v;
}

function optIntIn(v: unknown, field: string, min: number, max: number): number | null {
  if (v == null) return null;
  return intIn(v, field, min, max);
}

export function requireEnum<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw bad('FIELD_ENUM', { field });
  return v as T;
}

/**
 * 讀取端分類：文件缺欄位、null、或不是白名單，一律視為 'league'。
 * 不丟錯（舊賽事沒有這個欄位）。
 */
export function categoryOf(doc: { category?: unknown } | null | undefined): CompetitionCategory {
  const c = doc?.category;
  return typeof c === 'string' && (CATEGORIES as readonly string[]).includes(c) ? c as CompetitionCategory : 'league';
}

/** 寫入端白名單。其他值（含型別不對、空字串）回 INVALID_FIELD。缺值由呼叫端另處理。 */
export function categoryInput(v: unknown): CompetitionCategory {
  if (typeof v !== 'string' || !(CATEGORIES as readonly string[]).includes(v)) {
    throw bad('INVALID_FIELD', { field: 'category' });
  }
  return v as CompetitionCategory;
}

/**
 * 隊徽網址快照。規則對齊主站 tournamentCards 的 image（firestore.rules isValidTournamentCard）：
 * 整段符合 `https://` 後只許可見 ASCII（`[!-~]+`，不含空白），不合格的不存。
 * 長度上限 1200，與主站 image 相同（firestore.rules isValidTournamentCard）。取代派工卡原寫的 500：Firebase 下載網址可能超過 500，會被誤判成沒有隊徽。
 * 正規化只做 NFKC 與去頭尾空白，不改寫路徑（不用 URL.href，避免多出結尾斜線）。
 * 不合格回 null，不丟錯。
 */
export const TEAM_LOGO_MAX = 1200;
const TEAM_LOGO_RE = /^https:\/\/[!-~]+$/;

export function teamLogoOf(raw: unknown, buckets?: readonly string[]): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').trim();
  if (s.length === 0 || s.length > TEAM_LOGO_MAX) return null;
  if (!TEAM_LOGO_RE.test(s)) return null;
  // 顧問 §3.278 P2：只收本專案 Storage 下載網址，其餘寫 null（防追蹤圖、洩漏觀眾 IP）
  if (!isAllowedLogoUrl(s, buckets)) return null;
  return s;
}

/**
 * 賽事封面（計畫書「賽事封面圖」做法甲；顧問 §3.536）：前端裁切後直傳 Storage，這裡只驗兩個下載網址。
 * - null＝移除封面；物件只能有 url、thumb 兩鍵，兩鍵都必填。
 * - 每個網址：NFKC＋去頭尾空白、≤ 1200 字、`https://` 後只許可見 ASCII、本專案 bucket 的 Firebase Storage 下載網址
 *   （沿用隊徽 isAllowedLogoUrl／CP_LOGO_BUCKETS），且 URL 解析後原樣不變（不收反斜線、#、需要再編碼的字元）。
 * - 物件路徑（解碼後）：url＝images/competitions/c_{16 碼}/cover_{13 碼毫秒}.(webp|jpg)，thumb 同理換成 thumb_；
 *   兩者必須在同一個 c_ 資料夾。路徑不含 uid（§3.251 (c)）。
 * - 與隊徽「不合格寫 null」不同：封面是主辦自己送的欄位，不合格明確回錯。
 */
export interface CoverInput { url: string; thumb: string }
const COVER_KEYS = ['url', 'thumb'] as const;
const COVER_PATH_RE = /^images\/competitions\/(c_[a-z0-9]{16})\/(cover|thumb)_[0-9]{13}\.(?:webp|jpg)$/;

/** 回傳解碼後的資料夾鍵；不合格丟錯（field 為 cover.url 或 cover.thumb）。 */
function coverUrlOf(raw: unknown, kind: 'url' | 'thumb', buckets?: readonly string[]): { url: string; folder: string } {
  const field = `cover.${kind}`;
  if (raw == null) throw bad('FIELD_REQUIRED', { field });
  if (typeof raw !== 'string') throw bad('FIELD_TYPE', { field });
  const s = raw.normalize('NFKC').trim();
  if (s.length === 0 || s.length > TEAM_LOGO_MAX) throw bad('FIELD_LENGTH', { field, min: 1, max: TEAM_LOGO_MAX });
  if (!TEAM_LOGO_RE.test(s)) throw bad('FIELD_FORMAT', { field });
  if (!isAllowedLogoUrl(s, buckets)) throw bad('COVER_URL_NOT_ALLOWED', { field });
  const u = new URL(s); // isAllowedLogoUrl 已確認可解析
  if (u.href !== s || u.hash !== '') throw bad('FIELD_FORMAT', { field });
  // 只收 getDownloadURL 的標準形：bucket 段不編碼、物件段＝encodeURIComponent(路徑)、query 只有 alt=media（可帶 token）。
  // 獨立審查 P3：不帶 alt=media 會拿到 JSON 中繼資料而破圖；編碼變體雖指向同一物件，但前端比對會判不合格。
  if (!/^\?alt=media(?:&token=[A-Za-z0-9-]{1,64})?$/.test(u.search)) throw bad('COVER_URL_NOT_ALLOWED', { field });
  const m = /^\/v0\/b\/[a-z0-9._-]+\/o\/([^/]+)$/.exec(u.pathname);
  let path: string;
  try {
    path = decodeURIComponent(m ? m[1]! : '');
  } catch {
    throw bad('COVER_URL_NOT_ALLOWED', { field });
  }
  if (!m || encodeURIComponent(path) !== m[1]) throw bad('COVER_URL_NOT_ALLOWED', { field });
  const p = COVER_PATH_RE.exec(path);
  if (!p || p[2] !== (kind === 'url' ? 'cover' : 'thumb')) throw bad('COVER_URL_NOT_ALLOWED', { field });
  return { url: s, folder: p[1]! };
}

export function coverOf(v: unknown, buckets?: readonly string[]): CoverInput | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('FIELD_TYPE', { field: 'cover' });
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(COVER_KEYS as readonly string[]).includes(k)) throw bad('UNKNOWN_FIELD', { field: 'cover' });
  }
  const url = coverUrlOf(o.url, 'url', buckets);
  const thumb = coverUrlOf(o.thumb, 'thumb', buckets);
  if (url.folder !== thumb.folder) throw bad('COVER_URL_NOT_ALLOWED', { field: 'cover' });
  return { url: url.url, thumb: thumb.url };
}

export function competitionName(v: unknown, bannedWords: readonly string[]): string {
  const name = requireLine(v, 'name', 2, LIMITS.nameMax);
  if (findBannedWord(name, bannedWords)) throw bad('BANNED_WORD', { field: 'name' });
  return name;
}

export function hostDisplayName(v: unknown, bannedWords: readonly string[]): string {
  const s = requireLine(v, 'hostDisplay', 1, LIMITS.hostDisplayMax);
  if (findBannedWord(s, bannedWords)) throw bad('BANNED_WORD', { field: 'hostDisplay' });
  return s;
}

/**
 * 主辦公開聯絡文字（§3.272 F4）：選填、單行、≤ 60 字，走 cleanLine 與禁用詞。
 * 多行直接拒絕，不把換行壓成空白。不另開電話欄位。
 */
export function contactNoteOf(v: unknown, bannedWords: readonly string[]): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw bad('FIELD_TYPE', { field: 'contactNote' });
  if (/[\r\n]/.test(v)) throw bad('FIELD_FORMAT', { field: 'contactNote' });
  const s = cleanLine(v);
  if (!s) return null;
  if ([...s].length > LIMITS.contactNoteMax) {
    throw bad('FIELD_LENGTH', { field: 'contactNote', min: 0, max: LIMITS.contactNoteMax });
  }
  if (findBannedWord(s, bannedWords)) throw bad('BANNED_WORD', { field: 'contactNote' });
  return s;
}

export function epochMs(v: unknown, field: string): number {
  // 2020-01-01 ～ 2100-01-01
  if (!isInt(v) || v < 1577836800000 || v > 4102444800000) throw bad('FIELD_TIME', { field });
  return v;
}

/** 報名期間與比賽期間：regOpen < regClose ≤ firstMatch ≤ lastMatch；長度上限。 */
export function scheduleOf(v: Record<string, unknown>, nowMs: number, opts: { requireFuture: boolean }): Schedule {
  const s: Schedule = {
    regOpenAt: epochMs(v.regOpenAt, 'regOpenAt'),
    regCloseAt: epochMs(v.regCloseAt, 'regCloseAt'),
    firstMatchAt: epochMs(v.firstMatchAt, 'firstMatchAt'),
    lastMatchAt: epochMs(v.lastMatchAt, 'lastMatchAt')
  };
  if (!(s.regOpenAt < s.regCloseAt)) throw bad('SCHEDULE_ORDER', { field: 'regCloseAt' });
  if (!(s.regCloseAt <= s.firstMatchAt)) throw bad('SCHEDULE_ORDER', { field: 'firstMatchAt' });
  if (!(s.firstMatchAt <= s.lastMatchAt)) throw bad('SCHEDULE_ORDER', { field: 'lastMatchAt' });
  if (s.regCloseAt - s.regOpenAt > LIMITS.regSpanMaxDays * DAY) throw bad('SCHEDULE_SPAN', { field: 'regCloseAt' });
  if (s.lastMatchAt - s.firstMatchAt > LIMITS.matchSpanMaxDays * DAY) throw bad('SCHEDULE_SPAN', { field: 'lastMatchAt' });
  if (s.lastMatchAt > nowMs + LIMITS.futureMaxDays * DAY) throw bad('SCHEDULE_TOO_FAR', { field: 'lastMatchAt' });
  if (opts.requireFuture && s.firstMatchAt <= nowMs) throw bad('SCHEDULE_PAST', { field: 'firstMatchAt' });
  return s;
}

export function venuesOf(v: unknown): VenueInput[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > LIMITS.venuesMax) {
    throw bad('FIELD_RANGE', { field: 'venues', min: 1, max: LIMITS.venuesMax });
  }
  return v.map((x, i) => {
    if (!x || typeof x !== 'object') throw bad('FIELD_TYPE', { field: `venues.${i}` });
    const o = x as Record<string, unknown>;
    onlyKeys(o, ['name', 'address', 'lat', 'lng', 'mapPlaceId', 'mapProvider']);
    const hasLat = o.lat != null;
    const hasLng = o.lng != null;
    if (hasLat !== hasLng) throw bad('FIELD_REQUIRED', { field: `venues.${i}.${hasLat ? 'lng' : 'lat'}` });
    const num = (x: unknown, f: string, lim: number) => {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < -lim || x > lim) throw bad('FIELD_RANGE', { field: `venues.${i}.${f}`, min: -lim, max: lim });
      return x;
    };
    const lat = hasLat ? num(o.lat, 'lat', 90) : null;
    const lng = hasLng ? num(o.lng, 'lng', 180) : null;
    let mapPlaceId: string | null = null;
    if (o.mapPlaceId != null && o.mapPlaceId !== '') {
      if (typeof o.mapPlaceId !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(o.mapPlaceId)) throw bad('FIELD_FORMAT', { field: `venues.${i}.mapPlaceId` });
      mapPlaceId = o.mapPlaceId;
    }
    const mapProvider = lat == null ? null
      : (o.mapProvider == null ? (mapPlaceId ? 'google' : 'manual') : requireEnum(o.mapProvider, ['google', 'manual'] as const, `venues.${i}.mapProvider`));
    if (lat == null && (mapPlaceId || o.mapProvider != null)) throw bad('FIELD_REQUIRED', { field: `venues.${i}.lat` });
    return {
      name: requireLine(o.name, `venues.${i}.name`, 1, LIMITS.venueNameMax),
      address: optionalLine(o.address, `venues.${i}.address`, LIMITS.venueAddressMax),
      lat, lng, mapPlaceId, mapProvider
    };
  });
}

export function liveLinksOf(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > LIMITS.liveLinksMax) {
    throw bad('FIELD_RANGE', { field: 'liveLinks', min: 0, max: LIMITS.liveLinksMax });
  }
  return v.map((x, i) => {
    const s = cleanLine(x);
    if (!s || s.length > 300 || !isAllowedLiveLink(s)) throw bad('LIVE_LINK_NOT_ALLOWED', { field: `liveLinks.${i}` });
    return s;
  });
}

/** 繳費說明（§8.4）：只有俱樂部主辦可寫；個人主辦帶了就拒絕（不是靜默丟棄）。 */
export function feeNoteOf(v: unknown, hostType: 'personal' | 'club'): string | null {
  if (v == null || v === '') return null;
  if (hostType !== 'club') throw bad('FEE_NOTE_NOT_ALLOWED', { field: 'feeNote' });
  return optionalText(v, 'feeNote', LIMITS.feeNoteMax);
}

export function divisionOf(v: unknown, i: number): DivisionInput {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('FIELD_TYPE', { field: `divisions.${i}` });
  const o = v as Record<string, unknown>;
  const p = `divisions.${i}`;
  onlyKeys(o, ['dvId', 'name', 'playersOnField', 'maxTeams', 'rosterMin', 'rosterMax', 'minAge', 'maxAge', 'requireRealName', 'feePerTeam']);
  const playersOnField = o.playersOnField;
  if (!(PLAYERS_ON_FIELD as readonly unknown[]).includes(playersOnField)) throw bad('FIELD_ENUM', { field: `${p}.playersOnField` });
  const maxTeams = intIn(o.maxTeams, `${p}.maxTeams`, LIMITS.teamsMin, LIMITS.teamsMax);
  const rosterMax = intIn(o.rosterMax, `${p}.rosterMax`, playersOnField as number, LIMITS.rosterMaxCap);
  const rosterMin = intIn(o.rosterMin, `${p}.rosterMin`, 1, rosterMax);
  const minAge = optIntIn(o.minAge, `${p}.minAge`, 3, 99);
  const maxAge = optIntIn(o.maxAge, `${p}.maxAge`, 3, 99);
  if (minAge != null && maxAge != null && minAge > maxAge) throw bad('FIELD_RANGE', { field: `${p}.maxAge`, min: minAge, max: 99 });
  // §4.3（§3.248-b）：真名是否必填由主辦設定；預設＝有年齡限制才必填。未成年一律必填（在登錄時強制）。
  let requireRealName = minAge != null || maxAge != null;
  if (o.requireRealName != null) {
    if (typeof o.requireRealName !== 'boolean') throw bad('FIELD_TYPE', { field: `${p}.requireRealName` });
    requireRealName = o.requireRealName;
  }
  const out: DivisionInput = {
    name: requireLine(o.name, `${p}.name`, 1, LIMITS.divisionNameMax),
    playersOnField: playersOnField as number,
    maxTeams, rosterMin, rosterMax, minAge, maxAge, requireRealName,
    feePerTeam: o.feePerTeam == null ? 0 : intIn(o.feePerTeam, `${p}.feePerTeam`, 0, LIMITS.feePerTeamMax)
  };
  if (o.dvId != null) {
    if (typeof o.dvId !== 'string' || !/^dv_[A-Za-z0-9]{20}$/.test(o.dvId)) throw bad('BAD_ID', { field: `${p}.dvId` });
    out.dvId = o.dvId;
  }
  return out;
}

/** 報名費只限俱樂部主辦（顧問 §3.257，站長親口）：個人主辦的組別 feePerTeam 只能是 0，帶正數回錯（比照 FEE_NOTE_NOT_ALLOWED） */
export function assertFeeAllowed(divisions: readonly DivisionInput[], hostType: 'personal' | 'club'): void {
  if (hostType === 'club') return;
  divisions.forEach((d, i) => {
    if (d.feePerTeam > 0) throw bad('FEE_NOT_ALLOWED', { field: `divisions.${i}.feePerTeam` });
  });
}

export function divisionsOf(v: unknown): DivisionInput[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > LIMITS.divisionsMax) {
    throw bad('FIELD_RANGE', { field: 'divisions', min: 1, max: LIMITS.divisionsMax });
  }
  const list = v.map(divisionOf);
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const d of list) {
    if (names.has(d.name)) throw bad('DIVISION_NAME_DUPLICATE', { field: 'divisions' });
    names.add(d.name);
    if (d.dvId) {
      if (ids.has(d.dvId)) throw bad('BAD_ID', { field: 'divisions' });
      ids.add(d.dvId);
    }
  }
  return list;
}

export function statusReasonOf(v: unknown): string {
  return requireLine(v, 'reason', 2, LIMITS.statusReasonMax);
}

/** 只接受已知鍵：多帶任何鍵一律拒絕（避免前端以為寫進去了）。 */
export function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw bad('UNKNOWN_FIELD', { field: k });
  }
}

export function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('BAD_REQUEST');
  return v as Record<string, unknown>;
}
