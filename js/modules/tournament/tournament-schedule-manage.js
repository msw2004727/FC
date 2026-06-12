/* ================================================
   SportHub — Tournament Schedule Manager
   盃賽 / 聯賽：產生 / 重新產生賽程、單場時間地點與裁判指派。
   僅賽事管理者（主辦 / 委託 / 全域）可操作。
   ================================================ */

Object.assign(App, {

  _tournamentScheduleManagerState: null,

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
        <div class="modal-body">
          <div id="tournament-schedule-summary" class="tfd-picker-meta"></div>
          <div id="tournament-schedule-actions" class="tc-schedule-actions"></div>
          <div id="tournament-schedule-list" class="tc-schedule-manage-list"></div>
        </div>
        <div class="modal-actions">
          <button class="outline-btn" type="button" data-action="close">關閉</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        overlay.classList.remove('open');
        document.getElementById('tournament-schedule-modal')?.classList.remove('open');
        this._tournamentScheduleManagerState = null;
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  async openTournamentScheduleManager(tournamentId) {
    const safeId = String(tournamentId || '').trim();
    const state = this._getFriendlyTournamentState?.(safeId) || await this._loadFriendlyTournamentDetailState?.(safeId);
    const tournament = state?.tournament;
    if (!tournament || !this._isCompetitionTournamentRecord?.(tournament)) {
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
    this._renderTournamentScheduleManager();
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
    if (!summary || !actions || !list) return;

    const mode = this._getTournamentMode?.(tournament);
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const countingEntries = (state.entries || []).filter(entry => this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament));
    const matches = state.matches || [];
    const finishedCount = matches.filter(m => m.status === 'finished' || m.status === 'walkover').length;
    const modeText = mode === 'league'
      ? `聯賽（${config.doubleRound ? '雙循環' : '單循環'}）`
      : `盃賽（單淘汰${config.thirdPlace ? '＋季軍戰' : ''}）`;
    summary.textContent = `${modeText}・參賽 ${countingEntries.length} 隊・已建立 ${matches.length} 場（完賽 ${finishedCount} 場）・棄權判 ${config.walkoverWinScore}:${config.walkoverLoseScore}`;

    const regenWarn = matches.length > 0;
    actions.innerHTML = `
      <button type="button" class="primary-btn small" onclick="return App.generateTournamentSchedule('${escapeHTML(managerState.tournamentId)}', this)">${regenWarn ? '重新產生賽程' : '產生賽程'}</button>
      ${this.getTournamentStatus?.(tournament) === TOURNAMENT_STATUS.REG_OPEN ? '<span class="tc-schedule-warn">報名仍開放中，隊伍若有變動需重新產生</span>' : ''}
    `;

    if (matches.length === 0) {
      list.innerHTML = '<div class="tfd-empty-state">尚未產生賽程。確認參賽隊伍後點擊「產生賽程」。</div>';
      return;
    }
    const matchesBySlot = this._buildTournamentMatchesBySlot(matches);
    const nameById = this._getTournamentTeamNameMap(state);
    const refereeOptions = [
      ...(tournament.refereeHead && tournament.refereeHead.uid ? [{ ...tournament.refereeHead, isHead: true }] : []),
      ...(tournament.referees || []),
    ];
    const cupMatches = matches.filter(m => m.stage === 'cup');
    const bracketSize = cupMatches.filter(m => m.round === 1).length * 2;
    list.innerHTML = matches.map(match => {
      const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
      const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
      const locked = match.status === 'finished' || match.status === 'walkover';
      if (match.status === 'bye') {
        return `<div class="tc-manage-row tc-match-bye"><div class="tc-manage-title">${escapeHTML(this._getTournamentRoundLabel(match, bracketSize))}｜${escapeHTML(home.label)} 輪空晉級</div></div>`;
      }
      const assigned = new Set(match.refereeUids || []);
      const refereeChecks = refereeOptions.map(ref => `
        <label class="tc-ref-check"><input type="checkbox" data-ref-uid="${escapeHTML(ref.uid)}" data-ref-name="${escapeHTML(ref.name)}" ${assigned.has(ref.uid) ? 'checked' : ''}>${escapeHTML(ref.name)}${ref.isHead ? '（裁判長）' : ''}</label>`).join('');
      const timeValue = this._toTournamentDateTimeInputValue?.(match.scheduledAt) || '';
      return `
        <div class="tc-manage-row" data-match-id="${escapeHTML(match.id)}">
          <div class="tc-manage-title">${escapeHTML(this._getTournamentRoundLabel(match, bracketSize))}｜${escapeHTML(home.label)} vs ${escapeHTML(away.label)}${locked ? `<span class="tc-manage-lock">已完賽 ${match.status === 'walkover' ? '（棄權）' : `${match.scoreHome}:${match.scoreAway}`}</span>` : ''}</div>
          <div class="tc-manage-fields">
            <input type="datetime-local" class="tc-manage-time" value="${escapeHTML(timeValue)}">
            <input type="text" class="tc-manage-venue" placeholder="場地" value="${escapeHTML(match.venue || '')}">
          </div>
          ${refereeOptions.length ? `<div class="tc-manage-refs">${refereeChecks}</div>` : ''}
          <div class="tc-manage-actions">
            <button type="button" class="outline-btn small" onclick="return App.saveTournamentMatchMeta('${escapeHTML(managerState.tournamentId)}','${escapeHTML(match.id)}', this)">儲存</button>
            ${match.stage === 'league' && !locked ? `<button type="button" class="outline-btn small tc-manage-delete" onclick="return App.deleteTournamentScheduleMatch('${escapeHTML(managerState.tournamentId)}','${escapeHTML(match.id)}', this)">刪除</button>` : ''}
          </div>
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
    const fixtures = mode === 'league'
      ? this._generateLeagueFixtures(teamIds, { doubleRound: config.doubleRound === true })
      : this._generateCupBracket(teamIds, { thirdPlace: config.thirdPlace === true });
    if (fixtures.length === 0) {
      this.showToast('無法產生賽程，請確認隊伍數');
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

  async saveTournamentMatchMeta(tournamentId, matchId, actionButton = null) {
    const row = actionButton?.closest?.('.tc-manage-row') || document.querySelector(`.tc-manage-row[data-match-id="${CSS.escape(String(matchId || ''))}"]`);
    if (!row) return;
    const timeValue = row.querySelector('.tc-manage-time')?.value || '';
    const venue = row.querySelector('.tc-manage-venue')?.value.trim() || '';
    const referees = [...row.querySelectorAll('.tc-ref-check input:checked')].map(input => ({
      uid: input.dataset.refUid || '',
      name: input.dataset.refName || '',
    })).filter(ref => ref.uid);
    const save = async () => {
      await ApiService.updateTournamentMatchAwait(tournamentId, matchId, {
        scheduledAt: timeValue ? (this._normalizeTournamentDateTimeValue?.(timeValue) || timeValue) : '',
        venue,
        referees,
        refereeUids: referees.map(ref => ref.uid),
      });
      await this._refreshTournamentCompetitionMatches?.(tournamentId);
      this._renderTournamentScheduleManager();
      this.showToast('已儲存比賽設定');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
    } catch (err) {
      this._showTournamentActionError?.('儲存比賽設定', err);
    }
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
