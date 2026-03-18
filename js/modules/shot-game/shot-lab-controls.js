/* ================================================
   Shot Game Lab — Data Helpers & Leaderboard Logic
   排行榜資料處理、Mock 資料生成、身分驗證工具
   ================================================ */
(function () {
  var LEADERBOARD_TOP_SIZE = 10;
  var LEADERBOARD_POOL_SIZE = 60;
  var PERIOD_CONFIG = {
    daily: { baseScore: 1980, scoreStep: 39, streakBase: 22, timeBase: 62 },
    weekly: { baseScore: 2580, scoreStep: 43, streakBase: 27, timeBase: 74 },
    monthly: { baseScore: 3220, scoreStep: 47, streakBase: 32, timeBase: 86 },
  };
  var MOCK_NAME_POOL = [
    '\u8D85\u7D1A\u5C04\u9580\u738BAlphaWolf',
    '\u4ECA\u665A\u4E00\u5B9A\u9032\u7403\u7684\u963F\u54F2\u968A\u9577',
    'ToosterX Hub\u6311\u6230\u8005_\u5C0F\u65CB\u98A8',
    'MinaTheLegendaryShooter',
    '\u5DE6\u4E0A\u6B7B\u89D2\u5C08\u6253\u9078\u624B_\u5E03\u4E01',
    '\u6668\u5B89\u4ECA\u5929\u4E5F\u8981\u8E22\u9032\u53BB',
    '\u5B88\u9580\u54E1\u770B\u5230\u5C31\u982D\u75DB',
    'KikiPowerKickUnlimited',
    '\u5B87\u5B99\u6700\u5F37\u9580\u524D\u7D42\u7D50\u8005',
    '\u5FEB\u72E0\u6E96\u5C04\u624BRex',
    'Jay\u4ECA\u5929\u72C0\u614B\u8D85\u7D1A\u597D',
    '\u9023\u9032\u50B3\u8AAA\u4FDD\u6301\u8005',
    '\u963F\u6770\u672C\u5B63\u5927\u7206\u767C',
    '\u55B5\u55B5\u55B5\u55B5\u9023\u9032\u6A21\u5F0F',
    'Kevin\u8D85\u9060\u8DDD\u96E2\u7834\u9580',
    'TomLongNameForEllipsisTest',
    '\u795E\u7D1A\u52C1\u5C04\u4E8C\u865F\u6A5F',
    'Momo_IncredibleFinisher',
    'Nina\u706B\u529B\u5168\u958B\u6E2C\u8A66\u7528\u540D\u7A31',
    '\u5C0F\u767D\u7B2C\u4E00\u8173\u5C31\u7834\u7DB2',
  ];

  function hashSeed(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function createRng(seed) {
    var s = seed >>> 0;
    return function next() {
      s += 0x6d2b79f5;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function compareLeaderboardRows(a, b) {
    return (
      b.score - a.score
      || b.streak - a.streak
      || a.durationSec - b.durationSec
      || a.nick.localeCompare(b.nick, 'zh-Hant')
    );
  }
  function isLocalSessionBetter(localRow, remoteRow) {
    if (!localRow || !remoteRow) return false;
    if (localRow.score !== remoteRow.score) return localRow.score > remoteRow.score;
    if (localRow.streak !== remoteRow.streak) return localRow.streak > remoteRow.streak;
    return localRow.durationSec < remoteRow.durationSec;
  }
  function getCurrentAuthUid() {
    try {
      if (typeof auth === 'undefined' || !auth || !auth.currentUser || !auth.currentUser.uid) return '';
      return String(auth.currentUser.uid);
    } catch (_) {
      return '';
    }
  }
  function getPreferredPlayerDisplayName(user) {
    function isPlaceholderName(name) {
      return /^玩家[\w-]{2,}$/u.test(String(name || '').trim());
    }
    try {
      if (typeof LineAuth !== 'undefined' && LineAuth && typeof LineAuth.getProfile === 'function') {
        var profile = LineAuth.getProfile();
        var lineName = String(profile && profile.displayName ? profile.displayName : '').trim();
        if (lineName && !isPlaceholderName(lineName)) return lineName;
      }
    } catch (_) {}
    var authName = String(user && user.displayName ? user.displayName : '').trim();
    if (authName && !isPlaceholderName(authName)) return authName;
    if (authName) return authName;
    return '';
  }
  function getLeaderboardIdentity(row) {
    if (!row) return '';
    var uid = typeof row.uid === 'string' ? row.uid.trim() : '';
    if (uid) return uid;
    var id = typeof row.id === 'string' ? row.id.trim() : '';
    return id;
  }
  function pickPreferredLeaderboardRow(incoming, current) {
    if (!current) return incoming;
    if (isLocalSessionBetter(incoming, current)) return incoming;
    if (isLocalSessionBetter(current, incoming)) return current;
    var incomingCanonical = incoming.uid && incoming.id === incoming.uid;
    var currentCanonical = current.uid && current.id === current.uid;
    if (incomingCanonical && !currentCanonical) return incoming;
    return current;
  }
  function dedupeLeaderboardRows(rows) {
    var rowMap = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var identity = getLeaderboardIdentity(row);
      if (!identity) return;
      var existing = rowMap.get(identity);
      rowMap.set(identity, pickPreferredLeaderboardRow(row, existing));
    });
    return Array.from(rowMap.values());
  }

  function normalizeLeaderboardRow(id, data) {
    var row = data || {};
    var rawUid = typeof row.uid === 'string' ? row.uid.trim() : '';
    var rawName = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    var rawDurationSec = Number(row.bestDurationSec);
    var rawDurationMs = Number(row.bestDurationMs);
    var durationSec = Number.isFinite(rawDurationSec) && rawDurationSec > 0
      ? Math.round(rawDurationSec)
      : (
        Number.isFinite(rawDurationMs) && rawDurationMs > 0
          ? Math.round(rawDurationMs / 1000)
          : 0
      );
    return {
      id: String(id),
      uid: rawUid,
      nick: rawName || ('\u73A9\u5BB6' + String(id).slice(-4)),
      score: Number.isFinite(row.bestScore) ? row.bestScore : 0,
      streak: Number.isFinite(row.bestStreak) ? row.bestStreak : 0,
      durationSec: durationSec,
      authProvider: typeof row.authProvider === 'string' ? row.authProvider : '',
    };
  }

  function isAnonymousLeaderboardRow(row) {
    if (!row) return true;
    var provider = String(row.authProvider || '').toLowerCase();
    var nick = String(row.nick || '').trim();
    if (provider === 'anonymous') return true;
    if (nick === '\u533F\u540D\u73A9\u5BB6' || nick.toLowerCase() === 'anonymous') return true;
    return false;
  }

  function buildMockLeaderboard(period) {
    var key = period in PERIOD_CONFIG ? period : 'daily';
    var cfg = PERIOD_CONFIG[key];
    var rng = createRng(hashSeed('shot-game-leaderboard:' + key));
    var rows = [];

    for (var i = 0; i < LEADERBOARD_POOL_SIZE; i += 1) {
      var baseName = MOCK_NAME_POOL[i % MOCK_NAME_POOL.length];
      var nickSuffix = String(1000 + Math.floor(rng() * 9000));
      var scoreDrop = i * (cfg.scoreStep + Math.floor(rng() * 8));
      var score = Math.max(100, cfg.baseScore - scoreDrop - Math.floor(rng() * 28));
      var streak = Math.max(1, cfg.streakBase - Math.floor(i * 0.7) + Math.floor(rng() * 5));
      var durationSec = cfg.timeBase + i * 4 + Math.floor(rng() * 42);
      var nick = rng() < 0.7 ? baseName + '_' + nickSuffix : baseName + nickSuffix;
      rows.push({ id: 'mock-' + key + '-' + i, nick: nick, score: score, streak: streak, durationSec: durationSec });
    }

    rows.sort(compareLeaderboardRows);
    return rows.map(function (row) {
      return { id: row.id, nick: row.nick, score: row.score, streak: row.streak, durationSec: row.durationSec };
    });
  }

  function getTaipeiDateStr() {
    var t = new Date(Date.now() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
  }
  function getTaipeiDateBucket(period) {
    var offsetMs = 8 * 60 * 60 * 1000;
    var t = new Date(Date.now() + offsetMs);
    var year = t.getUTCFullYear();
    var month = String(t.getUTCMonth() + 1).padStart(2, '0');
    var day = String(t.getUTCDate()).padStart(2, '0');
    if (period === 'monthly') return 'monthly_' + year + '-' + month;
    if (period === 'weekly') {
      var d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
      var dow = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dow);
      var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      var week = String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0');
      return 'weekly_' + d.getUTCFullYear() + '-W' + week;
    }
    return 'daily_' + year + '-' + month + '-' + day;
  }

  var INTRO_DISMISS_KEY = 'sporthub_shot_game_intro_dismissed';
  function isIntroSuppressed() {
    try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch (_) { return false; }
  }
  function suppressIntroToday() {
    try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch (_) {}
  }

  function buildLeaderboardView(leaderboardData, bestSessionSinceOpen, leaderboardSubmitPending, period) {
    var rows = dedupeLeaderboardRows((leaderboardData[period] || []).map(function (row) { return Object.assign({}, row); }));
    var currentUid = getCurrentAuthUid();
    var localBestRow = bestSessionSinceOpen && bestSessionSinceOpen.score > 0
      ? {
        score: bestSessionSinceOpen.score,
        streak: Math.max(0, Number(bestSessionSinceOpen.streak || 0)),
        durationSec: Math.max(0, Math.round(Number(bestSessionSinceOpen.durationMs || 0) / 1000)),
      }
      : null;
    var selfIds = new Set();
    if (currentUid) {
      selfIds.add(currentUid);
      var selfPersistedRow = rows.find(function (row) { return row.id === currentUid || row.uid === currentUid; });
      if (selfPersistedRow) {
        selfIds.add(selfPersistedRow.id);
        selfPersistedRow.nick = '\u4F60';
        if (localBestRow && isLocalSessionBetter(localBestRow, selfPersistedRow)) {
          selfPersistedRow.score = localBestRow.score;
          selfPersistedRow.streak = localBestRow.streak;
          selfPersistedRow.durationSec = localBestRow.durationSec;
        }
      } else if (localBestRow && leaderboardSubmitPending) {
        rows.push({
          id: currentUid, uid: currentUid, nick: '\u4F60',
          score: localBestRow.score, streak: localBestRow.streak, durationSec: localBestRow.durationSec,
        });
      }
    } else if (localBestRow) {
      selfIds.add('player-self');
      rows.push({
        id: 'player-self', nick: '\u4F60',
        score: localBestRow.score, streak: localBestRow.streak, durationSec: localBestRow.durationSec,
      });
    }
    rows.sort(compareLeaderboardRows);
    var ranked = rows.map(function (row, index) { return Object.assign({}, row, { rank: index + 1 }); });
    var topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
    var playerRow = ranked.find(function (row) { return selfIds.has(row.id); }) || null;
    var extraPlayerRow = playerRow && playerRow.rank > LEADERBOARD_TOP_SIZE ? playerRow : null;
    return { topRows: topRows, extraPlayerRow: extraPlayerRow };
  }

  async function sha256Hex(input) {
    var bytes = new TextEncoder().encode(input);
    var hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  window._ShotLabData = {
    LEADERBOARD_TOP_SIZE: LEADERBOARD_TOP_SIZE,
    LEADERBOARD_PERIOD_LABELS: { daily: '\u6BCF\u65E5', weekly: '\u6BCF\u5468', monthly: '\u6BCF\u6708' },
    compareLeaderboardRows: compareLeaderboardRows,
    isLocalSessionBetter: isLocalSessionBetter,
    getCurrentAuthUid: getCurrentAuthUid,
    getPreferredPlayerDisplayName: getPreferredPlayerDisplayName,
    dedupeLeaderboardRows: dedupeLeaderboardRows,
    normalizeLeaderboardRow: normalizeLeaderboardRow,
    isAnonymousLeaderboardRow: isAnonymousLeaderboardRow,
    buildMockLeaderboard: buildMockLeaderboard,
    buildLeaderboardView: buildLeaderboardView,
    getTaipeiDateStr: getTaipeiDateStr,
    getTaipeiDateBucket: getTaipeiDateBucket,
    isIntroSuppressed: isIntroSuppressed,
    suppressIntroToday: suppressIntroToday,
    sha256Hex: sha256Hex,
  };
})();
