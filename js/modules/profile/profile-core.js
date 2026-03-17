/* ================================================
   SportHub — Profile: Core Helpers & User Card
   依賴：config.js, data.js, api-service.js, line-auth.js
   拆分模組：profile-avatar.js, profile-form.js
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  /**
   * 等級公式：升到 level L 的累計 EXP = 50 * L * (L+1)
   * 每級所需：level N → N+1 需要 (N+1)*100 EXP
   * @param {number} totalExp - 累計總積分
   * @returns {{ level:number, progress:number, needed:number }}
   */
  _calcLevelFromExp(totalExp) {
    if (totalExp <= 0) return { level: 0, progress: 0, needed: 100 };
    let level = Math.floor((-1 + Math.sqrt(1 + 4 * totalExp / 50)) / 2);
    if (level < 0) level = 0;
    if (level > 999) level = 999;
    const baseExp = 50 * level * (level + 1);
    const progress = totalExp - baseExp;
    const needed = (level + 1) * 100;
    return { level, progress, needed };
  },

  updatePointsDisplay() {
    const el = document.getElementById('points-value');
    if (!el) return;
    const isLoggedIn = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    if (!isLoggedIn) {
      el.textContent = '-';
      return;
    }
    const user = ApiService.getCurrentUser();
    const exp = (user && user.exp) || 0;
    el.textContent = exp.toLocaleString();
  },

  _userTag(name, forceRole) {
    const role = forceRole || ApiService.getUserRole(name);
    return `<span class="user-capsule uc-${role}" onclick="App.showUserProfile('${escapeHTML(name)}')" title="${ROLES[role]?.label || '一般用戶'}">${escapeHTML(name)}</span>`;
  },

  _findUserByName(name) {
    const users = ApiService.getAdminUsers();
    return users.find(u => u.name === name) || null;
  },

  async showUserProfile(name, options = {}) {
    if (!options.allowGuest && this._requireProtectedActionLogin({ type: 'showUserProfile', name }, { suppressToast: true })) {
      return;
    }
    // 確保 profile 群組（profile-data-render / profile-data-stats / profile-card 等）已載入
    await ScriptLoader.ensureForPage('page-user-card');
    // 判斷是否為當前用戶（比對 displayName / name）
    const isLoggedIn = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    const currentUser = isLoggedIn ? ApiService.getCurrentUser() : null;
    const lineProfile = isLoggedIn ? LineAuth.getProfile() : null;
    const currentName = (lineProfile && lineProfile.displayName) || (currentUser && currentUser.displayName) || '';
    const isSelf = currentUser && (name === currentName || name === currentUser.displayName || name === currentUser.name);

    // 如果是自己，優先用 currentUser + LINE 資料；否則從 adminUsers 查
    const user = isSelf ? currentUser : this._findUserByName(name);
    const role = user ? user.role : ApiService.getUserRole(name);
    const roleInfo = ROLES[role] || ROLES.user;
    const achievementProfile = this._getAchievementProfile?.();

    const totalExp = user ? (user.exp || 0) : 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    const expPct = Math.min(100, Math.round((progress / needed) * 100));
    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    const phone = (user && user.phone) || '-';
    const _ca = user && user.createdAt;
    const joinDate = _ca
      ? (() => { const d = (_ca.toDate ? _ca.toDate() : (_ca.seconds ? new Date(_ca.seconds * 1000) : new Date(_ca))); return isNaN(d) ? '-' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; })()
      : '-';
    // 頭像：自己用 LINE 頭像，他人用資料庫 pictureUrl
    const picCandidates = isSelf
      ? this._getAvatarCandidateUrls(lineProfile && lineProfile.pictureUrl, user && user.pictureUrl)
      : this._getAvatarCandidateUrls(user && user.pictureUrl);
    const pic = picCandidates[0] || null;

    const avatarHtml = this._buildAvatarImageMarkup(pic, name, '', 'uc-avatar-circle');
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    // 稱號顯示（HTML 版：金色/銀色標籤）
    const titleHtml = user
      ? (achievementProfile?.buildTitleDisplayHtml?.(user, name) || this._buildTitleDisplayHtml(user, name))
      : escapeHTML(name);
    // 同步先顯示（當前用戶快取 or 空狀態），異步再更新（其他用戶）
    let badgeHtml = achievementProfile?.buildEarnedBadgeListHtml?.({
      useCategoryBorder: true,
      emptyText: '尚未獲得徽章',
      targetUser: user || null,
    }) || '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>';

    const cardHeader = document.querySelector('#page-user-card .page-header h2');
    if (cardHeader) cardHeader.textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-avatar-circle" style="margin:0 auto .6rem">${avatarHtml}</div>
        <div class="profile-title">${titleHtml}</div>
        <div style="margin-top:.3rem"><span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span></div>
        <div class="profile-level">
          <span>Lv.${level}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${expPct}%"></div></div>
          <span class="exp-text">${progress.toLocaleString()} / ${needed.toLocaleString()}</span>
        </div>
      </div>
      ${this._buildSocialLinksHtml(user)}
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${escapeHTML(gender)}</span></div>
        <div class="info-row"><span>生日</span><span>${escapeHTML(birthday)}</span></div>
        <div class="info-row"><span>地區</span><span>${escapeHTML(region)}</span></div>
        <div class="info-row"><span>運動類別</span><span>${escapeHTML(sports)}</span></div>
        <div class="info-row"><span>所屬俱樂部</span><span>${teamHtml}</span></div>
        <div class="info-row"><span>聯繫方式</span><span>${escapeHTML(phone)}</span></div>
        <div class="info-row"><span>加入時間</span><span>${escapeHTML(joinDate)}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        <div id="uc-badge-container">${badgeHtml}</div>
      </div>
      <div class="info-card">
        <div class="info-title" style="display:flex;align-items:center">活動紀錄<button id="uc-records-refresh" type="button" onclick="App.refreshUserCardRecords()" title="重新整理" style="width:1.8rem;height:1.8rem;border:1px solid var(--border);border-radius:50%;background:transparent;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:auto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button></div>
        <div class="profile-stats" style="margin:-.2rem 0 .5rem" id="uc-record-stats">
          <div class="stat-item"><span class="stat-num" id="uc-stat-total">--</span><span class="stat-label">應到場次</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-done">--</span><span class="stat-label">完成場次</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-rate">--</span><span class="stat-label">出席率</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-badges">--</span><span class="stat-label">徽章</span></div>
        </div>
        <div class="tab-bar compact" id="uc-record-tabs">
          <button class="tab" data-filter="all">全部</button>
          <button class="tab" data-filter="completed">完成</button>
          <button class="tab" data-filter="cancelled">取消</button>
        </div>
        <div class="mini-activity-list" id="uc-activity-records"></div>
      </div>
      <div style="text-align:center;padding:.5rem 0 1rem">
        <button class="outline-btn" style="font-size:.78rem;padding:.4rem 1rem;display:inline-flex;align-items:center;gap:.3rem" onclick="App._shareUserCard('${escapeHTML(name)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          分享名片
        </button>
      </div>
    `;
    this._bindAvatarFallbacks(document.getElementById('user-card-full'));

    // 先顯示頁面（統計先顯示 "--"），再背景載入完整記錄
    const targetUid = user ? (user.uid || user.lineUserId) : null;
    this._ucRecordUid = targetUid || null;
    this.showPage('page-user-card');

    // 異步更新其他用戶的徽章（從 per-user 子集合讀取）
    if (!isSelf && user && achievementProfile?.buildEarnedBadgeListHtmlAsync) {
      achievementProfile.buildEarnedBadgeListHtmlAsync({
        useCategoryBorder: true,
        emptyText: '尚未獲得徽章',
        targetUser: user,
      }).then(asyncBadgeHtml => {
        const badgeContainer = document.getElementById('uc-badge-container');
        if (badgeContainer) badgeContainer.innerHTML = asyncBadgeHtml;
      }).catch(() => { /* keep sync result */ });
    }

    if (targetUid) {
      await FirebaseService.ensureUserStatsLoaded(targetUid);
      this.renderUserCardRecords('all', 1);
    }
  },

  async refreshUserCardRecords() {
    const uid = this._ucRecordUid;
    if (!uid) return;
    const btn = document.getElementById('uc-records-refresh');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
    try {
      // 清除快取強制重新載入
      if (FirebaseService._userStatsCache) {
        FirebaseService._userStatsCache = { uid: null, activityRecords: null, attendanceRecords: null };
      }
      await FirebaseService.ensureUserStatsLoaded(uid);
      this.renderUserCardRecords('all', 1);
    } catch (err) {
      console.warn('[refreshUserCardRecords]', err);
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  },

  async _shareUserCard(name) {
    const shareText = `SportHub 用戶名片：${name}\n${location.origin}${location.pathname}`;
    const doCopy = async () => {
      const ok = await this._copyToClipboard(shareText);
      this.showToast(ok ? '名片連結已複製到剪貼簿' : '複製失敗，請手動複製');
    };
    if (navigator.share) {
      navigator.share({ title: `${name} 的 SportHub 名片`, text: shareText }).catch(() => doCopy());
    } else {
      await doCopy();
    }
  },

});
