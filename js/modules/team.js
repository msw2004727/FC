/* ================================================
   SportHub — Team (Render + CRUD + Admin Management)
   ================================================ */

Object.assign(App, {

  _teamEditId: null,
  _teamCaptainUid: null,
  _teamCoachUids: [],

  /**
   * 接收 _recalcUserRole 結果，發送站內信 + 寫操作日誌
   */
  _applyRoleChange(result) {
    if (!result) return;
    const { uid, oldRole, newRole, userName } = result;
    const isUpgrade = (ROLE_LEVEL_MAP[newRole] || 0) > (ROLE_LEVEL_MAP[oldRole] || 0);
    const roleName = ROLES[newRole]?.label || newRole;
    const action = isUpgrade ? '晉升' : '調整';
    this._sendNotifFromTemplate('role_upgrade', {
      userName, roleName,
    }, uid, 'private', '私訊');
    ApiService._writeOpLog('role', '角色變更', `${userName} 自動${action}為「${roleName}」（原：${ROLES[oldRole]?.label || oldRole}）`);
  },

  _getTeamRank(teamExp) {
    const exp = teamExp || 0;
    for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
      const cfg = TEAM_RANK_CONFIG[i];
      if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
    }
    return { rank: 'E', color: '#6b7280' };
  },

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return 0;
    });
  },

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    const color = t.color || '#6b7280';
    const rank = this._getTeamRank(t.teamExp);
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">置頂</div>' : ''}
        ${t.image
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0"><img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`
          : `<div class="tc-img-placeholder" style="position:relative">球隊圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}</div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.memberLabel')}</span><span>${t.members} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    const sorted = this._sortTeams(ApiService.getActiveTeams());
    container.innerHTML = sorted.map(t => this._teamCardHTML(t)).join('');
  },

  filterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const container = document.getElementById('team-list');

    let filtered = ApiService.getActiveTeams();
    if (query) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.nameEn || '').toLowerCase().includes(query) ||
        t.captain.toLowerCase().includes(query)
      );
    }
    if (region) {
      filtered = filtered.filter(t => t.region === region);
    }

    const sorted = this._sortTeams(filtered);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${t('team.noMatch')}</div>`;
  },

  showTeamDetail(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';

    const imgEl = document.getElementById('team-detail-img');
    const detailRank = this._getTeamRank(t.teamExp);
    imgEl.style.position = 'relative';
    if (t.image) {
      imgEl.innerHTML = `<img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    } else {
      imgEl.innerHTML = `球隊封面 800 × 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    }

    const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
    const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.info')}</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.captain')}</span><span class="td-card-value">${t.captain ? this._userTag(t.captain, 'captain') : I18N.t('teamDetail.notSet')}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.coach')}</span><span class="td-card-value">${(t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : I18N.t('teamDetail.none')}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.memberCount')}</span><span class="td-card-value">${t.members} ${I18N.t('teamDetail.personUnit')}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.region')}</span><span class="td-card-value">${escapeHTML(t.region)}</span></div>
          ${t.nationality ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.nationality')}</span><span class="td-card-value">${escapeHTML(t.nationality)}</span></div>` : ''}
          ${t.founded ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.founded')}</span><span class="td-card-value">${escapeHTML(t.founded)}</span></div>` : ''}
          ${t.contact ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.contact')}</span><span class="td-card-value">${escapeHTML(t.contact)}</span></div>` : ''}
        </div>
      </div>
      ${t.bio ? `<div class="td-card">
        <div class="td-card-title" style="text-align:center">${I18N.t('teamDetail.bio')}</div>
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(t.bio)}</div>
      </div>` : ''}
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.record')}</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.wins')}</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.draws')}</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.losses')}</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">${I18N.t('teamDetail.winRate')}</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalsFor')}</span><span class="td-card-value">${t.gf || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalsAgainst')}</span><span class="td-card-value">${t.ga || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalDiff')}</span><span class="td-card-value">${(t.gf || 0) - (t.ga || 0) > 0 ? '+' : ''}${(t.gf || 0) - (t.ga || 0)}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.totalGames')}</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title profile-collapse-toggle" onclick="App.toggleProfileSection(this,'teamMatch')">
          <span>${I18N.t('teamDetail.matchHistory')}</span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        <div class="profile-collapse-content" style="display:none">
          ${(t.history || []).map(h => `
            <div class="td-history-row">
              <span class="td-history-name">${escapeHTML(h.name)}</span>
              <span class="td-history-result">${escapeHTML(h.result)}</span>
            </div>
          `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">' + I18N.t('teamDetail.noHistory') + '</div>'}
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title profile-collapse-toggle" onclick="App.toggleProfileSection(this,'teamMembers')">
          <span>${I18N.t('teamDetail.memberList')}</span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        <div class="profile-collapse-content td-member-tags" style="display:none">
          ${(() => {
            const tags = [];
            if (t.captain) {
              tags.push(`<span class="user-capsule uc-captain" onclick="App.showUserProfile('${escapeHTML(t.captain)}')" title="${I18N.t('teamDetail.captain')}">${I18N.t('teamDetail.captain')} ${escapeHTML(t.captain)}</span>`);
            }
            (t.coaches || []).forEach(c => {
              tags.push(`<span class="user-capsule uc-coach" onclick="App.showUserProfile('${escapeHTML(c)}')" title="${I18N.t('teamDetail.coach')}">${I18N.t('teamDetail.coach')} ${escapeHTML(c)}</span>`);
            });
            // 查詢 teamId 匹配的真實用戶（排除領隊與教練）
            const allUsers = ApiService.getAdminUsers() || [];
            const teamMembers = allUsers.filter(u => u.teamId === t.id);
            const captainCoachNames = new Set([t.captain, ...(t.coaches || [])].filter(Boolean));
            const regularMembers = teamMembers.filter(u => !captainCoachNames.has(u.name));
            regularMembers.slice(0, 20).forEach(u => {
              tags.push(`<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(u.name)}')" title="${I18N.t('team.memberLabel')}">${I18N.t('team.memberLabel')} ${escapeHTML(u.name)}</span>`);
            });
            return tags.join('');
          })()}
          ${t.members > 8 ? `<span class="td-member-more">... ${t.members} ${I18N.t('teamDetail.personUnit')}</span>` : ''}
        </div>
      </div>
      <div id="team-feed-section">${this._renderTeamFeed(t.id)}</div>
      ${(() => {
        const u = ApiService.getCurrentUser?.();
        const n = u?.displayName || '';
        const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
        const memberCanInvite = t.allowMemberInvite !== false;
        const canInvite = isCaptainCoach || (this._isTeamMember(t.id) && memberCanInvite);
        const isMember = this._isTeamMember(t.id);
        let html = '';
        // 上方區塊：邀請 QR Code + 隊員可邀請
        if (canInvite || isCaptainCoach) {
          html += `<div class="td-card" style="padding:.6rem .8rem">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">`;
          if (canInvite) html += `<button class="outline-btn" onclick="App.showTeamInviteQR('${t.id}')">${I18N.t('teamDetail.inviteQR')}</button>`;
          if (isCaptainCoach) html += `<div style="display:inline-flex;align-items:center;gap:.35rem"><span style="font-size:.72rem;color:var(--text-muted)">${I18N.t('teamDetail.memberCanInvite')}</span><label class="toggle-switch" style="margin:0;transform:scale(.8)"><input type="checkbox" ${memberCanInvite ? 'checked' : ''} onchange="App.toggleMemberInvite('${t.id}',this.checked)"><span class="toggle-slider"></span></label></div>`;
          html += `</div></div>`;
        }
        // 下方區塊：退出球隊 / 聯繫領隊（或申請加入）
        html += `<div class="td-card" style="padding:.6rem .8rem">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">`;
        if (isMember) {
          html += `<button style="background:var(--danger);color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;font-weight:600;cursor:pointer" onclick="App.handleLeaveTeam('${t.id}')">${I18N.t('teamDetail.leaveTeam')}</button>`;
        } else {
          html += `<button class="primary-btn" onclick="App.handleJoinTeam('${t.id}')">${I18N.t('teamDetail.applyJoin')}</button>`;
        }
        if (t.captain) html += `<button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(t.captain)}')">${I18N.t('teamDetail.contactCaptain')}</button>`;
        html += `</div></div>`;
        return html;
      })()}
    `;
    this.showPage('page-team-detail');
  },

  handleJoinTeam(teamId) {
    // 1. Check if user already has a team
    let currentTeamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      currentTeamId = user && user.teamId ? user.teamId : null;
    }
    if (currentTeamId) {
      const currentTeam = ApiService.getTeam(currentTeamId);
      const teamName = currentTeam ? currentTeam.name : '球隊';
      this.showToast(`您已加入「${teamName}」，無法重複加入其他球隊`);
      return;
    }

    // 2. Get target team
    const t = ApiService.getTeam(teamId);
    if (!t) { this.showToast('找不到此球隊'); return; }

    // 3. Get current user info
    const curUser = ApiService.getCurrentUser();
    const applicantUid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser.uid : null);
    const applicantName = curUser?.displayName || (ModeManager.isDemo() ? DemoData.currentUser.displayName : '未知');
    if (!applicantUid) { this.showToast('請先登入'); return; }

    const allMessages = ApiService.getMessages();
    const COOLDOWN_MS = 24 * 60 * 60 * 1000;

    // helper: parse message time string "YYYY/MM/DD HH:MM" -> ms timestamp
    const _parseTimeStr = (str) => {
      if (!str) return 0;
      const [dp, tp] = str.split(' ');
      const [y, mo, d] = (dp || '').split('/').map(Number);
      const [h, mi] = (tp || '0:0').split(':').map(Number);
      return isNaN(y) ? 0 : new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
    };

    // 4. Check for existing pending application (same team, 24h cooldown)
    const pendingMsgs = allMessages.filter(m =>
      m.actionType === 'team_join_request' &&
      m.actionStatus === 'pending' &&
      m.meta && m.meta.teamId === teamId &&
      m.meta.applicantUid === applicantUid
    );
    if (pendingMsgs.length > 0) {
      const mostRecentSentAt = Math.max(...pendingMsgs.map(m => _parseTimeStr(m.time)));
      const elapsed = Date.now() - mostRecentSentAt;
      if (elapsed < COOLDOWN_MS) {
        const hoursLeft = Math.ceil((COOLDOWN_MS - elapsed) / 3600000);
        this.showToast(`您已申請此球隊，請等候審核（可於 ${hoursLeft} 小時後再次申請）`);
        return;
      }
      // Pending > 24h: mark as ignored (superseded)
      pendingMsgs.forEach(m => {
        ApiService.updateMessage(m.id, { actionStatus: 'ignored' });
        m.actionStatus = 'ignored';
      });
    }

    // 5. Check cooldown (24h after rejection)
    const recentRejected = allMessages.find(m =>
      m.actionType === 'team_join_request' &&
      m.actionStatus === 'rejected' &&
      m.meta && m.meta.teamId === teamId &&
      m.meta.applicantUid === applicantUid &&
      m.rejectedAt && (Date.now() - m.rejectedAt) < COOLDOWN_MS
    );
    if (recentRejected) {
      const hoursLeft = Math.ceil((COOLDOWN_MS - (Date.now() - recentRejected.rejectedAt)) / 3600000);
      this.showToast(`您的申請已被拒絕，請於 ${hoursLeft} 小時後再次申請`);
      return;
    }

    // 6. Find captain UID
    const users = ApiService.getAdminUsers();
    let captainUid = t.captainUid || null;
    if (!captainUid && t.captain) {
      const capUser = users.find(u => u.name === t.captain);
      captainUid = capUser ? capUser.uid : null;
    }
    if (!captainUid) {
      this.showToast('無法找到領隊，請聯繫管理員');
      return;
    }

    // 7. Send join request message to captain
    this._deliverMessageToInbox(
      '球隊加入申請',
      `${applicantName} 申請加入「${t.name}」球隊，請審核此申請。`,
      'system', '系統', captainUid, applicantName,
      {
        actionType: 'team_join_request',
        actionStatus: 'pending',
        meta: { teamId, teamName: t.name, applicantUid, applicantName },
      }
    );

    this._grantAutoExp(applicantUid, 'join_team', t.name);
    this.showToast('已送出加入申請！');
  },

  _isTeamMember(teamId) {
    if (ModeManager.isDemo()) return this._userTeam === teamId;
    const user = ApiService.getCurrentUser();
    if (user && user.teamId === teamId) return true;
    // 也檢查是否為該隊領隊或教練
    const team = ApiService.getTeam(teamId);
    if (!team || !user) return false;
    if (team.captainUid && team.captainUid === user.uid) return true;
    if (team.captain && team.captain === user.displayName) return true;
    if ((team.coaches || []).includes(user.displayName)) return true;
    return false;
  },

  async handleLeaveTeam(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!(await this.appConfirm(`確定要退出「${t.name}」球隊？此操作無法自行撤回。`))) return;

    const curUser = ApiService.getCurrentUser();
    const userName = curUser?.displayName || (ModeManager.isDemo() ? DemoData.currentUser.displayName : '');
    const uid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser.uid : null);

    // 領隊不能退出
    if (t.captain === userName) {
      this.showToast('領隊無法退出球隊，請先轉移領隊職務');
      return;
    }

    // 如果用戶是教練，從球隊 coaches 移除
    const wasCoach = (t.coaches || []).includes(userName);
    if (wasCoach) {
      const newCoaches = t.coaches.filter(c => c !== userName);
      ApiService.updateTeam(teamId, { coaches: newCoaches });
    }

    // 清除用戶球隊資料
    if (ModeManager.isDemo()) {
      DemoData.currentUser.teamId = null;
      DemoData.currentUser.teamName = null;
      this._userTeam = null;
    } else {
      ApiService.updateCurrentUser({ teamId: null, teamName: null });
    }
    // 同步 adminUsers
    const users = ApiService.getAdminUsers();
    const adminUser = users.find(u => u.uid === uid);
    if (adminUser) {
      adminUser.teamId = null;
      adminUser.teamName = null;
      if (!ModeManager.isDemo() && adminUser._docId) {
        FirebaseService.updateUser(adminUser._docId, { teamId: null, teamName: null }).catch(err => console.error('[leaveTeam]', err));
      }
    }

    // 球隊人數 -1
    ApiService.updateTeam(teamId, { members: Math.max(0, (t.members || 1) - 1) });

    // 退隊後重新計算角色（教練退隊可能需降級）
    if (wasCoach && uid) {
      this._applyRoleChange(ApiService._recalcUserRole(uid));
    }

    this.showToast(`已退出「${t.name}」`);
    this.showTeamDetail(teamId);
    this.renderTeamList();
    this.renderProfileData();
    this.renderHotEvents();
    this.renderActivityList();
  },

  goMyTeam() {
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      teamId = user && user.teamId ? user.teamId : null;
    }
    if (teamId) {
      this.showTeamDetail(teamId);
    } else {
      this.showToast('您目前沒有加入任何球隊');
    }
  },

  // ══════════════════════════════════
  //  Team Feed (動態牆)
  // ══════════════════════════════════

  _teamFeedPage: {},
  _FEED_PAGE_SIZE: 20,
  _MAX_PINNED: 5,

  _renderTeamFeed(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return '';
    const feed = t.feed || [];
    const isMember = this._isTeamMember(teamId);
    const user = ApiService.getCurrentUser?.();
    const myUid = user?.uid || '';
    const myName = user?.displayName || '';
    const isCaptainOrCoach = (t.captain === myName) || (t.coaches || []).includes(myName);

    // Sort: pinned first, then by time descending
    const sorted = [...feed].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.time || '').localeCompare(a.time || '');
    });

    // Pagination
    const currentPage = this._teamFeedPage[teamId] || 1;
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._FEED_PAGE_SIZE));
    const startIdx = (currentPage - 1) * this._FEED_PAGE_SIZE;
    const pageItems = sorted.slice(startIdx, startIdx + this._FEED_PAGE_SIZE);

    // Post form: textarea on top, button row below with public toggle on right
    const postFormHtml = isMember ? `
      <div style="margin-bottom:.5rem">
        <textarea id="team-feed-input" rows="2" maxlength="200" placeholder="${I18N.t('teamDetail.postPlaceholder')}" style="width:100%;font-size:.82rem;padding:.4rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.3rem">
          <button class="primary-btn small" onclick="App.submitTeamPost('${teamId}')">${I18N.t('teamDetail.publish')}</button>
          <div style="display:flex;align-items:center;gap:.3rem">
            <span id="team-feed-public-label" style="font-size:.72rem;color:var(--text-muted)">${I18N.t('teamDetail.public')}</span>
            <label class="toggle-switch" style="margin:0;transform:scale(.8)">
              <input type="checkbox" id="team-feed-public" checked>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>` : '';

    const postsHtml = pageItems.length > 0 ? pageItems.map(post => {
      const isAuthor = post.uid === myUid;
      const canDelete = isAuthor || isCaptainOrCoach;
      const canPin = isCaptainOrCoach;
      const publicTag = post.isPublic === false
        ? `<span style="font-size:.58rem;padding:.08rem .25rem;border-radius:3px;background:var(--bg-elevated);color:var(--text-muted);font-weight:600">${I18N.t('teamDetail.privateOnly')}</span>`
        : '';
      return `
        <div style="padding:.5rem 0;border-bottom:1px solid var(--border)${post.pinned ? ';background:var(--accent-bg);margin:0 -.5rem;padding-left:.5rem;padding-right:.5rem;border-radius:var(--radius-sm)' : ''}">
          <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
            ${this._userTag(post.name)}
            ${post.pinned ? '<span style="font-size:.6rem;padding:.1rem .3rem;border-radius:3px;background:#f59e0b;color:#fff;font-weight:700">' + I18N.t('teamDetail.pinned') + '</span>' : ''}
            ${publicTag}
            <span style="margin-left:auto;font-size:.68rem;color:var(--text-muted)">${escapeHTML(post.time)}</span>
          </div>
          <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(post.content)}</div>
          ${this._renderFeedReactions(teamId, post, myUid)}
          ${this._renderFeedComments(teamId, post, myUid, isMember)}
          <div style="display:flex;gap:.3rem;margin-top:.25rem">
            ${canPin ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-muted);cursor:pointer" onclick="App.pinTeamPost('${teamId}','${post.id}')">${post.pinned ? I18N.t('teamDetail.unpinPost') : I18N.t('teamDetail.pinPost')}</button>` : ''}
            ${canDelete ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--danger);cursor:pointer" onclick="App.deleteTeamPost('${teamId}','${post.id}')">${I18N.t('teamDetail.delete')}</button>` : ''}
          </div>
        </div>`;
    }).join('') : '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">' + I18N.t('teamDetail.noFeed') + '</div>';

    // Pagination controls
    let paginationHtml = '';
    if (totalPages > 1) {
      const prevDisabled = currentPage <= 1 ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      const nextDisabled = currentPage >= totalPages ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      paginationHtml = `
        <div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.5rem 0;font-size:.75rem">
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${prevDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage - 1})">${I18N.t('teamDetail.prevPage')}</button>
          <span style="color:var(--text-muted)">${currentPage} / ${totalPages}</span>
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${nextDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage + 1})">${I18N.t('teamDetail.nextPage')}</button>
        </div>`;
    }

    return `
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.feed')} <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${feed.length})</span></div>
        ${postFormHtml}
        ${postsHtml}
        ${paginationHtml}
      </div>`;
  },

  /** Re-render only the feed section without scrolling to top */
  _refreshTeamDetailFeed(teamId) {
    const section = document.getElementById('team-feed-section');
    if (section) {
      section.innerHTML = this._renderTeamFeed(teamId);
    } else {
      this.showTeamDetail(teamId);
    }
  },

  goTeamFeedPage(teamId, page) {
    this._teamFeedPage[teamId] = Math.max(1, page);
    this.showTeamDetail(teamId);
  },

  submitTeamPost(teamId) {
    const input = document.getElementById('team-feed-input');
    const content = (input?.value || '').trim();
    if (!content) { this.showToast('請輸入內容'); return; }
    if (content.length > 200) { this.showToast('內容不可超過 200 字'); return; }
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!t.feed) t.feed = [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const isPublic = document.getElementById('team-feed-public')?.checked !== false;
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    t.feed.push({ id: 'f_' + Date.now(), uid, name, content, time: timeStr, pinned: false, isPublic });
    this._teamFeedPage[teamId] = 1; // 發佈後跳回第一頁
    if (uid) this._grantAutoExp(uid, 'post_team_feed', content.slice(0, 20));
    this.showToast('動態已發佈');
    this._refreshTeamDetailFeed(teamId);
  },

  deleteTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    t.feed = t.feed.filter(p => p.id !== postId);
    this.showToast('動態已刪除');
    this.showTeamDetail(teamId);
  },

  pinTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.pinned) {
      // 檢查已置頂數量上限
      const pinnedCount = t.feed.filter(p => p.pinned).length;
      if (pinnedCount >= this._MAX_PINNED) {
        this.showToast(`最多只能置頂 ${this._MAX_PINNED} 則`);
        return;
      }
    }
    post.pinned = !post.pinned;
    this.showToast(post.pinned ? '已置頂' : '已取消置頂');
    this.showTeamDetail(teamId);
  },

  // ══════════════════════════════════
  //  Feed Reactions & Comments
  // ══════════════════════════════════

  _renderFeedReactions(teamId, post, myUid) {
    if (!post.reactions) post.reactions = { like: [], heart: [], cheer: [] };
    const r = post.reactions;
    const keys = [
      { key: 'like', emoji: '\u{1F44D}' },
      { key: 'heart', emoji: '\u2764\uFE0F' },
      { key: 'cheer', emoji: '\u{1F4AA}' },
    ];
    return `<div style="display:flex;gap:.4rem;margin-top:.3rem">${keys.map(k => {
      const arr = r[k.key] || [];
      const active = arr.includes(myUid);
      const bg = active ? 'var(--accent-bg, #ede9fe)' : 'var(--bg-elevated)';
      const border = active ? 'var(--primary)' : 'var(--border)';
      return `<button style="display:flex;align-items:center;gap:.2rem;padding:.15rem .4rem;border:1px solid ${border};border-radius:var(--radius-full);background:${bg};font-size:.72rem;cursor:pointer;line-height:1" onclick="event.stopPropagation();App.toggleFeedReaction('${teamId}','${post.id}','${k.key}')">${k.emoji}<span style="font-size:.68rem;color:var(--text-secondary)">${arr.length || ''}</span></button>`;
    }).join('')}</div>`;
  },

  toggleFeedReaction(teamId, postId, key) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.reactions) post.reactions = { like: [], heart: [], cheer: [] };
    const arr = post.reactions[key] || [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    if (!uid) return;
    const idx = arr.indexOf(uid);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(uid);
    post.reactions[key] = arr;
    this._refreshTeamDetailFeed(teamId);
  },

  _renderFeedComments(teamId, post, myUid, isMember) {
    const comments = post.comments || [];
    let html = '';
    if (comments.length > 0) {
      html += `<div style="margin-top:.3rem;padding-left:.5rem;border-left:2px solid var(--border)">`;
      comments.forEach(c => {
        const canDel = c.uid === myUid;
        html += `<div style="font-size:.75rem;margin-bottom:.25rem;display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap">
          <span style="font-weight:600;color:var(--text-primary)">${escapeHTML(c.name)}</span>
          <span style="color:var(--text-secondary);word-break:break-word">${escapeHTML(c.text)}</span>
          <span style="font-size:.62rem;color:var(--text-muted);margin-left:auto;flex-shrink:0">${escapeHTML(c.time)}${canDel ? ` <span style="color:var(--danger);cursor:pointer" onclick="event.stopPropagation();App.deleteFeedComment('${teamId}','${post.id}','${c.id}')">✕</span>` : ''}</span>
        </div>`;
      });
      html += `</div>`;
    }
    if (isMember) {
      html += `<div style="display:flex;gap:.3rem;margin-top:.25rem">
        <input type="text" id="fc-${post.id}" maxlength="100" placeholder="${I18N.t('teamDetail.commentPlaceholder')}" style="flex:1;font-size:.75rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);min-width:0">
        <button style="font-size:.68rem;padding:.2rem .45rem;border:1px solid var(--primary);border-radius:var(--radius-sm);background:var(--primary);color:#fff;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation();App.submitFeedComment('${teamId}','${post.id}')">${I18N.t('teamDetail.commentSubmit')}</button>
      </div>`;
    }
    return html;
  },

  submitFeedComment(teamId, postId) {
    const input = document.getElementById('fc-' + postId);
    const text = (input?.value || '').trim();
    if (!text) return;
    if (text.length > 100) { this.showToast('留言不可超過 100 字'); return; }
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.comments) post.comments = [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    post.comments.push({ id: 'c_' + Date.now(), uid, name, text, time: timeStr });
    this._refreshTeamDetailFeed(teamId);
  },

  deleteFeedComment(teamId, postId, commentId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post || !post.comments) return;
    post.comments = post.comments.filter(c => c.id !== commentId);
    this._refreshTeamDetailFeed(teamId);
  },

  toggleMemberInvite(teamId, allowed) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    t.allowMemberInvite = allowed;
    ApiService.updateTeam(teamId, { allowMemberInvite: allowed });
    this.showToast(allowed ? '已開放隊員邀請' : '已關閉隊員邀請');
  },

  // ══════════════════════════════════
  //  Team Invite QR Code
  // ══════════════════════════════════

  showTeamInviteQR(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    const url = `${location.origin}${location.pathname}?team=${teamId}`;
    // Remove existing overlay if any
    const existing = document.getElementById('qr-invite-overlay');
    if (existing) existing.remove();
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'qr-invite-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card,#fff);border-radius:14px;padding:1.2rem;text-align:center;max-width:320px;width:88%';
    card.innerHTML = `
      <div style="font-size:.95rem;font-weight:700;margin-bottom:.5rem">${escapeHTML(t.name)} — 邀請加入</div>
      <div id="qr-invite-target" style="display:flex;justify-content:center;margin:.5rem 0"></div>
      <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:.5rem;word-break:break-all;user-select:all">${escapeHTML(url)}</div>
      <div style="display:flex;gap:.5rem;justify-content:center;margin-top:.6rem">
        <button id="qr-copy-btn" style="padding:.4rem 1rem;border:1px solid var(--primary,#3b82f6);border-radius:8px;background:transparent;color:var(--primary,#3b82f6);font-size:.82rem;cursor:pointer">複製連結</button>
        <button style="padding:.4rem 1rem;border:none;border-radius:8px;background:var(--primary,#3b82f6);color:#fff;font-size:.82rem;cursor:pointer" onclick="document.getElementById('qr-invite-overlay').remove()">關閉</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    // Copy button
    document.getElementById('qr-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => { App.showToast('邀請連結已複製'); }).catch(() => { App.showToast('複製失敗'); });
    });
    // Generate QR code (client-side → API fallback)
    const target = document.getElementById('qr-invite-target');
    if (target) {
      const apiFallback = () => {
        target.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=${encodeURIComponent(url)}" style="width:200px;height:200px;display:block" alt="QR Code" onerror="this.parentElement.innerHTML='<div style=\\'font-size:.78rem;color:var(--danger)\\'>QR Code 產生失敗</div>'">`;
      };
      if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
        QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
          .then(dataUrl => { target.innerHTML = `<img src="${dataUrl}" style="width:200px;height:200px;display:block" alt="QR Code">`; })
          .catch(() => apiFallback());
      } else {
        // 動態載入 QR Code 產生器
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
        s.onload = () => {
          if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
            QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
              .then(dataUrl => { target.innerHTML = `<img src="${dataUrl}" style="width:200px;height:200px;display:block" alt="QR Code">`; })
              .catch(() => apiFallback());
          } else { apiFallback(); }
        };
        s.onerror = () => apiFallback();
        document.head.appendChild(s);
      }
    }
  },

  // ══════════════════════════════════
  //  Team Form (Create / Edit)
  // ══════════════════════════════════

  _isTeamOwner(t) {
    if (ModeManager.isDemo()) {
      return t.id === this._userTeam;
    }
    const user = ApiService.getCurrentUser();
    return user && user.teamId === t.id;
  },

  _resetTeamForm() {
    document.getElementById('ct-team-name').value = '';
    document.getElementById('ct-team-name-en').value = '';
    document.getElementById('ct-team-nationality').value = '台灣';
    document.getElementById('ct-team-region').value = '';
    document.getElementById('ct-team-founded').value = '';
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-selected').innerHTML = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    document.getElementById('ct-captain-display').innerHTML = '';
    document.getElementById('ct-captain-transfer').style.display = 'none';
    document.getElementById('ct-team-contact').value = '';
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-tags').innerHTML = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    document.getElementById('ct-team-bio').value = '';
    this._teamCaptainUid = null;
    this._teamCoachUids = [];
    const preview = document.getElementById('ct-team-preview');
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    const fileInput = document.getElementById('ct-team-image');
    if (fileInput) fileInput.value = '';
  },

  _getCurrentUserName() {
    if (ModeManager.isDemo()) return DemoData.currentUser.displayName;
    const user = ApiService.getCurrentUser();
    return user ? user.displayName : '';
  },

  _getCurrentUserUid() {
    if (ModeManager.isDemo()) return DemoData.currentUser.uid;
    const user = ApiService.getCurrentUser();
    return user ? user.uid : '';
  },

  showTeamForm(id) {
    this._teamEditId = id || null;
    const titleEl = document.getElementById('ct-team-modal-title');
    const saveBtn = document.getElementById('ct-team-save-btn');
    const captainDisplay = document.getElementById('ct-captain-display');
    const captainTransfer = document.getElementById('ct-captain-transfer');

    if (id) {
      const t = ApiService.getTeam(id);
      if (!t) return;
      titleEl.textContent = '編輯球隊';
      saveBtn.textContent = '儲存變更';
      document.getElementById('ct-team-name').value = t.name || '';
      document.getElementById('ct-team-name-en').value = t.nameEn || '';
      document.getElementById('ct-team-nationality').value = t.nationality || '';
      document.getElementById('ct-team-region').value = t.region || '';
      document.getElementById('ct-team-founded').value = t.founded || '';
      document.getElementById('ct-team-contact').value = t.contact || '';
      document.getElementById('ct-team-bio').value = t.bio || '';

      // 編輯模式：顯示目前領隊 + 轉移搜尋
      captainDisplay.style.display = '';
      captainDisplay.innerHTML = `目前領隊：<span style="color:var(--accent)">${escapeHTML(t.captain || '（未設定）')}</span>`;
      captainTransfer.style.display = '';
      const captainHint = captainTransfer.querySelector('.ct-captain-hint');
      if (captainHint) captainHint.style.display = '';

      // 預設保留原領隊
      this._teamCaptainUid = null;
      document.getElementById('ct-captain-search').value = '';
      document.getElementById('ct-captain-selected').innerHTML = '';
      if (t.captain) {
        const users = ApiService.getAdminUsers();
        const found = users.find(u => u.name === t.captain);
        this._teamCaptainUid = found ? found.uid : '__legacy__';
      }

      // Restore coaches
      this._teamCoachUids = [];
      document.getElementById('ct-coach-search').value = '';
      document.getElementById('ct-coach-tags').innerHTML = '';
      if (t.coaches && t.coaches.length) {
        const users = ApiService.getAdminUsers();
        t.coaches.forEach(cName => {
          const found = users.find(u => u.name === cName);
          if (found) {
            this.selectTeamCoach(found.uid);
          } else {
            this._teamCoachUids.push('__legacy_' + cName);
            this._renderCoachTags();
          }
        });
      }

      const preview = document.getElementById('ct-team-preview');
      if (t.image) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `url(${t.image})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.classList.add('has-image');
      } else {
        preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
        preview.style.backgroundImage = '';
        preview.classList.remove('has-image');
      }
    } else {
      // 新增模式：領隊由搜尋選取，呈現方式與教練相同
      titleEl.textContent = '新增球隊';
      saveBtn.textContent = '建立球隊';
      this._resetTeamForm();

      captainDisplay.style.display = 'none';
      captainTransfer.style.display = '';
      const captainHint = captainTransfer.querySelector('.ct-captain-hint');
      if (captainHint) captainHint.style.display = 'none';
      this._teamCaptainUid = null;
    }
    this.showModal('create-team-modal');
  },

  async handleSaveTeam() {
    const name = document.getElementById('ct-team-name').value.trim();
    const nameEn = document.getElementById('ct-team-name-en').value.trim();
    const nationality = document.getElementById('ct-team-nationality').value;
    const region = document.getElementById('ct-team-region').value;
    const founded = document.getElementById('ct-team-founded').value;
    const contact = document.getElementById('ct-team-contact').value.trim();
    const bio = document.getElementById('ct-team-bio').value.trim();

    if (!name) { this.showToast('請輸入球隊名稱'); return; }

    // ── 記錄舊職位（編輯模式用於降級檢查）──
    let oldCaptainUid = null;
    let oldCoachUids = [];
    if (this._teamEditId) {
      const oldTeam = ApiService.getTeam(this._teamEditId);
      if (oldTeam) {
        oldCaptainUid = oldTeam.captainUid || null;
        // 如果沒有 captainUid 但有 captain name，嘗試反查 uid
        if (!oldCaptainUid && oldTeam.captain) {
          const capUser = ApiService.getAdminUsers().find(u => u.name === oldTeam.captain);
          oldCaptainUid = capUser ? capUser.uid : null;
        }
        // 收集舊教練 uid
        (oldTeam.coaches || []).forEach(cName => {
          const cUser = ApiService.getAdminUsers().find(u => u.name === cName);
          if (cUser) oldCoachUids.push(cUser.uid);
        });
      }
    }

    // Resolve captain name
    const users = ApiService.getAdminUsers();
    let captain = '';
    if (this._teamCaptainUid) {
      if (this._teamCaptainUid === '__legacy__') {
        // 編輯模式下保留原領隊名稱
        const t = this._teamEditId ? ApiService.getTeam(this._teamEditId) : null;
        captain = t ? t.captain : '';
      } else {
        const capUser = users.find(u => u.uid === this._teamCaptainUid);
        captain = capUser ? capUser.name : '';
      }
    }

    // Resolve coach names
    const coaches = this._teamCoachUids.map(uid => {
      if (uid.startsWith('__legacy_')) return uid.replace('__legacy_', '');
      const u = users.find(u => u.uid === uid);
      return u ? u.name : '';
    }).filter(Boolean);

    // 新教練 uid 集合（排除 legacy）
    const newCoachUids = this._teamCoachUids.filter(uid => !uid.startsWith('__legacy_'));

    // ── 降級確認（編輯模式：預覽被移除成員的角色變更）──
    if (this._teamEditId) {
      const newCaptainUidCheck = (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') ? this._teamCaptainUid : oldCaptainUid;
      // 預覽移除職位後的新角色（不實際修改）
      const previewNewRole = (uid) => {
        const u = users.find(u => u.uid === uid);
        if (!u) return null;
        if ((ROLE_LEVEL_MAP[u.role] || 0) >= ROLE_LEVEL_MAP['venue_owner']) return null;
        let highestTeamLevel = 0;
        ApiService.getTeams().forEach(t => {
          if (t.id === this._teamEditId) return; // 排除正在編輯的球隊
          if (t.captainUid === uid || t.captain === u.name) {
            highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['captain']);
          }
          if ((t.coaches || []).includes(u.name)) {
            highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
          }
        });
        const manualLevel = ROLE_LEVEL_MAP[u.manualRole] || 0;
        const targetLevel = Math.max(highestTeamLevel, manualLevel);
        const levelToRole = Object.entries(ROLE_LEVEL_MAP).reduce((m, [k, v]) => { m[v] = k; return m; }, {});
        return levelToRole[targetLevel] || 'user';
      };
      const demotionInfo = [];
      if (oldCaptainUid && oldCaptainUid !== newCaptainUidCheck) {
        const u = users.find(u => u.uid === oldCaptainUid);
        if (u) {
          const newRole = previewNewRole(oldCaptainUid);
          if (newRole && newRole !== u.role) {
            demotionInfo.push({ name: u.name, oldLabel: ROLES[u.role]?.label || u.role, newLabel: ROLES[newRole]?.label || newRole });
          }
        }
      }
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          const u = users.find(u => u.uid === uid);
          if (u) {
            const newRole = previewNewRole(uid);
            if (newRole && newRole !== u.role) {
              demotionInfo.push({ name: u.name, oldLabel: ROLES[u.role]?.label || u.role, newLabel: ROLES[newRole]?.label || newRole });
            }
          }
        }
      });
      if (demotionInfo.length > 0) {
        const table = demotionInfo.map(d => `  ${d.name}：${d.oldLabel} → ${d.newLabel}`).join('\n');
        if (!(await this.appConfirm(`以下成員將被移除職位，角色將自動調整：\n\n${table}\n\n確定要儲存？`))) return;
      }
    }

    const members = this._teamEditId
      ? (captain ? 1 : 0) + coaches.length
      : 0;

    const preview = document.getElementById('ct-team-preview');
    let image = null;
    const imgEl = preview.querySelector('img');
    if (imgEl) {
      image = imgEl.src;
    } else {
      const bgImg = preview.style.backgroundImage;
      if (bgImg && bgImg !== 'none' && bgImg !== '') {
        image = bgImg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
      }
    }

    if (this._teamEditId) {
      const updates = { name, nameEn, nationality, region, founded, contact, bio, captain, captainUid: this._teamCaptainUid || null, coaches, members };
      if (image) updates.image = image;
      ApiService.updateTeam(this._teamEditId, updates);
      ApiService._writeOpLog('team_edit', '編輯球隊', `編輯「${name}」`);
      // ── 球隊職位變更日誌 ──
      const newCapUid = (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') ? this._teamCaptainUid : null;
      if (oldCaptainUid && newCapUid && oldCaptainUid !== newCapUid) {
        const oldCapName = users.find(u => u.uid === oldCaptainUid)?.name || '?';
        ApiService._writeOpLog('team_position', '球隊職位變更', `「${name}」領隊由「${oldCapName}」轉移至「${captain}」`);
      } else if (!oldCaptainUid && newCapUid) {
        ApiService._writeOpLog('team_position', '球隊職位變更', `設定「${captain}」為「${name}」領隊`);
      }
      newCoachUids.forEach(uid => {
        if (!oldCoachUids.includes(uid)) {
          const cName = users.find(u => u.uid === uid)?.name || '?';
          ApiService._writeOpLog('team_position', '球隊職位變更', `新增「${cName}」為「${name}」教練`);
        }
      });
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          const cName = users.find(u => u.uid === uid)?.name || '?';
          ApiService._writeOpLog('team_position', '球隊職位變更', `移除「${cName}」的「${name}」教練職位`);
        }
      });
      this.showToast('球隊資料已更新');
    } else {
      const data = {
        id: generateId('tm_'),
        name, nameEn, nationality, captain, captainUid: this._teamCaptainUid || null, coaches, members,
        region, founded, contact, bio, image,
        active: true, pinned: false, pinOrder: 0,
        wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
        history: [],
      };
      ApiService.createTeam(data);
      ApiService._writeOpLog('team_create', '建立球隊', `建立「${name}」`);
      // ── 新建球隊職位日誌 ──
      if (captain) {
        ApiService._writeOpLog('team_position', '球隊職位變更', `設定「${captain}」為「${name}」領隊`);
      }
      coaches.forEach(c => {
        ApiService._writeOpLog('team_position', '球隊職位變更', `新增「${c}」為「${name}」教練`);
      });
      this.showToast('球隊建立成功！');
    }

    // ── 自動升級領隊/教練權限 + 發送通知 ──
    const allUsers = ApiService.getAdminUsers();
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') {
      const capUser = allUsers.find(u => u.uid === this._teamCaptainUid);
      if (capUser && (ROLE_LEVEL_MAP[capUser.role] || 0) < ROLE_LEVEL_MAP['captain']) {
        const oldRole = capUser.role;
        ApiService.promoteUser(capUser.name, 'captain');
        this._sendNotifFromTemplate('role_upgrade', {
          userName: capUser.name, roleName: ROLES['captain'].label,
        }, capUser.uid, 'private', '私訊');
        ApiService._writeOpLog('role', '角色變更', `${capUser.name} 自動晉升為「${ROLES['captain'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
      }
    }
    this._teamCoachUids.forEach(uid => {
      if (uid.startsWith('__legacy_')) return;
      const coachUser = allUsers.find(u => u.uid === uid);
      if (coachUser && (ROLE_LEVEL_MAP[coachUser.role] || 0) < ROLE_LEVEL_MAP['coach']) {
        const oldRole = coachUser.role;
        ApiService.promoteUser(coachUser.name, 'coach');
        this._sendNotifFromTemplate('role_upgrade', {
          userName: coachUser.name, roleName: ROLES['coach'].label,
        }, coachUser.uid, 'private', '私訊');
        ApiService._writeOpLog('role', '角色變更', `${coachUser.name} 自動晉升為「${ROLES['coach'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
      }
    });

    // ── 球隊職位指派通知 ──
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') {
      const isNewCaptain = !oldCaptainUid || oldCaptainUid !== this._teamCaptainUid;
      if (isNewCaptain) {
        this._deliverMessageToInbox(
          '球隊職位指派',
          `您已被設為「${name}」的領隊。`,
          'system', '系統', this._teamCaptainUid, '系統'
        );
      }
    }
    newCoachUids.forEach(uid => {
      if (!oldCoachUids.includes(uid)) {
        this._deliverMessageToInbox(
          '球隊職位指派',
          `您已被設為「${name}」的教練。`,
          'system', '系統', uid, '系統'
        );
      }
    });

    // ── 自動降級：被移除的領隊/教練 ──
    if (this._teamEditId) {
      const newCaptainUid = (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') ? this._teamCaptainUid : oldCaptainUid;
      // 舊領隊不再是新領隊 → recalc
      if (oldCaptainUid && oldCaptainUid !== newCaptainUid) {
        this._applyRoleChange(ApiService._recalcUserRole(oldCaptainUid));
      }
      // 被移除的教練 → recalc
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          this._applyRoleChange(ApiService._recalcUserRole(uid));
        }
      });
    }

    this.closeModal();
    this._teamEditId = null;
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
  },

  // ── Captain / Coach Search & Select ──

  _teamSearchUsers(query, excludeUids) {
    const users = ApiService.getAdminUsers();
    const q = query.toLowerCase();
    return users.filter(u =>
      !excludeUids.includes(u.uid) &&
      (u.name.toLowerCase().includes(q) || u.uid.toLowerCase().includes(q))
    ).slice(0, 5);
  },

  _renderSuggestList(containerId, results, onSelectFn) {
    const el = document.getElementById(containerId);
    if (!results.length) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.innerHTML = results.map(u =>
      `<div class="team-user-suggest-item" onclick="App.${onSelectFn}('${escapeHTML(u.uid)}')">
        <span class="tus-name">${escapeHTML(u.name)}</span>
        <span class="tus-uid">${escapeHTML(u.uid)}</span>
      </div>`
    ).join('');
    el.classList.add('show');
  },

  searchTeamCaptain() {
    const q = document.getElementById('ct-captain-search').value.trim();
    if (!q) { document.getElementById('ct-captain-suggest').classList.remove('show'); return; }
    const exclude = [];
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') exclude.push(this._teamCaptainUid);
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-captain-suggest', results, 'selectTeamCaptain');
  },

  selectTeamCaptain(uid) {
    const users = ApiService.getAdminUsers();
    const user = users.find(u => u.uid === uid);
    if (!user) return;
    this._teamCaptainUid = uid;
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    const prefix = this._teamEditId ? '轉移至：' : '';
    document.getElementById('ct-captain-selected').innerHTML =
      `<span class="team-tag">${prefix}${user.name}<span class="team-tag-x" onclick="App.clearTeamCaptain()">×</span></span>`;
  },

  clearTeamCaptain() {
    // 編輯模式：恢復原領隊
    if (this._teamEditId) {
      const t = ApiService.getTeam(this._teamEditId);
      if (t && t.captain) {
        const users = ApiService.getAdminUsers();
        const found = users.find(u => u.name === t.captain);
        this._teamCaptainUid = found ? found.uid : '__legacy__';
      } else {
        this._teamCaptainUid = null;
      }
    } else {
      // 新增模式：清除至空
      this._teamCaptainUid = null;
    }
    document.getElementById('ct-captain-selected').innerHTML = '';
  },

  searchTeamCoach() {
    const q = document.getElementById('ct-coach-search').value.trim();
    if (!q) { document.getElementById('ct-coach-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamCoachUids];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-coach-suggest', results, 'selectTeamCoach');
  },

  selectTeamCoach(uid) {
    if (this._teamCoachUids.includes(uid)) return;
    this._teamCoachUids.push(uid);
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    this._renderCoachTags();
  },

  removeTeamCoach(uid) {
    this._teamCoachUids = this._teamCoachUids.filter(u => u !== uid);
    this._renderCoachTags();
  },

  _renderCoachTags() {
    const users = ApiService.getAdminUsers();
    document.getElementById('ct-coach-tags').innerHTML = this._teamCoachUids.map(uid => {
      if (uid.startsWith('__legacy_')) {
        const legacyName = uid.replace('__legacy_', '');
        return `<span class="team-tag">${legacyName}<span class="team-tag-x" onclick="App.removeTeamCoach('${uid}')">×</span></span>`;
      }
      const u = users.find(u => u.uid === uid);
      return u ? `<span class="team-tag">${u.name}<span class="team-tag-x" onclick="App.removeTeamCoach('${uid}')">×</span></span>` : '';
    }).join('');
  },

  async removeTeam(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要刪除「${t.name}」？此操作無法復原。`))) return;
    const tName = t.name;

    // 刪隊前收集領隊 + 教練 uid，用於刪隊後降級檢查
    const affectedUids = [];
    const allUsers = ApiService.getAdminUsers();
    if (t.captainUid) {
      affectedUids.push(t.captainUid);
    } else if (t.captain) {
      const capUser = allUsers.find(u => u.name === t.captain);
      if (capUser) affectedUids.push(capUser.uid);
    }
    (t.coaches || []).forEach(cName => {
      const cUser = allUsers.find(u => u.name === cName);
      if (cUser && !affectedUids.includes(cUser.uid)) affectedUids.push(cUser.uid);
    });

    ApiService.deleteTeam(id);
    // Demo 模式：同步清除 _userTeam
    if (ModeManager.isDemo() && this._userTeam === id) this._userTeam = null;
    ApiService._writeOpLog('team_delete', '刪除球隊', `刪除「${tName}」`);

    // 刪隊後逐一重新計算角色
    affectedUids.forEach(uid => {
      this._applyRoleChange(ApiService._recalcUserRole(uid));
    });

    this.showToast(`已刪除「${tName}」`);
    this.showPage('page-teams');
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
    this.renderProfileData();
    this.renderHotEvents();
    this.renderActivityList();
  },

  // ══════════════════════════════════
  //  Team Manage Page (Captain+)
  // ══════════════════════════════════

  renderTeamManage(filter) {
    const container = document.getElementById('team-manage-list');
    if (!container) return;

    const tabs = document.getElementById('team-manage-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderTeamManage(tab.dataset.tab);
        });
      });
    }

    const currentFilter = filter || tabs?.querySelector('.tab.active')?.dataset.tab || 'my-teams';
    const isAdmin = ROLE_LEVEL_MAP[this.currentRole] >= ROLE_LEVEL_MAP['admin'];

    let teams;
    if (currentFilter === 'my-teams' && !isAdmin) {
      teams = ApiService.getTeams().filter(t => this._isTeamOwner(t));
    } else {
      teams = ApiService.getTeams();
    }

    if (!teams.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無球隊資料</div>';
      return;
    }

    const activeTeams = teams.filter(t => t.active);
    const inactiveTeams = teams.filter(t => !t.active);
    const renderCard = (t) => {
      const canEdit = isAdmin || this._isTeamOwner(t);
      const dim = !t.active ? ' team-inactive' : '';
      return `
      <div class="event-card${dim}">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            <span style="font-size:.72rem;color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.captain)}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            ${canEdit ? `<button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>` : ''}
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
            ${canEdit ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam('${t.id}')">刪除</button>` : ''}
          </div>
        </div>
      </div>`;
    };
    let html = activeTeams.map(renderCard).join('');
    if (inactiveTeams.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架球隊</div>';
      html += inactiveTeams.map(renderCard).join('');
    }
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Admin Team Management
  // ══════════════════════════════════

  _pinCounter: 100,

  filterAdminTeams() {
    const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
    this.renderAdminTeams(q);
  },

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t => t.name.toLowerCase().includes(q) || (t.nameEn || '').toLowerCase().includes(q) || t.captain.includes(q) || t.region.includes(q));
    if (!teams.length) {
      container.innerHTML = '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的球隊</div>';
      return;
    }
    const activeT = teams.filter(t => t.active);
    const inactiveT = teams.filter(t => !t.active);
    const adminCard = (t) => {
      const dim = !t.active ? ' team-inactive' : '';
      return `
      <div class="event-card${dim}">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.captain)}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消置頂' : '置頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam('${t.id}')">刪除</button>
          </div>
        </div>
      </div>`;
    };
    let html = activeT.map(adminCard).join('');
    if (inactiveT.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架球隊</div>';
      html += inactiveT.map(adminCard).join('');
    }
    container.innerHTML = html;
  },

  toggleTeamPin(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) {
      this._pinCounter++;
      t.pinOrder = this._pinCounter;
    } else {
      t.pinOrder = 0;
    }
    ApiService.updateTeam(id, { pinned: t.pinned, pinOrder: t.pinOrder });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.pinned ? `已置頂「${t.name}」` : `已取消置頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.renderTeamManage();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

});
