/* ================================================
   SportHub — Tournament: Render & Detail View
   ================================================ */

Object.assign(App, {

  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    if (!container) return;
    const ongoing = ApiService.getTournaments().filter(t => !this.isTournamentEnded(t));

    // ── 已渲染且 ID 完全相同 → 跳過，避免封面圖重載 ──
    const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
    if (existingCards.length > 0 && existingCards.length === ongoing.length) {
      const renderedIds = [...existingCards].map(c => (c.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1]).filter(Boolean);
      const currentIds = ongoing.map(t => t.id);
      if (renderedIds.length === currentIds.length && renderedIds.every((id, i) => id === currentIds[i])) return;
    }
    this._setHomeSectionVisibility?.(container, ongoing.length > 0);
    if (ongoing.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = ongoing.map(t => `
      <div class="h-card" onclick="App.showTournamentDetail('${t.id}')">
        ${t.image
          ? `<div class="h-card-img"><img src="${t.image}" alt="${escapeHTML(t.name)}"></div>`
          : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
        <div class="h-card-body">
          <div class="h-card-title">${escapeHTML(t.name)}</div>
          <div class="h-card-meta">
            <span>${escapeHTML(t.type)}</span>
            <span>${t.teams} ${I18N.t('tournament.teamUnit')}</span>
          </div>
        </div>
      </div>
    `).join('');
  },

  _tcActiveTab: 'active',

  switchTournamentCenterTab(tab) {
    this._tcActiveTab = tab;
    document.querySelectorAll('#tc-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tctab === tab);
    });
    this.renderTournamentTimeline();
  },

  filterTournamentCenter() {
    this.renderTournamentTimeline();
  },

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;
    this._refreshTournamentCenterCreateButton?.();

    const tab = this._tcActiveTab || 'active';
    const query = (document.getElementById('tc-search')?.value || '').trim().toLowerCase();
    const regionFilter = document.getElementById('tc-region-filter')?.value || '';

    let tournaments = (ApiService.getTournaments() || []).map(t => this.getFriendlyTournamentRecord?.(t) || t);

    // Tab filter
    tournaments = tournaments.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });

    // Text search
    if (query) {
      tournaments = tournaments.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (this._getTournamentOrganizerDisplayText?.(t) || '').toLowerCase().includes(query) ||
        (t.organizer || '').toLowerCase().includes(query) ||
        (t.venues || []).some(v => v.toLowerCase().includes(query))
      );
    }

    // Region filter
    if (regionFilter) {
      tournaments = tournaments.filter(t => t.region === regionFilter);
    }

    if (tournaments.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? t('tournament.noEnded') : t('tournament.noActive')}</div>`;
      return;
    }

    const fmtDate = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    };
    const fmtDatetime = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getDate().toString().padStart(2, '0')}`;
    };

    const statusBgMap = {
      '報名中':  { bg: 'rgba(52,211,153,.07)', border: '#10b981', darkBg: 'rgba(52,211,153,.15)' },
      '截止報名': { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      '準備中':  { bg: 'rgba(96,165,250,.07)', border: '#60a5fa', darkBg: 'rgba(96,165,250,.15)' },
      '已結束':  { bg: 'rgba(107,114,128,.07)', border: '#6b7280', darkBg: 'rgba(107,114,128,.15)' },
    };
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    container.innerHTML = tournaments.map(t => {
      const isEnded = this.isTournamentEnded(t);
      const status = isEnded ? '已結束' : this.getTournamentStatus(t);
      const statusMap = { '報名中': 'open', '截止報名': 'full', '準備中': 'upcoming', '已結束': 'ended' };
      const css = statusMap[status] || 'open';
      const sBg = statusBgMap[status] || statusBgMap['已結束'];

      const registered = t.registeredTeams || [];
      const maxTeams = t.maxTeams || '?';
      const matchDates = t.matchDates || [];
      const matchDatesText = matchDates.length ? matchDates.map(d => fmtDate(d)).join('、') : '未定';
      const regPeriod = (t.regStart && t.regEnd) ? `${fmtDatetime(t.regStart)} ~ ${fmtDatetime(t.regEnd)}` : '未定';
      const organizer = t.organizer || '管理員';
      const role = ApiService.getUserRole(organizer);
      const region = t.region || '';

      return `
        <div class="tl-event-row" onclick="App.showTournamentDetail('${t.id}')" style="margin-bottom:.4rem;flex-wrap:wrap;padding:.45rem .6rem .35rem;background:${isDark ? sBg.darkBg : sBg.bg};border-left:3px solid ${sBg.border}">
          <div style="width:100%;display:flex;align-items:center;gap:.35rem">
            <div class="tl-event-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.58rem;color:var(--text-muted);opacity:.7">待定義</span>
            <span class="user-capsule uc-${role}" style="pointer-events:none;cursor:default;font-size:.6rem;padding:.1rem .35rem">${escapeHTML(organizer)}</span>
            <span class="tl-event-status ${css}">${status}</span>
            <span class="tl-event-arrow">›</span>
          </div>
          <div style="width:100%;font-size:.62rem;color:var(--text-muted);margin-top:.2rem;line-height:1.5">
            ${region ? region + ' · ' : ''}${I18N.t('tournament.matchDay')} ${matchDatesText} · ${I18N.t('tournament.regPeriod')} ${regPeriod} · ${I18N.t('tournament.registered')} ${registered.length}/${maxTeams} ${I18N.t('tournament.teamUnit')}
          </div>
        </div>`;
    }).join('');
  },

  async showTournamentDetail(id) {
    if (this._requireLogin()) return;
    this.currentTournament = id;
    const t = ApiService.getTournament(id);
    if (!t) return;
    await this.showPage('page-tournament-detail');
    if (!document.getElementById('td-title')) return;

    // 圖片渲染
    const tdImg = document.getElementById('td-img-placeholder');
    if (tdImg) {
      if (t.image) {
        tdImg.innerHTML = `<img src="${t.image}" alt="${escapeHTML(t.name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        tdImg.style.border = 'none';
      } else {
        tdImg.textContent = '賽事圖片 800 × 300';
        tdImg.style.border = '';
      }
    }
    document.getElementById('td-title').innerHTML = escapeHTML(t.name) + ' ' + this._favHeartHtml(this.isTournamentFavorited(id), 'Tournament', id);

    // 報名按鈕
    this.renderRegisterButton(t);
    // 賽事資訊（場地、日期、費用、主辦、委託）
    this.renderTournamentInfo(t);

    // 頁簽綁定
    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    // 預設為「說明」頁簽
    document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'info'));
    this.renderTournamentTab('info');
  },

  renderRegisterButton(t) {
    const area = document.getElementById('td-register-area');
    if (!area) return;

    const status = this.getTournamentStatus(t);
    const registered = t.registeredTeams || [];
    const maxTeams = t.maxTeams || 999;
    const isFull = registered.length >= maxTeams;

    // 找出當前用戶管理的球隊
    const curUser = ApiService.getCurrentUser();
    const allTeams = ApiService.getTeams();
    const myManagedTeams = curUser ? allTeams.filter(tm =>
      (tm.captainUid && tm.captainUid === curUser.uid) ||
      (tm.captain && tm.captain === curUser.displayName) ||
      (tm.coaches || []).includes(curUser.displayName)
    ) : [];
    const canRegister = myManagedTeams.length > 0;
    const alreadyRegistered = myManagedTeams.some(mt => registered.includes(mt.id));

    // 檢查是否有待審核的報名申請
    const hasPendingRequest = curUser ? ApiService.getMessages().some(m =>
      m.actionType === 'tournament_register_request' &&
      m.actionStatus === 'pending' &&
      m.meta && m.meta.tournamentId === t.id &&
      myManagedTeams.some(mt => mt.id === m.meta.teamId)
    ) : false;

    let btnHTML = '';
    if (alreadyRegistered) {
      btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.showUserProfile('${escapeHTML(t.organizer || '管理員')}')">聯繫主辦</button>`;
    } else if (hasPendingRequest) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.6;cursor:not-allowed" disabled>等待審核中</button>`;
    } else if (status === '截止報名' && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已滿</button>`;
    } else if (status === '截止報名') {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已截止</button>`;
    } else if (status === '報名中' && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已滿</button>`;
    } else if (status === '報名中') {
      if (canRegister) {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.registerTournament('${t.id}')">報名比賽</button>`;
      } else {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.showToast('請聯繫球隊管理人員進行報名')">報名比賽</button>`;
      }
    } else if (status === '準備中') {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>尚未開放報名</button>`;
    }

    const countText = `<div style="font-size:.78rem;color:var(--text-muted);margin-top:.35rem;text-align:center">已報名 ${registered.length} / ${maxTeams} 隊</div>`;
    area.innerHTML = btnHTML + countText;
  },

  registerTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;

    // 找出當前用戶所屬球隊（作為領隊或教練的）
    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }
    const allTeams = ApiService.getTeams();
    const myTeam = allTeams.find(tm =>
      (tm.captainUid && tm.captainUid === curUser.uid) ||
      (tm.captain && tm.captain === curUser.displayName) ||
      (tm.coaches || []).includes(curUser.displayName)
    );
    if (!myTeam) {
      this.showToast('您尚未管理任何球隊');
      return;
    }

    if (!t.registeredTeams) t.registeredTeams = [];
    if (t.registeredTeams.includes(myTeam.id)) {
      this.showToast('您的球隊已報名此賽事');
      return;
    }
    if (t.registeredTeams.length >= (t.maxTeams || 999)) {
      this.showToast('報名已滿');
      return;
    }

    // 檢查是否已有待審核的報名申請
    const allMessages = ApiService.getMessages();
    const hasPending = allMessages.find(m =>
      m.actionType === 'tournament_register_request' &&
      m.actionStatus === 'pending' &&
      m.meta && m.meta.tournamentId === id &&
      m.meta.teamId === myTeam.id
    );
    if (hasPending) {
      this.showToast('已提交報名申請，審核中請耐心等候');
      return;
    }

    // 找到主辦人 UID
    const users = ApiService.getAdminUsers();
    let organizerUid = t.creatorUid || null;
    if (!organizerUid && t.organizer) {
      const orgUser = users.find(u => u.name === t.organizer);
      organizerUid = orgUser ? orgUser.uid : null;
    }
    if (!organizerUid) {
      this.showToast('無法找到主辦人，請聯繫管理員');
      return;
    }

    // 產生 groupId 關聯同一筆報名申請的所有通知
    const groupId = 'trg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const msgBody = `「${myTeam.name}」申請報名賽事「${t.name}」，請審核此申請。\n\n申請人：${curUser.displayName}\n球隊：${myTeam.name}`;
    const metaData = { tournamentId: id, tournamentName: t.name, teamId: myTeam.id, teamName: myTeam.name, applicantUid: curUser.uid, applicantName: curUser.displayName, groupId };

    // 發送給主辦人
    this._deliverMessageWithLinePush(
      '賽事報名申請', msgBody,
      'tournament', '賽事', organizerUid, curUser.displayName,
      { actionType: 'tournament_register_request', actionStatus: 'pending', meta: metaData },
      { lineOptions: { source: 'tournament_register_request' } }
    );

    // 發送給所有委託人
    const delegates = t.delegates || [];
    delegates.forEach(d => {
      if (d.uid && d.uid !== organizerUid) {
        this._deliverMessageWithLinePush(
          '賽事報名申請', msgBody,
          'tournament', '賽事', d.uid, curUser.displayName,
          { actionType: 'tournament_register_request', actionStatus: 'pending', meta: metaData },
          { lineOptions: { source: 'tournament_register_request' } }
        );
      }
    });

    this.showToast('已送出報名申請，等待主辦方審核！');
  },

  renderTournamentInfo(t) {
    const container = document.getElementById('td-info-section');
    if (!container) return;
    const infoTournament = this.getFriendlyTournamentRecord?.(t) || t;
    const infoRows = [];

    if (infoTournament.region) {
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">地區</span><div class="td-info-value">${escapeHTML(infoTournament.region)}</div></div>`);
    }

    const infoVenues = Array.isArray(infoTournament.venues) ? infoTournament.venues : [];
    if (infoVenues.length > 0) {
      const searchPrefix = infoTournament.region || '';
      const venueLinks = infoVenues.map(v => {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchPrefix + v)}`;
        return `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-size:.82rem">${escapeHTML(v)} ↗</a>`;
      }).join('<span style="color:var(--border);margin:0 .3rem">|</span>');
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">場地</span><div class="td-info-value">${venueLinks}</div></div>`);
    }

    const infoDates = Array.isArray(infoTournament.matchDates) ? infoTournament.matchDates : [];
    if (infoDates.length > 0) {
      const dateTags = infoDates.map(d => {
        const parts = String(d || '').split('-');
        return `<span style="display:inline-block;font-size:.7rem;padding:.15rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}</span>`;
      }).join('');
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">比賽日期</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.25rem">${dateTags}</div></div>`);
    }

    if (infoTournament.regStart && infoTournament.regEnd) {
      const fmtRegDT = d => {
        const dt = new Date(d);
        return `${dt.getFullYear()}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getDate().toString().padStart(2, '0')} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
      };
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">報名期間</span><div class="td-info-value">${fmtRegDT(infoTournament.regStart)} ~ ${fmtRegDT(infoTournament.regEnd)}</div></div>`);
    }

    const feeEnabled = typeof infoTournament.feeEnabled === 'boolean' ? infoTournament.feeEnabled : Number(infoTournament.fee || 0) > 0;
    const feeValue = feeEnabled ? Number(infoTournament.fee || 0) || 0 : 0;
    infoRows.push(`<div class="td-info-row"><span class="td-info-label">報名費</span><div class="td-info-value" style="font-weight:600">${feeEnabled ? `NT$${feeValue.toLocaleString()} / 隊` : '未開啟'}</div></div>`);

    const organizerDisplay = this._getTournamentOrganizerDisplayText?.(infoTournament) || infoTournament.organizer || '主辦球隊';
    infoRows.push(`<div class="td-info-row"><span class="td-info-label">主辦單位</span><div class="td-info-value">${escapeHTML(organizerDisplay)}</div></div>`);

    const infoDelegates = Array.isArray(infoTournament.delegates) ? infoTournament.delegates : [];
    if (infoDelegates.length > 0) {
      const delegateTags = infoDelegates.map(d => this._userTag(d.name)).join(' ');
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">委託人</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.3rem">${delegateTags}</div></div>`);
    }

    const infoActions = [];
    if (this._canManageTournamentRecord?.(infoTournament)) {
      infoActions.push(`<button class="outline-btn" onclick="App.showEditTournament('${infoTournament.id}')" style="font-size:.78rem;padding:.45rem .75rem">編輯賽事</button>`);
    }

    container.innerHTML = `<div class="td-info-card">${infoRows.join('')}${infoActions.length ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem">${infoActions.join('')}</div>` : ''}</div>`;
    return;

    const rows = [];

    // 地區
    if (t.region) {
      rows.push(`<div class="td-info-row"><span class="td-info-label">地區</span><div class="td-info-value">${escapeHTML(t.region)}</div></div>`);
    }

    // 場地
    const venues = t.venues || [];
    if (venues.length > 0) {
      const searchPrefix = t.region || '';
      const venueLinks = venues.map(v => {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchPrefix + v)}`;
        return `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-size:.82rem">${escapeHTML(v)} 📍</a>`;
      }).join('<span style="color:var(--border);margin:0 .3rem">|</span>');
      rows.push(`<div class="td-info-row"><span class="td-info-label">場地</span><div class="td-info-value">${venueLinks}</div></div>`);
    }

    // 比賽日期
    const dates = t.matchDates || [];
    if (dates.length > 0) {
      const dateTags = dates.map(d => {
        const parts = d.split('-');
        return `<span style="display:inline-block;font-size:.7rem;padding:.15rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${parseInt(parts[1])}/${parseInt(parts[2])}</span>`;
      }).join('');
      rows.push(`<div class="td-info-row"><span class="td-info-label">比賽日期</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.25rem">${dateTags}</div></div>`);
    }

    // 報名時間
    if (t.regStart && t.regEnd) {
      const fmtRegDT = d => {
        const dt = new Date(d);
        return `${dt.getFullYear()}/${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
      };
      rows.push(`<div class="td-info-row"><span class="td-info-label">報名時間</span><div class="td-info-value">${fmtRegDT(t.regStart)} ~ ${fmtRegDT(t.regEnd)}</div></div>`);
    }

    // 報名費
    const fee = t.fee || 0;
    rows.push(`<div class="td-info-row"><span class="td-info-label">報名費</span><div class="td-info-value" style="font-weight:600">${fee > 0 ? 'NT$' + fee.toLocaleString() + ' / 隊' : '免費'}</div></div>`);

    // 主辦人
    const organizer = t.organizer || '管理員';
    rows.push(`<div class="td-info-row"><span class="td-info-label">主辦人</span><div class="td-info-value">${this._userTag(organizer)}</div></div>`);

    // 委託人
    const delegates = t.delegates || [];
    if (delegates.length > 0) {
      const delegateTags = delegates.map(d => this._userTag(d.name)).join(' ');
      rows.push(`<div class="td-info-row"><span class="td-info-label">委託</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.3rem">${delegateTags}</div></div>`);
    }

    container.innerHTML = `<div class="td-info-card">${rows.join('')}</div>`;
  },

  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = ApiService.getTournament(this.currentTournament);
    if (!t) return;

    if (tab === 'info') {
      const desc = t.description || '';
      const contentImgHTML = t.contentImage ? `<div style="padding:0 .8rem .8rem"><img src="${t.contentImage}" alt="賽事內容圖片" style="width:100%;border-radius:var(--radius);display:block"></div>` : '';
      container.innerHTML = desc
        ? `<div style="padding:.8rem;font-size:.88rem;line-height:1.7;white-space:pre-wrap;color:var(--text-primary)">${escapeHTML(desc)}</div>${contentImgHTML}`
        : `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">暫無說明</div>${contentImgHTML}`;
    } else if (tab === 'teams') {
      const teamIds = t.registeredTeams || [];
      if (teamIds.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無球隊報名</div>';
        return;
      }
      const allTeams = ApiService.getTeams();
      const registered = teamIds.map(id => allTeams.find(tm => tm.id === id)).filter(Boolean);
      container.innerHTML = `<div class="team-grid" style="padding:.5rem .4rem">${registered.map(tm => this._teamCardHTML({...tm, pinned: false})).join('')}</div>`;
    } else if (tab === 'schedule') {
      if (!ModeManager.isDemo()) {
        container.innerHTML = '<div style="padding:3rem 1rem;text-align:center;color:var(--text-muted);font-size:.92rem">功能開發中</div>';
      } else {
        const isCup = t && !t.type.includes('聯賽');
        container.innerHTML = isCup ? this.renderBracket() : this.renderLeagueSchedule();
      }
    } else if (tab === 'stats') {
      if (!ModeManager.isDemo()) {
        container.innerHTML = '<div style="padding:3rem 1rem;text-align:center;color:var(--text-muted);font-size:.92rem">功能開發中</div>';
      } else {
        container.innerHTML = `<table class="standings-table">
          <tr><th>#</th><th>隊名</th><th>勝</th><th>平</th><th>負</th><th>積分</th></tr>
          ${ApiService.getStandings().map(s => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td><strong>${s.pts}</strong></td></tr>`).join('')}
        </table>`;
      }
    }
  },

  renderLeagueSchedule() {
    const teams = ApiService.getTeams();
    const matches = ApiService.getMatches();

    let html = '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:.4rem">賽程</div>';
    matches.forEach(m => {
      const homeTeam = teams.find(t => t.name === m.home);
      const awayTeam = teams.find(t => t.name === m.away);
      html += `
        <div class="match-card-compact">
          <div class="mc-team">
            <div class="mc-emblem" style="background:${homeTeam?.color || '#666'}22;color:${homeTeam?.color || '#666'}">${homeTeam?.emblem || '?'}</div>
            <span>${m.home}</span>
          </div>
          <div class="mc-score">${m.scoreH !== null ? `${m.scoreH} : ${m.scoreA}` : 'vs'}</div>
          <div class="mc-team away">
            <span>${m.away}</span>
            <div class="mc-emblem" style="background:${awayTeam?.color || '#666'}22;color:${awayTeam?.color || '#666'}">${awayTeam?.emblem || '?'}</div>
          </div>
        </div>
        <div class="mc-meta"><span>${m.venue}</span><span>${m.time}</span></div>`;
    });

    html += '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.8rem 0 .4rem">循環對戰表</div>';
    html += '<div class="rr-table-wrap"><table class="rr-table"><tr><th></th>';
    teams.forEach(t => { html += `<th>${t.emblem}</th>`; });
    html += '</tr>';
    teams.forEach((home, hi) => {
      html += `<tr><td class="rr-team-cell">${home.emblem} ${home.name}</td>`;
      teams.forEach((away, ai) => {
        if (hi === ai) {
          html += '<td class="rr-self">—</td>';
        } else {
          const m = matches.find(x => (x.home === home.name && x.away === away.name));
          if (m && m.scoreH !== null) {
            const cls = m.scoreH > m.scoreA ? 'rr-win' : m.scoreH < m.scoreA ? 'rr-loss' : 'rr-draw';
            html += `<td class="${cls}">${m.scoreH}:${m.scoreA}</td>`;
          } else {
            html += '<td style="color:var(--text-muted)">-</td>';
          }
        }
      });
      html += '</tr>';
    });
    html += '</table></div>';
    return html;
  },

  renderBracket() {
    const bracketData = [
      { round: '八強', matches: [
        { t1: '雷霆隊', s1: 3, t2: '旋風B隊', s2: 0, e1: '雷', e2: '旋' },
        { t1: '閃電隊', s1: 2, t2: '火焰B隊', s2: 1, e1: '電', e2: '火' },
        { t1: '旋風隊', s1: 1, t2: '獵鷹隊', s2: 1, e1: '旋', e2: '鷹' },
        { t1: '火焰隊', s1: 4, t2: '鐵衛隊', s2: 2, e1: '火', e2: '鐵' },
      ]},
      { round: '四強', matches: [
        { t1: '雷霆隊', s1: null, t2: '閃電隊', s2: null, e1: '雷', e2: '電' },
        { t1: '?', s1: null, t2: '火焰隊', s2: null, e1: '?', e2: '火' },
      ]},
      { round: '決賽', matches: [
        { t1: '?', s1: null, t2: '?', s2: null, e1: '?', e2: '?' },
      ]},
    ];

    let html = '<div class="bracket-container"><div class="bracket">';
    bracketData.forEach((round, ri) => {
      html += `<div class="bracket-round">
        <div class="bracket-round-title">${round.round}</div>`;
      round.matches.forEach(m => {
        const w1 = m.s1 !== null && m.s2 !== null && m.s1 > m.s2;
        const w2 = m.s1 !== null && m.s2 !== null && m.s2 > m.s1;
        html += `<div class="bracket-match">
          <div class="bracket-team${w1 ? ' winner' : ''}">
            <span>${m.e1}</span> ${m.t1}
            <span class="bt-score">${m.s1 !== null ? m.s1 : ''}</span>
          </div>
          <div class="bracket-team${w2 ? ' winner' : ''}">
            <span>${m.e2}</span> ${m.t2}
            <span class="bt-score">${m.s2 !== null ? m.s2 : ''}</span>
          </div>
        </div>`;
      });
      html += '</div>';
      if (ri < bracketData.length - 1) {
        html += '<div class="bracket-connector"></div>';
      }
    });
    html += '</div></div>';
    return html;
  },

});
