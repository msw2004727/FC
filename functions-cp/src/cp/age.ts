/**
 * 年齡判斷（§4.3、§4.4）：生日只用來算結果，算完丟棄，不寫進賽事庫。
 * 生日格式與主站相同（`functions/registration-guards.js` parseBirthdayParts：YYYY/MM/DD 或 YYYY-MM-DD）；
 * 年齡以台北日期計算，未過生日減 1，0～129 以外視為不合法。
 */
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

export interface DateParts { year: number; month: number; day: number }

export function parseBirthdayParts(value: unknown): DateParts | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function taipeiDateParts(date: Date): DateParts {
  const s = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

export function ageOn(birth: DateParts, ref: DateParts): number | null {
  let age = ref.year - birth.year;
  if (ref.month < birth.month || (ref.month === birth.month && ref.day < birth.day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export interface AgeRule { minAge?: number | null; maxAge?: number | null }

export interface AgeResult { age: number; isMinor: boolean; ageEligible: boolean }

/**
 * 以首場日期（台北）判斷：isMinor＝未滿 18；ageEligible＝符合組別 minAge／maxAge（含端點）。
 * 生日缺漏或不合法回 null（呼叫端回 BIRTHDAY_REQUIRED）。
 */
export function evaluateAge(birthday: unknown, firstMatchAt: Date, rule: AgeRule): AgeResult | null {
  const birth = parseBirthdayParts(birthday);
  if (!birth) return null;
  const age = ageOn(birth, taipeiDateParts(firstMatchAt));
  if (age == null) return null;
  const minOk = rule.minAge == null || age >= rule.minAge;
  const maxOk = rule.maxAge == null || age <= rule.maxAge;
  return { age, isMinor: age < 18, ageEligible: minOk && maxOk };
}
