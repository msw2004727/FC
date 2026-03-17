/* ================================================
   Shot Game Lab — UI Rendering & Display
   排行榜渲染、排名圖示、HTML 逸出、格式化
   ================================================ */
(function () {
  function formatDuration(seconds) {
    var sec = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(sec / 60);
    var remain = sec % 60;
    return String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildRankIcon(rank) {
    if (rank === 1) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    }
    if (rank === 2) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    }
    if (rank === 3) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    }
    return '';
  }

  // Session badge template — uses Unicode escapes for Chinese text to avoid encoding issues
  function ensureSessionBadgeTemplate(sessionBadge) {
    if (!sessionBadge || sessionBadge.querySelector('.sg-session-title')) return;
    var el = document.createElement('div');
    // Build template via DOM to avoid innerHTML with raw strings
    sessionBadge.textContent = '';

    var topTitle = document.createElement('div');
    topTitle.className = 'sg-session-top-title';
    topTitle.textContent = '\u672C\u5C40\u8A18\u9304';
    sessionBadge.appendChild(topTitle);

    var focusRow = document.createElement('div');
    focusRow.className = 'sg-session-focus-row';

    var scoreBox = document.createElement('div');
    scoreBox.className = 'sg-session-focus-box sg-session-focus-box-score';
    var scoreLabel = document.createElement('div');
    scoreLabel.className = 'sg-session-focus-label';
    scoreLabel.textContent = '\u5206\u6578';
    var scoreValue = document.createElement('div');
    scoreValue.className = 'sg-session-focus-value sg-session-focus-score';
    scoreValue.textContent = '0';
    scoreBox.appendChild(scoreLabel);
    scoreBox.appendChild(scoreValue);

    var streakBox = document.createElement('div');
    streakBox.className = 'sg-session-focus-box sg-session-focus-box-streak';
    var streakLabel = document.createElement('div');
    streakLabel.className = 'sg-session-focus-label';
    streakLabel.textContent = '\u9023\u9032';
    var streakValue = document.createElement('div');
    streakValue.className = 'sg-session-focus-value sg-session-focus-streak';
    streakValue.textContent = '0';
    streakBox.appendChild(streakLabel);
    streakBox.appendChild(streakValue);

    focusRow.appendChild(scoreBox);
    focusRow.appendChild(streakBox);
    sessionBadge.appendChild(focusRow);

    var bestTitle = document.createElement('div');
    bestTitle.className = 'sg-session-title';
    bestTitle.textContent = '\u7576\u524D\u6700\u4F73\u8A18\u9304';
    sessionBadge.appendChild(bestTitle);

    var bestDiv = document.createElement('div');
    bestDiv.className = 'sg-session-best';
    var bScore = document.createElement('span');
    bScore.className = 'sg-session-best-score';
    bScore.textContent = '--';
    bestDiv.appendChild(bScore);
    bestDiv.appendChild(document.createTextNode('\u5206'));
    var sep1 = document.createElement('span');
    sep1.className = 'sg-session-sep';
    sep1.textContent = '|';
    bestDiv.appendChild(sep1);
    var bShots = document.createElement('span');
    bShots.className = 'sg-session-best-shots';
    bShots.textContent = '--';
    bestDiv.appendChild(bShots);
    bestDiv.appendChild(document.createTextNode('\u5C04\u9580'));
    var sep2 = document.createElement('span');
    sep2.className = 'sg-session-sep';
    sep2.textContent = '|';
    bestDiv.appendChild(sep2);
    var bTime = document.createElement('span');
    bTime.className = 'sg-session-best-time';
    bTime.textContent = '--';
    bestDiv.appendChild(bTime);
    bestDiv.appendChild(document.createTextNode('\u79D2'));
    sessionBadge.appendChild(bestDiv);
  }

  function renderLeaderboardRows(bodyEl, topRows) {
    // Build rows via DOM to avoid raw innerHTML
    bodyEl.textContent = '';
    topRows.forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.rank <= 3) tr.className = 'lb-row-top' + row.rank;

      var tdRank = document.createElement('td');
      tdRank.className = 'lb-rank';
      if (row.rank <= 3) {
        var badge = document.createElement('span');
        badge.className = 'lb-rank-badge';
        // SVG icons are static trusted content
        badge.innerHTML = buildRankIcon(row.rank) + '<span>' + row.rank + '</span>';
        tdRank.appendChild(badge);
      } else {
        tdRank.textContent = '#' + row.rank;
      }

      var tdNick = document.createElement('td');
      tdNick.className = 'lb-nick';
      var pill = document.createElement('span');
      pill.className = 'lb-name-pill';
      pill.title = row.nick;
      pill.textContent = row.nick;
      tdNick.appendChild(pill);

      var tdScore = document.createElement('td');
      tdScore.className = 'lb-score';
      tdScore.textContent = row.score;

      var tdStreak = document.createElement('td');
      tdStreak.textContent = row.streak;

      var tdTime = document.createElement('td');
      tdTime.textContent = formatDuration(row.durationSec);

      tr.appendChild(tdRank);
      tr.appendChild(tdNick);
      tr.appendChild(tdScore);
      tr.appendChild(tdStreak);
      tr.appendChild(tdTime);
      bodyEl.appendChild(tr);
    });
  }

  function renderPlayerRow(playerRowEl, extraPlayerRow) {
    if (!playerRowEl) return;
    if (extraPlayerRow) {
      var row = extraPlayerRow;
      playerRowEl.classList.remove('is-hidden');
      playerRowEl.textContent = '';

      var h4 = document.createElement('h4');
      h4.textContent = '\u4F60\u7684\u540D\u6B21';
      playerRowEl.appendChild(h4);

      var table = document.createElement('table');
      table.setAttribute('aria-label', '\u73A9\u5BB6\u540D\u6B21');

      var colgroup = document.createElement('colgroup');
      ['lb-col-rank', 'lb-col-nick', 'lb-col-score', 'lb-col-streak', 'lb-col-time'].forEach(function (cls) {
        var col = document.createElement('col');
        col.className = cls;
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);

      var tbody = document.createElement('tbody');
      var tr = document.createElement('tr');

      var tdRank = document.createElement('td');
      tdRank.className = 'lb-rank';
      tdRank.textContent = '#' + row.rank;

      var tdNick = document.createElement('td');
      tdNick.className = 'lb-nick';
      var pill = document.createElement('span');
      pill.className = 'lb-name-pill';
      pill.title = row.nick;
      pill.textContent = row.nick;
      tdNick.appendChild(pill);

      var tdScore = document.createElement('td');
      tdScore.className = 'lb-score';
      tdScore.textContent = row.score;

      var tdStreak = document.createElement('td');
      tdStreak.textContent = row.streak;

      var tdTime = document.createElement('td');
      tdTime.textContent = formatDuration(row.durationSec);

      tr.appendChild(tdRank);
      tr.appendChild(tdNick);
      tr.appendChild(tdScore);
      tr.appendChild(tdStreak);
      tr.appendChild(tdTime);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      playerRowEl.appendChild(table);
    } else {
      playerRowEl.classList.add('is-hidden');
      playerRowEl.textContent = '';
    }
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

  window._ShotLabUI = {
    appendStatusRow: appendStatusRow,
    formatDuration: formatDuration,
    escapeHtml: escapeHtml,
    buildRankIcon: buildRankIcon,
    ensureSessionBadgeTemplate: ensureSessionBadgeTemplate,
    renderLeaderboardRows: renderLeaderboardRows,
    renderPlayerRow: renderPlayerRow,
  };
})();
