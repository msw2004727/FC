/**
 * 施工卡 CP-PO-16：cleanProseLine／requireProseLine 保留全形標點；statusReasonOf 走新版；cleanLine 行為不變。
 */
import { describe, it, expect } from 'vitest';
import { cleanLine, cleanProseLine } from '../src/cp/text.js';
import { statusReasonOf } from '../src/cp/validate.js';
import { CpError } from '../src/cp/errors.js';

const reasonOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as CpError).reason; }
  return 'NO_ERROR';
};

describe('cleanProseLine：保留全形標點與符號', () => {
  it('全形標點原樣保留（，！（））', () => {
    expect(cleanProseLine('場地積水，改期！（待通知）')).toBe('場地積水，改期！（待通知）');
  });
  it('全形英數仍轉半形、全形空白壓成半形空白', () => {
    expect(cleanProseLine('ＡＢＣ　球隊')).toBe('ABC 球隊');
  });
  it('省略號（…）與波浪號（～）保留', () => {
    expect(cleanProseLine('雨天…延期～')).toBe('雨天…延期～');
  });
  it('零寬字元被移除、首尾空白去掉', () => {
    expect(cleanProseLine('\u200b')).toBe('');
    expect(cleanProseLine('  甲  ')).toBe('甲');
  });
});

describe('statusReasonOf：走 requireProseLine', () => {
  it('全形數字轉半形、全形冒號保留', () => {
    expect(statusReasonOf('請洽主辦：０９１２')).toBe('請洽主辦：0912');
  });
  it('只有全形標點 1 碼 < min 2 → FIELD_LENGTH', () => {
    expect(reasonOf(() => statusReasonOf('，'))).toBe('FIELD_LENGTH');
  });
  it('非字串 → FIELD_REQUIRED', () => {
    expect(reasonOf(() => statusReasonOf(123))).toBe('FIELD_REQUIRED');
  });
});

describe('cleanLine 行為不變（名稱等其他欄位仍走 NFKC）', () => {
  it('全形逗號仍轉半形逗號', () => {
    expect(cleanLine('，')).toBe(',');
  });
});
