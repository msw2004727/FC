/* ================================================
   SportHub — Team: Form (Create/Edit), Join/Leave, CRUD
   依賴：team-list.js, team-detail.js, config.js, api-service.js
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

    this._grantAutoExp(applicantUid, 'join_team', t.name);
    this.showToast('已送出加入申請！');
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
  //  Team Form (Create / Edit)
  // ══════════════════════════════════

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

});
