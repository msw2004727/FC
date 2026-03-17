/**
 * shot-scoring.js — Score map, streak milestones, message theming helpers
 * Part of ShotGameEngine split. Loaded BEFORE shot-game-engine.js.
 */
(function () {
  var SGI = window._ShotGameInternal = window._ShotGameInternal || {};

  // ── Score / streak constants ──
  SGI.SCORE_MAP = [[100, 50, 100], [50, 20, 50], [40, 10, 40]];
  SGI.STREAK_MILESTONES = new Set([5, 10, 20, 30]);

  // ── Light-theme message color overrides ──
  SGI.LIGHT_THEME_MESSAGE_COLORS = Object.freeze({
    '#ffffff': '#13283b',
    '#ffd166': '#6b4b00',
    '#ffd54f': '#755300',
    '#80ff80': '#1e6a33',
    '#ff8a80': '#7a1f2c',
  });

  /**
   * Resolve the display color for in-game messages depending on dark/light theme.
   * @param {string} inputColor - raw hex color
   * @param {function} readThemeIsDark - function returning current theme boolean
   * @returns {string} resolved color hex
   */
  SGI.resolveMessageColor = function (inputColor, readThemeIsDark) {
    var fallback = '#ffffff';
    var rawColor = (typeof inputColor === 'string' && inputColor.trim())
      ? inputColor.trim().toLowerCase()
      : fallback;
    if (readThemeIsDark()) return rawColor;
    return SGI.LIGHT_THEME_MESSAGE_COLORS[rawColor] || '#13283b';
  };

  /**
   * Resolve the CSS background gradient for the message band.
   * @param {boolean} isDark
   * @returns {string} CSS gradient string
   */
  SGI.resolveMessageBandBackground = function (isDark) {
    if (isDark) {
      return 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(6,16,29,0.64) 23%, rgba(6,16,29,0.64) 77%, rgba(0,0,0,0) 100%)';
    }
    return 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(13,30,45,0.22) 23%, rgba(13,30,45,0.22) 77%, rgba(255,255,255,0) 100%)';
  };
})();
