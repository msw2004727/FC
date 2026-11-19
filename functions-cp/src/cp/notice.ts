/**
 * 公告（顧問 §3.272 F4、§3.282）。
 * 放在賽事根文件的 `notices` 陣列：用戶端本來就能讀根文件，而且根文件 `allow update: if false`，不必改 Rules。
 * 手動公告最多 20 則。系統公告另計，只留最近 20 則，不占手動額度。
 * `at` 用伺服器時鐘的 Timestamp。Firestore 不允許陣列元素裡放 serverTimestamp sentinel。
 * 作者只存稽核用的雜湊（`by`），不寫 uid。
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { matchDayOf } from '../engine/index.js';
import { CpError, bad } from './errors.js';
import { FieldValue, Timestamp, newId } from './context.js';
import { clipCodePoints, findBannedWord, optionalText } from './text.js';

export const NOTICE_LIMITS = Object.freeze({
  /** 主辦手動公告上限。滿了回 NOTICE_LIMIT。 */
  hostMax: 20,
  /** 系統公告只留最近這幾則，舊的汰換。不占 hostMax。 */
  systemMax: 20,
  textMax: 300
});

export const NOTICE_ID_RE = /^nt_[A-Za-z0-9]{20}$/;

export interface Notice {
  id: string;
  text: string;
  kind: 'host' | 'system';
  /** 伺服器時鐘，不是用戶端傳入的時間 */
  at: Timestamp;
  /** sha256(cid:uid) 前 16 碼。系統公告沒有操作者時為 null。不放 uid。 */
  by: string | null;
}

/** 主辦手動公告：optionalText（可換行、上限 300）＋禁用詞。空的回 FIELD_REQUIRED。 */
export function noticeTextOf(value: unknown, bannedWords: readonly string[]): string {
  const text = optionalText(value, 'text', NOTICE_LIMITS.textMax);
  if (text == null) throw bad('FIELD_REQUIRED', { field: 'text' });
  if (findBannedWord(text, bannedWords)) throw bad('BANNED_WORD', { field: 'text' });
  return text;
}

/** 讀回根文件上的公告。形狀不對的元素略過，避免一筆壞資料擋住之後的公告。 */
export function noticesOf(raw: unknown): Notice[] {
  if (!Array.isArray(raw)) return [];
  const out: Notice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.text !== 'string') continue;
    if (o.kind !== 'host' && o.kind !== 'system') continue;
    if (!(o.at instanceof Timestamp)) continue;
    out.push({
      id: o.id,
      text: o.text,
      kind: o.kind,
      at: o.at,
      by: typeof o.by === 'string' && o.by.length > 0 ? o.by : null
    });
  }
  return out;
}

