/**
 * 賽事封面 coverOf 純函式（計畫書「賽事封面圖」做法甲；顧問 §3.536）。不需模擬器。
 */
import { describe, expect, it } from 'vitest';
import { CpError } from '../src/cp/errors.js';
import { TEAM_LOGO_MAX, coverOf } from '../src/cp/validate.js';

const B = 'demo-cp.firebasestorage.app';
const B2 = 'demo-cp-asia-east1';
const BUCKETS = [B, B2];
const KEY = 'c_abcdefghij012345';
const enc = (p: string) => encodeURIComponent(p);
const dl = (path: string, bucket = B) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${enc(path)}?alt=media&token=8f1c2d3e-0000-4000-8000-000000000001`;
const COVER = dl(`images/competitions/${KEY}/cover_1763700000000.webp`);
const THUMB = dl(`images/competitions/${KEY}/thumb_1763700000001.webp`);

function thrown(fn: () => unknown): CpError | null {
  try { fn(); return null; } catch (e) { return e as CpError; }
}
function expectErr(fn: () => unknown, reason: string, field: string) {
  const e = thrown(fn);
  expect(e).toBeInstanceOf(CpError);
  expect(e?.code).toBe('invalid-argument');
  expect(e?.reason).toBe(reason);
  expect(e?.params?.field).toBe(field);
}

describe('coverOf 合法', () => {
  it('同資料夾的封面與縮圖原樣留下', () => {
    expect(coverOf({ url: COVER, thumb: THUMB }, BUCKETS)).toEqual({ url: COVER, thumb: THUMB });
  });
  it('JPEG 退路（.jpg）也收；兩個上傳 bucket 都收', () => {
    const url = dl(`images/competitions/${KEY}/cover_1763700000000.jpg`, B2);
    const thumb = dl(`images/competitions/${KEY}/thumb_1763700000000.jpg`, B2);
    expect(coverOf({ url, thumb }, BUCKETS)).toEqual({ url, thumb });
  });
  it('去頭尾空白', () => {
    expect(coverOf({ url: `  ${COVER} `, thumb: THUMB }, BUCKETS)).toEqual({ url: COVER, thumb: THUMB });
  });
  it('null＝移除封面', () => {
    expect(coverOf(null, BUCKETS)).toBeNull();
  });
});

describe('coverOf 拒絕', () => {
  it('非本專案 bucket → COVER_URL_NOT_ALLOWED（cover.url／cover.thumb）', () => {
    expectErr(() => coverOf({ url: dl(`images/competitions/${KEY}/cover_1763700000000.webp`, 'evil-bucket'), thumb: THUMB }, BUCKETS),
      'COVER_URL_NOT_ALLOWED', 'cover.url');
    expectErr(() => coverOf({ url: COVER, thumb: dl(`images/competitions/${KEY}/thumb_1763700000000.webp`, 'evil-bucket') }, BUCKETS),
      'COVER_URL_NOT_ALLOWED', 'cover.thumb');
  });
  it('外站 https 網址 → COVER_URL_NOT_ALLOWED', () => {
    expectErr(() => coverOf({ url: 'https://cdn.example/track.webp', thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
  it('沒有設定任何 bucket（fail-closed）→ COVER_URL_NOT_ALLOWED', () => {
    expectErr(() => coverOf({ url: COVER, thumb: THUMB }, []), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
  it.each([
    ['別的資料夾（第二身份頭像）', 'images/avatars/u1/cover_1763700000000.webp'],
    ['活動封面路徑', 'images/events/ev1_cover_1763700000000.webp'],
    ['少了草稿鍵', 'images/competitions/cover_1763700000000.webp'],
    ['草稿鍵長度不對', 'images/competitions/c_abc/cover_1763700000000.webp'],
    ['草稿鍵大寫', 'images/competitions/c_ABCDEFGHIJ012345/cover_1763700000000.webp'],
    ['毫秒不是 13 碼', 'images/competitions/c_abcdefghij012345/cover_17637.webp'],
    ['副檔名 png', 'images/competitions/c_abcdefghij012345/cover_1763700000000.png'],
    ['往上跳一層', 'images/competitions/c_abcdefghij012345/../x/cover_1763700000000.webp'],
    ['多一層資料夾', 'images/competitions/c_abcdefghij012345/x/cover_1763700000000.webp'],
    ['url 放縮圖檔名', 'images/competitions/c_abcdefghij012345/thumb_1763700000000.webp']
  ])('路徑不符（%s）→ COVER_URL_NOT_ALLOWED', (_label, path) => {
    expectErr(() => coverOf({ url: dl(path), thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
  it('thumb 放封面檔名 → COVER_URL_NOT_ALLOWED（cover.thumb）', () => {
    expectErr(() => coverOf({ url: COVER, thumb: COVER }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.thumb');
  });
  it('物件路徑沒編碼（/o/ 後直接帶斜線）→ COVER_URL_NOT_ALLOWED', () => {
    const raw = `https://firebasestorage.googleapis.com/v0/b/${B}/o/images/competitions/${KEY}/cover_1763700000000.webp?alt=media`;
    expectErr(() => coverOf({ url: raw, thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
  it('物件路徑壞百分比編碼 → COVER_URL_NOT_ALLOWED，不丟 URIError', () => {
    const raw = `https://firebasestorage.googleapis.com/v0/b/${B}/o/images%2Fcompetitions%2F%E0%A4%A?alt=media`;
    expectErr(() => coverOf({ url: raw, thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
  it('封面與縮圖在不同資料夾 → COVER_URL_NOT_ALLOWED（field cover）', () => {
    const thumb = dl('images/competitions/c_zzzzzzzzzz999999/thumb_1763700000000.webp');
    expectErr(() => coverOf({ url: COVER, thumb }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover');
  });
  it('多出的鍵 → UNKNOWN_FIELD（field cover）', () => {
    expectErr(() => coverOf({ url: COVER, thumb: THUMB, alt: 'x' }, BUCKETS), 'UNKNOWN_FIELD', 'cover');
    expectErr(() => coverOf({ url: COVER, thumb: THUMB, uid: 'u1' }, BUCKETS), 'UNKNOWN_FIELD', 'cover');
  });
  it('少了 url 或 thumb → FIELD_REQUIRED', () => {
    expectErr(() => coverOf({ thumb: THUMB }, BUCKETS), 'FIELD_REQUIRED', 'cover.url');
    expectErr(() => coverOf({ url: COVER }, BUCKETS), 'FIELD_REQUIRED', 'cover.thumb');
    expectErr(() => coverOf({ url: COVER, thumb: null }, BUCKETS), 'FIELD_REQUIRED', 'cover.thumb');
  });
  it.each([
    ['字串', COVER],
    ['陣列', [COVER, THUMB]],
    ['數字', 1],
    ['布林', true],
    ['undefined', undefined]
  ])('cover 不是物件（%s）→ FIELD_TYPE（field cover）', (_label, v) => {
    expectErr(() => coverOf(v, BUCKETS), 'FIELD_TYPE', 'cover');
  });
  it('網址不是字串 → FIELD_TYPE', () => {
    expectErr(() => coverOf({ url: 1, thumb: THUMB }, BUCKETS), 'FIELD_TYPE', 'cover.url');
    expectErr(() => coverOf({ url: COVER, thumb: { a: 1 } }, BUCKETS), 'FIELD_TYPE', 'cover.thumb');
  });
  it('空字串、超過 1200 字 → FIELD_LENGTH', () => {
    expectErr(() => coverOf({ url: '  ', thumb: THUMB }, BUCKETS), 'FIELD_LENGTH', 'cover.url');
    expectErr(() => coverOf({ url: COVER + '&x=' + 'a'.repeat(TEAM_LOGO_MAX), thumb: THUMB }, BUCKETS), 'FIELD_LENGTH', 'cover.url');
  });
  it('http、含空白、帶 # → FIELD_FORMAT', () => {
    expectErr(() => coverOf({ url: COVER.replace('https:', 'http:'), thumb: THUMB }, BUCKETS), 'FIELD_FORMAT', 'cover.url');
    expectErr(() => coverOf({ url: COVER.replace('?alt', ' ?alt'), thumb: THUMB }, BUCKETS), 'FIELD_FORMAT', 'cover.url');
    expectErr(() => coverOf({ url: COVER + '#x', thumb: THUMB }, BUCKETS), 'FIELD_FORMAT', 'cover.url');
  });
  it('URL 解析後會變形（反斜線、主機大寫）→ FIELD_FORMAT', () => {
    expectErr(() => coverOf({ url: COVER.replace('/v0/b/', '/v0\\b/'), thumb: THUMB }, BUCKETS), 'FIELD_FORMAT', 'cover.url');
    expectErr(() => coverOf({ url: COVER.replace('firebasestorage.googleapis.com', 'FIREBASESTORAGE.googleapis.com'), thumb: THUMB }, BUCKETS),
      'FIELD_FORMAT', 'cover.url');
  });
  it('帶帳密或埠號的網址 → COVER_URL_NOT_ALLOWED', () => {
    expectErr(() => coverOf({ url: COVER.replace('https://', 'https://u:p@'), thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
    expectErr(() => coverOf({ url: COVER.replace('.com/', '.com:8443/'), thumb: THUMB }, BUCKETS), 'COVER_URL_NOT_ALLOWED', 'cover.url');
  });
});
