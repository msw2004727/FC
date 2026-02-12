/* ================================================
   SportHub — Profile: Data Rendering & Titles
   依賴：profile-core.js
   ================================================ */
Object.assign(App, {

  _getUserTeamHtml(user) {
    const teams = ApiService.getTeams();
    const userName = user.displayName || user.name;
    const teamSet = new Map();
    // 用戶自身的 teamId
    if (user.teamId) {
      teamSet.set(user.teamId, user.teamName || '球隊');
    }
    // 檢查是否為任何球隊的領隊
    teams.forEach(t => {
      if (t.captain === userName && !teamSet.has(t.id)) {
        teamSet.set(t.id, t.name);
      }
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
    const pic = (lineProfile && lineProfile.pictureUrl) || user.pictureUrl || null;

    // 頭像
    if (el('profile-avatar')) {
      if (pic) {
        el('profile-avatar').className = 'profile-avatar profile-avatar-img';
        el('profile-avatar').innerHTML = `<img src="${pic}" alt="">`;
      } else {
        el('profile-avatar').className = 'profile-avatar';
        el('profile-avatar').innerHTML = (lineName || '?').charAt(0);
      }
    }

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

    // 統計數據（即時從活動紀錄計算）
    if (this._categorizeRecords) {
      const _uid = user.uid || user.lineUserId || 'demo-user';
      const { completed: _comp, cancelled: _canc } = this._categorizeRecords(_uid, false);
      const _all = ApiService.getActivityRecords(_uid);
      const _total = _all.length;
      const _compN = _comp.length;
      const _cancN = _canc.length;
      const _rate = _total > 0 ? Math.round(((_total - _cancN) / _total) * 100) : 0;
      if (el('profile-stat-total')) el('profile-stat-total').textContent = _total;
      if (el('profile-stat-done')) el('profile-stat-done').textContent = _compN;
      if (el('profile-stat-rate')) el('profile-stat-rate').textContent = `${_rate}%`;
    }
    // 徽章數量：從成就資料動態計算
    if (el('profile-stat-badges')) {
      const _achs = ApiService.getAchievements().filter(a => a.status !== 'archived');
      const _badgeCount = _achs.filter(a => {
        const t = a.condition && a.condition.threshold != null ? a.condition.threshold : (a.target != null ? a.target : 1);
        return a.current >= t;
      }).length;
      el('profile-stat-badges').textContent = _badgeCount;
    }

    // 我的資料（顯示模式）
    if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
    if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
    if (el('profile-region')) el('profile-region').textContent = v(user.region);
    if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
    if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);
    if (el('profile-join-date')) el('profile-join-date').textContent = v(user.joinDate);
    if (el('profile-join-date-edit')) el('profile-join-date-edit').textContent = v(user.joinDate);

    // 所屬球隊（含領隊球隊，可點擊）
    const teamEl = el('profile-team');
    if (teamEl) teamEl.innerHTML = this._getUserTeamHtml(user);

    // 社群連結
    this.renderSocialLinks(user);

    // LINE 推播通知卡片
    this.renderLineNotifyCard();

    // 編輯模式的靜態欄位
    if (el('profile-gender-display')) el('profile-gender-display').textContent = v(user.gender);
    if (el('profile-sports-display')) el('profile-sports-display').textContent = v(user.sports);
    if (el('profile-team-display')) el('profile-team-display').innerHTML = this._getUserTeamHtml(user);

    // 我的球隊申請
    this._renderMyApplications();

    // 新徽章稱號自動推薦（每次會話只檢查一次）
    if (!this._titleSuggestionChecked) {
      this._titleSuggestionChecked = true;
      setTimeout(() => this._checkTitleSuggestion(), 800);
    }
  },

  _renderMyApplications() {
    const card = document.getElementById('profile-applications-card');
    const list = document.getElementById('profile-applications-list');
    if (!card || !list) return;
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || (ModeManager.isDemo() ? 'demo-user' : null);
    if (!uid) { card.style.display = 'none'; return; }
    const allMsgs = ApiService.getMessages();
    const apps = allMsgs.filter(m =>
      m.actionType === 'team_join_request' && m.meta && m.meta.applicantUid === uid
    );
    if (!apps.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = apps.length;
    const statusMap = { pending: { label: '審核中', color: 'var(--warning)' }, approved: { label: '已通過', color: 'var(--success)' }, rejected: { label: '已拒絕', color: 'var(--danger)' } };
    list.innerHTML = apps.map(m => {
      const s = statusMap[m.actionStatus] || statusMap.pending;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.82rem">${escapeHTML(m.meta.teamName || '-')}</span>
        <span style="font-size:.72rem;font-weight:600;color:${s.color}">${s.label}</span>
      </div>`;
    }).join('');
    // 設定為展開狀態
    const toggle = card.querySelector('.profile-collapse-toggle');
    if (toggle) toggle.classList.add('open');
    list.style.display = '';
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
    }
  },

  /** 輕量判斷：有無球隊申請 → 控制卡片顯示 + badge */
  _showApplicationsCard() {
    const card = document.getElementById('profile-applications-card');
    if (!card) return;
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || (ModeManager.isDemo() ? 'demo-user' : null);
    if (!uid) { card.style.display = 'none'; return; }
    const allMsgs = ApiService.getMessages();
    const count = allMsgs.filter(m =>
      m.actionType === 'team_join_request' && m.meta && m.meta.applicantUid === uid
    ).length;
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
      const bdInput = document.getElementById('profile-edit-birthday');
      const regionInput = document.getElementById('profile-edit-region');
      const phoneInput = document.getElementById('profile-edit-phone');
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
    const bdInput = document.getElementById('profile-edit-birthday');
    const regionInput = document.getElementById('profile-edit-region');
    const phoneInput = document.getElementById('profile-edit-phone');
    const updates = {};
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

  // 組合稱號顯示：大成就.普通.暱稱（純文字）
  _buildTitleDisplay(user, overrideName) {
    const parts = [];
    if (user.titleBig) parts.push(user.titleBig);
    if (user.titleNormal) parts.push(user.titleNormal);
    const name = overrideName || user.displayName || '-';
    parts.push(name);
    return parts.join('.');
  },

  // 組合稱號顯示 HTML 版（金色/銀色標籤）
  _buildTitleDisplayHtml(user, overrideName) {
    const parts = [];
    if (user.titleBig) {
      parts.push(`<span class="title-tag title-gold">${escapeHTML(user.titleBig)}</span>`);
    }
    if (user.titleNormal) {
      parts.push(`<span class="title-tag title-normal">${escapeHTML(user.titleNormal)}</span>`);
    }
    const name = overrideName || user.displayName || '-';
    parts.push(escapeHTML(name));
    return parts.join('<span class="title-dot">.</span>');
  },

  // 新徽章稱號自動推薦
  _titleSuggestionChecked: false,
  async _checkTitleSuggestion() {
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const achs = ApiService.getAchievements().filter(a => a.status !== 'archived');
    const getT = a => (a.condition && a.condition.threshold != null) ? a.condition.threshold : (a.target != null ? a.target : 1);
    const earned = achs.filter(a => a.current >= getT(a));
    if (earned.length === 0) return;
    const tpKey = 'sporthub_title_prompted_' + ModeManager.getMode();
    const lastCount = parseInt(localStorage.getItem(tpKey) || '0');
    if (earned.length <= lastCount) return;
    localStorage.setItem(tpKey, String(earned.length));
    // 檢查是否有空的稱號欄位可以裝備
    const hasGoldSlot = !user.titleBig && earned.some(a => a.category === 'gold');
    const hasNormalSlot = !user.titleNormal && earned.some(a => a.category !== 'gold');
    if (hasGoldSlot || hasNormalSlot) {
      const yes = await this.appConfirm('您獲得了新的稱號，是否前往裝備？');
      if (yes) this.showPage('page-titles');
    } else {
      this.showToast('恭喜獲得新徽章！可至「稱號設定」更換');
    }
  },

  // 渲染稱號設定頁
  renderTitlePage() {
    const user = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const lineName = lineProfile ? lineProfile.displayName : (user ? user.displayName : '-');

    // LINE 暱稱
    const nameInput = document.getElementById('title-line-name');
    if (nameInput) nameInput.value = lineName || '-';

    // 大成就稱號選項：從已完成的成就中取
    const achievements = ApiService.getAchievements().filter(a => a.status !== 'archived');
    const _getThreshold = a => (a.condition && a.condition.threshold != null) ? a.condition.threshold : (a.target != null ? a.target : 1);
    const bigTitles = achievements.filter(a => a.category === 'gold' && a.current >= _getThreshold(a)).map(a => a.name);
    const normalTitles = achievements.filter(a => a.category !== 'gold' && a.current >= _getThreshold(a)).map(a => a.name);

    const bigSelect = document.getElementById('title-big');
    const normalSelect = document.getElementById('title-normal');
    if (bigSelect) {
      const cur = user && user.titleBig ? user.titleBig : '';
      bigSelect.innerHTML = '<option value="">（無）</option>' + bigTitles.map(t =>
        `<option value="${t}" ${t === cur ? 'selected' : ''}>${t}</option>`
      ).join('');
    }
    if (normalSelect) {
      const cur = user && user.titleNormal ? user.titleNormal : '';
      normalSelect.innerHTML = '<option value="">（無）</option>' + normalTitles.map(t =>
        `<option value="${t}" ${t === cur ? 'selected' : ''}>${t}</option>`
      ).join('');
    }

    // 即時預覽
    this._updateTitlePreview();
    if (bigSelect && !bigSelect.dataset.bound) {
      bigSelect.dataset.bound = '1';
      bigSelect.addEventListener('change', () => this._updateTitlePreview());
    }
    if (normalSelect && !normalSelect.dataset.bound) {
      normalSelect.dataset.bound = '1';
      normalSelect.addEventListener('change', () => this._updateTitlePreview());
    }
  },

  _updateTitlePreview() {
    const big = document.getElementById('title-big')?.value || '';
    const normal = document.getElementById('title-normal')?.value || '';
    const name = document.getElementById('title-line-name')?.value || '-';
    const preview = document.getElementById('title-preview');
    if (!preview) return;
    const fakeUser = { titleBig: big || null, titleNormal: normal || null, displayName: name };
    preview.innerHTML = this._buildTitleDisplayHtml(fakeUser);
  },

  saveTitles() {
    const titleBig = document.getElementById('title-big')?.value || null;
    const titleNormal = document.getElementById('title-normal')?.value || null;
    ApiService.updateCurrentUser({ titleBig, titleNormal });
    this.renderProfileData();
    this.showToast('稱號已儲存');
  },

  toggleUserMenu() {
    const menu = document.getElementById('user-menu-dropdown');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
      // 填入用戶名稱
      const nameEl = document.getElementById('user-menu-name');
      const profile = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
      if (nameEl && profile) nameEl.textContent = profile.displayName;
      // 點擊外部關閉
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && e.target.id !== 'line-avatar-topbar') {
            menu.style.display = 'none';
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  logoutLine() {
    if (typeof LineAuth !== 'undefined') {
      LineAuth.logout();
    }
  },

  // ── LINE 推播通知 ──
  renderLineNotifyCard() {
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const ln = user.lineNotify || { bound: false, settings: {} };
    const badge = document.getElementById('line-notify-badge');
    const boundEl = document.getElementById('line-notify-bound');
    const unboundEl = document.getElementById('line-notify-unbound');
    if (!badge || !boundEl || !unboundEl) return;

    if (ln.bound) {
      badge.textContent = '已綁定';
      badge.className = 'line-notify-status bound';
      boundEl.style.display = '';
      unboundEl.style.display = 'none';
      const nameEl = document.getElementById('line-notify-name');
      const timeEl = document.getElementById('line-notify-time');
      if (nameEl) nameEl.textContent = user.displayName || '-';
      if (timeEl) timeEl.textContent = ln.boundAt || '-';
      const keys = ['activity', 'system', 'tournament'];
      keys.forEach(k => {
        const cb = document.getElementById('line-toggle-' + k);
        if (cb) cb.checked = !!ln.settings[k];
      });
    } else {
      badge.textContent = '未綁定';
      badge.className = 'line-notify-status unbound';
      boundEl.style.display = 'none';
      unboundEl.style.display = '';
    }
  },

  async bindLineNotify() {
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const btn = document.querySelector('.line-login-btn');

    // Demo 模式 → 直接綁定
    if (ModeManager.isDemo()) {
      this._completeLineBinding(btn);
      return;
    }

    // 檢查 LIFF 登入狀態
    if (typeof liff === 'undefined' || !liff.isLoggedIn()) {
      this.showToast('請先登入 LINE 帳號');
      return;
    }

    // 綁定同時開啟加好友頁面（確保用戶已加官方帳號好友）
    window.open(`https://line.me/R/ti/p/${LINE_CONFIG.BOT_BASIC_ID}`, '_blank');
    this._completeLineBinding(btn);
  },

  _completeLineBinding(btn) {
    if (btn) btn.classList.add('loading');
    const today = new Date();
    const dateStr = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0') + '/' + String(today.getDate()).padStart(2, '0');
    const notify = {
      bound: true,
      boundAt: dateStr,
      settings: { activity: true, system: true, tournament: false }
    };
    ApiService.updateCurrentUser({ lineNotify: notify });
    setTimeout(() => {
      if (btn) btn.classList.remove('loading');
      const boundEl = document.getElementById('line-notify-bound');
      const unboundEl = document.getElementById('line-notify-unbound');
      if (boundEl) boundEl.classList.add('fadeIn');
      this.renderLineNotifyCard();
      this.showToast('LINE 綁定成功');
    }, 600);
  },

  async unbindLineNotify() {
    const yes = await this.appConfirm('確定要解除 LINE 綁定嗎？解除後將無法收到推播通知。');
    if (!yes) return;
    const user = ApiService.getCurrentUser();
    if (!user) return;
    ApiService.updateCurrentUser({ lineNotify: { bound: false, settings: { activity: true, system: true, tournament: false } } });
    const unboundEl = document.getElementById('line-notify-unbound');
    if (unboundEl) unboundEl.classList.add('fadeIn');
    this.renderLineNotifyCard();
    this.showToast('已解除 LINE 綁定');
  },

  toggleLineNotify(key) {
    const user = ApiService.getCurrentUser();
    if (!user || !user.lineNotify || !user.lineNotify.bound) return;
    const settings = user.lineNotify.settings;
    const newSettings = { ...settings, [key]: !settings[key] };
    ApiService.updateCurrentUser({ lineNotify: { ...user.lineNotify, settings: newSettings } });
    const labels = { activity: '活動提醒', system: '系統通知', tournament: '賽事通知' };
    const label = labels[key] || key;
    this.showToast(newSettings[key] ? '已開啟' + label : '已關閉' + label);
  },

  saveFirstLoginProfile() {
    const gender = document.getElementById('fl-gender').value;
    const birthday = document.getElementById('fl-birthday').value;
    const region = document.getElementById('fl-region').value;
    if (!gender || !birthday || !region) {
      this.showToast('請填寫所有必填欄位');
      return;
    }
    ApiService.updateCurrentUser({ gender, birthday, region });
    this._pendingFirstLogin = false;
    this.closeModal();
    this.renderProfileData();
    this.showToast('個人資料已儲存');
  },

});
