/**
 * §3.264 純函式：分類白名單、categoryOf 缺值、隊徽網址正規化。不需模擬器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowedLogoBuckets } from '../src/cp/logo-hosts.js';
import { CpError } from '../src/cp/errors.js';
import { CATEGORIES, TEAM_LOGO_MAX, categoryInput, categoryOf, teamLogoOf } from '../src/cp/validate.js';

function thrown(fn: () => unknown): CpError | null {
  try { fn(); return null; } catch (e) { return e as CpError; }
}

describe('category 白名單（§3.264）', () => {
  it('league、cup、friendly 通過', () => {
    expect(CATEGORIES).toEqual(['league', 'cup', 'friendly']);
    for (const c of CATEGORIES) expect(categoryInput(c)).toBe(c);
  });

  it.each([
    ['open', 'open'],
    ['League', 'League'],
    ['空字串', ''],
    ['前後空白', ' league'],
    ['數字', 1],
    ['null', null],
    ['布林', true]
  ])('非法值（%s）回 INVALID_FIELD，field 是 category', (_label, value) => {
    const e = thrown(() => categoryInput(value));
    expect(e).toBeInstanceOf(CpError);
    expect(e?.code).toBe('invalid-argument');
    expect(e?.reason).toBe('INVALID_FIELD');
    expect(e?.params).toEqual({ field: 'category' });
  });
});

describe('categoryOf 缺值視為 league', () => {
  it.each([
    ['未傳文件', undefined],
    ['null', null],
    ['空物件', {}],
    ['category null', { category: null }],
    ['空字串', { category: '' }],
    ['不在白名單', { category: 'open' }],
    ['型別不對', { category: 1 }]
  ])('%s → league', (_label, doc) => {
    expect(categoryOf(doc as { category?: unknown } | null | undefined)).toBe('league');
  });

  it('白名單原樣讀回', () => {
    expect(categoryOf({ category: 'league' })).toBe('league');
    expect(categoryOf({ category: 'cup' })).toBe('cup');
    expect(categoryOf({ category: 'friendly' })).toBe('friendly');
  });
});

describe('teamLogoOf 網址正規化＋本專案 Storage 白名單（顧問 §3.278 P2）', () => {
  const B = 'demo-cp.firebasestorage.app';
  const base = `https://firebasestorage.googleapis.com/v0/b/${B}/o/`;
  const ok = `${base}teams%2Fclub_a%2Flogo.png?alt=media&token=ab`;
  const prev = process.env.CP_LOGO_BUCKETS;
  beforeEach(() => { process.env.CP_LOGO_BUCKETS = B; });
  afterEach(() => { if (prev === undefined) delete process.env.CP_LOGO_BUCKETS; else process.env.CP_LOGO_BUCKETS = prev; });

  it('本專案 Storage 下載網址原樣留下，不去改路徑', () => {
    expect(teamLogoOf(ok)).toBe(ok);
    expect(teamLogoOf(`${base}a.png`)).toBe(`${base}a.png`);
  });

  it('去頭尾空白，並做 NFKC', () => {
    expect(teamLogoOf(`  ${ok}
`)).toBe(ok);
  });

  it('長度到上限（1200，同主站 image）留、超過丟', () => {
    const atMax = base + 'a'.repeat(TEAM_LOGO_MAX - base.length);
    expect(atMax.length).toBe(TEAM_LOGO_MAX);
    expect(teamLogoOf(atMax)).toBe(atMax);
    expect(teamLogoOf(atMax + 'a')).toBeNull();
  });

  it('沒有設定任何 bucket 時一律不收（fail-closed）', () => {
    delete process.env.CP_LOGO_BUCKETS;
    const fc = process.env.FIREBASE_CONFIG;
    delete process.env.FIREBASE_CONFIG;
    try {
      expect(teamLogoOf(ok)).toBeNull();
    } finally {
      if (fc !== undefined) process.env.FIREBASE_CONFIG = fc;
    }
  });

  it('bucket 也可從 FIREBASE_CONFIG.storageBucket 讀', () => {
    expect(allowedLogoBuckets({ FIREBASE_CONFIG: JSON.stringify({ storageBucket: B }) } as NodeJS.ProcessEnv)).toEqual([B]);
    expect(allowedLogoBuckets({ FIREBASE_CONFIG: '{壞掉' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it.each([
    ['不是字串', 1],
    ['null', null],
    ['空字串', ''],
    ['只有空白', '   '],
    ['外部任意 https（追蹤圖）', 'https://cdn.example/a.png'],
    ['http', `http://firebasestorage.googleapis.com/v0/b/${B}/o/a.png`],
    ['別的 bucket', 'https://firebasestorage.googleapis.com/v0/b/other-proj.appspot.com/o/a.png'],
    ['假冒主機（子網域）', `https://firebasestorage.googleapis.com.evil.example/v0/b/${B}/o/a.png`],
    ['帶帳密', `https://x@firebasestorage.googleapis.com/v0/b/${B}/o/a.png`],
    ['帶連接埠', `https://firebasestorage.googleapis.com:8443/v0/b/${B}/o/a.png`],
    ['路徑不是下載格式', `https://firebasestorage.googleapis.com/${B}/a.png`],
    ['沒有物件路徑', `https://firebasestorage.googleapis.com/v0/b/${B}/o/`],
    ['只有 https://', 'https://'],
    ['中間有空白', `${base}a b.png`],
    ['javascript', 'javascript:alert(1)'],
    ['零寬字元', `${base}​a.png`],
    ['bucket 壞的百分比編碼（顧問 §3.291）', 'https://firebasestorage.googleapis.com/v0/b/%E0%A4%A/o/x']
  ])('不合格寫 null：%s', (_label, value) => {
    expect(teamLogoOf(value)).toBeNull();
  });
});
