/**
 * §3.264 純函式：分類白名單、categoryOf 缺值、隊徽網址正規化。不需模擬器。
 */
import { describe, expect, it } from 'vitest';
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

describe('teamLogoOf 網址正規化（對齊 tournamentCards image）', () => {
  const ok = 'https://cdn.example/a.png';

  it('合格 https 網址原樣留下，不去改路徑', () => {
    expect(teamLogoOf(ok)).toBe(ok);
    expect(teamLogoOf('https://cdn.example')).toBe('https://cdn.example');
    expect(teamLogoOf('https://cdn.example/a.png?token=ab')).toBe('https://cdn.example/a.png?token=ab');
  });

  it('去頭尾空白，並做 NFKC（全形）', () => {
    expect(teamLogoOf(`  ${ok}\n`)).toBe(ok);
    expect(teamLogoOf('ｈｔｔｐｓ：／／ｃｄｎ．ｅｘａｍｐｌｅ／ａ．ｐｎｇ')).toBe(ok);
  });

  it('長度到上限（1200，同主站 image）留、超過丟', () => {
    const head = 'https://a.com/';
    const atMax = head + 'a'.repeat(TEAM_LOGO_MAX - head.length);
    expect(atMax.length).toBe(TEAM_LOGO_MAX);
    expect(teamLogoOf(atMax)).toBe(atMax);
    expect(teamLogoOf(atMax + 'a')).toBeNull();
  });

  it.each([
    ['不是字串', 1],
    ['null', null],
    ['空字串', ''],
    ['只有空白', '   '],
    ['http', 'http://cdn.example/a.png'],
    ['只有 https://', 'https://'],
    ['中間有空白', 'https://cdn.example/a b.png'],
    ['javascript', 'javascript:alert(1)'],
    ['零寬字元', 'https://cdn.example/\u200ba.png'],
    ['非 ASCII 主機', 'https://例子.example/a.png']
  ])('不合格寫 null：%s', (_label, value) => {
    expect(teamLogoOf(value)).toBeNull();
  });
});
