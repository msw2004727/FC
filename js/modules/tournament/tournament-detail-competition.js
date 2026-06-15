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

  _getTournamentTeamLogoMap(state) {
    const logoById = {};
    const readPreferredLogo = item => String(
      item?.teamLogo
      || item?.teamAvatar
      || item?.avatarUrl
      || item?.logoUrl
      || item?.logo
      || item?.avatar
      || ''
    ).trim();
    const readAnyLogo = item => String(
      readPreferredLogo(item)
      || item?.teamImage
      || item?.image
      || item?.imageUrl
      || item?.coverImage
      || item?.coverUrl
      || ''
    ).trim();
    const writeLogo = (teamId, item, preferredOnly = false) => {
      const safeId = String(teamId || '').trim();
      if (!safeId || logoById[safeId]) return;
      const logo = preferredOnly ? readPreferredLogo(item) : readAnyLogo(item);
      if (logo) logoById[safeId] = logo;
    };
    (state?.entries || []).forEach(entry => writeLogo(entry?.teamId || entry?.id, entry, true));
    const collect = teamId => {
      const safeId = String(teamId || '').trim();
      if (!safeId || logoById[safeId]) return;
      const team = ApiService.getTeam?.(safeId);
      writeLogo(safeId, team);
    };
    (state?.matches || []).forEach(match => { collect(match.homeTeamId); collect(match.awayTeamId); });
    (state?.entries || []).forEach(entry => writeLogo(entry?.teamId || entry?.id, entry));
    return logoById;
  },

  _formatTournamentMatchTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getMonth() + 1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  },

  _formatTournamentMatchDateParts(value) {
    if (!value) return { date: '日期待定', time: '時間待定', iso: '' };
    let dt = null;
    if (typeof value?.toDate === 'function') dt = value.toDate();
    else if (typeof value?.toMillis === 'function') dt = new Date(value.toMillis());
    else dt = new Date(value);
    if (!dt || Number.isNaN(dt.getTime())) {
      const text = String(value || '').trim();
      return { date: text || '日期待定', time: '時間待定', iso: '' };
    }
    const pad = n => String(n).padStart(2, '0');
    return {
      date: `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())}`,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      iso: dt.toISOString(),
    };
  },

  _buildTournamentLiveEmbedUrl(rawUrl = '') {
    const source = String(rawUrl || '').trim();
    if (!source) return '';
    try {
      const url = new URL(source);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0] || '';
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
      }
      if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        const videoId = url.searchParams.get('v')
          || url.pathname.match(/\/(?:embed|live|shorts)\/([^/?#]+)/)?.[1]
          || '';
        return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : source;
      }
      if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const parent = encodeURIComponent(window.location.hostname || 'localhost');
        if (parts[0] === 'videos' && parts[1]) {
          return `https://player.twitch.tv/?video=${encodeURIComponent(parts[1])}&parent=${parent}`;
        }
        if (parts[0]) {
          return `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${parent}`;
        }
      }
      return source;
    } catch (_) {
      return '';
    }
  },

  _renderTournamentLiveFrameHtml(match, options = {}) {
    const liveUrl = String(match?.liveUrl || '').trim();
    const compact = options.compact === true;
    if (!liveUrl) {
      return `<div class="tc-match-live-placeholder">
        <span>LIVE</span>
        <small>直播尚未提供</small>
      </div>`;
    }
    const embedUrl = this._buildTournamentLiveEmbedUrl(liveUrl);
    let openUrl = '';
    try {
      const parsed = new URL(liveUrl);
      if (['http:', 'https:'].includes(parsed.protocol)) openUrl = parsed.href;
    } catch (_) {}
    const iframe = embedUrl
      ? `<iframe class="tc-match-live-frame" src="${escapeHTML(embedUrl)}" title="賽事直播" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
      : '';
    return `<div class="tc-match-live-box${compact ? ' compact' : ''}">
      ${iframe || `<div class="tc-match-live-placeholder"><span>LIVE</span><small>此網址不支援嵌入</small></div>`}
      ${openUrl ? `<a class="tc-match-live-open" href="${escapeHTML(openUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">開啟直播</a>` : ''}
    </div>`;
  },

  _getTournamentMatchEventLabel(type = '') {
    return {
      goal: '進球',
      own_goal: '烏龍球',
      yellow: '黃牌',
      red: '紅牌',
      stoppage_time: '補時公告',
      substitution: '換人',
    }[String(type || '').trim()] || '事件';
  },

  _getTournamentMatchEventIcon(type = '') {
    return {
      goal: '⚽',
      own_goal: 'OG',
      yellow: 'YC',
      red: 'RC',
      stoppage_time: 'ET',
      substitution: 'SUB',
    }[String(type || '').trim()] || 'EV';
  },

  _getTournamentMatchEventMeta(ev, teams = {}) {
    const type = String(ev?.type || '').trim();
    const minute = Number.isFinite(Number(ev?.minute)) && Number(ev.minute) > 0 ? `${Math.floor(Number(ev.minute))}'` : '';
    const teamName = teams[String(ev?.teamId || '').trim()] || (type === 'stoppage_time' ? '全場' : '');
    const note = String(ev?.note || '').trim();
    if (type === 'substitution') {
      const playersIn = Array.isArray(ev?.playersIn) ? ev.playersIn.join('、') : '';
      const playersOut = Array.isArray(ev?.playersOut) ? ev.playersOut.join('、') : '';
      return {
        title: [this._getTournamentMatchEventLabel(type), minute, teamName].filter(Boolean).join(' · '),
        body: [`上場：${playersIn || '-'}`, `下場：${playersOut || '-'}`, note].filter(Boolean).join(' / '),
      };
    }
    const body = String(ev?.name || ev?.uid || note || this._getTournamentMatchEventLabel(type)).trim();
    return {
      title: [this._getTournamentMatchEventLabel(type), minute, teamName].filter(Boolean).join(' · '),
      body: (type === 'yellow' || type === 'red') && note && body !== note ? `${body}（${note}）` : body,
    };
  },

  _renderTournamentMatchEventsTimeline(match, home, away) {
    const events = Array.isArray(match?.events) ? match.events : [];
    const teamNames = {
      [home.teamId]: home.label,
      [away.teamId]: away.label,
    };
    if (!events.length) {
      return '<div class="tc-match-detail-empty">尚未登錄即時事件</div>';
    }
    return `<div class="tc-match-detail-timeline">
      ${events.map(ev => {
        const type = String(ev?.type || '').trim();
        const safeType = type.replace(/[^a-z0-9_-]/gi, '') || 'event';
        const meta = this._getTournamentMatchEventMeta(ev, teamNames);
        return `<div class="tc-match-detail-event tc-match-detail-event-${escapeHTML(safeType)}">
          <span class="tc-match-detail-event-icon">${escapeHTML(this._getTournamentMatchEventIcon(type))}</span>
          <span class="tc-match-detail-event-copy">
            <strong>${escapeHTML(meta.title)}</strong>
            <small>${escapeHTML(meta.body)}</small>
          </span>
        </div>`;
      }).join('')}
    </div>`;
  },

  _getTournamentBracketSize(cupMatches) {
    const firstRoundKeys = new Set((Array.isArray(cupMatches) ? cupMatches : [])
      .filter(match => Number(match?.round) === 1)
      .map(match => String(match.seriesKey || match.slotKey || '').trim())
      .filter(Boolean));
    return firstRoundKeys.size * 2;
  },

  _renderTournamentMatchEventsSummaryHtml(match, home, away) {
    const events = Array.isArray(match?.events) ? match.events : [];
    if (!events.length) return '';
    const teamNames = {
      [home.teamId]: home.label,
      [away.teamId]: away.label,
    };
    const iconMap = { goal: '⚽', own_goal: 'OG', yellow: 'YC', red: 'RC', stoppage_time: 'ET', substitution: 'SUB' };
    const labelMap = { goal: '進球', own_goal: '烏龍球', yellow: '黃牌', red: '紅牌', stoppage_time: '補時公告', substitution: '換人' };
    const shown = events.slice(0, 6).map(ev => {
      const type = String(ev?.type || '').trim();
      const safeType = type.replace(/[^a-z0-9_-]/gi, '') || 'event';
      const label = labelMap[type] || type || '事件';
      const icon = iconMap[type] || label;
      const minute = Number.isFinite(Number(ev?.minute)) && Number(ev.minute) > 0 ? `${Math.floor(Number(ev.minute))}'` : '';
      const note = String(ev?.note || '').trim();
      const substitutionText = type === 'substitution'
        ? [
            Array.isArray(ev?.playersIn) && ev.playersIn.length ? `上 ${ev.playersIn.join('、')}` : '',
            Array.isArray(ev?.playersOut) && ev.playersOut.length ? `下 ${ev.playersOut.join('、')}` : '',
          ].filter(Boolean).join(' / ')
        : '';
      const player = String(substitutionText || ev?.name || ev?.uid || note || '').trim();
      const team = teamNames[String(ev?.teamId || '').trim()] || '';
      const title = [label, minute, player, team, (type === 'yellow' || type === 'red') ? note : ''].filter(Boolean).join(' · ');
      return `<span class="tc-match-event-chip tc-match-event-${escapeHTML(safeType)}" title="${escapeHTML(title)}">
        <b>${escapeHTML(icon)}</b>
        ${minute ? `<em>${escapeHTML(minute)}</em>` : ''}
        <span>${escapeHTML(player || label)}</span>
      </span>`;
    }).join('');
    const more = events.length > 6 ? `<span class="tc-match-event-more">+${events.length - 6}</span>` : '';
    return `<div class="tc-match-events-summary">${shown}${more}</div>`;
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
    const eventCount = Array.isArray(match.events) ? match.events.length : 0;
    const hasDraftScore = !finished && !walkover && !bye
      && match.scoreHome !== null && match.scoreHome !== undefined
      && match.scoreAway !== null && match.scoreAway !== undefined;
    const hasDraftWalkover = !finished && !walkover && !bye && !!match.walkoverWinnerTeamId;
    const isLiveUpdating = !finished && !walkover && !bye && (hasDraftScore || hasDraftWalkover || eventCount > 0);
    const statusClass = bye ? 'bye' : walkover ? 'walkover' : finished ? 'finished' : isLiveUpdating ? 'live' : 'scheduled';
    const statusLabel = {
      bye: '輪空',
      finished: '已結束',
      live: '更新中',
      scheduled: '待開賽',
      walkover: '棄權',
    }[statusClass] || '待開賽';
    let scoreText = 'VS';
    if (finished) {
      const pkText = Number.isFinite(Number(match.pkHome)) && Number.isFinite(Number(match.pkAway)) && match.pkHome !== null && match.pkHome !== undefined && match.pkAway !== null && match.pkAway !== undefined
        ? `<span class="tc-pk">PK ${match.pkHome}:${match.pkAway}</span>` : '';
      scoreText = `${match.scoreHome ?? '-'} : ${match.scoreAway ?? '-'}${pkText}`;
    } else if (walkover) {
      const winnerName = nameById[match.walkoverWinnerTeamId] || '';
      scoreText = `<span class="tc-wo" title="${escapeHTML(winnerName)} 獲勝">棄權</span>`;
    } else if (hasDraftScore) {
      const pkText = Number.isFinite(Number(match.pkHome)) && Number.isFinite(Number(match.pkAway)) && match.pkHome !== null && match.pkHome !== undefined && match.pkAway !== null && match.pkAway !== undefined
        ? `<span class="tc-pk">PK ${match.pkHome}:${match.pkAway}</span>` : '';
      scoreText = `${match.scoreHome ?? '-'} : ${match.scoreAway ?? '-'}${pkText}`;
    } else if (hasDraftWalkover) {
      scoreText = '<span class="tc-wo">棄權暫存</span>';
    } else if (bye) {
      scoreText = '<span class="tc-wo">輪空</span>';
    }
    const winnerTeamId = this._getTournamentMatchWinnerTeamId(match, matchesBySlot);
    const sideScore = (info, side) => {
      if (finished) return side === 'home' ? (match.scoreHome ?? '-') : (match.scoreAway ?? '-');
      if (walkover && match.walkoverWinnerTeamId) return match.walkoverWinnerTeamId === info.teamId ? '勝' : '棄';
      if (hasDraftScore) return side === 'home' ? (match.scoreHome ?? '-') : (match.scoreAway ?? '-');
      if (bye && side === 'home') return '晉';
      return '';
    };
    const teamHtml = (info, side) => `
      <div class="tc-match-team${side === 'away' ? ' away' : ''}${winnerTeamId && winnerTeamId === info.teamId ? ' tc-winner' : ''}${info.pending ? ' tc-pending' : ''}">
        <span class="tc-match-team-name" title="${escapeHTML(info.label)}">${escapeHTML(info.label)}</span>
        <span class="tc-match-team-score">${escapeHTML(sideScore(info, side))}</span>
      </div>`;
    const matchNumber = Number.isFinite(Number(match.slot)) ? Number(match.slot) + 1 : '';
    const seriesTotal = Math.max(1, Number(match.seriesTotal) || 1);
    const seriesGame = Math.max(1, Number(match.seriesGame) || 1);
    const seriesLabel = seriesTotal > 1 ? `第 ${seriesGame}/${seriesTotal} 場` : '';
    const matchLabel = match.stage === 'third' ? (seriesLabel || '季軍戰') : seriesLabel || (matchNumber ? `第 ${matchNumber} 場` : '場次');
    const eventsSummaryHtml = this._renderTournamentMatchEventsSummaryHtml(match, home, away);
    const dateParts = this._formatTournamentMatchDateParts(match.scheduledAt);
    const refereeNames = (match.referees || []).map(ref => ref?.name || '').filter(Boolean).join('、');
    const metaLine = [
      match.venue ? `場地 ${match.venue}` : '場地待定',
      refereeNames ? `裁判 ${refereeNames}` : '裁判待定',
      eventCount ? `${eventCount} 個事件` : '',
    ].filter(Boolean).join(' · ');
    const publicInfoHtml = `
      <div class="tc-match-public-info">
        <div class="tc-match-timebox">
          <span>開賽日</span>
          <strong>${escapeHTML(dateParts.date)}</strong>
        </div>
        <div class="tc-match-timebox">
          <span>開賽時間</span>
          <strong>${escapeHTML(dateParts.time)}</strong>
        </div>
        <div class="tc-match-meta-line">${escapeHTML(metaLine)}</div>
      </div>`;
    const liveHtml = `
      <div class="tc-match-live-slot" aria-label="直播">
        ${this._renderTournamentLiveFrameHtml(match, { compact: true })}
      </div>`;
    const canRecord = options.canRecord === true && !bye;
    const recordBtn = canRecord
      ? `<button type="button" class="tc-record-btn" onclick="event.stopPropagation();App.openTournamentMatchRecordModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')">更新賽況</button>`
      : '';
    const staffPanel = canRecord
      ? `<div class="tc-match-staff-panel">
          <span>職員操作</span>
          <small>比分、事件、裁判視角與直播網址只對有權限人員顯示。</small>
          ${recordBtn}
        </div>`
      : '';
    return `
      <article class="tc-match-row tc-match-card tc-match-${statusClass}${bye ? ' tc-match-bye' : ''}" data-match-id="${escapeHTML(match.id)}" role="button" tabindex="0" onclick="App.openTournamentMatchDetailModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openTournamentMatchDetailModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}');}">
        <div class="tc-match-state">
          <span class="tc-match-status tc-match-status-${statusClass}">${statusLabel}</span>
          <span class="tc-match-number">${escapeHTML(matchLabel)}</span>
        </div>
        <div class="tc-match-main">
          ${teamHtml(home, 'home')}
          <div class="tc-match-scoreline">${scoreText}</div>
          ${teamHtml(away, 'away')}
          ${eventsSummaryHtml}
        </div>
        ${publicInfoHtml}
        ${liveHtml}
        ${staffPanel}
      </article>`;
  },

  _ensureTournamentMatchDetailModal() {
    let overlay = document.getElementById('tournament-match-detail-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tournament-match-detail-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal tc-match-info-modal" id="tournament-match-detail-modal">
        <div class="modal-header">
          <h3 id="tournament-match-detail-title">賽事詳情</h3>
          <button class="modal-close" type="button" data-action="close">×</button>
        </div>
        <div class="modal-body" id="tournament-match-detail-body"></div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this.closeTournamentMatchDetailModal();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  closeTournamentMatchDetailModal() {
    document.getElementById('tournament-match-detail-overlay')?.classList.remove('open');
    document.getElementById('tournament-match-detail-modal')?.classList.remove('open');
    document.body?.classList?.remove('modal-open');
  },

  async openTournamentMatchDetailModal(tournamentId, matchId) {
    const safeId = String(tournamentId || '').trim();
    const state = this._getFriendlyTournamentState?.(safeId) || await this._loadFriendlyTournamentDetailState?.(safeId);
    const tournament = state?.tournament;
    const match = (state?.matches || []).find(item => item.id === String(matchId || '').trim());
    if (!tournament || !match) {
      this.showToast('找不到比賽資料');
      return;
    }
    const overlay = this._ensureTournamentMatchDetailModal();
    const title = document.getElementById('tournament-match-detail-title');
    const body = document.getElementById('tournament-match-detail-body');
    const matchesBySlot = this._buildTournamentMatchesBySlot(state.matches || []);
    const nameById = this._getTournamentTeamNameMap(state);
    const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
    const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
    if (title) title.textContent = `${home.label} vs ${away.label}`;
    if (body) body.innerHTML = this._renderTournamentMatchDetailModalBody(tournament, match, matchesBySlot, nameById);
    overlay.classList.add('open');
    document.getElementById('tournament-match-detail-modal')?.classList.add('open');
    document.body?.classList?.add('modal-open');
  },

  _renderTournamentMatchDetailModalBody(tournament, match, matchesBySlot, nameById) {
    const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
    const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
    const finished = match.status === 'finished';
    const walkover = match.status === 'walkover';
    const bye = match.status === 'bye';
    const eventCount = Array.isArray(match.events) ? match.events.length : 0;
    const hasScore = match.scoreHome !== null && match.scoreHome !== undefined && match.scoreAway !== null && match.scoreAway !== undefined;
    const isLiveUpdating = !finished && !walkover && !bye && (hasScore || eventCount > 0 || match.walkoverWinnerTeamId);
    const statusClass = bye ? 'bye' : walkover ? 'walkover' : finished ? 'finished' : isLiveUpdating ? 'live' : 'scheduled';
    const statusText = {
      bye: '輪空',
      finished: '已結束',
      live: '更新中',
      scheduled: '待開賽',
      walkover: '棄權',
    }[statusClass] || '待開賽';
    const scoreText = walkover ? '棄權' : bye ? '輪空' : hasScore ? `${match.scoreHome} : ${match.scoreAway}` : 'VS';
    const pkText = Number.isFinite(Number(match.pkHome)) && Number.isFinite(Number(match.pkAway)) && match.pkHome !== null && match.pkHome !== undefined && match.pkAway !== null && match.pkAway !== undefined
      ? `PK ${match.pkHome}:${match.pkAway}` : '';
    const dateParts = this._formatTournamentMatchDateParts(match.scheduledAt);
    const referees = Array.isArray(match.referees) ? match.referees : [];
    const refereeHtml = referees.length
      ? referees.map(ref => `<div class="tc-match-referee-row">
          <strong>${escapeHTML(ref?.name || ref?.uid || '未命名裁判')}</strong>
          <small>${escapeHTML([ref?.role || '裁判', ref?.phone, ref?.note].filter(Boolean).join(' · ') || '未填聯絡資訊')}</small>
        </div>`).join('')
      : '<div class="tc-match-detail-empty">裁判資訊尚未公布</div>';
    const user = ApiService.getCurrentUser?.();
    const canRecord = this._canRecordTournamentMatch?.(tournament, match, user) && !bye;
    const staffHtml = canRecord ? `
      <section class="tc-match-detail-card tc-match-detail-staff">
        <div class="tc-match-detail-section-title">
          <strong>職員工作區</strong>
          <span>一般用戶不會看到此區</span>
        </div>
        <button type="button" class="primary-btn" onclick="App.closeTournamentMatchDetailModal();App.openTournamentMatchRecordModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')">更新賽況</button>
      </section>` : '';
    return `
      <div class="tc-match-detail-shell">
        <section class="tc-match-detail-hero tc-match-${statusClass}">
          <span class="tc-match-status tc-match-status-${statusClass}">${escapeHTML(statusText)}</span>
          <div class="tc-match-detail-score">
            <strong>${escapeHTML(home.label)}</strong>
            <span>${escapeHTML(scoreText)}</span>
            <strong>${escapeHTML(away.label)}</strong>
          </div>
          ${pkText ? `<small>${escapeHTML(pkText)}</small>` : ''}
        </section>
        <div class="tc-match-detail-grid">
          <section class="tc-match-detail-card">
            <div class="tc-match-detail-section-title">
              <strong>開賽資訊</strong>
              <span>${escapeHTML(match.stage === 'league' ? '聯賽' : match.stage === 'third' ? '季軍戰' : '盃賽')}</span>
            </div>
            <dl class="tc-match-detail-list">
              <div><dt>開賽日</dt><dd>${escapeHTML(dateParts.date)}</dd></div>
              <div><dt>開賽時間</dt><dd>${escapeHTML(dateParts.time)}</dd></div>
              <div><dt>場地</dt><dd>${escapeHTML(match.venue || '待公布')}</dd></div>
              <div><dt>即時事件</dt><dd>${escapeHTML(String(eventCount))}</dd></div>
            </dl>
          </section>
          <section class="tc-match-detail-card">
            <div class="tc-match-detail-section-title">
              <strong>直播</strong>
              <span>${match.liveUrl ? '可直接播放或另開' : '待工作人員更新'}</span>
            </div>
            ${this._renderTournamentLiveFrameHtml(match)}
          </section>
        </div>
        <section class="tc-match-detail-card">
          <div class="tc-match-detail-section-title">
            <strong>即時事件</strong>
            <span>進球、牌卡、補時與換人</span>
          </div>
          ${this._renderTournamentMatchEventsTimeline(match, home, away)}
        </section>
        <section class="tc-match-detail-card">
          <div class="tc-match-detail-section-title">
            <strong>裁判資訊</strong>
            <span>主裁、助理與備註</span>
          </div>
          <div class="tc-match-referee-list">${refereeHtml}</div>
        </section>
        ${staffHtml}
      </div>`;
  },

  _renderTournamentScheduleSummaryHtml(tournament, matches, matchesBySlot, nameById, bracketSize, stats = {}, logoById = {}) {
    const rows = (Array.isArray(matches) ? matches : []).map(match => {
      const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
      const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
      const finished = match.status === 'finished';
      const walkover = match.status === 'walkover';
      const bye = match.status === 'bye';
      const eventCount = Array.isArray(match.events) ? match.events.length : 0;
      const hasScore = match.scoreHome !== null && match.scoreHome !== undefined
        && match.scoreAway !== null && match.scoreAway !== undefined;
      const hasDraftScore = !finished && !walkover && !bye && hasScore;
      const hasDraftWalkover = !finished && !walkover && !bye && !!match.walkoverWinnerTeamId;
      const isLiveUpdating = !finished && !walkover && !bye && (hasDraftScore || hasDraftWalkover || eventCount > 0);
      const statusClass = bye ? 'bye' : walkover ? 'walkover' : finished ? 'finished' : isLiveUpdating ? 'live' : 'scheduled';
      const statusLabel = {
        bye: '輪空',
        finished: '已結束',
        live: '更新中',
        scheduled: '待開賽',
        walkover: '棄權',
      }[statusClass] || '待開賽';
      const winnerTeamId = this._getTournamentMatchWinnerTeamId(match, matchesBySlot);
      const dateParts = this._formatTournamentMatchDateParts(match.scheduledAt);
      const timeLabel = match.scheduledAt ? `${dateParts.date} ${dateParts.time}` : '時間待定';
      const roundLabel = this._getTournamentRoundLabel(match, bracketSize);
      const scoreOf = (info, side) => {
        if (finished || hasDraftScore) return side === 'home' ? (match.scoreHome ?? '-') : (match.scoreAway ?? '-');
        if (walkover && match.walkoverWinnerTeamId) return match.walkoverWinnerTeamId === info.teamId ? '勝' : '棄';
        if (hasDraftWalkover && match.walkoverWinnerTeamId) return match.walkoverWinnerTeamId === info.teamId ? '勝' : '待';
        if (bye && side === 'home') return '晉';
        return '-';
      };
      const teamRow = (info, side) => {
        const isWinner = !!winnerTeamId && !!info.teamId && winnerTeamId === info.teamId;
        const logoUrl = info.teamId ? String(logoById?.[info.teamId] || '').trim() : '';
        const initial = String(info.label || '?').trim().charAt(0) || '?';
        const logoHtml = logoUrl
          ? `<span class="tc-summary-team-logo has-img" aria-hidden="true"><img src="${escapeHTML(logoUrl)}" alt="" loading="lazy" decoding="async"></span>`
          : `<span class="tc-summary-team-logo tc-summary-team-logo-fallback" aria-hidden="true">${escapeHTML(initial)}</span>`;
        return `<div class="tc-summary-team tc-summary-team-${side}${isWinner ? ' is-winner' : ''}${info.pending ? ' tc-pending' : ''}">
          ${logoHtml}
          <span class="tc-summary-team-name" title="${escapeHTML(info.label)}">${escapeHTML(info.label)}</span>
          <b>${escapeHTML(scoreOf(info, side))}</b>
        </div>`;
      };
      return `<button type="button" class="tc-summary-match tc-summary-match-${statusClass}" onclick="App.openTournamentMatchDetailModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')">
        <div class="tc-summary-match-head">
          <span>${escapeHTML(roundLabel)}</span>
          <time datetime="${escapeHTML(dateParts.iso || '')}">${escapeHTML(timeLabel)}</time>
        </div>
        <div class="tc-summary-scoreboard">
          ${teamRow(home, 'home')}
          ${away.label || !bye ? teamRow(away, 'away') : ''}
        </div>
        <div class="tc-summary-match-foot">
          <span class="tc-summary-status tc-summary-status-${statusClass}">${escapeHTML(statusLabel)}</span>
          ${eventCount ? `<span>${eventCount} 個事件</span>` : ''}
        </div>
      </button>`;
    }).join('');
    const total = Number(stats.total || matches?.length || 0);
    const finished = Number(stats.finished || 0);
    const scheduled = Number(stats.scheduled || 0);
    const venue = Number(stats.venue || 0);
    return `<div class="tc-schedule-summary-head">
        <div>
          <strong>賽程摘要列</strong>
          <span>兩隊、時間與比分</span>
        </div>
        <div class="tc-summary-totals" aria-label="摘要統計">
          <b>${finished}/${total}</b>
          <span>完成</span>
        </div>
      </div>
      <div class="tc-summary-meta">
        <span>${escapeHTML(String(total))} 場</span>
        <span>${escapeHTML(String(scheduled))} 有時間</span>
        <span>${escapeHTML(String(venue))} 有場地</span>
      </div>
      <div class="tc-schedule-summary-list" tabindex="0" aria-label="可上下滑動的賽程摘要">
        ${rows}
      </div>`;
  },

  _renderTournamentCompetitionScheduleHtml(state) {
    const tournament = state.tournament;
    const matches = state.matches || [];
    const canManage = this._canManageTournamentRecord?.(tournament);
    if (matches.length === 0) {
      const hint = canManage
        ? '尚未產生賽程。請先完成俱樂部審核，再從上方「賽程管理」產生賽程。'
        : '主辦方尚未公布賽程。';
      return `
        <div class="tc-schedule">
          <div class="tc-schedule-empty">
            <div class="tc-schedule-empty-title">賽程尚未公布</div>
            <div class="tc-schedule-empty-body">${escapeHTML(hint)}</div>
          </div>
        </div>`;
    }
    const user = ApiService.getCurrentUser?.();
    const matchesBySlot = this._buildTournamentMatchesBySlot(matches);
    const nameById = this._getTournamentTeamNameMap(state);
    const logoById = this._getTournamentTeamLogoMap(state);
    const mode = this._getTournamentMode?.(tournament);
    const modeText = mode === 'league' ? '聯賽' : '盃賽';
    const cupMatches = matches.filter(m => m.stage === 'cup');
    const bracketSize = this._getTournamentBracketSize(cupMatches);
    const finishedCount = matches.filter(m => m.status === 'finished' || m.status === 'walkover').length;
    const scheduledCount = matches.filter(m => m.scheduledAt).length;
    const venueCount = matches.filter(m => String(m.venue || '').trim()).length;
    const orderedMatches = [...matches].sort((a, b) => {
      const stageOrder = { cup: 0, third: 1, league: 2 };
      const stageA = stageOrder[a.stage] ?? 9;
      const stageB = stageOrder[b.stage] ?? 9;
      return stageA - stageB || Number(a.round || 0) - Number(b.round || 0) || Number(a.slot || 0) - Number(b.slot || 0);
    });
    const groups = new Map();
    orderedMatches.forEach(match => {
      const key = match.stage === 'third' ? 'third' : `${match.stage}-${match.round}`;
      if (!groups.has(key)) groups.set(key, { label: this._getTournamentRoundLabel(match, bracketSize), items: [] });
      groups.get(key).items.push(match);
    });
    let html = `<div class="tc-schedule">
      <div class="tc-schedule-head">
        <div class="tc-schedule-title-block">
          <span class="tc-schedule-kicker">${escapeHTML(modeText)}賽程</span>
          <h3>賽程總覽</h3>
          <p>依輪次整理場次、比分、時間、場地與裁判資訊。</p>
        </div>
        <div class="tc-schedule-stats" aria-label="賽程摘要">
          ${this._renderTournamentScheduleSummaryHtml(tournament, orderedMatches, matchesBySlot, nameById, bracketSize, {
            total: matches.length,
            finished: finishedCount,
            scheduled: scheduledCount,
            venue: venueCount,
          }, logoById)}
        </div>
      </div>`;
    if (mode === 'cup' && cupMatches.length > 0) {
      html += `<section class="tc-bracket-section">
        <div class="tc-bracket-section-head">
          <span>淘汰賽對戰表</span>
          <small>依輪次分組，自動並排顯示場次</small>
        </div>
        ${this._renderTournamentBracketHtml(cupMatches, matchesBySlot, nameById, bracketSize)}
      </section>`;
    }
    groups.forEach(group => {
      const groupFinished = group.items.filter(match => match.status === 'finished' || match.status === 'walkover' || match.status === 'bye').length;
      html += `
        <section class="td-card tc-round-card">
          <div class="tc-round-head">
            <div>
              <span class="tc-round-kicker">${escapeHTML(modeText)}</span>
              <h4>${escapeHTML(group.label)}</h4>
            </div>
            <span class="tc-round-count">${groupFinished}/${group.items.length} 完成</span>
          </div>
          <div class="tc-round-match-list">`;
      group.items.forEach(match => {
        const canRecord = this._canRecordTournamentMatch?.(tournament, match, user);
        html += this._renderTournamentMatchRowHtml(tournament, match, matchesBySlot, nameById, { canRecord });
      });
      html += '</div></section>';
    });
    html += '</div>';
    return html;
  },

  _renderTournamentBracketHtml(cupMatches, matchesBySlot, nameById, bracketSize) {
    const rounds = new Map();
    (Array.isArray(cupMatches) ? cupMatches : []).forEach(match => {
      const round = Math.max(1, Number(match?.round) || 1);
      if (!rounds.has(round)) rounds.set(round, []);
      rounds.get(round).push(match);
    });
    const roundKeys = [...rounds.keys()].sort((a, b) => a - b);
    const columns = roundKeys.map(round => {
      const items = rounds.get(round).sort((a, b) =>
        Number(a.slot || 0) - Number(b.slot || 0)
        || Number(a.seriesGame || 1) - Number(b.seriesGame || 1)
        || Number(a.matchNo || 0) - Number(b.matchNo || 0)
      );
      const title = this._getTournamentRoundLabel(items[0], bracketSize);
      const cells = items.map(match => {
        const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
        const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
        const winnerTeamId = this._getTournamentMatchWinnerTeamId(match, matchesBySlot);
        const hasDraftScore = match.status === 'scheduled'
          && match.scoreHome !== null && match.scoreHome !== undefined
          && match.scoreAway !== null && match.scoreAway !== undefined;
        const hasDraftWalkover = match.status === 'scheduled' && !!match.walkoverWinnerTeamId;
        const statusClass = match.status === 'bye' ? 'bye' : match.status === 'walkover' ? 'walkover' : match.status === 'finished' ? 'finished' : 'scheduled';
        const statusLabel = {
          bye: '輪空',
          finished: '已結束',
          scheduled: hasDraftScore || hasDraftWalkover ? '暫存' : '待賽',
          walkover: '棄權',
        }[statusClass] || '待賽';
        const seriesKey = String(match.seriesKey || match.slotKey || '').trim();
        const seriesGroup = seriesKey ? matchesBySlot?.[seriesKey] : null;
        const seriesItems = Array.isArray(seriesGroup?.seriesMatches) ? seriesGroup.seriesMatches : [];
        const seriesTotal = Math.max(1, Number(match.seriesTotal) || seriesItems.length || 1);
        const seriesGame = Math.max(1, Number(match.seriesGame) || 1);
        const hasSeries = seriesTotal > 1;
        const seriesScore = hasSeries
          ? seriesItems.reduce((acc, item) => {
              const winner = this._getTournamentSingleMatchWinnerTeamId(item, matchesBySlot);
              if (!winner) return acc;
              if (winner === home.teamId) acc.home += 1;
              if (winner === away.teamId) acc.away += 1;
              return acc;
            }, { home: 0, away: 0 })
          : null;
        const completedInSeries = hasSeries
          ? seriesItems.filter(item => ['finished', 'walkover', 'bye'].includes(String(item.status || ''))).length
          : 0;
        const scoreOf = side => {
          if (match.status === 'finished') return side === 'home' ? (match.scoreHome ?? '') : (match.scoreAway ?? '');
          if (match.status === 'walkover') return match.walkoverWinnerTeamId === (side === 'home' ? home.teamId : away.teamId) ? '勝' : '棄';
          if (hasDraftScore) return side === 'home' ? (match.scoreHome ?? '') : (match.scoreAway ?? '');
          if (match.status === 'bye') return side === 'home' ? '晉級' : '';
          return '';
        };
        const sideHtml = (info, side) => `
          <div class="bracket-team${winnerTeamId && winnerTeamId === info.teamId ? ' winner' : ''}">
            <span class="${info.pending ? 'tc-pending' : ''}">${escapeHTML(info.label)}</span>
            <span class="bt-score">${scoreOf(side)}</span>
          </div>`;
        const seriesBadge = hasSeries
          ? `<span class="bracket-series-badge">系列 ${seriesScore.home}:${seriesScore.away} · ${completedInSeries}/${seriesTotal} 完成</span>`
          : '';
        const timeText = this._formatTournamentMatchTime(match.scheduledAt);
        const venueText = String(match.venue || '').trim();
        const metaText = [timeText, venueText].filter(Boolean).join(' · ');
        return `<div class="bracket-match bracket-match-${statusClass}" data-match-id="${escapeHTML(match.id || '')}" data-series-key="${escapeHTML(seriesKey)}" data-series-game="${escapeHTML(String(seriesGame))}">
          <div class="bracket-match-head">
            <span class="bracket-match-status bracket-match-status-${statusClass}">${escapeHTML(statusLabel)}</span>
            <span class="bracket-game-label">${hasSeries ? `第 ${seriesGame}/${seriesTotal} 場` : `第 ${Number(match.slot || 0) + 1} 場`}</span>
          </div>
          ${sideHtml(home, 'home')}
          ${away.label || match.status !== 'bye' ? sideHtml(away, 'away') : ''}
          ${seriesBadge || metaText ? `<div class="bracket-match-meta">${seriesBadge}${metaText ? `<span>${escapeHTML(metaText)}</span>` : ''}</div>` : ''}
        </div>`;
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
