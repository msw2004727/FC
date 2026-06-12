/* ================================================
   SportHub — Tournament Match Record Modal
   比分 / 棄權 / 進球者 / 紅黃牌記錄。
   權限：_canRecordTournamentMatch（管理者全場次；
   裁判長全場次；裁判限被指派場次；賽事結束後僅管理者）。
   ================================================ */

Object.assign(App, {

  _tournamentMatchRecordState: null,

  _ensureTournamentMatchRecordModal() {
    let overlay = document.getElementById('tournament-match-record-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tournament-match-record-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal tc-record-modal" id="tournament-match-record-modal">
        <div class="modal-header">
          <h3 id="tmr-title">記錄比賽結果</h3>
          <button class="modal-close" type="button" data-action="close">✕</button>
        </div>
        <div class="modal-body" id="tmr-body"></div>
        <div class="modal-actions" id="tmr-actions"></div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this.closeTournamentMatchRecordModal();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  closeTournamentMatchRecordModal() {
    document.getElementById('tournament-match-record-overlay')?.classList.remove('open');
    document.getElementById('tournament-match-record-modal')?.classList.remove('open');
    this._tournamentMatchRecordState = null;
  },

  async openTournamentMatchRecordModal(tournamentId, matchId) {
    const safeId = String(tournamentId || '').trim();
    const state = this._getFriendlyTournamentState?.(safeId) || await this._loadFriendlyTournamentDetailState?.(safeId);
    const tournament = state?.tournament;
    const match = (state?.matches || []).find(item => item.id === String(matchId || '').trim());
    if (!tournament || !match) {
      this.showToast('找不到比賽資料');
      return;
    }
    if (!this._canRecordTournamentMatch?.(tournament, match)) {
      this.showToast('你沒有記錄此場比賽的權限');
      return;
    }
    const matchesBySlot = this._buildTournamentMatchesBySlot(state.matches || []);
    const nameById = this._getTournamentTeamNameMap(state);
    const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
    const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
    if (!home.teamId || !away.teamId) {
      this.showToast('此場對戰隊伍尚未確定（前一輪未完成）');
      return;
    }
    this._tournamentMatchRecordState = {
      tournamentId: safeId,
      matchId: match.id,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeName: home.label,
      awayName: away.label,
      events: (match.events || []).map(ev => ({ ...ev })),
      isCup: match.stage !== 'league',
    };
    const overlay = this._ensureTournamentMatchRecordModal();
    this._renderTournamentMatchRecordBody(tournament, match);
    overlay.classList.add('open');
    document.getElementById('tournament-match-record-modal')?.classList.add('open');
  },

  _renderTournamentMatchRecordBody(tournament, match) {
    const recordState = this._tournamentMatchRecordState;
    const body = document.getElementById('tmr-body');
    const actions = document.getElementById('tmr-actions');
    const title = document.getElementById('tmr-title');
    if (!recordState || !body || !actions) return;
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const isWalkover = match.status === 'walkover';
    if (title) title.textContent = `${recordState.homeName} vs ${recordState.awayName}`;
    body.innerHTML = `
      <div class="ce-row">
        <label>結果類型</label>
        <select id="tmr-result-type" onchange="App._syncTournamentMatchRecordResultType()">
          <option value="finished" ${!isWalkover ? 'selected' : ''}>正常完賽</option>
          <option value="walkover" ${isWalkover ? 'selected' : ''}>棄權（判 ${config.walkoverWinScore}:${config.walkoverLoseScore}）</option>
        </select>
      </div>
      <div id="tmr-score-section">
        <div class="tc-score-grid">
          <div class="tc-score-side">
            <div class="tc-score-team">${escapeHTML(recordState.homeName)}</div>
            <input type="number" id="tmr-score-home" min="0" max="99" inputmode="numeric" value="${Number.isFinite(Number(match.scoreHome)) && match.scoreHome !== null ? match.scoreHome : 0}">
          </div>
          <div class="tc-score-divider">:</div>
          <div class="tc-score-side">
            <div class="tc-score-team">${escapeHTML(recordState.awayName)}</div>
            <input type="number" id="tmr-score-away" min="0" max="99" inputmode="numeric" value="${Number.isFinite(Number(match.scoreAway)) && match.scoreAway !== null ? match.scoreAway : 0}">
          </div>
        </div>
        ${recordState.isCup ? `
        <div class="tc-pk-row" id="tmr-pk-row">
          <label>PK 大戰（平手時必填）</label>
          <div class="tc-score-grid tc-pk-grid">
            <input type="number" id="tmr-pk-home" min="0" max="99" inputmode="numeric" value="${match.pkHome ?? ''}" placeholder="-">
            <div class="tc-score-divider">:</div>
            <input type="number" id="tmr-pk-away" min="0" max="99" inputmode="numeric" value="${match.pkAway ?? ''}" placeholder="-">
          </div>
        </div>` : ''}
        <div class="tc-events-section">
          <div class="tc-events-header">比賽事件（進球 / 紅黃牌，選填）</div>
          <div id="tmr-events-list"></div>
          <div class="tc-event-add">
            <select id="tmr-event-type">
              <option value="goal">⚽ 進球</option>
              <option value="own_goal">🥅 烏龍球</option>
              <option value="yellow">🟨 黃牌</option>
              <option value="red">🟥 紅牌</option>
            </select>
            <select id="tmr-event-team" onchange="App._syncTournamentMatchRecordPlayers()">
              <option value="${escapeHTML(recordState.homeTeamId)}">${escapeHTML(recordState.homeName)}</option>
              <option value="${escapeHTML(recordState.awayTeamId)}">${escapeHTML(recordState.awayName)}</option>
            </select>
            <select id="tmr-event-player"></select>
            <input type="text" id="tmr-event-player-custom" placeholder="輸入球員名" style="display:none">
            <input type="number" id="tmr-event-minute" min="1" max="150" placeholder="分" inputmode="numeric">
            <button type="button" class="outline-btn small" onclick="App._addTournamentMatchRecordEvent()">＋</button>
          </div>
        </div>
      </div>
      <div id="tmr-walkover-section" style="display:none">
        <div class="ce-row">
          <label>棄權方（判負）</label>
          <select id="tmr-walkover-loser">
            <option value="${escapeHTML(recordState.awayTeamId)}" ${match.walkoverWinnerTeamId === recordState.homeTeamId ? 'selected' : ''}>${escapeHTML(recordState.awayName)}</option>
            <option value="${escapeHTML(recordState.homeTeamId)}" ${match.walkoverWinnerTeamId === recordState.awayTeamId ? 'selected' : ''}>${escapeHTML(recordState.homeName)}</option>
          </select>
          <div class="ce-field-note">棄權判 ${config.walkoverWinScore}:${config.walkoverLoseScore}，計入積分榜但不計入射手榜。</div>
        </div>
      </div>`;
    const canClear = (match.status === 'finished' || match.status === 'walkover') && this._canManageTournamentRecord?.(tournament);
    actions.innerHTML = `
      ${canClear ? `<button class="outline-btn tc-clear-btn" type="button" onclick="return App.clearTournamentMatchResult(this)">清除結果</button>` : ''}
      <button class="outline-btn" type="button" data-action="close" onclick="App.closeTournamentMatchRecordModal()">取消</button>
      <button class="primary-btn" type="button" id="tmr-save-btn" onclick="return App.saveTournamentMatchResult(this)">儲存結果</button>`;
    this._syncTournamentMatchRecordResultType();
    this._syncTournamentMatchRecordPlayers();
    this._renderTournamentMatchRecordEvents();
  },

  _syncTournamentMatchRecordResultType() {
    const type = document.getElementById('tmr-result-type')?.value || 'finished';
    const scoreSection = document.getElementById('tmr-score-section');
    const walkoverSection = document.getElementById('tmr-walkover-section');
    if (scoreSection) scoreSection.style.display = type === 'walkover' ? 'none' : '';
    if (walkoverSection) walkoverSection.style.display = type === 'walkover' ? '' : 'none';
  },

  _syncTournamentMatchRecordPlayers() {
    const recordState = this._tournamentMatchRecordState;
    const teamSelect = document.getElementById('tmr-event-team');
    const playerSelect = document.getElementById('tmr-event-player');
    const customInput = document.getElementById('tmr-event-player-custom');
    if (!recordState || !teamSelect || !playerSelect) return;
    const state = this._getFriendlyTournamentState?.(recordState.tournamentId);
    const entry = (state?.entries || []).find(item => item.teamId === teamSelect.value);
    const roster = Array.isArray(entry?.memberRoster) ? entry.memberRoster : [];
    playerSelect.innerHTML = [
      ...roster.map(member => `<option value="${escapeHTML(member.uid)}" data-name="${escapeHTML(member.name || '')}">${escapeHTML(member.name || member.uid)}</option>`),
      '<option value="__custom__">其他（手動輸入）</option>',
    ].join('');
    playerSelect.onchange = () => {
      if (customInput) customInput.style.display = playerSelect.value === '__custom__' ? '' : 'none';
    };
    if (customInput) customInput.style.display = roster.length === 0 ? '' : 'none';
    if (roster.length === 0) playerSelect.value = '__custom__';
  },

  _addTournamentMatchRecordEvent() {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    const type = document.getElementById('tmr-event-type')?.value || 'goal';
    const teamId = document.getElementById('tmr-event-team')?.value || '';
    const playerSelect = document.getElementById('tmr-event-player');
    const customInput = document.getElementById('tmr-event-player-custom');
    const minuteRaw = Number(document.getElementById('tmr-event-minute')?.value);
    let uid = '';
    let name = '';
    if (playerSelect?.value && playerSelect.value !== '__custom__') {
      uid = playerSelect.value;
      name = playerSelect.selectedOptions?.[0]?.dataset?.name || '';
    } else {
      name = String(customInput?.value || '').trim();
    }
    if (!teamId || (!uid && !name)) {
      this.showToast('請選擇或輸入球員');
      return;
    }
    recordState.events.push({
      type, teamId, uid, name,
      minute: Number.isFinite(minuteRaw) && minuteRaw > 0 ? Math.floor(minuteRaw) : null,
    });
    if (customInput) customInput.value = '';
    const minuteInput = document.getElementById('tmr-event-minute');
    if (minuteInput) minuteInput.value = '';
    this._renderTournamentMatchRecordEvents();
  },

  _removeTournamentMatchRecordEvent(index) {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    recordState.events.splice(index, 1);
    this._renderTournamentMatchRecordEvents();
  },

  _renderTournamentMatchRecordEvents() {
    const recordState = this._tournamentMatchRecordState;
    const list = document.getElementById('tmr-events-list');
    if (!recordState || !list) return;
    const iconMap = { goal: '⚽', own_goal: '🥅', yellow: '🟨', red: '🟥' };
    const labelMap = { goal: '進球', own_goal: '烏龍球', yellow: '黃牌', red: '紅牌' };
    if (recordState.events.length === 0) {
      list.innerHTML = '<div class="tc-events-empty">尚未新增事件</div>';
      return;
    }
    list.innerHTML = recordState.events.map((ev, index) => {
      const teamName = ev.teamId === recordState.homeTeamId ? recordState.homeName : recordState.awayName;
      return `
      <div class="tc-event-row">
        <span>${iconMap[ev.type] || ''} ${labelMap[ev.type] || ev.type}${ev.minute ? ` ${ev.minute}'` : ''}</span>
        <span class="tc-event-player">${escapeHTML(ev.name || ev.uid)}</span>
        <span class="tc-event-team">${escapeHTML(teamName)}</span>
        <button type="button" class="tc-event-remove" onclick="App._removeTournamentMatchRecordEvent(${index})">✕</button>
      </div>`;
    }).join('');
  },

  async saveTournamentMatchResult(actionButton = null) {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    const type = document.getElementById('tmr-result-type')?.value || 'finished';
    const user = ApiService.getCurrentUser?.();
    let updates;
    if (type === 'walkover') {
      const loserTeamId = document.getElementById('tmr-walkover-loser')?.value || '';
      const winnerTeamId = loserTeamId === recordState.homeTeamId ? recordState.awayTeamId : recordState.homeTeamId;
      updates = {
        status: 'walkover', walkoverWinnerTeamId: winnerTeamId,
        scoreHome: null, scoreAway: null, pkHome: null, pkAway: null, events: [],
      };
    } else {
      const scoreHome = Math.max(0, Math.floor(Number(document.getElementById('tmr-score-home')?.value) || 0));
      const scoreAway = Math.max(0, Math.floor(Number(document.getElementById('tmr-score-away')?.value) || 0));
      const pkHomeRaw = document.getElementById('tmr-pk-home')?.value;
      const pkAwayRaw = document.getElementById('tmr-pk-away')?.value;
      const pkHome = pkHomeRaw !== '' && pkHomeRaw !== undefined ? Math.max(0, Math.floor(Number(pkHomeRaw) || 0)) : null;
      const pkAway = pkAwayRaw !== '' && pkAwayRaw !== undefined ? Math.max(0, Math.floor(Number(pkAwayRaw) || 0)) : null;
      if (recordState.isCup && scoreHome === scoreAway) {
        if (pkHome === null || pkAway === null || pkHome === pkAway) {
          this.showToast('淘汰賽平手需填寫 PK 結果（不可同分）');
          return;
        }
      }
      const goalEvents = recordState.events.filter(ev => ev.type === 'goal' || ev.type === 'own_goal');
      if (goalEvents.length > 0) {
        const homeGoals = recordState.events.filter(ev => (ev.type === 'goal' && ev.teamId === recordState.homeTeamId) || (ev.type === 'own_goal' && ev.teamId === recordState.awayTeamId)).length;
        const awayGoals = recordState.events.filter(ev => (ev.type === 'goal' && ev.teamId === recordState.awayTeamId) || (ev.type === 'own_goal' && ev.teamId === recordState.homeTeamId)).length;
        if ((homeGoals !== scoreHome || awayGoals !== scoreAway)
          && !(await this.appConfirm(`事件統計（${homeGoals}:${awayGoals}）與比分（${scoreHome}:${scoreAway}）不一致，仍要儲存？`))) return;
      }
      updates = {
        status: 'finished', scoreHome, scoreAway,
        pkHome: recordState.isCup ? pkHome : null, pkAway: recordState.isCup ? pkAway : null,
        walkoverWinnerTeamId: '', events: recordState.events,
      };
    }
    updates.recordedByUid = user?.uid || '';
    updates.recordedByName = user?.displayName || user?.name || '';
    updates.recordedAt = new Date().toISOString();
    const save = async () => {
      await ApiService.updateTournamentMatchAwait(recordState.tournamentId, recordState.matchId, updates);
      ApiService._writeOpLog?.('tourn_score', '記錄比分', `賽事 ${recordState.tournamentId} 比賽 ${recordState.matchId} → ${type === 'walkover' ? '棄權' : `${updates.scoreHome}:${updates.scoreAway}`}`);
      this.closeTournamentMatchRecordModal();
      await this._refreshTournamentCompetitionMatches?.(recordState.tournamentId);
      if (document.getElementById('tournament-schedule-overlay')?.classList.contains('open')) {
        this._renderTournamentScheduleManager?.();
      }
      this.showToast('比賽結果已儲存');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
    } catch (err) {
      this._showTournamentActionError?.('記錄比賽結果', err);
    }
  },

  async clearTournamentMatchResult(actionButton = null) {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    if (!(await this.appConfirm('確定清除此場比賽結果？事件記錄會一併移除。'))) return;
    const clear = async () => {
      await ApiService.updateTournamentMatchAwait(recordState.tournamentId, recordState.matchId, {
        status: 'scheduled', scoreHome: null, scoreAway: null, pkHome: null, pkAway: null,
        walkoverWinnerTeamId: '', events: [],
        recordedByUid: '', recordedByName: '', recordedAt: '',
      });
      this.closeTournamentMatchRecordModal();
      await this._refreshTournamentCompetitionMatches?.(recordState.tournamentId);
      this.showToast('已清除比賽結果');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '清除中...', clear);
      } else {
        await clear();
      }
    } catch (err) {
      this._showTournamentActionError?.('清除比賽結果', err);
    }
  },

});
