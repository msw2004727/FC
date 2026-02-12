/* ================================================
   SportHub — Team (Render + CRUD + Admin Management)
   ================================================ */

Object.assign(App, {

  _teamEditId: null,
  _teamCaptainUid: null,
  _teamCoachUids: [],

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
        ${t.pinned ? '<div class="tc-pin-badge">至頂</div>' : ''}
        ${t.image
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0"><img src="${t.image}" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`
          : `<div class="tc-img-placeholder" style="position:relative">球隊圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}</div>
          <div class="tc-info-row"><span class="tc-label">隊員</span><span>${t.members} 人</span></div>
          <div class="tc-info-row"><span class="tc-label">地區</span><span>${escapeHTML(t.region || '')}</span></div>
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
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">找不到符合的球隊</div>';
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
      imgEl.innerHTML = `<img src="${t.image}" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    } else {
      imgEl.innerHTML = `球隊封面 800 × 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    }

    const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
    const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">球隊資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">領隊</span><span class="td-card-value">${t.captain ? this._userTag(t.captain, 'captain') : '未設定'}</span></div>
          <div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">${(t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無'}</span></div>
          <div class="td-card-item"><span class="td-card-label">隊員數</span><span class="td-card-value">${t.members} 人</span></div>
          <div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">${escapeHTML(t.region)}</span></div>
          ${t.nationality ? `<div class="td-card-item"><span class="td-card-label">國籍</span><span class="td-card-value">${escapeHTML(t.nationality)}</span></div>` : ''}
          ${t.founded ? `<div class="td-card-item"><span class="td-card-label">創立時間</span><span class="td-card-value">${escapeHTML(t.founded)}</span></div>` : ''}
          ${t.contact ? `<div class="td-card-item"><span class="td-card-label">聯繫方式</span><span class="td-card-value">${escapeHTML(t.contact)}</span></div>` : ''}
        </div>
      </div>
      ${t.bio ? `<div class="td-card">
        <div class="td-card-title" style="text-align:center">簡介</div>
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(t.bio)}</div>
      </div>` : ''}
      <div class="td-card">
        <div class="td-card-title">球隊戰績</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins || 0}</span><span class="td-stat-label">勝</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws || 0}</span><span class="td-stat-label">平</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses || 0}</span><span class="td-stat-label">負</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">勝率</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">進球</span><span class="td-card-value">${t.gf || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">失球</span><span class="td-card-value">${t.ga || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">淨勝球</span><span class="td-card-value">${(t.gf || 0) - (t.ga || 0) > 0 ? '+' : ''}${(t.gf || 0) - (t.ga || 0)}</span></div>
          <div class="td-card-item"><span class="td-card-label">總場次</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">賽事紀錄</div>
        ${(t.history || []).map(h => `
          <div class="td-history-row">
            <span class="td-history-name">${escapeHTML(h.name)}</span>
            <span class="td-history-result">${escapeHTML(h.result)}</span>
          </div>
        `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">尚無賽事紀錄</div>'}
      </div>
      <div class="td-card">
        <div class="td-card-title">成員列表</div>
        <div class="td-member-tags">
          ${(() => {
            const tags = [];
            if (t.captain) {
              tags.push(`<span class="user-capsule uc-captain" onclick="App.showUserProfile('${escapeHTML(t.captain)}')" title="領隊">領隊 ${escapeHTML(t.captain)}</span>`);
            }
            (t.coaches || []).forEach(c => {
              tags.push(`<span class="user-capsule uc-coach" onclick="App.showUserProfile('${escapeHTML(c)}')" title="教練">教練 ${escapeHTML(c)}</span>`);
            });
            // 查詢 teamId 匹配的真實用戶（排除領隊與教練）
            const allUsers = ApiService.getAdminUsers() || [];
            const teamMembers = allUsers.filter(u => u.teamId === t.id);
            const captainCoachNames = new Set([t.captain, ...(t.coaches || [])].filter(Boolean));
            const regularMembers = teamMembers.filter(u => !captainCoachNames.has(u.name));
            regularMembers.slice(0, 20).forEach(u => {
              tags.push(`<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(u.name)}')" title="隊員">隊員 ${escapeHTML(u.name)}</span>`);
            });
            return tags.join('');
          })()}
          ${t.members > 8 ? `<span class="td-member-more">... 共 ${t.members} 人</span>` : ''}
        </div>
      </div>
      <div class="td-actions">
        ${this._isTeamMember(t.id)
          ? `<button style="background:var(--danger);color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;font-weight:600;cursor:pointer" onclick="App.handleLeaveTeam('${t.id}')">退出球隊</button>`
          : `<button class="primary-btn" onclick="App.handleJoinTeam('${t.id}')">申請加入</button>`
        }
        ${t.captain ? `<button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(t.captain)}')">聯繫領隊</button>` : ''}
      </div>
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

    // 4. Check for existing pending application
    const allMessages = ApiService.getMessages();
    const hasPending = allMessages.find(m =>
      m.actionType === 'team_join_request' &&
      m.actionStatus === 'pending' &&
      m.meta && m.meta.teamId === teamId &&
      m.meta.applicantUid === applicantUid
    );
    if (hasPending) {
      this.showToast('您已申請此球隊，審核中請耐心等候');
      return;
    }

    // 5. Find captain UID
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

    // 6. Send join request message to captain
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

    // 領隊不能退出
    if (t.captain === userName) {
      this.showToast('領隊無法退出球隊，請先轉移領隊職務');
      return;
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
    const uid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser.uid : null);
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

    this.showToast(`已退出「${t.name}」`);
    this.showTeamDetail(teamId);
    this.renderTeamList();
    this.renderProfileData();
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
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 5MB</span>';
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
        preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 5MB</span>';
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

  handleSaveTeam() {
    const name = document.getElementById('ct-team-name').value.trim();
    const nameEn = document.getElementById('ct-team-name-en').value.trim();
    const nationality = document.getElementById('ct-team-nationality').value;
    const region = document.getElementById('ct-team-region').value;
    const founded = document.getElementById('ct-team-founded').value;
    const contact = document.getElementById('ct-team-contact').value.trim();
    const bio = document.getElementById('ct-team-bio').value.trim();

    if (!name) { this.showToast('請輸入球隊名稱'); return; }

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
      this.showToast('球隊建立成功！');
    }

    // 自動升級領隊/教練權限
    const allUsers = ApiService.getAdminUsers();
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') {
      const capUser = allUsers.find(u => u.uid === this._teamCaptainUid);
      if (capUser && (ROLE_LEVEL_MAP[capUser.role] || 0) < ROLE_LEVEL_MAP['captain']) {
        ApiService.promoteUser(capUser.name, 'captain');
      }
    }
    this._teamCoachUids.forEach(uid => {
      if (uid.startsWith('__legacy_')) return;
      const coachUser = allUsers.find(u => u.uid === uid);
      if (coachUser && (ROLE_LEVEL_MAP[coachUser.role] || 0) < ROLE_LEVEL_MAP['coach']) {
        ApiService.promoteUser(coachUser.name, 'coach');
      }
    });

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
    ApiService.deleteTeam(id);
    this.showToast(`已刪除「${t.name}」`);
    this.showPage('page-teams');
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
    this.renderProfileData();
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
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">至頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.captain)}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消至頂' : '至頂'}</button>
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
    this.showToast(t.pinned ? `已至頂「${t.name}」` : `已取消至頂「${t.name}」`);
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
