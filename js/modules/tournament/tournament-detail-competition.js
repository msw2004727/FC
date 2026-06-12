/* ================================================
   SportHub — Tournament Detail Competition Renderers
   盃賽 / 聯賽詳情頁：賽程、對戰表、積分榜、射手榜/紅黃牌。
   依賴：tournament-competition.js（純引擎）、
        tournament-friendly-detail-view.js（renderTournamentTab 鏈）。
   友誼賽不受影響：非 cup/league 一律走原本渲染鏈。
   ================================================ */

const _tournamentCompetitionViewLegacy = {
  renderTournamentTab: App.renderTournamentTab,
};

Object.assign(App, {

  _isCompetitionTournamentRecord(record) {
    return ['cup', 'league'].includes(this._getTournamentMode?.(record) || 'friendly');
  },

  /** 依賽制顯示 / 隱藏「積分榜」頁籤（聯賽限定）。renderTournamentInfo 會呼叫。 */
  _syncTournamentDetailTabsForMode(tournament) {
    const tabs = document.getElementById('td-tabs');
    if (!tabs) return;
    let standingsTab = tabs.querySelector('[data-ttab="standings"]');
    if (!standingsTab) {
      standingsTab = document.createElement('button');
      standingsTab.className = 'tab';
      standingsTab.dataset.ttab = 'standings';
      standingsTab.textContent = '積分榜';
      const scheduleTab = tabs.querySelector('[data-ttab="schedule"]');
      if (scheduleTab) scheduleTab.insertAdjacentElement('afterend', standingsTab);
      else tabs.appendChild(standingsTab);
      standingsTab.onclick = () => {
        tabs.querySelectorAll('.tab').forEach(node => node.classList.remove('active'));
        standingsTab.classList.add('active');
        this.renderTournamentTab('standings');
      };
    }
    const isLeague = (this._getTournamentMode?.(tournament) || 'friendly') === 'league';
    standingsTab.style.display = isLeague ? '' : 'none';
    if (!isLeague && standingsTab.classList.contains('active')) {
      standingsTab.classList.remove('active');
      tabs.querySelector('[data-ttab="teams"]')?.classList.add('active');
      this.renderTournamentTab('teams');
    }
  },

  _getTournamentCompetitionState(tournamentId) {
    const state = this._getFriendlyTournamentState?.(tournamentId);
    if (state) return state;
    const tournament = ApiService.getFriendlyTournamentRecord?.(tournamentId) || ApiService.getTournament?.(tournamentId);
    return tournament ? { tournament, applications: [], entries: tournament.teamEntries || [], matches: [] } : null;
  },

  _getTournamentTeamNameMap(state) {
    const nameById = {};
    (state?.entries || []).forEach(entry => {
      if (entry.teamId) nameById[entry.teamId] = entry.teamName || entry.teamId;
    });
    const collect = teamId => {
      const safeId = String(teamId || '').trim();
      if (!safeId || nameById[safeId]) return;
      const team = ApiService.getTeam?.(safeId);
      nameById[safeId] = team?.name || safeId;
    };
    (state?.matches || []).forEach(match => { collect(match.homeTeamId); collect(match.awayTeamId); });
    return nameById;
  },

  _formatTournamentMatchTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getMonth() + 1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  },

  _renderTournamentMatchSideLabel(match, side, matchesBySlot, nameById) {
    const resolved = this._resolveTournamentMatchSide(match, side, matchesBySlot);
    if (resolved.teamId) return { teamId: resolved.teamId, label: nameById[resolved.teamId] || resolved.teamId, pending: false };
    const sourceSlot = side === 'home' ? match.homeSourceSlot : match.awaySourceSlot;
    return { teamId: '', label: sourceSlot ? (match.sourceType === 'loser' ? '準決賽敗方' : '待定') : '輪空', pending: true };
  },

  _renderTournamentMatchRowHtml(tournament, match, matchesBySlot, nameById, options = {}) {
    const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
    const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
    const finished = match.status === 'finished';
    const walkover = match.status === 'walkover';
    const bye = match.status === 'bye';
    let scoreText = 'VS';
    if (finished) {
      const pkText = Number.isFinite(Number(match.pkHome)) && Number.isFinite(Number(match.pkAway)) && match.pkHome !== null && match.pkAway !== null
        ? `<span class="tc-pk">PK ${match.pkHome}:${match.pkAway}</span>` : '';
      scoreText = `${match.scoreHome ?? '-'} : ${match.scoreAway ?? '-'}${pkText}`;
    } else if (walkover) {
      const winnerName = nameById[match.walkoverWinnerTeamId] || '';
      scoreText = `<span class="tc-wo" title="${escapeHTML(winnerName)} 獲勝">棄權</span>`;
    } else if (bye) {
      scoreText = '<span class="tc-wo">輪空</span>';
    }
    const winnerTeamId = this._getTournamentMatchWinnerTeamId(match, matchesBySlot);
    const metaParts = [
      this._formatTournamentMatchTime(match.scheduledAt),
      match.venue ? escapeHTML(match.venue) : '',
      (match.referees || []).length ? `裁判 ${escapeHTML(match.referees.map(r => r.name).join('、'))}` : '',
    ].filter(Boolean);
    const canRecord = options.canRecord === true && !bye;
    const recordLabel = finished || walkover ? '更正' : '記錄';
    const recordBtn = canRecord
      ? `<button type="button" class="tc-record-btn" onclick="event.stopPropagation();App.openTournamentMatchRecordModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')">${recordLabel}</button>`
      : '';
    return `
      <div class="match-card-compact tc-match-row${bye ? ' tc-match-bye' : ''}" data-match-id="${escapeHTML(match.id)}">
        <div class="mc-team${winnerTeamId && winnerTeamId === home.teamId ? ' tc-winner' : ''}${home.pending ? ' tc-pending' : ''}">${escapeHTML(home.label)}</div>
        <div class="mc-score">${scoreText}</div>
        <div class="mc-team away${winnerTeamId && winnerTeamId === away.teamId ? ' tc-winner' : ''}${away.pending ? ' tc-pending' : ''}">${escapeHTML(away.label)}</div>
        ${recordBtn}
      </div>
      ${metaParts.length ? `<div class="mc-meta tc-match-meta">${metaParts.join(' · ')}</div>` : ''}`;
  },

  _renderTournamentCompetitionScheduleHtml(state) {
    const tournament = state.tournament;
    const matches = state.matches || [];
    const canManage = this._canManageTournamentRecord?.(tournament);
    if (matches.length === 0) {
      const hint = canManage
        ? '尚未產生賽程。請先完成俱樂部審核，再從上方「賽程管理」產生賽程。'
        : '主辦方尚未公布賽程。';
      return `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">${hint}</div>`;
    }
    const user = ApiService.getCurrentUser?.();
    const matchesBySlot = this._buildTournamentMatchesBySlot(matches);
    const nameById = this._getTournamentTeamNameMap(state);
    const mode = this._getTournamentMode?.(tournament);
    const cupMatches = matches.filter(m => m.stage === 'cup');
    const bracketSize = cupMatches.filter(m => m.round === 1).length * 2;
    const groups = new Map();
    matches.forEach(match => {
      const key = match.stage === 'third' ? 'third' : `${match.stage}-${match.round}`;
      if (!groups.has(key)) groups.set(key, { label: this._getTournamentRoundLabel(match, bracketSize), items: [] });
      groups.get(key).items.push(match);
    });
    let html = '<div class="tc-schedule">';
    if (mode === 'cup' && cupMatches.length > 0) {
      html += this._renderTournamentBracketHtml(cupMatches, matchesBySlot, nameById, bracketSize);
    }
    groups.forEach(group => {
      html += `<div class="td-card tc-round-card"><div class="td-card-title">${escapeHTML(group.label)}</div>`;
      group.items.forEach(match => {
        const canRecord = this._canRecordTournamentMatch?.(tournament, match, user);
        html += this._renderTournamentMatchRowHtml(tournament, match, matchesBySlot, nameById, { canRecord });
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  },

  _renderTournamentBracketHtml(cupMatches, matchesBySlot, nameById, bracketSize) {
    const rounds = new Map();
    cupMatches.forEach(match => {
      if (!rounds.has(match.round)) rounds.set(match.round, []);
      rounds.get(match.round).push(match);
    });
    const roundKeys = [...rounds.keys()].sort((a, b) => a - b);
    const columns = roundKeys.map(round => {
      const items = rounds.get(round).sort((a, b) => a.slot - b.slot);
      const title = this._getTournamentRoundLabel(items[0], bracketSize);
      const cells = items.map(match => {
        const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
        const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
        const winnerTeamId = this._getTournamentMatchWinnerTeamId(match, matchesBySlot);
        const scoreOf = side => {
          if (match.status === 'finished') return side === 'home' ? (match.scoreHome ?? '') : (match.scoreAway ?? '');
          if (match.status === 'walkover') return match.walkoverWinnerTeamId === (side === 'home' ? home.teamId : away.teamId) ? '勝' : '棄';
          if (match.status === 'bye') return side === 'home' ? '晉級' : '';
          return '';
        };
        const sideHtml = (info, side) => `
          <div class="bracket-team${winnerTeamId && winnerTeamId === info.teamId ? ' winner' : ''}">
            <span class="${info.pending ? 'tc-pending' : ''}">${escapeHTML(info.label)}</span>
            <span class="bt-score">${scoreOf(side)}</span>
          </div>`;
        return `<div class="bracket-match">${sideHtml(home, 'home')}${away.label || match.status !== 'bye' ? sideHtml(away, 'away') : ''}</div>`;
      }).join('');
      return `<div class="bracket-round"><div class="bracket-round-title">${escapeHTML(title)}</div>${cells}</div>`;
    }).join('');
    return `<div class="bracket-container"><div class="bracket">${columns}</div></div>`;
  },

  _renderTournamentStandingsHtml(state) {
    const tournament = state.tournament;
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const entries = (state.entries || []).filter(entry => this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament));
    const teamIds = entries.map(entry => entry.teamId).filter(Boolean);
    const nameById = this._getTournamentTeamNameMap(state);
    const rows = this._computeLeagueStandings(state.matches || [], { config, teamIds, nameById });
    if (rows.length === 0) {
      return '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無參賽隊伍，積分榜將於審核通過後顯示。</div>';
    }
    const bodyRows = rows.map(row => `
      <tr>
        <td>${row.rank}</td>
        <td class="rr-team-cell">${escapeHTML(row.name)}${row.walkovers > 0 ? ' <span class="tc-wo" title="含棄權判負">WO</span>' : ''}</td>
        <td>${row.played}</td>
        <td class="rr-win">${row.win}</td>
        <td class="rr-draw">${row.draw}</td>
        <td class="rr-loss">${row.loss}</td>
        <td>${row.gf}</td>
        <td>${row.ga}</td>
        <td>${row.gd > 0 ? '+' : ''}${row.gd}</td>
        <td style="font-weight:800">${row.points}</td>
      </tr>`).join('');
    const tiebreakerLabels = { gd: '淨勝球', gf: '進球數', h2h: '對戰成績', wins: '勝場' };
    const order = ['積分', ...(config.tiebreakers || []).map(key => tiebreakerLabels[key] || key)].join(' → ');
    return `
      <div style="padding:.6rem">
        <div class="td-card">
          <div class="td-card-title">聯賽積分榜</div>
          <div class="rr-table-wrap">
            <table class="rr-table">
              <thead><tr><th>#</th><th style="text-align:left">隊伍</th><th>賽</th><th>勝</th><th>平</th><th>負</th><th>進</th><th>失</th><th>淨</th><th>積分</th></tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>
          <div class="tc-standings-note">排名依據：${escapeHTML(order)}。積分榜由比賽結果即時計算，棄權判 ${config.walkoverWinScore}:${config.walkoverLoseScore}。</div>
        </div>
      </div>`;
  },

  _renderTournamentCompetitionStatsHtml(state) {
    const tournament = state.tournament;
    const nameById = this._getTournamentTeamNameMap(state);
    const { scorers, cards } = this._computeTournamentScorerStats(state.matches || [], { nameById });
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const entries = state.entries || [];
    const approved = entries.filter(e => e.entryStatus === 'approved' || e.entryStatus === 'host').length;
    const rosterTotal = entries.reduce((sum, e) => sum + (e.memberRoster ? e.memberRoster.length : 0), 0);
    const finishedCount = (state.matches || []).filter(m => m.status === 'finished' || m.status === 'walkover').length;
    let html = '<div style="padding:.6rem">';
    html += `<div class="td-card"><div class="td-card-title">${I18N.t('tournament.statsSummary')}</div><div class="td-stats-row">`;
    html += `<div class="td-stat"><div class="td-stat-num">${approved}</div><div class="td-stat-label">參賽隊伍</div></div>`;
    html += `<div class="td-stat"><div class="td-stat-num">${finishedCount}</div><div class="td-stat-label">已完賽場次</div></div>`;
    html += `<div class="td-stat"><div class="td-stat-num">${rosterTotal}</div><div class="td-stat-label">登錄球員</div></div>`;
    html += '</div></div>';
    const scorerRows = scorers.slice(0, 20).map((row, i) => `
      <div class="tc-stat-row">
        <span class="tc-stat-rank">${i + 1}</span>
        <span class="tc-stat-name">${this._userTag(row.name, null, { uid: row.uid || '' })}</span>
        <span class="tc-stat-team">${escapeHTML(nameById[row.teamId] || '')}</span>
        <span class="tc-stat-num">${row.goals} 球</span>
      </div>`).join('');
    html += `<div class="td-card"><div class="td-card-title">射手榜</div>${scorerRows || '<div class="tfd-empty-state">尚無進球記錄</div>'}</div>`;
    const yellowLimit = Number(config.yellowLimit || 0);
    const cardRows = cards.slice(0, 20).map(row => {
      const suspendHint = yellowLimit > 0 && row.yellow >= yellowLimit
        ? `<span class="tc-suspend-hint" title="黃牌累計達 ${yellowLimit} 張">⚠ 停賽提醒</span>` : '';
      return `
      <div class="tc-stat-row">
        <span class="tc-stat-name">${this._userTag(row.name, null, { uid: row.uid || '' })}</span>
        <span class="tc-stat-team">${escapeHTML(nameById[row.teamId] || '')}</span>
        <span class="tc-stat-num">${row.yellow > 0 ? `🟨×${row.yellow}` : ''} ${row.red > 0 ? `🟥×${row.red}` : ''} ${suspendHint}</span>
      </div>`;
    }).join('');
    html += `<div class="td-card"><div class="td-card-title">紅黃牌${yellowLimit > 0 ? `（黃牌 ${yellowLimit} 張停賽提醒）` : ''}</div>${cardRows || '<div class="tfd-empty-state">尚無紅黃牌記錄</div>'}</div>`;
    html += '</div>';
    return html;
  },

  renderTournamentTab(tab) {
    const tournament = ApiService.getFriendlyTournamentRecord?.(this.currentTournament) || ApiService.getTournament?.(this.currentTournament);
    if (!tournament || !this._isCompetitionTournamentRecord(tournament) || !['schedule', 'standings', 'stats'].includes(tab)) {
      return _tournamentCompetitionViewLegacy.renderTournamentTab.call(this, tab);
    }
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const state = this._getTournamentCompetitionState(tournament.id);
    if (!state) return;
    if (!Array.isArray(state.matches)) state.matches = [];
    if (tab === 'schedule') container.innerHTML = this._renderTournamentCompetitionScheduleHtml(state);
    else if (tab === 'standings') container.innerHTML = this._renderTournamentStandingsHtml(state);
    else if (tab === 'stats') container.innerHTML = this._renderTournamentCompetitionStatsHtml(state);
  },

  /** 重新載入比賽並刷新目前頁籤（記錄比分 / 產生賽程後呼叫）。 */
  async _refreshTournamentCompetitionMatches(tournamentId) {
    const safeId = String(tournamentId || '').trim();
    if (!safeId) return;
    try {
      const matches = await ApiService.listTournamentMatches(safeId);
      const state = this._getFriendlyTournamentState?.(safeId);
      if (state) state.matches = matches.map(match => this._buildTournamentMatchRecord(match));
      if (this.currentPage === 'page-tournament-detail' && String(this.currentTournament || '') === safeId) {
        const activeTab = document.querySelector('#td-tabs .tab.active')?.dataset?.ttab || 'teams';
        this.renderTournamentTab(activeTab);
      }
    } catch (err) {
      console.warn('[Tournament:refreshMatches] failed:', err);
    }
  },

});
