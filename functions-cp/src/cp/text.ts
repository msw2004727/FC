/**
 * 文字處理：輸入清理、禁用字（§5.4）、取姓氏（§4.3）。純函式，無 I/O。
 */
import { bad } from './errors.js';

// 控制字元、零寬字元、雙向控制字元（防止藏字繞過禁用字或在畫面上反轉顯示）
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

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
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length === 0) return null;
  if ([...s].length > max) throw bad('FIELD_LENGTH', { field, min: 0, max });
  return s;
}

/**
 * 禁用字（§5.4 冒名）：協會、聯盟、官方、足協、總會、Federation、Association、Official 等。
 * 比對前 NFKC、轉小寫、去掉空白與標點，擋「官 方」「O.f.f.i.c.i.a.l」這類拆字。
 * 簡體字一併列入（NFKC 不會把簡體轉繁體）。
 */
export const BANNED_HOST_WORDS: readonly string[] = Object.freeze([
  '協會', '协会', '聯盟', '联盟', '官方', '足協', '足协', '總會', '总会',
  '聯合會', '联合会', '認證', '认证',
  'federation', 'association', 'official', 'fifa'
]);

function foldForMatch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(INVISIBLE_RE, '').replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 回傳第一個命中的禁用字；沒有命中回 null。 */
export function findBannedWord(text: string): string | null {
  const folded = foldForMatch(text);
  for (const w of BANNED_HOST_WORDS) {
    if (folded.includes(foldForMatch(w))) return w;
  }
  return null;
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
 * 未成年公開顯示名可接受的候選（球員或代表可修正姓氏判斷，但只能在這幾種之中選，
 * 防止把全名寫進公開投影）：中文第一字、前兩字（複姓）；外文只取最後一個詞。
 */
export function minorPublicNameCandidates(realName: string): string[] {
  const s = cleanLine(realName) ?? '';
  if (!s) return [];
  const out = new Set<string>();
  out.add(surnameOf(s));
  if (HAN_RE.test(s)) {
    const chars = [...s.replace(/\s+/g, '')];
    out.add(chars[0]);
    if (chars.length >= 3) out.add(chars.slice(0, 2).join(''));
  }
  // 外文名只允許最後一個詞（姓）；名字通常比姓更好辨識，不列入（Flash 交叉審 P3）
  out.delete('');
  return [...out];
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
