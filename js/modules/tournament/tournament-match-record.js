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
          <h3 id="tmr-title">更新賽況</h3>
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
    this.closeTournamentMatchBriefingModal?.();
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
    const [homeTeam, awayTeam] = await Promise.all([
      this._loadTournamentMatchRecordTeamInfo(home.teamId),
      this._loadTournamentMatchRecordTeamInfo(away.teamId),
    ]);
    this._tournamentMatchRecordState = {
      tournamentId: safeId,
      matchId: match.id,
      tournament: { ...tournament },
      match: { ...match },
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeName: home.label,
      awayName: away.label,
      homeTeam: homeTeam || {},
      awayTeam: awayTeam || {},
      events: (match.events || []).map(ev => ({ ...ev })),
      liveUrl: String(match.liveUrl || '').trim(),
      isCup: match.stage !== 'league',
    };
    const overlay = this._ensureTournamentMatchRecordModal();
    this._renderTournamentMatchRecordBody(tournament, match);
    overlay.classList.add('open');
    document.getElementById('tournament-match-record-modal')?.classList.add('open');
  },

  async _loadTournamentMatchRecordTeamInfo(teamId) {
    const safeId = String(teamId || '').trim();
    if (!safeId || typeof ApiService.getTeam !== 'function') return null;
    try {
      return await ApiService.getTeam(safeId);
    } catch (_) {
      return null;
    }
  },

  _ensureTournamentMatchBriefingModal() {
    let overlay = document.getElementById('tournament-match-briefing-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tournament-match-briefing-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal tc-briefing-modal" id="tournament-match-briefing-modal">
        <div class="modal-header">
          <h3 id="tmr-briefing-title">賽事簡報</h3>
          <button class="modal-close" type="button" data-action="close">×</button>
        </div>
        <div class="modal-body" id="tmr-briefing-body"></div>
        <div class="modal-actions tmr-briefing-actions">
          <button class="outline-btn" type="button" data-action="close">關閉</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this.closeTournamentMatchBriefingModal();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  closeTournamentMatchBriefingModal() {
    document.getElementById('tournament-match-briefing-overlay')?.classList.remove('open');
    document.getElementById('tournament-match-briefing-modal')?.classList.remove('open');
  },

  openTournamentMatchEventBriefing() {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) {
      this.showToast?.('尚未載入賽事紀錄');
      return;
    }
    const overlay = this._ensureTournamentMatchBriefingModal();
    const title = document.getElementById('tmr-briefing-title');
    const body = document.getElementById('tmr-briefing-body');
    if (title) title.textContent = `${recordState.homeName || '主隊'} vs ${recordState.awayName || '客隊'} 賽事簡報`;
    if (body) body.innerHTML = this._buildTournamentMatchBriefingHtml(recordState);
    overlay.classList.add('open');
    document.getElementById('tournament-match-briefing-modal')?.classList.add('open');
  },

  _escapeTournamentMatchBriefingText(value) {
    const text = String(value ?? '');
    if (typeof escapeHTML === 'function') return escapeHTML(text);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, ch => map[ch]);
  },

  _getTournamentMatchBriefingTeamName(teamId, recordState = this._tournamentMatchRecordState) {
    const safeId = String(teamId || '').trim();
    if (!safeId) return '全場';
    if (safeId === String(recordState?.homeTeamId || '')) return recordState?.homeName || '主隊';
    if (safeId === String(recordState?.awayTeamId || '')) return recordState?.awayName || '客隊';
    return '未知隊伍';
  },

  _getTournamentMatchBriefingScoreText(recordState = this._tournamentMatchRecordState) {
    const match = recordState?.match || {};
    const doc = typeof document !== 'undefined' ? document : null;
    const resultType = doc?.querySelector?.('input[name="tmr-result-type"]:checked')?.value
      || (match.status === 'walkover' ? 'walkover' : match.status === 'finished' ? 'finished' : 'scheduled');
    if (resultType === 'walkover') return '棄賽判定';
    if (resultType === 'scheduled') {
      const domHome = doc?.getElementById?.('tmr-score-home')?.value;
      const domAway = doc?.getElementById?.('tmr-score-away')?.value;
      if (!domHome && !domAway && match.scoreHome == null && match.scoreAway == null) return '即時更新';
    }
    const domHome = doc?.getElementById?.('tmr-score-home')?.value;
    const domAway = doc?.getElementById?.('tmr-score-away')?.value;
    const home = domHome !== undefined && domHome !== null && domHome !== '' ? domHome : match.scoreHome;
    const away = domAway !== undefined && domAway !== null && domAway !== '' ? domAway : match.scoreAway;
    if (home === undefined || home === null || away === undefined || away === null) return '尚未輸入';
    return `${home} : ${away}`;
  },

  _getTournamentMatchBriefingStatusText(recordState = this._tournamentMatchRecordState) {
    const match = recordState?.match || {};
    const doc = typeof document !== 'undefined' ? document : null;
    const resultType = doc?.querySelector?.('input[name="tmr-result-type"]:checked')?.value
      || (match.status === 'walkover' ? 'walkover' : match.status === 'finished' ? 'finished' : 'scheduled');
    if (resultType === 'walkover') return '棄賽完賽';
    return resultType === 'finished' ? '已完賽' : '即時更新中';
  },

  _getTournamentMatchBriefingRoster(teamId, recordState = this._tournamentMatchRecordState) {
    const state = this._getFriendlyTournamentState?.(recordState?.tournamentId);
    const entry = (state?.entries || []).find(item => String(item?.teamId || item?.id || '').trim() === String(teamId || '').trim());
    const roster = Array.isArray(entry?.memberRoster) ? entry.memberRoster : [];
    return roster
      .map(member => this._formatFriendlyTournamentRosterMemberName?.(member)
        || (member?.jerseyNumber || member?.number ? `${member.jerseyNumber || member.number}-${member.name || member.displayName || member.nickname || member.uid || ''}` : member?.name || member?.displayName || member?.nickname || member?.uid || ''))
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 40);
  },

  _formatTournamentMatchBriefingPerson(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (typeof value !== 'object') return '';
    const jersey = String(value.jerseyNumber || value.number || '').trim();
    const name = String(value.name || value.displayName || value.nickname || value.nickName || value.title || value.uid || value.id || '').trim();
    return jersey && name ? `${jersey}-${name}` : name;
  },

  _collectTournamentMatchBriefingPeople(...values) {
    const labels = [];
    const visit = value => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value === 'object') {
        const label = this._formatTournamentMatchBriefingPerson(value);
        if (label) {
          labels.push(label);
          return;
        }
        Object.values(value).forEach(visit);
        return;
      }
      const label = this._formatTournamentMatchBriefingPerson(value);
      if (label) labels.push(label);
    };
    values.forEach(visit);
    return [...new Set(labels.map(item => String(item).trim()).filter(Boolean))].slice(0, 30);
  },

  _renderTournamentMatchBriefingPersonChips(labels, emptyText = '尚未設定') {
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    if (!Array.isArray(labels) || labels.length === 0) {
      return `<span class="tmr-briefing-empty">${safe(emptyText)}</span>`;
    }
    return labels.map(label => `<span class="tmr-briefing-chip">${safe(label)}</span>`).join('');
  },

  _renderTournamentMatchBriefingStaff(teamInfo) {
    const roles = [
      {
        label: '教練',
        people: this._collectTournamentMatchBriefingPeople(teamInfo?.coaches, teamInfo?.coachNames, teamInfo?.coachName, teamInfo?.coachUids, teamInfo?.coachUid, teamInfo?.coach),
      },
      {
        label: '領隊',
        people: this._collectTournamentMatchBriefingPeople(teamInfo?.leaders, teamInfo?.leaderNames, teamInfo?.leaderName, teamInfo?.leaderUids, teamInfo?.leaderUid, teamInfo?.leader),
      },
      {
        label: '隊長',
        people: this._collectTournamentMatchBriefingPeople(teamInfo?.captains, teamInfo?.captainName, teamInfo?.captainUid, teamInfo?.captain),
      },
    ];
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    return roles.map(role => `
      <div class="tmr-briefing-info-row">
        <span>${safe(role.label)}</span>
        <div>${this._renderTournamentMatchBriefingPersonChips(role.people, '未登錄')}</div>
      </div>`).join('');
  },

  _renderTournamentMatchBriefingReferees(recordState = this._tournamentMatchRecordState) {
    const match = recordState?.match || {};
    const tournament = recordState?.tournament || {};
    const assignedRefs = this._collectTournamentMatchBriefingPeople(match.referees, match.refereeNames, match.refereeName, match.refereeUids, match.refereeUid);
    const heads = this._collectTournamentMatchBriefingPeople(match.refereeHead, match.refereeHeadName, match.refereeHeadUid, tournament.refereeHead, tournament.refereeHeadName, tournament.refereeHeadUid);
    const poolRefs = this._collectTournamentMatchBriefingPeople(tournament.referees, tournament.refereeNames, tournament.refereeUids, tournament.refereeUid);
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    return `
      <section class="tmr-briefing-section">
        <div class="tmr-briefing-section-title">
          <strong>裁判資訊</strong>
          <span>本場指派與賽事裁判</span>
        </div>
        <div class="tmr-briefing-info-row">
          <span>裁判長</span>
          <div>${this._renderTournamentMatchBriefingPersonChips(heads, '未設定')}</div>
        </div>
        <div class="tmr-briefing-info-row">
          <span>本場裁判</span>
          <div>${this._renderTournamentMatchBriefingPersonChips(assignedRefs, '未指派')}</div>
        </div>
        <div class="tmr-briefing-info-row">
          <span>裁判名單</span>
          <div>${this._renderTournamentMatchBriefingPersonChips(poolRefs, '未建立')}</div>
        </div>
      </section>`;
  },

  _renderTournamentMatchBriefingTeamCard(teamId, teamName, teamInfo, recordState = this._tournamentMatchRecordState) {
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    const roster = this._getTournamentMatchBriefingRoster(teamId, recordState);
    return `
      <article class="tmr-briefing-team-card">
        <div class="tmr-briefing-team-head">
          <strong>${safe(teamName)}</strong>
          <span>${roster.length} 人登錄</span>
        </div>
        ${this._renderTournamentMatchBriefingStaff(teamInfo || {})}
        <div class="tmr-briefing-roster">
          ${this._renderTournamentMatchBriefingPersonChips(roster, '尚無登錄球員')}
        </div>
      </article>`;
  },

  _getTournamentMatchEventLabel(type) {
    return {
      goal: '進球',
      own_goal: '烏龍球',
      yellow: '黃牌',
      red: '紅牌',
      stoppage_time: '補時公告',
      substitution: '換人',
    }[type] || String(type || '事件');
  },

  _getTournamentMatchEventIcon(type) {
    return {
      goal: '⚽',
      own_goal: '🥅',
      yellow: '🟨',
      red: '🟥',
      stoppage_time: '⏱',
      substitution: '↔',
    }[type] || '•';
  },

  _getTournamentMatchEventBriefingDetail(ev, recordState = this._tournamentMatchRecordState) {
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    const playerName = String(ev?.name || ev?.uid || '').trim();
    const note = String(ev?.note || '').trim();
    if (ev?.type === 'substitution') {
      const playersOut = Array.isArray(ev.playersOut) ? ev.playersOut.filter(Boolean) : [];
      const playersIn = Array.isArray(ev.playersIn) ? ev.playersIn.filter(Boolean) : [];
      return `
        <div class="tmr-briefing-event-lines">
          <span>下場：${safe(playersOut.join('、') || '-')}</span>
          <span>上場：${safe(playersIn.join('、') || '-')}</span>
          ${note ? `<span>備註：${safe(note)}</span>` : ''}
        </div>`;
    }
    if (ev?.type === 'stoppage_time') {
      return `
        <div class="tmr-briefing-event-lines">
          <span>宣布補時：${ev.minute ? `${safe(ev.minute)} 分鐘` : '未填分鐘'}</span>
          ${note ? `<span>備註：${safe(note)}</span>` : ''}
        </div>`;
    }
    const teamName = this._getTournamentMatchBriefingTeamName(ev?.teamId, recordState);
    return `
      <div class="tmr-briefing-event-lines">
        <span>隊伍：${safe(teamName)}</span>
        <span>球員：${safe(playerName || '未填球員')}</span>
        ${(ev?.type === 'yellow' || ev?.type === 'red') && note ? `<span>原因：${safe(note)}</span>` : ''}
      </div>`;
  },

  _renderTournamentMatchEventBriefingTimeline(recordState = this._tournamentMatchRecordState) {
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    const events = Array.isArray(recordState?.events) ? recordState.events : [];
    if (!events.length) {
      return '<div class="tmr-briefing-empty-panel">尚未新增比賽事件</div>';
    }
    return events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => {
        const minuteA = Number.isFinite(Number(a.event?.minute)) ? Number(a.event.minute) : 9999;
        const minuteB = Number.isFinite(Number(b.event?.minute)) ? Number(b.event.minute) : 9999;
        return minuteA === minuteB ? a.index - b.index : minuteA - minuteB;
      })
      .map(({ event, index }) => {
        const label = this._getTournamentMatchEventLabel(event?.type);
        const icon = this._getTournamentMatchEventIcon(event?.type);
        const teamName = event?.type === 'stoppage_time'
          ? '全場'
          : this._getTournamentMatchBriefingTeamName(event?.teamId, recordState);
        const time = event?.type === 'stoppage_time'
          ? (event?.minute ? `補時 ${event.minute} 分鐘` : '未填補時')
          : (event?.minute ? `第 ${event.minute} 分鐘` : '未填時間');
        return `
          <article class="tmr-briefing-event">
            <div class="tmr-briefing-event-time">${safe(time)}</div>
            <div class="tmr-briefing-event-card">
              <div class="tmr-briefing-event-title">
                <span>${safe(icon)}</span>
                <strong>${safe(label)}</strong>
                <em>${safe(teamName)}</em>
                <small>#${index + 1}</small>
              </div>
              ${this._getTournamentMatchEventBriefingDetail(event, recordState)}
            </div>
          </article>`;
      }).join('');
  },

  _buildTournamentMatchBriefingHtml(recordState = this._tournamentMatchRecordState) {
    const safe = value => this._escapeTournamentMatchBriefingText(value);
    if (!recordState) {
      return '<div class="tmr-briefing-empty-panel">尚未載入賽事資料</div>';
    }
    const events = Array.isArray(recordState.events) ? recordState.events : [];
    const scoreText = this._getTournamentMatchBriefingScoreText(recordState);
    const statusText = this._getTournamentMatchBriefingStatusText(recordState);
    return `
      <div class="tmr-briefing-shell">
        <section class="tmr-briefing-hero">
          <div>
            <span>賽事總結</span>
            <strong>${safe(recordState.homeName || '主隊')} vs ${safe(recordState.awayName || '客隊')}</strong>
          </div>
          <div class="tmr-briefing-score">
            <b>${safe(scoreText)}</b>
            <small>${safe(statusText)}</small>
          </div>
        </section>
        <section class="tmr-briefing-stats">
          <article>
            <span>事件數</span>
            <strong>${events.length}</strong>
          </article>
          <article>
            <span>牌卡</span>
            <strong>${events.filter(ev => ev.type === 'yellow' || ev.type === 'red').length}</strong>
          </article>
          <article>
            <span>換人</span>
            <strong>${events.filter(ev => ev.type === 'substitution').length}</strong>
          </article>
        </section>
        <section class="tmr-briefing-section">
          <div class="tmr-briefing-section-title">
            <strong>事件時間軸</strong>
            <span>依發生分鐘排序</span>
          </div>
          <div class="tmr-briefing-timeline">
            ${this._renderTournamentMatchEventBriefingTimeline(recordState)}
          </div>
        </section>
        <section class="tmr-briefing-section">
          <div class="tmr-briefing-section-title">
            <strong>參賽隊伍</strong>
            <span>登錄球員與俱樂部職務</span>
          </div>
          <div class="tmr-briefing-teams">
            ${this._renderTournamentMatchBriefingTeamCard(recordState.homeTeamId, recordState.homeName || '主隊', recordState.homeTeam || {}, recordState)}
            ${this._renderTournamentMatchBriefingTeamCard(recordState.awayTeamId, recordState.awayName || '客隊', recordState.awayTeam || {}, recordState)}
          </div>
        </section>
        ${this._renderTournamentMatchBriefingReferees(recordState)}
      </div>`;
  },

  _renderTournamentMatchRecordBody(tournament, match) {
    const recordState = this._tournamentMatchRecordState;
    const body = document.getElementById('tmr-body');
    const actions = document.getElementById('tmr-actions');
    const title = document.getElementById('tmr-title');
    if (!recordState || !body || !actions) return;
    const config = this._getTournamentCompetitionConfig?.(tournament) || {};
    const isWalkover = match.status === 'walkover';
    const isFinished = match.status === 'finished';
    const walkoverScoreText = `${config.walkoverWinScore}:${config.walkoverLoseScore}`;
    if (title) {
      title.className = 'tmr-title tmr-title-redesigned';
      title.innerHTML = `
        <span class="tmr-title-kicker">更新賽況</span>
        <span class="tmr-title-matchup">
          <span class="tmr-title-team tmr-title-pill">${escapeHTML(recordState.homeName || '')}</span>
          <span class="tmr-title-vs">VS</span>
          <span class="tmr-title-team tmr-title-pill">${escapeHTML(recordState.awayName || '')}</span>
        </span>`;
    }
    body.innerHTML = `
      <div class="tmr-result-switch" role="radiogroup" aria-label="結果類型">
        <label class="tmr-result-card">
          <input type="radio" name="tmr-result-type" value="scheduled" onchange="App._syncTournamentMatchRecordResultType()" ${!isWalkover && !isFinished ? 'checked' : ''}>
          <span class="tmr-result-card-copy">
            <strong>即時更新</strong>
            <small>更新比分、事件或直播，不計入積分榜</small>
          </span>
        </label>
        <label class="tmr-result-card">
          <input type="radio" name="tmr-result-type" value="finished" onchange="App._syncTournamentMatchRecordResultType()" ${isFinished ? 'checked' : ''}>
          <span class="tmr-result-card-copy">
            <strong>正常完賽</strong>
            <small>儲存後計入積分榜與淘汰賽晉級</small>
          </span>
        </label>
        <label class="tmr-result-card">
          <input type="radio" name="tmr-result-type" value="walkover" onchange="App._syncTournamentMatchRecordResultType()" ${isWalkover ? 'checked' : ''}>
          <span class="tmr-result-card-copy">
            <strong>棄權判定</strong>
            <small>依賽事設定判 ${escapeHTML(walkoverScoreText)}</small>
          </span>
        </label>
      </div>
      <div class="tmr-live-card">
        <div class="tmr-section-head">
          <strong>直播網址</strong>
          <small>YouTube / Twitch 可嵌入，其他網址會提供外開連結</small>
        </div>
        <input type="url" id="tmr-live-url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." value="${escapeHTML(recordState.liveUrl || '')}">
      </div>
      <div id="tmr-score-section" class="tmr-score-card">
        <div class="tmr-section-head">
          <strong>比分</strong>
          <small>左右隊伍對應賽程卡片順序</small>
        </div>
        <div class="tc-score-grid tmr-score-grid">
          <div class="tc-score-side">
            <div class="tc-score-team">${escapeHTML(recordState.homeName)}</div>
            <input type="number" id="tmr-score-home" min="0" max="99" inputmode="numeric" value="${Number.isFinite(Number(match.scoreHome)) && match.scoreHome !== null ? match.scoreHome : ''}" placeholder="0">
          </div>
          <div class="tc-score-divider">:</div>
          <div class="tc-score-side">
            <div class="tc-score-team">${escapeHTML(recordState.awayName)}</div>
            <input type="number" id="tmr-score-away" min="0" max="99" inputmode="numeric" value="${Number.isFinite(Number(match.scoreAway)) && match.scoreAway !== null ? match.scoreAway : ''}" placeholder="0">
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
          <div class="tmr-section-head">
            <strong>比賽事件</strong>
            <small>進球、烏龍、紅黃牌、補時與換人可選填</small>
          </div>
          <button type="button" class="outline-btn small tmr-briefing-open-btn" onclick="App.openTournamentMatchEventBriefing()">查看簡報</button>
          <div id="tmr-events-list"></div>
          <div class="tc-event-add tmr-event-add-grid">
            <label class="tmr-event-control">
              <span>事件</span>
              <select id="tmr-event-type" onchange="App._syncTournamentMatchRecordEventFields()">
                <option value="goal">⚽ 進球</option>
                <option value="own_goal">🥅 烏龍球</option>
                <option value="yellow">🟨 黃牌</option>
                <option value="red">🟥 紅牌</option>
                <option value="stoppage_time">⏱ 補時公告</option>
                <option value="substitution">↔ 換人</option>
              </select>
            </label>
            <label class="tmr-event-control tmr-event-control-team">
              <span>隊伍</span>
              <select id="tmr-event-team" onchange="App._syncTournamentMatchRecordTeamSelection()">
                <option value="${escapeHTML(recordState.homeTeamId)}">${escapeHTML(recordState.homeName)}</option>
                <option value="${escapeHTML(recordState.awayTeamId)}">${escapeHTML(recordState.awayName)}</option>
              </select>
            </label>
            <label class="tmr-event-control tmr-event-control-player">
              <span>球員</span>
              <select id="tmr-event-player"></select>
              <input type="text" id="tmr-event-player-custom" placeholder="輸入球員名" style="display:none">
            </label>
            <label class="tmr-event-control tmr-event-control-sub tmr-event-control-sub-out" style="display:none">
              <span>下場球員</span>
              <input type="search" id="tmr-event-sub-out-search" class="tmr-event-sub-search" placeholder="搜尋背號或暱稱" autocomplete="off" oninput="App._renderTournamentSubstitutionSearch('out')" onfocus="App._renderTournamentSubstitutionSearch('out')">
              <div id="tmr-event-sub-out-suggestions" class="tmr-sub-suggestions"></div>
              <textarea id="tmr-event-sub-out" rows="2" maxlength="240" placeholder="可用逗號或換行，最多20人"></textarea>
            </label>
            <label class="tmr-event-control tmr-event-control-sub tmr-event-control-sub-in" style="display:none">
              <span>上場球員</span>
              <input type="search" id="tmr-event-sub-in-search" class="tmr-event-sub-search" placeholder="搜尋背號或暱稱" autocomplete="off" oninput="App._renderTournamentSubstitutionSearch('in')" onfocus="App._renderTournamentSubstitutionSearch('in')">
              <div id="tmr-event-sub-in-suggestions" class="tmr-sub-suggestions"></div>
              <textarea id="tmr-event-sub-in" rows="2" maxlength="240" placeholder="可用逗號或換行，最多20人"></textarea>
            </label>
            <label class="tmr-event-control tmr-event-control-minute">
              <span>時間</span>
              <input type="number" id="tmr-event-minute" min="1" max="150" placeholder="分" inputmode="numeric">
            </label>
            <label class="tmr-event-control tmr-event-control-note" style="display:none">
              <span>備註</span>
              <input type="text" id="tmr-event-note" maxlength="60" placeholder="原因或補時時間">
            </label>
            <button type="button" class="outline-btn small tmr-event-add-btn" onclick="App._addTournamentMatchRecordEvent()">加入</button>
          </div>
        </div>
      </div>
      <div id="tmr-walkover-section" class="tmr-walkover-card" style="display:none">
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
      <button class="primary-btn" type="button" id="tmr-save-btn" onclick="return App.saveTournamentMatchResult(this)">儲存賽況</button>`;
    this._syncTournamentMatchRecordResultType();
    this._syncTournamentMatchRecordPlayers();
    this._syncTournamentMatchRecordEventFields();
    this._renderTournamentMatchRecordEvents();
  },

  _syncTournamentMatchRecordResultType() {
    const type = document.querySelector('input[name="tmr-result-type"]:checked')?.value
      || document.getElementById('tmr-result-type')?.value
      || 'scheduled';
    const scoreSection = document.getElementById('tmr-score-section');
    const walkoverSection = document.getElementById('tmr-walkover-section');
    if (scoreSection) scoreSection.style.display = type === 'walkover' ? 'none' : '';
    if (walkoverSection) walkoverSection.style.display = type === 'walkover' ? '' : 'none';
  },

  _syncTournamentMatchRecordTeamSelection() {
    this._syncTournamentMatchRecordPlayers();
    this._syncTournamentMatchRecordSubstitutionSearches();
  },

  _syncTournamentMatchRecordEventFields() {
    const type = document.getElementById('tmr-event-type')?.value || 'goal';
    const teamControl = document.querySelector('.tmr-event-control-team');
    const playerControl = document.querySelector('.tmr-event-control-player');
    const subControls = document.querySelectorAll('.tmr-event-control-sub');
    const noteControl = document.querySelector('.tmr-event-control-note');
    const minuteLabel = document.querySelector('.tmr-event-control-minute span');
    const noteInput = document.getElementById('tmr-event-note');
    const isSinglePlayer = ['goal', 'own_goal', 'yellow', 'red'].includes(type);
    const isSubstitution = type === 'substitution';
    const isStoppage = type === 'stoppage_time';
    if (teamControl) teamControl.style.display = isStoppage ? 'none' : '';
    if (playerControl) playerControl.style.display = isSinglePlayer ? '' : 'none';
    subControls.forEach(node => { node.style.display = isSubstitution ? '' : 'none'; });
    if (noteControl) noteControl.style.display = (type === 'yellow' || type === 'red' || isStoppage || isSubstitution) ? '' : 'none';
    if (minuteLabel) minuteLabel.textContent = isStoppage ? '公告時間' : '時間';
    if (noteInput) {
      noteInput.placeholder = isStoppage
        ? '例如：補時 5 分鐘'
        : isSubstitution
          ? '換人備註'
          : '吃牌原因';
    }
    this._syncTournamentMatchRecordPlayers();
    this._syncTournamentMatchRecordSubstitutionSearches();
  },

  _syncTournamentMatchRecordPlayers() {
    const recordState = this._tournamentMatchRecordState;
    const teamSelect = document.getElementById('tmr-event-team');
    const playerSelect = document.getElementById('tmr-event-player');
    const customInput = document.getElementById('tmr-event-player-custom');
    if (!recordState || !teamSelect || !playerSelect) return;
    const type = document.getElementById('tmr-event-type')?.value || 'goal';
    if (!['goal', 'own_goal', 'yellow', 'red'].includes(type)) return;
    const state = this._getFriendlyTournamentState?.(recordState.tournamentId);
    const entry = (state?.entries || []).find(item => item.teamId === teamSelect.value);
    const roster = Array.isArray(entry?.memberRoster) ? entry.memberRoster : [];
    playerSelect.innerHTML = [
      ...roster.map(member => `<option value="${escapeHTML(member.uid)}" data-name="${escapeHTML(member.name || '')}">${escapeHTML(this._formatFriendlyTournamentRosterMemberName?.(member) || member.name || member.uid)}</option>`),
      '<option value="__custom__">其他（手動輸入）</option>',
    ].join('');
    playerSelect.onchange = () => {
      if (customInput) customInput.style.display = playerSelect.value === '__custom__' ? '' : 'none';
    };
    if (customInput) customInput.style.display = roster.length === 0 ? '' : 'none';
    if (roster.length === 0) playerSelect.value = '__custom__';
  },

  _normalizeTournamentMatchRecordSearchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  },

  _isTournamentMatchRecordFuzzyMatch(text, query) {
    const safeText = this._normalizeTournamentMatchRecordSearchText(text);
    const safeQuery = this._normalizeTournamentMatchRecordSearchText(query);
    if (!safeQuery) return true;
    if (safeText.includes(safeQuery)) return true;
    let cursor = 0;
    for (const char of safeText) {
      if (char === safeQuery[cursor]) cursor += 1;
      if (cursor >= safeQuery.length) return true;
    }
    return false;
  },

  _getTournamentSubstitutionRosterOptions(teamId = null) {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return [];
    const selectedTeamId = String(teamId || document.getElementById('tmr-event-team')?.value || '').trim();
    if (!selectedTeamId) return [];
    const state = this._getFriendlyTournamentState?.(recordState.tournamentId);
    const entry = (state?.entries || []).find(item => String(item?.teamId || item?.id || '').trim() === selectedTeamId);
    const roster = Array.isArray(entry?.memberRoster) ? entry.memberRoster : [];
    return roster
      .map(member => {
        const uid = String(member?.uid || '').trim();
        const rawName = String(member?.name || member?.displayName || member?.nickname || member?.nickName || uid || '').trim();
        const jerseyNumber = String(member?.jerseyNumber || member?.number || '').trim();
        const displayName = this._formatFriendlyTournamentRosterMemberName?.(member)
          || (jerseyNumber ? `${jerseyNumber}-${rawName || uid}` : rawName || uid);
        const searchText = [
          displayName,
          rawName,
          member?.displayName,
          member?.nickname,
          member?.nickName,
          jerseyNumber,
          uid,
        ].filter(Boolean).join(' ');
        return { uid, label: String(displayName || rawName || uid || '').trim(), searchText };
      })
      .filter(item => item.label);
  },

  _getTournamentSubstitutionPlayerSuggestions(side = 'out') {
    const safeSide = side === 'in' ? 'in' : 'out';
    const query = document.getElementById(`tmr-event-sub-${safeSide}-search`)?.value || '';
    const options = this._getTournamentSubstitutionRosterOptions();
    const normalizedQuery = this._normalizeTournamentMatchRecordSearchText(query);
    return options
      .filter(option => !normalizedQuery || this._isTournamentMatchRecordFuzzyMatch(option.searchText, normalizedQuery))
      .slice(0, 8);
  },

  _renderTournamentSubstitutionSearch(side = 'out') {
    const safeSide = side === 'in' ? 'in' : 'out';
    const box = document.getElementById(`tmr-event-sub-${safeSide}-suggestions`);
    if (!box) return;
    const suggestions = this._getTournamentSubstitutionPlayerSuggestions(safeSide);
    if (!suggestions.length) {
      box.innerHTML = '<span class="tmr-sub-empty">無符合名單</span>';
      return;
    }
    box.innerHTML = suggestions.map(option => {
      const safeLabel = escapeHTML(option.label);
      const jsLabel = escapeHTML(JSON.stringify(option.label));
      return `<button type="button" class="tmr-sub-suggestion" onclick="App._appendTournamentSubstitutionPlayer('${safeSide}', ${jsLabel})">${safeLabel}</button>`;
    }).join('');
  },

  _syncTournamentMatchRecordSubstitutionSearches() {
    const type = document.getElementById('tmr-event-type')?.value || 'goal';
    if (type !== 'substitution') {
      ['out', 'in'].forEach(side => {
        const box = document.getElementById(`tmr-event-sub-${side}-suggestions`);
        if (box) box.innerHTML = '';
      });
      return;
    }
    this._renderTournamentSubstitutionSearch('out');
    this._renderTournamentSubstitutionSearch('in');
  },

  _appendTournamentSubstitutionPlayer(side = 'out', playerName = '') {
    const safeSide = side === 'in' ? 'in' : 'out';
    const value = String(playerName || '').trim().slice(0, 30);
    const target = document.getElementById(`tmr-event-sub-${safeSide}`);
    if (!target || !value) return;
    const players = this._parseTournamentEventPlayerList(target.value);
    if (!players.includes(value)) players.push(value);
    target.value = players.slice(0, 20).join('\n');
    const searchInput = document.getElementById(`tmr-event-sub-${safeSide}-search`);
    const box = document.getElementById(`tmr-event-sub-${safeSide}-suggestions`);
    if (searchInput) searchInput.value = '';
    if (box) box.innerHTML = '';
  },

  _parseTournamentEventPlayerList(value) {
    const rawItems = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,，、/]+/);
    return rawItems
      .map(item => String(item || '').trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 20);
  },

  _addTournamentMatchRecordEvent() {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    const type = document.getElementById('tmr-event-type')?.value || 'goal';
    const teamId = document.getElementById('tmr-event-team')?.value || '';
    const playerSelect = document.getElementById('tmr-event-player');
    const customInput = document.getElementById('tmr-event-player-custom');
    const minuteRaw = Number(document.getElementById('tmr-event-minute')?.value);
    const minute = Number.isFinite(minuteRaw) && minuteRaw > 0 ? Math.floor(minuteRaw) : null;
    const note = String(document.getElementById('tmr-event-note')?.value || '').trim().slice(0, 60);
    if (type === 'stoppage_time') {
      if (!minute && !note) {
        this.showToast('請填寫補時公告時間或補時內容');
        return;
      }
      recordState.events.push({ type, teamId: '', uid: '', name: '', minute, note });
      const minuteInput = document.getElementById('tmr-event-minute');
      const noteInput = document.getElementById('tmr-event-note');
      if (minuteInput) minuteInput.value = '';
      if (noteInput) noteInput.value = '';
      this._renderTournamentMatchRecordEvents();
      return;
    }
    if (type === 'substitution') {
      const playersOut = this._parseTournamentEventPlayerList(document.getElementById('tmr-event-sub-out')?.value);
      const playersIn = this._parseTournamentEventPlayerList(document.getElementById('tmr-event-sub-in')?.value);
      if (!teamId || playersOut.length === 0 || playersIn.length === 0) {
        this.showToast('請選擇隊伍並填寫上場與下場球員');
        return;
      }
      recordState.events.push({ type, teamId, uid: '', name: '', minute, note, playersOut, playersIn });
      ['tmr-event-sub-out', 'tmr-event-sub-in', 'tmr-event-sub-out-search', 'tmr-event-sub-in-search', 'tmr-event-minute', 'tmr-event-note'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      ['tmr-event-sub-out-suggestions', 'tmr-event-sub-in-suggestions'].forEach(id => {
        const box = document.getElementById(id);
        if (box) box.innerHTML = '';
      });
      this._renderTournamentMatchRecordEvents();
      return;
    }
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
      minute,
      note: (type === 'yellow' || type === 'red') ? note : '',
    });
    if (customInput) customInput.value = '';
    const minuteInput = document.getElementById('tmr-event-minute');
    const noteInput = document.getElementById('tmr-event-note');
    if (minuteInput) minuteInput.value = '';
    if (noteInput) noteInput.value = '';
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
    const iconMap = { goal: '⚽', own_goal: '🥅', yellow: '🟨', red: '🟥', stoppage_time: '⏱', substitution: '↔' };
    const labelMap = { goal: '進球', own_goal: '烏龍球', yellow: '黃牌', red: '紅牌', stoppage_time: '補時公告', substitution: '換人' };
    if (recordState.events.length === 0) {
      list.innerHTML = '<div class="tc-events-empty">尚未新增事件</div>';
      return;
    }
    list.innerHTML = recordState.events.map((ev, index) => {
      const teamName = ev.teamId === recordState.homeTeamId ? recordState.homeName : recordState.awayName;
      const note = String(ev.note || '').trim();
      const eventText = `${iconMap[ev.type] || ''} ${labelMap[ev.type] || ev.type}${ev.minute ? ` ${ev.minute}'` : ''}`;
      let playerText = ev.name || ev.uid || '';
      if (ev.type === 'stoppage_time') {
        playerText = note || '補時時間待補';
      } else if (ev.type === 'substitution') {
        const playersIn = Array.isArray(ev.playersIn) ? ev.playersIn.join('、') : '';
        const playersOut = Array.isArray(ev.playersOut) ? ev.playersOut.join('、') : '';
        playerText = [`上場：${playersIn || '-'}`, `下場：${playersOut || '-'}`].join(' / ');
      } else if ((ev.type === 'yellow' || ev.type === 'red') && note) {
        playerText = `${playerText}（${note}）`;
      }
      return `
      <div class="tc-event-row tc-event-row-briefing" role="button" tabindex="0" onclick="App.openTournamentMatchEventBriefing()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openTournamentMatchEventBriefing();}">
        <span>${escapeHTML(eventText)}</span>
        <span class="tc-event-player">${escapeHTML(playerText)}</span>
        <span class="tc-event-team">${escapeHTML(ev.type === 'stoppage_time' ? '全場' : teamName)}</span>
        <button type="button" class="tc-event-remove" onclick="event.stopPropagation();App._removeTournamentMatchRecordEvent(${index})">✕</button>
      </div>`;
    }).join('');
  },

  async saveTournamentMatchResult(actionButton = null) {
    const recordState = this._tournamentMatchRecordState;
    if (!recordState) return;
    const type = document.querySelector('input[name="tmr-result-type"]:checked')?.value
      || document.getElementById('tmr-result-type')?.value
      || 'scheduled';
    const isCompleted = type === 'finished' || type === 'walkover';
    const liveUrl = String(document.getElementById('tmr-live-url')?.value || '').trim();
    const user = ApiService.getCurrentUser?.();
    let updates;
    if (type === 'walkover') {
      const loserTeamId = document.getElementById('tmr-walkover-loser')?.value || '';
      const winnerTeamId = loserTeamId === recordState.homeTeamId ? recordState.awayTeamId : recordState.homeTeamId;
      updates = {
        status: 'walkover', walkoverWinnerTeamId: winnerTeamId,
        scoreHome: null, scoreAway: null, pkHome: null, pkAway: null, events: [], liveUrl,
      };
    } else {
      const scoreHomeRaw = document.getElementById('tmr-score-home')?.value;
      const scoreAwayRaw = document.getElementById('tmr-score-away')?.value;
      const hasHomeScore = scoreHomeRaw !== '' && scoreHomeRaw !== undefined && scoreHomeRaw !== null;
      const hasAwayScore = scoreAwayRaw !== '' && scoreAwayRaw !== undefined && scoreAwayRaw !== null;
      const scoreHome = hasHomeScore ? Math.max(0, Math.floor(Number(scoreHomeRaw) || 0)) : null;
      const scoreAway = hasAwayScore ? Math.max(0, Math.floor(Number(scoreAwayRaw) || 0)) : null;
      const pkHomeRaw = document.getElementById('tmr-pk-home')?.value;
      const pkAwayRaw = document.getElementById('tmr-pk-away')?.value;
      const pkHome = pkHomeRaw !== '' && pkHomeRaw !== undefined ? Math.max(0, Math.floor(Number(pkHomeRaw) || 0)) : null;
      const pkAway = pkAwayRaw !== '' && pkAwayRaw !== undefined ? Math.max(0, Math.floor(Number(pkAwayRaw) || 0)) : null;
      if (isCompleted && (scoreHome === null || scoreAway === null)) {
        this.showToast('完賽需要填寫雙方比分');
        return;
      }
      if (isCompleted && recordState.isCup && scoreHome === scoreAway) {
        if (pkHome === null || pkAway === null || pkHome === pkAway) {
          this.showToast('淘汰賽平手需填寫 PK 結果（不可同分）');
          return;
        }
      }
      const goalEvents = recordState.events.filter(ev => ev.type === 'goal' || ev.type === 'own_goal');
      if (isCompleted && goalEvents.length > 0) {
        const homeGoals = recordState.events.filter(ev => (ev.type === 'goal' && ev.teamId === recordState.homeTeamId) || (ev.type === 'own_goal' && ev.teamId === recordState.awayTeamId)).length;
        const awayGoals = recordState.events.filter(ev => (ev.type === 'goal' && ev.teamId === recordState.awayTeamId) || (ev.type === 'own_goal' && ev.teamId === recordState.homeTeamId)).length;
        if ((homeGoals !== scoreHome || awayGoals !== scoreAway)
          && !(await this.appConfirm(`事件統計（${homeGoals}:${awayGoals}）與比分（${scoreHome}:${scoreAway}）不一致，仍要儲存？`))) return;
      }
      updates = {
        status: isCompleted ? 'finished' : 'scheduled', scoreHome, scoreAway,
        pkHome: recordState.isCup ? pkHome : null, pkAway: recordState.isCup ? pkAway : null,
        walkoverWinnerTeamId: '', events: recordState.events, liveUrl,
      };
    }
    updates.recordedByUid = user?.uid || '';
    updates.recordedByName = user?.displayName || user?.name || '';
    updates.recordedAt = new Date().toISOString();
    const save = async () => {
      await ApiService.updateTournamentMatchAwait(recordState.tournamentId, recordState.matchId, updates);
      ApiService._writeOpLog?.('tourn_score', '更新賽況', `賽事 ${recordState.tournamentId} 比賽 ${recordState.matchId} → ${type === 'walkover' ? '棄權' : `${updates.scoreHome ?? '-'}:${updates.scoreAway ?? '-'}`}`);
      this.closeTournamentMatchRecordModal();
      await this._refreshTournamentCompetitionMatches?.(recordState.tournamentId);
      if (document.getElementById('tournament-schedule-overlay')?.classList.contains('open')) {
        this._renderTournamentScheduleManager?.();
      }
      this.showToast('賽況已儲存');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
    } catch (err) {
      this._showTournamentActionError?.('更新賽況', err);
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
