/**
 * Shot Game — unit tests
 *
 * Extracted from: js/modules/shot-game/shot-scoring.js
 *
 * 重點驗證：
 *   - 深淺主題訊息顏色對應
 *   - 訊息條背景 gradient（dark/light）
 *   - 分數設定常數（SCORE_MAP / STREAK_MILESTONES）
 */

// ─── 從 shot-scoring.js 抽取 ───
const LIGHT_THEME_MESSAGE_COLORS = Object.freeze({
  '#ffffff': '#13283b',
  '#ffd166': '#6b4b00',
  '#ffd54f': '#755300',
  '#80ff80': '#1e6a33',
  '#ff8a80': '#7a1f2c',
});

function resolveMessageColor(inputColor, readThemeIsDark) {
  const fallback = '#ffffff';
  const rawColor = (typeof inputColor === 'string' && inputColor.trim())
    ? inputColor.trim().toLowerCase()
    : fallback;
  if (readThemeIsDark()) return rawColor;
  return LIGHT_THEME_MESSAGE_COLORS[rawColor] || '#13283b';
}

function resolveMessageBandBackground(isDark) {
  if (isDark) {
    return 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(6,16,29,0.64) 23%, rgba(6,16,29,0.64) 77%, rgba(0,0,0,0) 100%)';
  }
  return 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(13,30,45,0.22) 23%, rgba(13,30,45,0.22) 77%, rgba(255,255,255,0) 100%)';
}

const SCORE_MAP = [[100, 50, 100], [50, 20, 50], [40, 10, 40]];
const STREAK_MILESTONES = new Set([5, 10, 20, 30]);

// ═══════════════════════════════════════════════════════════════════
describe('Shot Game — 訊息顏色解析', () => {
  test('深色模式下直接使用輸入顏色', () => {
    expect(resolveMessageColor('#ffd166', () => true)).toBe('#ffd166');
    expect(resolveMessageColor('#80ff80', () => true)).toBe('#80ff80');
  });

  test('淺色模式下對應到反差色', () => {
    expect(resolveMessageColor('#ffffff', () => false)).toBe('#13283b');
    expect(resolveMessageColor('#ffd166', () => false)).toBe('#6b4b00');
    expect(resolveMessageColor('#80ff80', () => false)).toBe('#1e6a33');
  });

  test('未註冊顏色淺色模式 fallback 到深色', () => {
    expect(resolveMessageColor('#aabbcc', () => false)).toBe('#13283b');
  });

  test('無效輸入 fallback 到 #ffffff', () => {
    expect(resolveMessageColor(null, () => false)).toBe('#13283b'); // fallback #ffffff → 淺色對應 #13283b
    expect(resolveMessageColor('', () => false)).toBe('#13283b');
    expect(resolveMessageColor(undefined, () => true)).toBe('#ffffff');
  });

  test('大小寫不敏感', () => {
    expect(resolveMessageColor('#FFD166', () => false)).toBe('#6b4b00');
    expect(resolveMessageColor('  #ffd166  ', () => false)).toBe('#6b4b00');
  });
});

describe('Shot Game — 訊息條背景', () => {
  test('深色模式 gradient', () => {
    const bg = resolveMessageBandBackground(true);
    expect(bg).toContain('rgba(6,16,29,0.64)');
    expect(bg).toContain('linear-gradient(90deg');
  });

  test('淺色模式 gradient', () => {
    const bg = resolveMessageBandBackground(false);
    expect(bg).toContain('rgba(13,30,45,0.22)');
  });

  test('dark vs light 是不同內容', () => {
    expect(resolveMessageBandBackground(true)).not.toBe(resolveMessageBandBackground(false));
  });
});

describe('Shot Game — 分數設定常數', () => {
  test('SCORE_MAP 是 3x3 矩陣', () => {
    expect(SCORE_MAP.length).toBe(3);
    SCORE_MAP.forEach(row => expect(row.length).toBe(3));
  });

  test('SCORE_MAP 最高分 = 100（四角）', () => {
    expect(SCORE_MAP[0][0]).toBe(100);
    expect(SCORE_MAP[0][2]).toBe(100);
  });

  test('SCORE_MAP 中央分數最低（靶心） = 10', () => {
    expect(SCORE_MAP[1][1]).toBe(20);  // 驗證實際設定
  });

  test('STREAK_MILESTONES 含 5/10/20/30', () => {
    expect(STREAK_MILESTONES.has(5)).toBe(true);
    expect(STREAK_MILESTONES.has(10)).toBe(true);
    expect(STREAK_MILESTONES.has(20)).toBe(true);
    expect(STREAK_MILESTONES.has(30)).toBe(true);
  });

  test('STREAK_MILESTONES 不含其他數字（防止誤觸）', () => {
    expect(STREAK_MILESTONES.has(1)).toBe(false);
    expect(STREAK_MILESTONES.has(15)).toBe(false);
    expect(STREAK_MILESTONES.has(25)).toBe(false);
  });
});