function byAge(a: Notice, b: Notice): number {
  const delta = a.at.toMillis() - b.at.toMillis();
  if (delta !== 0) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 加上一則。手動已滿 hostMax 就 NOTICE_LIMIT（不改原陣列）。
 * 系統公告永遠留下新的這一則，再依時間丢掉最舊的系統公告，直到不超過 systemMax。手動公告不動。
 */
export function pushNotice(existing: readonly Notice[], add: Notice, limits: { hostMax: number; systemMax: number } = NOTICE_LIMITS): Notice[] {
  if (add.kind === 'host') {
    const used = existing.filter(n => n.kind === 'host').length;
    if (used >= limits.hostMax) {
      throw new CpError('resource-exhausted', 'NOTICE_LIMIT', { max: limits.hostMax });
    }
    return [...existing, add];
  }
  const system = existing.filter(n => n.kind === 'system');
  const room = Math.max(0, limits.systemMax - 1);
  const keep = new Set([...system].sort(byAge).slice(Math.max(0, system.length - room)).map(n => n.id));
  const kept = existing.filter(n => n.kind !== 'system' || keep.has(n.id));
  return [...kept, add];
}

/** 依 id 刪除（手動與系統都可以）。找不到回 NOTICE_NOT_FOUND。 */
export function removeNotice(existing: readonly Notice[], id: string): { notices: Notice[]; removed: Notice } {
  const removed = existing.find(n => n.id === id);
  if (!removed) throw new CpError('not-found', 'NOTICE_NOT_FOUND');
  return { notices: existing.filter(n => n.id !== id), removed };
}

/** 系統公告與取消文案共用。超過上限時不切開組合 emoji。 */
function clipText(text: string, max: number): string {
  return clipCodePoints(text, max);
}

const TAIPEI_OFFSET_MS = 8 * 3_600_000;
/** 凌晨 00:00～04:59。05:00 起算當天，取消公告不再補時刻。 */
const EARLY_MINUTES = 5 * 60;

function taipeiClock(ms: number): { month: number; day: number; minutes: number } | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return {
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 不帶時刻的日期標籤：比賽日月／日，不補零。例：1/9。
 * 凌晨 00:00～04:59 顯示前一個比賽日。無開賽時間回 null。
 */
export function matchDayLabel(ms: number | null): string | null {
  if (ms == null || typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const ymd = matchDayOf(ms);
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 與 matchDayLabel 相同。不帶時刻的公告標籤用比賽日。 */
export function taipeiMonthDay(ms: number | null): string | null {
  return matchDayLabel(ms);
}

/**
 * 日期與時刻寫在一起：台北日曆日＋時刻，不補月日的零。例：1/10 01:30。
 * 午夜不往前挪到前一個比賽日。無開賽時間回 null。
 */
export function taipeiMonthDayTime(ms: number | null): string | null {
  if (ms == null) return null;
  const clock = taipeiClock(ms);
  if (clock == null) return null;
  const hm = `${pad2(Math.floor(clock.minutes / 60))}:${pad2(clock.minutes % 60)}`;
  return `${clock.month}/${clock.day} ${hm}`;
}

/**
 * 公告裡指稱「原本那一場」的標籤：白天場用比賽日（不帶時刻），
 * 凌晨 00:00～04:59 補上時刻並用日曆日，避免同一句裡比賽日與日曆日混用而看起來早一天。
 * 取消與改期共用（PM 收 K5-fix 時統一：原本改期的原場次仍用比賽日標籤）。
 */
export function noticeMatchLabel(ms: number | null): string | null {
  if (ms == null) return null;
  const clock = taipeiClock(ms);
  if (clock == null) return null;
  return clock.minutes < EARLY_MINUTES ? taipeiMonthDayTime(ms) : matchDayLabel(ms);
}

/**
 * 取消場次的系統公告。例：「1/9 甲隊對乙隊已取消：原因」。
 * 凌晨 00:00～04:59 補上時刻並用日曆日，例：「1/10 01:30 甲隊對乙隊已取消：原因」。
 * 超過 300 字就截斷，不讓取消失敗。
 */
export function cancelNoticeText(input: { kickoffMs: number | null; homeName: string; awayName: string; reason: string }): string {
  const when = noticeMatchLabel(input.kickoffMs);
  const head = when
    ? `${when} ${input.homeName}對${input.awayName}已取消：`
    : `${input.homeName}對${input.awayName}已取消：`;
  return clipText(head + input.reason, NOTICE_LIMITS.textMax);
}

export interface NoticeBoard {
  ref: DocumentReference;
  notices?: unknown;
  /** 伺服器時鐘 */
  at: Timestamp;
  /** 操作者雜湊。不放 uid。 */
  by: string | null;
}

/**
 * 同一筆交易附加一則系統公告。給取消場次、改期等動作呼叫。
 * 不另讀文件：呼叫端已經讀過賽事根文件。不占手動 20 則額度。
 * `patch` 與公告併成對賽事根文件的同一次 update（Firestore 同一文件不能在一筆交易裡各寫一次）。
 * 公告的 `notices`、`updatedAt` 以這裡為準，patch 不要覆寫這兩欄。
 */
export function appendSystemNotice(
  tx: Transaction,
  comp: NoticeBoard,
  input: { kind: 'system'; text: string },
  patch?: Record<string, unknown>
): { id: string } {
  if (input.kind !== 'system') throw bad('FIELD_ENUM', { field: 'kind' });
  const text = clipText(input.text, NOTICE_LIMITS.textMax).trim();
  if (!text) throw bad('FIELD_REQUIRED', { field: 'text' });
  const notice: Notice = {
    id: newId('nt'),
    text,
    kind: 'system',
    at: comp.at,
    by: typeof comp.by === 'string' && comp.by.length > 0 ? comp.by : null
  };
  const notices = pushNotice(noticesOf(comp.notices), notice);
  tx.update(comp.ref, { ...(patch ?? {}), notices, updatedAt: FieldValue.serverTimestamp() });
  return { id: notice.id };
}
