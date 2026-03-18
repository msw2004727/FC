/* ================================================
   SportHub — Profile Data: Page Rendering
   依賴：profile-core.js, profile-data.js (core)
   ================================================ */
Object.assign(App, {

  _getUserTeamHtml(user) {
    const teams = ApiService.getTeams();
    const userName = user.displayName || user.name;
    const myUid = user.uid || user._docId || '';
    const teamSet = new Map();
    // 用戶自身的 teamId / teamIds（一般成員）
    const ownTeamIds = (typeof App._getUserTeamIds === 'function')
      ? App._getUserTeamIds(user)
      : (() => {
        const ids = [];
        const seen = new Set();
        const pushId = (id) => {
          const v = String(id || '').trim();
          if (!v || seen.has(v)) return;
          seen.add(v);
          ids.push(v);
        };
        if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
        pushId(user.teamId);
        return ids;
      })();
    ownTeamIds.forEach((tid, idx) => {
      const teamObj = teams.find(t => t.id === tid);
      const fallbackName = Array.isArray(user.teamNames) ? user.teamNames[idx] : null;
      teamSet.set(tid, (teamObj && teamObj.name) || fallbackName || user.teamName || '俱樂部');
    });
    // 檢查是否為任何俱樂部的隊長、領隊或教練
    teams.forEach(t => {
      if (teamSet.has(t.id)) return;
      const isCaptain = (myUid && t.captainUid === myUid) || (userName && t.captain === userName);
      const isLeader  = (myUid && t.leaderUid  === myUid) || (userName && t.leader  === userName);
      const isCoach   = userName && (t.coaches || []).includes(userName);
      if (isCaptain || isLeader || isCoach) teamSet.set(t.id, t.name);
    });
    if (teamSet.size === 0) return '無';
    return Array.from(teamSet.entries()).map(([id, name]) =>
      `<span class="uc-team-link" onclick="App.showTeamDetail('${escapeHTML(id)}')">${escapeHTML(name)}</span>`
    ).join('、');
  },

  renderProfileData() {
    const el = (id) => document.getElementById(id);
    const v = (val) => val || '-';
    const user = ApiService.getCurrentUser();
    if (!user) return;

    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const lineName = (lineProfile && lineProfile.displayName) || user.displayName;
    const avatarCandidates = this._getAvatarCandidateUrls(lineProfile && lineProfile.pictureUrl, user.pictureUrl);
    const pic = avatarCandidates[0] || null;

    // 頭像
    this._setAvatarContent(el('profile-avatar'), pic, lineName, {
      fallbackClass: 'profile-avatar',
      containerImageClass: 'profile-avatar profile-avatar-img',
      candidateUrls: avatarCandidates,
    });

    // 稱號（HTML 版：金色/銀色標籤）
    const titleHtml = this._buildTitleDisplayHtml(user, lineProfile ? lineProfile.displayName : null);
    if (el('profile-title')) el('profile-title').innerHTML = titleHtml;

    // UID 顯示 + 迷你 QR 按鈕
    const uidWrap = el('profile-uid-wrap');
    if (uidWrap) {
      const uid = user.uid || user.lineUserId || '-';
      uidWrap.innerHTML = `<span style="font-size:.72rem;color:var(--text-muted);letter-spacing:.3px">${escapeHTML(uid)}</span>`
        + `<button onclick="App.showUidQrCode()" style="background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center" title="顯示 UID QR Code">`
        + `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="17"/><line x1="17" y1="21" x2="21" y2="21"/></svg>`
        + `</button>`;
    }

    // 角色膠囊
    const roleTagWrap = el('profile-role-tag-wrap');
    if (roleTagWrap) {
      const role = user.role || 'user';
      const roleInfo = ROLES[role] || ROLES.user;
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span>`;
    }

    // 等級 & 經驗值（由累計積分推算）
    const totalExp = user.exp || 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${progress.toLocaleString()} / ${needed.toLocaleString()}`;
    if (el('profile-exp-fill')) el('profile-exp-fill').style.width = `${Math.min(100, Math.round((progress / needed) * 100))}%`;

    // 統計數據（方向 B：以掃碼紀錄為依據）
    if (this._calcScanStats) {
      const _uid = user.uid || user.lineUserId || 'demo-user';
      const { expectedCount, completedCount, attendRate } = this._calcScanStats(_uid);
      if (el('profile-stat-total')) el('profile-stat-total').textContent = expectedCount;
      if (el('profile-stat-done')) el('profile-stat-done').textContent = completedCount;
      if (el('profile-stat-rate')) el('profile-stat-rate').textContent = `${attendRate}%`;
    }
    // 徽章數量：從成就資料動態計算
    if (el('profile-stat-badges')) {
      const _badgeCount = this._getAchievementProfile?.()?.getCurrentBadgeCount?.() || 0;
      el('profile-stat-badges').textContent = _badgeCount;
    }

    // 我的資料（顯示模式）
    if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
    if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
    if (el('profile-region')) el('profile-region').textContent = v(user.region);
    if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
    if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);
    const _fmtCreatedAt = (ca) => { if (!ca) return '-'; const d = ca.toDate ? ca.toDate() : (ca.seconds ? new Date(ca.seconds * 1000) : new Date(ca)); return isNaN(d) ? '-' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; };
    if (el('profile-join-date')) el('profile-join-date').textContent = _fmtCreatedAt(user.createdAt);
    if (el('profile-join-date-edit')) el('profile-join-date-edit').textContent = _fmtCreatedAt(user.createdAt);

    // 所屬俱樂部（含領隊俱樂部，可點擊）
    const teamEl = el('profile-team');
    if (teamEl) teamEl.innerHTML = this._getUserTeamHtml(user);

    // 社群連結（profile-card.js 可能尚未載入）
    this.renderSocialLinks?.(user);

    // LINE 推播通知卡片
    this.renderLineNotifyCard?.();

    // 編輯模式的靜態欄位
    if (el('profile-edit-gender')) el('profile-edit-gender').value = user.gender || '';
    if (el('profile-sports-display')) el('profile-sports-display').textContent = v(user.sports);
    if (el('profile-team-display')) el('profile-team-display').innerHTML = this._getUserTeamHtml(user);

    // 我的俱樂部申請（profile-data-history.js 可能尚未載入）
    this._renderMyApplications?.();

    // 同行者數量標記
    const compBadge = document.getElementById('companions-count');
    if (compBadge) compBadge.textContent = ApiService.getCompanions().length;

    // 新徽章稱號自動推薦（每次會話只檢查一次）
    if (!this._titleSuggestionChecked) {
      this._titleSuggestionChecked = true;
      setTimeout(() => this._checkTitleSuggestion(), 800);
    }
    this._markPageSnapshotReady?.('page-profile');
  },

  toggleProfileEdit() {
    const display = document.getElementById('profile-info-display');
    const edit = document.getElementById('profile-info-edit');
    const btn = document.getElementById('profile-edit-btn');
    if (!display || !edit) return;
    const isEditing = edit.style.display !== 'none';
    if (isEditing) {
      // 關閉編輯
      display.style.display = '';
      edit.style.display = 'none';
      if (btn) btn.textContent = '編輯';
    } else {
      // 開啟編輯，預填現有值
      const user = ApiService.getCurrentUser();
      const genderInput = document.getElementById('profile-edit-gender');
      const bdInput = document.getElementById('profile-edit-birthday');
      const regionInput = document.getElementById('profile-edit-region');
      const phoneInput = document.getElementById('profile-edit-phone');
      if (genderInput) genderInput.value = (user && user.gender) || '';
      if (bdInput && user && user.birthday) {
        // 轉換 yyyy/MM/dd → yyyy-MM-dd（date input 格式）
        bdInput.value = user.birthday.replace(/\//g, '-');
      }
      if (regionInput) regionInput.value = (user && user.region) || '';
      if (phoneInput) phoneInput.value = (user && user.phone) || '';
      display.style.display = 'none';
      edit.style.display = '';
      if (btn) btn.textContent = '取消';
    }
  },

  saveProfileInfo() {
    const genderInput = document.getElementById('profile-edit-gender');
    const bdInput = document.getElementById('profile-edit-birthday');
    const regionInput = document.getElementById('profile-edit-region');
    const phoneInput = document.getElementById('profile-edit-phone');
    const updates = {};
    if (genderInput) updates.gender = genderInput.value || null;
    if (bdInput && bdInput.value) {
      // 轉換 yyyy-MM-dd → yyyy/MM/dd
      updates.birthday = bdInput.value.replace(/-/g, '/');
    }
    if (regionInput) updates.region = regionInput.value.trim() || null;
    if (phoneInput) updates.phone = phoneInput.value.trim() || null;
    ApiService.updateCurrentUser(updates);
    this.toggleProfileEdit();
    this.renderProfileData();
    this.showToast('個人資料已更新');
  },

  /** 收折切換：展開時 lazy load 對應區塊 */
  toggleProfileSection(labelEl, section) {
    const isOpen = labelEl.classList.toggle('open');
    const content = labelEl.nextElementSibling;
    if (!content) return;
    content.style.display = isOpen ? '' : 'none';
    if (isOpen) {
      if (section === 'favorites') this.renderProfileFavorites();
      if (section === 'applications') this._renderMyApplications();
      if (section === 'companions') this.renderCompanions();
      if (section === 'records') this.renderActivityRecords('all');
    }
  },

  /** 輕量判斷：有無俱樂部申請 → 控制卡片顯示 + badge */
  _showApplicationsCard() {
    const card = document.getElementById('profile-applications-card');
    if (!card) return;
    const count = this._getMyLatestTeamApplications().length;
    if (!count) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = count;
    // 重置收折狀態
    const toggle = card.querySelector('.profile-collapse-toggle');
    const content = document.getElementById('profile-applications-list');
    if (toggle) toggle.classList.remove('open');
    if (content) content.style.display = 'none';
  },

});
