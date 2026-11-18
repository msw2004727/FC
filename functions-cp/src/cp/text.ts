/**
 * 文字處理：輸入清理、禁用字（§5.4）、取姓氏（§4.3）。純函式，無 I/O。
 */
import { bad } from './errors.js';

// 控制字元、零寬字元、雙向控制字元（防止藏字繞過禁用字或在畫面上反轉顯示）
// 另含分類為字母但畫面看不見的填充字（U+115F、U+1160、U+3164、U+FFA0、U+2800），Opus 終審 P3
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u115f\u1160\u3164\uffa0\u2800]/g;

/** 清理單行文字：NFKC、去不可見字元、壓空白、去頭尾。非字串回 null。 */
export function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.normalize('NFKC').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}

/** 必填單行文字；長度以 Unicode code point 計。 */
export function requireLine(value: unknown, field: string, min: number, max: number): string {
  const s = cleanLine(value);
  if (s == null || s.length === 0) throw bad('FIELD_REQUIRED', { field });
  const len = [...s].length;
  if (len < min || len > max) throw bad('FIELD_LENGTH', { field, min, max });
  return s;
}

/** 選填單行文字：未提供或空字串回 null。 */
export function optionalLine(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  const s = cleanLine(value);
  if (s == null) throw bad('FIELD_TYPE', { field });
  if (s.length === 0) return null;
  if ([...s].length > max) throw bad('FIELD_LENGTH', { field, min: 0, max });
  return s;
}

/** 多行說明文字（繳費說明等）：保留換行，其餘同 cleanLine。 */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw bad('FIELD_TYPE', { field });
  const s = value.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u115f\u1160\u3164\uffa0\u2800]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length === 0) return null;
  if ([...s].length > max) throw bad('FIELD_LENGTH', { field, min: 0, max });
  return s;
}

/**
 * 禁用字（§5.4 冒名）：站長 11-18 定案「功能要有、預設清單為空」，清單由管理員設定在 cpConfig/launch.bannedWords
 * （與內部期閘門同一次讀取帶出，不多讀）。下列只是給管理員參考的建議清單，**預設不套用**。
 * 比對前 NFKC、轉小寫、去掉空白與標點，擋「官 方」「O.f.f.i.c.i.a.l」這類拆字。
 */
export const SUGGESTED_BANNED_WORDS: readonly string[] = Object.freeze([
  '協會', '协会', '聯盟', '联盟', '官方', '足協', '足协', '總會', '总会',
  '聯合會', '联合会', '認證', '认证',
  'federation', 'association', 'official', 'fifa'
]);

function foldForMatch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(INVISIBLE_RE, '').replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 回傳第一個命中的禁用字；清單為空或沒有命中回 null。 */
export function findBannedWord(text: string, words: readonly string[]): string | null {
  if (words.length === 0) return null;
  const folded = foldForMatch(text);
  for (const w of words) {
    const fw = foldForMatch(w);
    if (fw && folded.includes(fw)) return w;
  }
  return null;
}

/** 設定文件的禁用詞清單：只收字串、去空白、每個 ≤ 20 字、最多 200 個；格式不對一律視為空清單（不擋）。 */
export function bannedWordsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = cleanLine(x);
    if (s && [...s].length <= 20 && !out.includes(s)) out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * 複姓表（§4.3）：命中取兩字。含台灣常見雙姓（張簡、范姜、周黃、張廖等）。
 * 伺服器常數；前端預覽用同一份（第 2 步畫面施工時由同步腳本帶過去）。
 */
export const COMPOUND_SURNAMES: readonly string[] = Object.freeze([
  '歐陽', '司馬', '諸葛', '上官', '東方', '皇甫', '張簡', '范姜', '周黃', '張廖',
  '夏侯', '尉遲', '公孫', '令狐', '慕容', '長孫', '宇文', '司徒', '端木', '澹臺',
  '西門', '南宮', '呼延', '軒轅', '東郭', '鍾離', '赫連', '濮陽', '太史', '申屠',
  '陳黃', '江謝', '張李', '劉張', '黃林'
]);

const HAN_RE = /^\p{Script=Han}/u;

/** 取姓氏：中文名取第一字（複姓取兩字）；外文名取最後一個詞。空字串回空字串。 */
export function surnameOf(realName: string): string {
  const s = cleanLine(realName) ?? '';
  if (!s) return '';
  if (HAN_RE.test(s)) {
    const chars = [...s.replace(/\s+/g, '')];
    const two = chars.slice(0, 2).join('');
    if (chars.length >= 3 && COMPOUND_SURNAMES.includes(two)) return two;
    return chars[0];
  }
  const words = s.split(' ').filter(Boolean);
  return words[words.length - 1] ?? '';
}

/**
 * 公開顯示名遮字（站長 11-18：未成年與代填成年沒填暱稱時，一律遮住姓氏後的第一個字，不讓使用者自選）：
 * - 含漢字：從第一個漢字起算；姓氏照 surnameOf（複姓表命中且至少 3 字才取兩字）；
 *   王小明→王O明、歐陽娜娜→歐陽O娜、王明→王O、林→林O、Amy王小美→王O美。
 * - 外文多個詞：名字只留首字母＋姓（John Smith→J. Smith、Mary Ann Lee→M. Lee）。
 * - 外文單一個詞：首字母＋.（ChenXiaoming→C.）。
 * 遮字用半形大寫 O。結果一定不等於完整真名。
 */
export const MASK_CHAR = 'O';
export function maskedPublicName(realName: string): string {
  const s = cleanLine(realName) ?? '';
  if (!s) return '';
  const chars = [...s.replace(/\s+/g, '')];
  const hanAt = chars.findIndex(ch => HAN_RE.test(ch));
  if (hanAt >= 0) {
    const han = chars.slice(hanAt).join('');
    const sur = surnameOf(han);
    const given = [...han].slice([...sur].length);
    return sur + MASK_CHAR + given.slice(1).join('');
  }
  const words = s.split(' ').filter(Boolean);
  if (words.length >= 2) return `${[...words[0]][0].toUpperCase()}. ${words[words.length - 1]}`;
  return [...s][0].toUpperCase() + '.';
}

/** 直播連結（§8.3）：https＋白名單網域。 */
export const LIVE_LINK_HOSTS: readonly string[] = Object.freeze([
  'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'twitch.tv', 'instagram.com'
]);

export function isAllowedLiveLink(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return LIVE_LINK_HOSTS.some(h => host === h || host.endsWith('.' + h));
}
