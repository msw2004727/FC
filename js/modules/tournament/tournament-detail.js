/* === SportHub — Tournament Detail View ===
   依賴：tournament-render.js (list helpers)
   ============================================ */
Object.assign(App, {

  async showTournamentDetail(id, options) {
    if (!(options && options.allowGuest) && this._requireLogin()) return;
    this.currentTournament = id;
    let t = ApiService.getTournament(id);
    if (!t) {
      // 快取 miss → 單筆查詢 Firestore（Phase 2A §7.4）
      t = await ApiService.getTournamentAsync(id);
      if (!t) return;
    }
    await this.showPage('page-tournament-detail');
    if (!document.getElementById('td-title')) return;

    // 圖片渲染
    const tdImg = document.getElementById('td-img-placeholder');
    if (tdImg) {
      if (t.image) {
        // Safety: t.image is admin-uploaded URL, t.name is escaped
        tdImg.innerHTML = `<img src="${t.image}" alt="${escapeHTML(t.name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        tdImg.style.border = 'none';
      } else {
        tdImg.textContent = '賽事圖片 800 × 300';
        tdImg.style.border = '';
      }
    }
    // Safety: t.name is escaped; _favHeartHtml returns safe markup
    document.getElementById('td-title').innerHTML = escapeHTML(t.name) + ' ' + this._favHeartHtml(this.isTournamentFavorited(id), 'Tournament', id);

    // 報名按鈕
    this.renderRegisterButton(t);
    // 賽事資訊（場地、日期、費用、主辦、委託）
    this.renderTournamentInfo(t);
    this._ensureTournamentDetailTabsLayout();

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

  _renderTournamentDetailToolbar(tournament) {
    const { toolbar } = this._ensureTournamentDetailTabsLayout();
    if (!toolbar) return;

    if (!this._canManageTournamentRecord?.(tournament)) {
      // Safety: clearing toolbar
      toolbar.innerHTML = '';
      toolbar.style.display = 'none';
      return;
    }

    // Safety: tournament.id is escaped
    toolbar.innerHTML = `<button class="td-edit-btn" onclick="App.showEditTournament('${escapeHTML(tournament.id)}')">編輯賽事</button>`;
    toolbar.style.display = 'flex';
  },

  _ensureTournamentDetailTabsLayout() {
    const tabs = document.getElementById('td-tabs');
    if (!tabs) return { tabs: null, row: null, toolbar: null };

    let row = tabs.parentElement;
    if (!row || !row.classList.contains('td-tabs-row')) {
      row = document.createElement('div');
      row.className = 'td-tabs-row';
      tabs.parentNode?.insertBefore(row, tabs);
      row.appendChild(tabs);
    }

    let toolbar = document.getElementById('td-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'td-toolbar';
      toolbar.className = 'td-toolbar';
      toolbar.style.display = 'none';
      row.appendChild(toolbar);
    } else if (toolbar.parentElement !== row) {
      row.appendChild(toolbar);
    }

    return { tabs, row, toolbar };
  },

  renderRegisterButton(t) {
    const area = document.getElementById('td-register-area');
    if (!area) return;

    const status = this.getTournamentStatus(t);
    const registered = t.registeredTeams || [];
    const maxTeams = this._getFriendlyTournamentTeamLimit?.(t) || t.maxTeams || 999;
    const isFull = registered.length >= maxTeams;

    // 找出當前用戶管理的俱樂部
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
      btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.contactTournamentOrganizer('${t.id}')">${I18N.t('tournament.contactHost')}</button>`;
    } else if (hasPendingRequest) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.6;cursor:not-allowed" disabled>${I18N.t('tournament.waitingReview')}</button>`;
    } else if ((status === TOURNAMENT_STATUS.REG_CLOSED_ALT || status === TOURNAMENT_STATUS.REG_CLOSED) && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>${I18N.t('tournament.regFull')}</button>`;
    } else if (status === TOURNAMENT_STATUS.REG_CLOSED_ALT || status === TOURNAMENT_STATUS.REG_CLOSED) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>${I18N.t('tournament.regClosed')}</button>`;
    } else if (status === TOURNAMENT_STATUS.REG_OPEN && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>${I18N.t('tournament.regFull')}</button>`;
    } else if (status === TOURNAMENT_STATUS.REG_OPEN) {
      if (canRegister) {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.registerTournament('${t.id}')">${I18N.t('tournament.register')}</button>`;
      } else {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.showToast('請聯繫俱樂部管理人員進行報名')">${I18N.t('tournament.register')}</button>`;
      }
    } else if (status === TOURNAMENT_STATUS.PREPARING) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>${I18N.t('tournament.notYetOpen')}</button>`;
    }

    // Safety: registered.length and maxTeams are numbers
    const countText = `<div style="font-size:.78rem;color:var(--text-muted);margin-top:.35rem;text-align:center">已報名 ${registered.length} / ${maxTeams} 隊</div>`;
    area.innerHTML = btnHTML + countText;
  },

  registerTournament(id) {
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料
    if (this._requireProfileComplete()) return;
    const t = ApiService.getTournament(id);
    if (!t) return;

    // 找出當前用戶所屬俱樂部（作為領隊或教練的）
    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }
    const allTeams = ApiService.getTeams();
    const myTeam = allTeams.find(tm =>
      (tm.captainUid && tm.captainUid === curUser.uid) ||
      (tm.captain && tm.captain === curUser.displayName) ||
      (tm.coaches || []).includes(curUser.displayName)
    );
    if (!myTeam) {
      this.showToast('您尚未管理任何俱樂部');
      return;
    }

    if (!t.registeredTeams) t.registeredTeams = [];
    if (t.registeredTeams.includes(myTeam.id)) {
      this.showToast('您的俱樂部已報名此賽事');
      return;
    }
    if (t.registeredTeams.length >= (this._getFriendlyTournamentTeamLimit?.(t) || t.maxTeams || 999)) {
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
    const msgBody = `「${myTeam.name}」申請報名賽事「${t.name}」，請審核此申請。\n\n申請人：${curUser.displayName}\n俱樂部：${myTeam.name}`;
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
        return `<a href="${mapUrl}" target="sporthub_map" rel="noopener" style="color:var(--primary);text-decoration:none;font-size:.82rem">${escapeHTML(v)} ↗</a>`;
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
    if (feeEnabled) {
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">報名費</span><div class="td-info-value" style="font-weight:600">NT$${feeValue.toLocaleString()} / 隊</div></div>`);
    }

    const organizerDisplay = this._getTournamentOrganizerDisplayText?.(infoTournament) || infoTournament.organizer || '主辦俱樂部';
    infoRows.push(`<div class="td-info-row"><span class="td-info-label">主辦單位</span><div class="td-info-value">${escapeHTML(organizerDisplay)}</div></div>`);

    const infoDelegates = Array.isArray(infoTournament.delegates) ? infoTournament.delegates : [];
    if (infoDelegates.length > 0) {
      const delegateTags = infoDelegates.map(d => this._userTag(d.name)).join(' ');
      infoRows.push(`<div class="td-info-row"><span class="td-info-label">委託人</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.3rem">${delegateTags}</div></div>`);
    }

    // Safety: infoRows contains escaped values; _renderTournamentDetailToolbar uses escapeHTML
    container.innerHTML = `<div class="td-info-card">${infoRows.join('')}</div>`;
    this._renderTournamentDetailToolbar(infoTournament);
  },

  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = ApiService.getTournament(this.currentTournament);
    if (!t) return;

    if (tab === 'info') {
      const desc = t.description || '';
      // Safety: t.contentImage is admin-uploaded URL; desc is escaped
      const contentImgHTML = t.contentImage ? `<div style="padding:0 .8rem .8rem"><img src="${t.contentImage}" alt="賽事內容圖片" style="width:100%;border-radius:var(--radius);display:block"></div>` : '';
      container.innerHTML = desc
        ? `<div style="padding:.8rem;font-size:.88rem;line-height:1.7;white-space:pre-wrap;color:var(--text-primary)">${escapeHTML(desc)}</div>${contentImgHTML}`
        : `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">${I18N.t('tournament.noDescription')}</div>${contentImgHTML}`;
    } else if (tab === 'teams') {
      const teamIds = t.registeredTeams || [];
      if (teamIds.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">' + I18N.t('tournament.noTeams') + '</div>';
        return;
      }
      const allTeams = ApiService.getTeams();
      const registered = teamIds.map(id => allTeams.find(tm => tm.id === id)).filter(Boolean);
      // Safety: _teamCardHTML returns pre-escaped markup
      container.innerHTML = `<div class="team-grid" style="padding:.5rem .4rem">${registered.map(tm => this._teamCardHTML({...tm, pinned: false})).join('')}</div>`;
    } else if (tab === 'schedule') {
      const ft = this.getFriendlyTournamentRecord?.(t) || t;
      const matchDates = ft.matchDates || [];
      const matches = ApiService.getMatches?.() || [];
      const tournamentMatches = matches.filter(function (m) { return m.tournamentId === ft.id; });
      if (matchDates.length === 0 && tournamentMatches.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">' + I18N.t('tournament.noSchedule') + '</div>';
        return;
      }
      let schedHtml = '<div style="padding:.6rem">';
      if (matchDates.length > 0) {
        schedHtml += '<div class="td-card"><div class="td-card-title">' + I18N.t('tournament.matchDays') + '</div>';
        matchDates.forEach(function (date, i) {
          schedHtml += '<div class="td-info-row"><span class="td-info-label">Day ' + (i + 1) + '</span><span class="td-info-value">' + escapeHTML(date) + '</span></div>';
        });
        schedHtml += '</div>';
      }
      if (tournamentMatches.length > 0) {
        schedHtml += '<div class="td-card"><div class="td-card-title">' + I18N.t('tournament.matchResults') + '</div>';
        tournamentMatches.forEach(function (m) {
          var scoreH = m.scoreH != null ? m.scoreH : '-';
          var scoreA = m.scoreA != null ? m.scoreA : '-';
          schedHtml += '<div class="td-history-row"><span class="td-history-name">' + escapeHTML(m.home || '') + '</span><span class="td-history-result">' + scoreH + ' : ' + scoreA + '</span><span class="td-history-name" style="text-align:right">' + escapeHTML(m.away || '') + '</span></div>';
        });
        schedHtml += '</div>';
      }
      schedHtml += '</div>';
      container.innerHTML = schedHtml;
    } else if (tab === 'stats') {
      const ft2 = this.getFriendlyTournamentRecord?.(t) || t;
      const entries = ft2.teamEntries || [];
      const applications = ft2.teamApplications || [];
      if (entries.length === 0 && applications.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">' + I18N.t('tournament.noStats') + '</div>';
        return;
      }
      var approved = entries.filter(function (e) { return e.entryStatus === 'approved' || e.entryStatus === 'host'; }).length;
      var pending = applications.filter(function (a) { return a.status === 'pending'; }).length;
      var rosterTotal = entries.reduce(function (sum, e) { return sum + (e.memberRoster ? e.memberRoster.length : 0); }, 0);
      let statsHtml = '<div style="padding:.6rem">';
      statsHtml += '<div class="td-card"><div class="td-card-title">' + I18N.t('tournament.statsSummary') + '</div>';
      statsHtml += '<div class="td-stats-row">';
      statsHtml += '<div class="td-stat"><div class="td-stat-num">' + approved + '</div><div class="td-stat-label">' + I18N.t('tournament.approvedTeams') + '</div></div>';
      statsHtml += '<div class="td-stat"><div class="td-stat-num">' + pending + '</div><div class="td-stat-label">' + I18N.t('tournament.pendingTeams') + '</div></div>';
      statsHtml += '<div class="td-stat"><div class="td-stat-num">' + rosterTotal + '</div><div class="td-stat-label">' + I18N.t('tournament.totalPlayers') + '</div></div>';
      statsHtml += '</div></div>';
      statsHtml += '</div>';
      container.innerHTML = statsHtml;
    }
  },

  // renderLeagueSchedule / renderBracket — 已刪除（Phase 1b 死代碼清理）

});
