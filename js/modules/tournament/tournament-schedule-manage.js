/* ================================================
   SportHub — Tournament Schedule Manager
   盃賽 / 聯賽：產生 / 重新產生賽程、單場時間地點與裁判指派。
   僅賽事管理者（主辦 / 委託 / 全域）可操作。
   ================================================ */

Object.assign(App, {

  _tournamentScheduleManagerState: null,

  _closeTournamentScheduleManager() {
    document.getElementById('tournament-schedule-overlay')?.classList.remove('open');
    document.getElementById('tournament-schedule-modal')?.classList.remove('open');
    document.body?.classList?.remove('modal-open');
    this._tournamentScheduleManagerState = null;
  },

  _ensureTournamentScheduleModal() {
    let overlay = document.getElementById('tournament-schedule-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tournament-schedule-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal tc-schedule-modal" id="tournament-schedule-modal">
        <div class="modal-header">
          <h3>賽程管理</h3>
          <button class="modal-close" type="button" data-action="close">✕</button>
        </div>
        <div class="modal-body tc-schedule-manager-body">
          <div id="tournament-schedule-summary" class="tc-manager-summary"></div>
          <div id="tournament-schedule-actions" class="tc-schedule-actions"></div>
          <div id="tournament-schedule-list" class="tc-schedule-manage-list"></div>
          <div id="tournament-schedule-sticky-actions" class="tc-schedule-sticky-actions"></div>
        </div>
        <div class="modal-actions">
          <button class="outline-btn" type="button" data-action="close">關閉</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this._closeTournamentScheduleManager();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  async openTournamentScheduleManager(tournamentId) {
    const safeId = String(tournamentId || '').trim();
    const state = this._getFriendlyTournamentState?.(safeId) || await this._loadFriendlyTournamentDetailState?.(safeId);
    const tournament = state?.tournament;
    const mode = tournament ? (this._getTournamentMode?.(tournament) || 'friendly') : '';
    if (!tournament || !['friendly', 'single', 'cup', 'league'].includes(mode)) {
      this.showToast('此賽事無賽程功能');
      return;
    }
    if (!this._isTournamentGlobalAdmin?.() && !this._canManageTournamentRecord?.(tournament)) {
      this.showToast('你沒有管理此賽事賽程的權限');
      return;
    }
    this._tournamentScheduleManagerState = { tournamentId: safeId };
    const overlay = this._ensureTournamentScheduleModal();
    overlay.classList.add('open');
    document.getElementById('tournament-schedule-modal')?.classList.add('open');
    document.body?.classList?.add('modal-open');
    this._renderTournamentScheduleManager();
  },

  _getTournamentScheduleRepeatDefault(matches = [], config = {}) {
    const totals = (Array.isArray(matches) ? matches : []).map(match => Number(match.seriesTotal) || 1);
    const existing = totals.length ? Math.max(1, ...totals) : 1;
    const fallback = config.matchRepeatCount || (config.doubleRound === true ? 2 : 1);
    return this._normalizeTournamentMatchRepeatCount(existing > 1 ? existing : fallback, 1);
  },

  _readTournamentScheduleRepeatCount(config = {}) {
    const input = document.getElementById('tc-schedule-repeat-count');
    const fallback = config.matchRepeatCount || (config.doubleRound === true ? 2 : 1);
    return this._normalizeTournamentMatchRepeatCount(input?.value, fallback);
  },

  _renderTournamentScheduleManager() {
    const managerState = this._tournamentScheduleManagerState;
    if (!managerState) return;
    const state = this._getFriendlyTournamentState?.(managerState.tournamentId);
    const tournament = state?.tournament;
    if (!tournament) return;
    const summary = document.getElementById('tournament-schedule-summary');
    const actions = document.getElementById('tournament-schedule-actions');
    const list = document.getElementById('tournament-schedule-list');
    let stickyActions = document.getElementById('tournament-schedule-sticky-actions');
    if (!summary || !actions || !list) return;
    if (!stickyActions) {
      stickyActions = document.createElement('div');
      stickyActions.id = 'tournament-schedule-sticky-actions';
      stickyActions.className = 'tc-schedule-sticky-actions';
      list.insertAdjacentElement('afterend', stickyActions);
    }

    const mode = this._getTournamentMode?.(tournament);
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const countingEntries = (state.entries || []).filter(entry => this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament));
    const matches = state.matches || [];
    const finishedCount = matches.filter(m => m.status === 'finished' || m.status === 'walkover').length;
    const repeatDefault = this._getTournamentScheduleRepeatDefault(matches, config);
    const modeText = mode === 'league'
      ? `聯賽（${config.doubleRound ? '主客雙循環' : '單循環'}）`
      : mode === 'cup'
        ? `盃賽（淘汰賽${config.thirdPlace ? '，含季軍戰' : ''}）`
        : mode === 'single'
          ? '單賽制（隨機對戰）'
          : '友誼賽（隨機對戰）';
    const configuredTimeCount = matches.filter(m => m.scheduledAt).length;
    const configuredVenueCount = matches.filter(m => String(m.venue || '').trim()).length;
    summary.innerHTML = `
      <div class="tc-manager-summary-copy">
        <span class="tc-manager-kicker">賽程管理</span>
        <strong>${escapeHTML(modeText)}</strong>
        <small>調整單場時間、場地與裁判；已完賽場次仍可保留結果並更新基本資訊。</small>
      </div>
      <div class="tc-manager-summary-stats">
        <span><b>${countingEntries.length}</b>參賽隊伍</span>
        <span><b>${matches.length}</b>場次</span>
        <span><b>${finishedCount}</b>已完賽</span>
        <span><b>${configuredTimeCount}</b>有時間</span>
        <span><b>${configuredVenueCount}</b>有場地</span>
      </div>
      <div class="tc-manager-summary-note">棄權比分 ${escapeHTML(String(config.walkoverWinScore))}:${escapeHTML(String(config.walkoverLoseScore))} · 每組對戰 ${escapeHTML(String(repeatDefault))} 場</div>`;

    const regenWarn = matches.length > 0;
    actions.innerHTML = `
      <div class="tc-schedule-generate-controls">
        <label class="tc-schedule-repeat-control" for="tc-schedule-repeat-count">
          <span>每組對戰場數</span>
          <input id="tc-schedule-repeat-count" type="number" min="1" max="20" step="1" inputmode="numeric" value="${escapeHTML(String(repeatDefault))}">
          <small>預設 1 場，可設定 3、4 場後再產生賽程。</small>
        </label>
        <button type="button" class="primary-btn small tc-schedule-generate-btn" onclick="return App.generateTournamentSchedule('${escapeHTML(managerState.tournamentId)}', this)">${regenWarn ? '重新產生賽程' : '產生賽程'}</button>
      </div>
      ${this.getTournamentStatus?.(tournament) === TOURNAMENT_STATUS.REG_OPEN ? '<span class="tc-schedule-warn">報名仍開放中，隊伍若有變動需重新產生</span>' : ''}
    `;

    if (matches.length === 0) {
      stickyActions.innerHTML = '';
      list.innerHTML = `
        <div class="tc-manager-empty">
          <div class="tc-manager-empty-title">尚未產生賽程</div>
          <div class="tc-manager-empty-body">確認參賽隊伍後點擊「產生賽程」，系統會依目前賽制建立場次。</div>
        </div>`;
      return;
    }
    const matchesBySlot = this._buildTournamentMatchesBySlot(matches);
    const nameById = this._getTournamentTeamNameMap(state);
    const refereeOptions = [
      ...(tournament.refereeHead && tournament.refereeHead.uid ? [{ ...tournament.refereeHead, isHead: true }] : []),
      ...(tournament.referees || []),
    ];
    const cupMatches = matches.filter(m => m.stage === 'cup');
    const bracketSize = this._getTournamentBracketSize?.(cupMatches) || cupMatches.filter(m => m.round === 1).length * 2;
    const orderedMatches = [...matches].sort((a, b) => {
      const stageOrder = { friendly: 0, cup: 1, third: 2, league: 3 };
      const stageA = stageOrder[a.stage] ?? 9;
      const stageB = stageOrder[b.stage] ?? 9;
      return stageA - stageB || Number(a.round || 0) - Number(b.round || 0) || Number(a.slot || 0) - Number(b.slot || 0);
    });
    const editableCount = orderedMatches.filter(match => match.status !== 'bye').length;
    stickyActions.innerHTML = editableCount > 0 ? `
      <div class="tc-schedule-sticky-inner">
        <div class="tc-schedule-sticky-copy">
          <strong>儲存全部</strong>
          <span>${escapeHTML(String(editableCount))} 場設定</span>
        </div>
        <button type="button" class="primary-btn tc-save-all-btn" onclick="return App.saveAllTournamentMatchMeta('${escapeHTML(managerState.tournamentId)}', this)">儲存</button>
      </div>` : '';
    list.innerHTML = orderedMatches.map(match => {
      const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
      const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
      const locked = match.status === 'finished' || match.status === 'walkover';
      const roundLabel = this._getTournamentRoundLabel(match, bracketSize);
      const seriesTotal = Math.max(1, Number(match.seriesTotal) || 1);
      const seriesGame = Math.max(1, Number(match.seriesGame) || 1);
      const seriesLabel = seriesTotal > 1 ? ` · 第 ${seriesGame}/${seriesTotal} 場` : '';
      if (match.status === 'bye') {
        return `
          <div class="tc-manage-row tc-manage-row-bye tc-match-bye">
            <div class="tc-manage-card-head">
              <div class="tc-manage-title-block">
                <span class="tc-manage-round">${escapeHTML(roundLabel + seriesLabel)}</span>
                <div class="tc-manage-title">${escapeHTML(home.label)} 輪空晉級</div>
              </div>
              <span class="tc-manage-status tc-manage-status-bye">輪空</span>
            </div>
          </div>`;
      }
      const assigned = new Set(match.refereeUids || []);
      const refereeChecks = refereeOptions.map(ref => `
        <label class="tc-ref-check">
          <input type="checkbox" data-ref-uid="${escapeHTML(ref.uid)}" data-ref-name="${escapeHTML(ref.name)}" ${assigned.has(ref.uid) ? 'checked' : ''}>
          <span class="tc-ref-name">${escapeHTML(ref.name)}</span>
          ${ref.isHead ? '<span class="tc-ref-role">裁判長</span>' : ''}
        </label>`).join('');
      const timeValue = this._toTournamentDateTimeInputValue?.(match.scheduledAt) || '';
      const statusText = locked
        ? `已完賽 ${match.status === 'walkover' ? '（棄權）' : `${match.scoreHome}:${match.scoreAway}`}`
        : '待設定';
      return `
        <div class="tc-manage-row" data-match-id="${escapeHTML(match.id)}">
          <div class="tc-manage-card-head">
            <div class="tc-manage-title-block">
              <span class="tc-manage-round">${escapeHTML(roundLabel + seriesLabel)}</span>
              <div class="tc-manage-title">
                <span title="${escapeHTML(home.label)}">${escapeHTML(home.label)}</span>
                <b>VS</b>
                <span title="${escapeHTML(away.label)}">${escapeHTML(away.label)}</span>
              </div>
            </div>
            <span class="tc-manage-status${locked ? ' tc-manage-status-locked' : ''}">${escapeHTML(statusText)}</span>
          </div>
          <div class="tc-manage-fields">
            <label class="tc-manage-field">
              <span>開賽時間</span>
              <input type="datetime-local" class="tc-manage-time" value="${escapeHTML(timeValue)}">
            </label>
            <label class="tc-manage-field">
              <span>場地</span>
              <input type="text" class="tc-manage-venue" placeholder="輸入場地" value="${escapeHTML(match.venue || '')}">
            </label>
          </div>
          ${refereeOptions.length ? `<div class="tc-manage-ref-panel"><div class="tc-manage-section-title">裁判指派</div><div class="tc-manage-refs">${refereeChecks}</div></div>` : '<div class="tc-manage-ref-panel"><div class="tc-manage-refs-empty">尚未設定裁判名單</div></div>'}
          ${['friendly', 'league'].includes(match.stage) && !locked ? `<div class="tc-manage-actions"><button type="button" class="outline-btn small tc-manage-delete" onclick="return App.deleteTournamentScheduleMatch('${escapeHTML(managerState.tournamentId)}','${escapeHTML(match.id)}', this)">刪除</button></div>` : ''}
        </div>`;
    }).join('');
  },

  /** 從目前已核准隊伍產生（或重新產生）賽程。會覆蓋既有賽程。 */
  async generateTournamentSchedule(tournamentId, actionButton = null) {
    const safeId = String(tournamentId || '').trim();
    const state = this._getFriendlyTournamentState?.(safeId) || await this._loadFriendlyTournamentDetailState?.(safeId);
    const tournament = state?.tournament;
    if (!tournament) return;
    if (!this._isTournamentGlobalAdmin?.() && !this._canManageTournamentRecord?.(tournament)) {
      this.showToast('你沒有管理此賽事賽程的權限');
      return;
    }
    const mode = this._getTournamentMode?.(tournament);
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const countingEntries = (state.entries || []).filter(entry => this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament));
    const teamIds = countingEntries.map(entry => entry.teamId).filter(Boolean);
    if (teamIds.length < 2) {
      this.showToast('至少需要 2 支已核准隊伍才能產生賽程');
      return;
    }
    const existing = state.matches || [];
    const recordedCount = existing.filter(m => m.status === 'finished' || m.status === 'walkover').length;
    if (existing.length > 0) {
      const warnText = recordedCount > 0
        ? `已有 ${recordedCount} 場比賽記錄了結果，重新產生會刪除全部 ${existing.length} 場比賽與其比分（無法復原）。確定重新產生？`
        : `將刪除既有 ${existing.length} 場賽程並重新產生。確定？`;
      if (!(await this.appConfirm(warnText))) return;
    }
    const repeatCount = this._readTournamentScheduleRepeatCount(config);
    const scheduleSeed = `${safeId}|${teamIds.join('|')}|${(tournament.matchDates || []).join('|')}`;
    const rawFixtures = mode === 'league'
      ? this._generateLeagueFixtures(teamIds, { doubleRound: config.doubleRound === true, matchRepeatCount: repeatCount })
      : mode === 'cup'
        ? this._generateCupBracket(teamIds, { thirdPlace: config.thirdPlace === true, matchRepeatCount: repeatCount })
        : this._generateFriendlyFixtures(teamIds, { matchRepeatCount: repeatCount, seed: scheduleSeed, tournament });
    const fixtures = rawFixtures.map(match => this._buildTournamentMatchRecord?.(match) || match);
    if (fixtures.length === 0) {
      this.showToast('無法產生賽程，請確認隊伍數');
      return;
    }
    if (fixtures.length > 400) {
      this.showToast(`產生後會有 ${fixtures.length} 場，已超過 400 場上限，請降低每組對戰場數`);
      return;
    }
    const generate = async () => {
      await ApiService.replaceTournamentMatchesAtomic(safeId, fixtures);
      await this._refreshTournamentCompetitionMatches?.(safeId);
      this._renderTournamentScheduleManager();
      this.showToast(`已產生 ${fixtures.length} 場賽程`);
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '產生中...', generate);
      } else {
        await generate();
      }
    } catch (err) {
      this._showTournamentActionError?.('產生賽程', err);
    }
  },

  _collectTournamentScheduleMetaUpdates() {
    const rows = [...document.querySelectorAll('#tournament-schedule-list .tc-manage-row[data-match-id]')];
    return rows.map(row => {
      const matchId = String(row.dataset.matchId || '').trim();
      if (!matchId) return null;
      const timeValue = row.querySelector('.tc-manage-time')?.value || '';
      const venue = row.querySelector('.tc-manage-venue')?.value.trim() || '';
      const referees = [...row.querySelectorAll('.tc-ref-check input:checked')].map(input => ({
        uid: input.dataset.refUid || '',
        name: input.dataset.refName || '',
      })).filter(ref => ref.uid);
      return {
        id: matchId,
        updates: {
          scheduledAt: timeValue ? (this._normalizeTournamentDateTimeValue?.(timeValue) || timeValue) : '',
          venue,
          referees,
          refereeUids: referees.map(ref => ref.uid),
        },
      };
    }).filter(Boolean);
  },

  async saveAllTournamentMatchMeta(tournamentId, actionButton = null) {
    const safeId = String(tournamentId || '').trim();
    const updates = this._collectTournamentScheduleMetaUpdates();
    if (updates.length === 0) {
      this.showToast('沒有可儲存的場次設定');
      return;
    }
    const save = async () => {
      await ApiService.batchUpdateTournamentMatchesMetaAwait(safeId, updates);
      await this._refreshTournamentCompetitionMatches?.(safeId);
      this._closeTournamentScheduleManager();
      this.showToast(`已儲存 ${updates.length} 場場次設定`);
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
    } catch (err) {
      this._showTournamentActionError?.('儲存全部場次設定', err);
    }
  },

  async saveTournamentMatchMeta(tournamentId, matchId, actionButton = null) {
    return this.saveAllTournamentMatchMeta(tournamentId, actionButton);
  },

  async deleteTournamentScheduleMatch(tournamentId, matchId, actionButton = null) {
    if (!(await this.appConfirm('確定刪除此場比賽？'))) return;
    const remove = async () => {
      await ApiService.deleteTournamentMatchAwait(tournamentId, matchId);
      await this._refreshTournamentCompetitionMatches?.(tournamentId);
      this._renderTournamentScheduleManager();
      this.showToast('已刪除比賽');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '刪除中...', remove);
      } else {
        await remove();
      }
    } catch (err) {
      this._showTournamentActionError?.('刪除比賽', err);
    }
  },

});
