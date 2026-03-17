/* ================================================
   SportHub — Kickball Helpers
   Shared constants, utility functions, data helpers
   ================================================ */
window._KickballHelpers = (function () {
  var LEADERBOARD_TOP_SIZE = 10;
  var INTRO_DISMISS_KEY = 'sporthub_kick_game_intro_dismissed';
  var LEADERBOARD_PERIOD_LABELS = { daily: '每日', weekly: '每周', monthly: '每月' };
  var THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  function formatDuration(seconds) {
    var sec = Math.max(0, Number(seconds) || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function getCurrentAuthUid() {
    try { return (typeof auth !== 'undefined' && auth && auth.currentUser) ? String(auth.currentUser.uid) : ''; } catch (_) { return ''; }
  }
  function getPreferredPlayerDisplayName(user) {
    function isPlaceholder(n) { return /^玩家[\w-]{2,}$/u.test(String(n || '').trim()); }
    try {
      if (typeof LineAuth !== 'undefined' && LineAuth && typeof LineAuth.getProfile === 'function') {
        var p = LineAuth.getProfile();
        var ln = String(p && p.displayName ? p.displayName : '').trim();
        if (ln && !isPlaceholder(ln)) return ln;
      }
    } catch (_) {}
    var an = String(user && user.displayName ? user.displayName : '').trim();
    if (an && !isPlaceholder(an)) return an;
    return an || '';
  }
  function getTaipeiDateStr() {
    var t = new Date(Date.now() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
  }
  function getTaipeiDateBucket(period) {
    var t = new Date(Date.now() + 8 * 3600000);
    var year = t.getUTCFullYear(), month = String(t.getUTCMonth() + 1).padStart(2, '0'), day = String(t.getUTCDate()).padStart(2, '0');
    if (period === 'monthly') return 'monthly_' + year + '-' + month;
    if (period === 'weekly') {
      var d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
      var dow = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dow);
      var ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      var wk = String(Math.ceil(((d - ys) / 86400000 + 1) / 7)).padStart(2, '0');
      return 'weekly_' + d.getUTCFullYear() + '-W' + wk;
    }
    return 'daily_' + year + '-' + month + '-' + day;
  }
  function isIntroSuppressed() { try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch (_) { return false; } }
  function suppressIntroToday() { try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch (_) {} }

  function buildRankIcon(rank) {
    if (rank === 1) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    if (rank === 2) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    if (rank === 3) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    return '';
  }
  function normalizeRow(id, data) {
    var row = data || {};
    var rawDurSec = Number(row.bestDurationSec);
    var rawDurMs = Number(row.bestDurationMs);
    var durSec = Number.isFinite(rawDurSec) && rawDurSec > 0 ? Math.round(rawDurSec) : (Number.isFinite(rawDurMs) && rawDurMs > 0 ? Math.round(rawDurMs / 1000) : 0);
    return {
      id: String(id),
      uid: typeof row.uid === 'string' ? row.uid.trim() : '',
      nick: (typeof row.displayName === 'string' ? row.displayName.trim() : '') || ('\u73A9\u5BB6' + String(id).slice(-4)),
      distance: Number.isFinite(row.bestDistance) ? row.bestDistance : 0,
      maxSpeed: Number.isFinite(row.bestMaxSpeed) ? row.bestMaxSpeed : 0,
      durationSec: durSec,
      authProvider: typeof row.authProvider === 'string' ? row.authProvider : '',
    };
  }
  function isAnonymousRow(row) {
    if (!row) return true;
    var p = String(row.authProvider || '').toLowerCase();
    var n = String(row.nick || '').trim();
    return p === 'anonymous' || n === '匿名玩家' || n.toLowerCase() === 'anonymous';
  }
  function compareRows(a, b) {
    return b.distance - a.distance || b.maxSpeed - a.maxSpeed || a.durationSec - b.durationSec || a.nick.localeCompare(b.nick, 'zh-Hant');
  }
  function dedupeRows(rows) {
    var map = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var key = (r.uid || r.id || '').trim();
      if (!key) return;
      var prev = map.get(key);
      if (!prev || r.distance > prev.distance || (r.distance === prev.distance && r.maxSpeed > prev.maxSpeed)) map.set(key, r);
    });
    return Array.from(map.values());
  }

  return {
    LEADERBOARD_TOP_SIZE: LEADERBOARD_TOP_SIZE,
    INTRO_DISMISS_KEY: INTRO_DISMISS_KEY,
    LEADERBOARD_PERIOD_LABELS: LEADERBOARD_PERIOD_LABELS,
    THREE_CDN_URL: THREE_CDN_URL,
    formatDuration: formatDuration,
    escapeHtml: escapeHtml,
    clamp: clamp,
    getCurrentAuthUid: getCurrentAuthUid,
    getPreferredPlayerDisplayName: getPreferredPlayerDisplayName,
    getTaipeiDateStr: getTaipeiDateStr,
    getTaipeiDateBucket: getTaipeiDateBucket,
    isIntroSuppressed: isIntroSuppressed,
    suppressIntroToday: suppressIntroToday,
    buildRankIcon: buildRankIcon,
    normalizeRow: normalizeRow,
    isAnonymousRow: isAnonymousRow,
    compareRows: compareRows,
    dedupeRows: dedupeRows,
  };
})();
