/* ================================================
   SportHub — Shot Game Page UI & Leaderboard
   排行榜渲染、Session Badge、Intro/Modal 控制
   ================================================ */
(function () {
  var LEADERBOARD_TOP_SIZE = 10;
  var LEADERBOARD_PERIOD_LABELS = { daily: '\u6BCF\u65E5', weekly: '\u6BCF\u5468', monthly: '\u6BCF\u6708' };

  function formatDuration(seconds) {
    var sec = Math.max(0, Number(seconds) || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compareRows(a, b) {
    return b.score - a.score || b.streak - a.streak || a.durationSec - b.durationSec || a.nick.localeCompare(b.nick, 'zh-Hant');
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
    } catch (_) { return ''; }
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
    return typeof row.id === 'string' ? row.id.trim() : '';
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
      : (Number.isFinite(rawDurationMs) && rawDurationMs > 0 ? Math.round(rawDurationMs / 1000) : 0);
    return {
      id: String(id), uid: rawUid,
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
  function buildRankIcon(rank) {
    if (rank === 1) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    if (rank === 2) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    if (rank === 3) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    return '';
  }

  var INTRO_DISMISS_KEY = 'sporthub_shot_game_intro_dismissed';
  function getTaipeiDateStr() {
    var t = new Date(Date.now() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
  }
  function isIntroSuppressed() {
    try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch (_) { return false; }
  }
  function suppressIntroToday() {
    try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch (_) {}
  }
  function getTaipeiDateBucket(period) {
    var t = new Date(Date.now() + 8 * 3600 * 1000);
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

  function appendStatusRow(bodyEl, text) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.setAttribute('colspan', '5');
    td.style.cssText = 'text-align:center;padding:1.5rem;opacity:0.6';
    td.textContent = text;
    tr.appendChild(td);
    bodyEl.appendChild(tr);
  }

  function appendLeaderboardRow(bodyEl, row) {
    var tr = document.createElement('tr');
    if (row.rank <= 3) tr.className = 'sg-lb-row-top' + row.rank;
    var tdRank = document.createElement('td');
    tdRank.className = 'sg-lb-rank';
    if (row.rank <= 3) {
      var badge = document.createElement('span');
      badge.className = 'sg-lb-rank-badge';
      // Trusted static SVG rank icons — no user input
      badge.innerHTML = buildRankIcon(row.rank) + '<span>' + row.rank + '</span>';
      tdRank.appendChild(badge);
    } else {
      tdRank.textContent = '#' + row.rank;
    }
    var tdNick = document.createElement('td');
    tdNick.className = 'sg-lb-nick';
    var pill = document.createElement('span');
    pill.className = 'sg-lb-name-pill';
    pill.title = row.nick;
    pill.textContent = row.nick;
    tdNick.appendChild(pill);
    var tdScore = document.createElement('td');
    tdScore.className = 'sg-lb-score';
    tdScore.textContent = row.score;
    var tdStreak = document.createElement('td');
    tdStreak.textContent = row.streak;
    var tdTime = document.createElement('td');
    tdTime.textContent = formatDuration(row.durationSec);
    tr.appendChild(tdRank); tr.appendChild(tdNick); tr.appendChild(tdScore);
    tr.appendChild(tdStreak); tr.appendChild(tdTime);
    bodyEl.appendChild(tr);
  }

  function renderExtraPlayerRow(el, row) {
    el.classList.remove('is-hidden');
    el.textContent = '';
    var h4 = document.createElement('h4');
    h4.textContent = '\u4F60\u7684\u540D\u6B21';
    el.appendChild(h4);
    var tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed';
    var cg = document.createElement('colgroup');
    ['sg-lb-col-rank','sg-lb-col-nick','sg-lb-col-score','sg-lb-col-streak','sg-lb-col-time'].forEach(function (c) {
      var col = document.createElement('col'); col.className = c; cg.appendChild(col);
    });
    tbl.appendChild(cg);
    var tb = document.createElement('tbody');
    appendLeaderboardRow(tb, row);
    tbl.appendChild(tb);
    el.appendChild(tbl);
  }

  function buildSessionBadgeDOM(badge) {
    var mk = function (tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    badge.appendChild(mk('div', 'sg-session-top-title', '\u672C\u5C40\u8A18\u9304'));
    var fr = mk('div', 'sg-session-focus-row');
    var sb = mk('div', 'sg-session-focus-box sg-session-focus-box-score');
    sb.appendChild(mk('div', 'sg-session-focus-label', '\u5206\u6578'));
    sb.appendChild(mk('div', 'sg-session-focus-value sg-session-focus-score', '0'));
    var kb = mk('div', 'sg-session-focus-box sg-session-focus-box-streak');
    kb.appendChild(mk('div', 'sg-session-focus-label', '\u9023\u9032'));
    kb.appendChild(mk('div', 'sg-session-focus-value sg-session-focus-streak', '0'));
    fr.appendChild(sb); fr.appendChild(kb);
    badge.appendChild(fr);
    badge.appendChild(mk('div', 'sg-session-title', '\u7576\u524D\u6700\u4F73\u8A18\u9304'));
    var bd = mk('div', 'sg-session-best');
    bd.appendChild(mk('span', 'sg-session-best-score', '--'));
    bd.appendChild(document.createTextNode('\u5206'));
    bd.appendChild(mk('span', 'sg-session-sep', '|'));
    bd.appendChild(mk('span', 'sg-session-best-shots', '--'));
    bd.appendChild(document.createTextNode('\u5C04\u9580'));
    bd.appendChild(mk('span', 'sg-session-sep', '|'));
    bd.appendChild(mk('span', 'sg-session-best-time', '--'));
    bd.appendChild(document.createTextNode('\u79D2'));
    badge.appendChild(bd);
  }

  // Expose shared functions for shot-game-page.js
  window._ShotPageUI = {
    LEADERBOARD_TOP_SIZE: LEADERBOARD_TOP_SIZE,
    LEADERBOARD_PERIOD_LABELS: LEADERBOARD_PERIOD_LABELS,
    formatDuration: formatDuration,
    escapeHtml: escapeHtml,
    compareRows: compareRows,
    isLocalSessionBetter: isLocalSessionBetter,
    getCurrentAuthUid: getCurrentAuthUid,
    getPreferredPlayerDisplayName: getPreferredPlayerDisplayName,
    dedupeLeaderboardRows: dedupeLeaderboardRows,
    normalizeLeaderboardRow: normalizeLeaderboardRow,
    isAnonymousLeaderboardRow: isAnonymousLeaderboardRow,
    buildRankIcon: buildRankIcon,
    isIntroSuppressed: isIntroSuppressed,
    suppressIntroToday: suppressIntroToday,
    getTaipeiDateBucket: getTaipeiDateBucket,
    appendStatusRow: appendStatusRow,
    appendLeaderboardRow: appendLeaderboardRow,
    renderExtraPlayerRow: renderExtraPlayerRow,
    buildSessionBadgeDOM: buildSessionBadgeDOM,
    buildLeaderboardView: function (rows, bestSession, lbSubmitPending) {
      var currentUid = getCurrentAuthUid();
      var localBestRow = bestSession && bestSession.score > 0
        ? { score: bestSession.score, streak: bestSession.streak || 0, durationSec: Math.round((bestSession.durationMs || 0) / 1000) }
        : null;
      var selfIds = new Set();
      if (currentUid) {
        selfIds.add(currentUid);
        var selfRow = rows.find(function (r) { return r.id === currentUid || r.uid === currentUid; });
        if (selfRow) {
          selfIds.add(selfRow.id);
          selfRow.nick = '\u4F60';
          if (localBestRow && isLocalSessionBetter(localBestRow, selfRow)) {
            selfRow.score = localBestRow.score;
            selfRow.streak = localBestRow.streak;
            selfRow.durationSec = localBestRow.durationSec;
          }
        } else if (localBestRow && lbSubmitPending) {
          rows.push({ id: currentUid, uid: currentUid, nick: '\u4F60', score: localBestRow.score, streak: localBestRow.streak, durationSec: localBestRow.durationSec });
        }
      } else if (localBestRow) {
        selfIds.add('player-self');
        rows.push({ id: 'player-self', nick: '\u4F60', score: localBestRow.score, streak: localBestRow.streak, durationSec: localBestRow.durationSec });
      }
      rows.sort(compareRows);
      var ranked = rows.map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); });
      var topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
      var playerRow = ranked.find(function (r) { return selfIds.has(r.id); }) || null;
      var extraPlayerRow = playerRow && playerRow.rank > LEADERBOARD_TOP_SIZE ? playerRow : null;
      return { topRows: topRows, extraPlayerRow: extraPlayerRow };
    },
  };
})();
