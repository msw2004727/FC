/* ================================================
   SportHub — Kickball Leaderboard & Score Submission
   Leaderboard rendering, open/close, score submit
   ================================================ */
window._KickballLeaderboard = (function () {
  var H = window._KickballHelpers;

  /* ── Module State ── */
  var _lbPeriod = 'daily';
  var _lbOpen = false;
  var _lbSubmitPending = false;
  var _bestSession = null; // { distance, maxSpeed, durationMs }

  /* ── Leaderboard ── */
  function _renderLeaderboard(period) {
    var key = period in H.LEADERBOARD_PERIOD_LABELS ? period : 'daily';
    _lbPeriod = key;
    var rangeEl = document.getElementById('kg-leaderboard-range');
    var bodyEl = document.getElementById('kg-leaderboard-body');
    var playerRowEl = document.getElementById('kg-leaderboard-player-row');
    var tabs = document.querySelectorAll('#kg-leaderboard-modal .kg-lb-tab');
    if (rangeEl) rangeEl.textContent = H.LEADERBOARD_PERIOD_LABELS[key] + '\u6392\u884C\u524D ' + H.LEADERBOARD_TOP_SIZE + ' \u540D';
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-lb-period') === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!bodyEl) return;
    bodyEl.textContent = '';
    var loadingRow = document.createElement('tr');
    var loadingCell = document.createElement('td');
    loadingCell.setAttribute('colspan', '5');
    loadingCell.style.cssText = 'text-align:center;padding:1.5rem;opacity:0.6';
    loadingCell.textContent = '\u8F09\u5165\u4E2D\u2026';
    loadingRow.appendChild(loadingCell);
    bodyEl.appendChild(loadingRow);
    if (playerRowEl) { playerRowEl.classList.add('is-hidden'); playerRowEl.textContent = ''; }

    var bucket = H.getTaipeiDateBucket(key);
    firebase.firestore()
      .collection('kickGameRankings').doc(bucket)
      .collection('entries')
      .orderBy('bestDistance', 'desc').limit(50).get()
      .then(function (snap) {
        var rows = snap.docs.map(function (d) { return H.normalizeRow(d.id, d.data()); }).filter(function (r) { return !H.isAnonymousRow(r); });
        rows = H.dedupeRows(rows);
        var currentUid = H.getCurrentAuthUid();
        var localBest = _bestSession && _bestSession.distance > 0
          ? { distance: _bestSession.distance, maxSpeed: _bestSession.maxSpeed || 0, durationSec: Math.round((_bestSession.durationMs || 0) / 1000) }
          : null;
        var selfIds = new Set();
        if (currentUid) {
          selfIds.add(currentUid);
          var selfRow = rows.find(function (r) { return r.id === currentUid || r.uid === currentUid; });
          if (selfRow) {
            selfIds.add(selfRow.id);
            selfRow.nick = '\u4F60';
            if (localBest && localBest.distance > selfRow.distance) {
              selfRow.distance = localBest.distance;
              selfRow.maxSpeed = localBest.maxSpeed;
              selfRow.durationSec = localBest.durationSec;
            }
          } else if (localBest && _lbSubmitPending) {
            rows.push({ id: currentUid, uid: currentUid, nick: '\u4F60', distance: localBest.distance, maxSpeed: localBest.maxSpeed, durationSec: localBest.durationSec });
          }
        }
        rows.sort(H.compareRows);
        var ranked = rows.map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); });
        var topRows = ranked.slice(0, H.LEADERBOARD_TOP_SIZE);
        var playerRow = ranked.find(function (r) { return selfIds.has(r.id); }) || null;
        var extraPlayerRow = playerRow && playerRow.rank > H.LEADERBOARD_TOP_SIZE ? playerRow : null;
        if (topRows.length === 0) {
          bodyEl.textContent = '';
          var emptyRow = document.createElement('tr');
          var emptyCell = document.createElement('td');
          emptyCell.setAttribute('colspan', '5');
          emptyCell.style.cssText = 'text-align:center;padding:1.5rem;opacity:0.6';
          emptyCell.textContent = '\u5C1A\u7121\u6392\u884C\u8CC7\u6599';
          emptyRow.appendChild(emptyCell);
          bodyEl.appendChild(emptyRow);
          return;
        }
        _buildLeaderboardRows(bodyEl, topRows);
        if (!playerRowEl) return;
        if (extraPlayerRow) {
          _buildPlayerRow(playerRowEl, extraPlayerRow);
        } else {
          playerRowEl.classList.add('is-hidden');
          playerRowEl.textContent = '';
        }
      })
      .catch(function () {
        bodyEl.textContent = '';
        var errRow = document.createElement('tr');
        var errCell = document.createElement('td');
        errCell.setAttribute('colspan', '5');
        errCell.style.cssText = 'text-align:center;padding:1.5rem;opacity:0.6';
        errCell.textContent = '\u8B80\u53D6\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66';
        errRow.appendChild(errCell);
        bodyEl.appendChild(errRow);
      });
  }

  function _buildLeaderboardRows(bodyEl, topRows) {
    bodyEl.textContent = '';
    topRows.forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.rank <= 3) tr.className = 'kg-lb-row-top' + row.rank;
      var rankTd = document.createElement('td');
      rankTd.className = 'kg-lb-rank';
      if (row.rank <= 3) {
        var badge = document.createElement('span');
        badge.className = 'kg-lb-rank-badge';
        badge.innerHTML = H.buildRankIcon(row.rank);
        var numSpan = document.createElement('span');
        numSpan.textContent = String(row.rank);
        badge.appendChild(numSpan);
        rankTd.appendChild(badge);
      } else {
        rankTd.textContent = '#' + row.rank;
      }
      var nickTd = document.createElement('td');
      nickTd.className = 'kg-lb-nick';
      var pill = document.createElement('span');
      pill.className = 'kg-lb-name-pill';
      pill.title = row.nick;
      pill.textContent = row.nick;
      nickTd.appendChild(pill);
      var distTd = document.createElement('td');
      distTd.className = 'kg-lb-dist';
      distTd.textContent = row.distance.toFixed(2) + ' m';
      var speedTd = document.createElement('td');
      speedTd.textContent = row.maxSpeed.toFixed(1);
      var timeTd = document.createElement('td');
      timeTd.textContent = H.formatDuration(row.durationSec);
      tr.appendChild(rankTd);
      tr.appendChild(nickTd);
      tr.appendChild(distTd);
      tr.appendChild(speedTd);
      tr.appendChild(timeTd);
      bodyEl.appendChild(tr);
    });
  }

  function _buildPlayerRow(playerRowEl, r) {
    playerRowEl.classList.remove('is-hidden');
    playerRowEl.textContent = '';
    var h4 = document.createElement('h4');
    h4.textContent = '\u4F60\u7684\u540D\u6B21';
    playerRowEl.appendChild(h4);
    var tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed';
    var cg = document.createElement('colgroup');
    ['kg-lb-col-rank','kg-lb-col-nick','kg-lb-col-dist','kg-lb-col-speed','kg-lb-col-time'].forEach(function (cls) {
      var col = document.createElement('col');
      col.className = cls;
      cg.appendChild(col);
    });
    tbl.appendChild(cg);
    var tbody = document.createElement('tbody');
    var tr = document.createElement('tr');
    var rankTd = document.createElement('td');
    rankTd.className = 'kg-lb-rank';
    rankTd.textContent = '#' + r.rank;
    var nickTd = document.createElement('td');
    nickTd.className = 'kg-lb-nick';
    var pill = document.createElement('span');
    pill.className = 'kg-lb-name-pill';
    pill.title = r.nick;
    pill.textContent = r.nick;
    nickTd.appendChild(pill);
    var distTd = document.createElement('td');
    distTd.className = 'kg-lb-dist';
    distTd.textContent = r.distance.toFixed(2) + ' m';
    var speedTd = document.createElement('td');
    speedTd.textContent = r.maxSpeed.toFixed(1);
    var timeTd = document.createElement('td');
    timeTd.textContent = H.formatDuration(r.durationSec);
    tr.appendChild(rankTd);
    tr.appendChild(nickTd);
    tr.appendChild(distTd);
    tr.appendChild(speedTd);
    tr.appendChild(timeTd);
    tbody.appendChild(tr);
    tbl.appendChild(tbody);
    playerRowEl.appendChild(tbl);
  }

  function _openLeaderboard(period) {
    var modal = document.getElementById('kg-leaderboard-modal');
    if (!modal) return;
    _renderLeaderboard(period || _lbPeriod);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    _lbOpen = true;
  }
  function _closeLeaderboard() {
    var modal = document.getElementById('kg-leaderboard-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    _lbOpen = false;
  }

  /* ── Score Submission ── */
  function _submitScore(payload, gameInstance) {
    var user = typeof auth !== 'undefined' ? auth.currentUser : null;
    if (!payload || payload.distance <= 0 || !user) return;
    _lbSubmitPending = true;
    firebase.app().functions('asia-east1').httpsCallable('submitKickGameScore')({
      distance: payload.distance,
      maxSpeed: payload.maxSpeed,
      kicks: payload.kicks || 3,
      durationMs: payload.durationMs,
      displayName: H.getPreferredPlayerDisplayName(user),
    }).catch(function () {}).finally(function () {
      _lbSubmitPending = false;
      if (_lbOpen) _renderLeaderboard(_lbPeriod);
      if (gameInstance && gameInstance.refreshMarkers) gameInstance.refreshMarkers();
    });
  }

  return {
    get lbPeriod() { return _lbPeriod; },
    get lbOpen() { return _lbOpen; },
    get bestSession() { return _bestSession; },
    set bestSession(v) { _bestSession = v; },
    renderLeaderboard: _renderLeaderboard,
    openLeaderboard: _openLeaderboard,
    closeLeaderboard: _closeLeaderboard,
    submitScore: _submitScore,
  };
})();
