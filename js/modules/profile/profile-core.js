/* ================================================
   SportHub — Profile: Core Helpers & User Card
   依賴：config.js, data.js, api-service.js, line-auth.js
   拆分模組：profile-avatar.js, profile-form.js
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  /* ── Admin Stealth Mode ── */
  /** 讀取隱身狀態：優先從 user doc（Firestore source of truth），fallback localStorage */
  _isAdminStealth() {
    const user = ApiService.getCurrentUser();
    if (user && typeof user.stealth !== 'undefined') {
      return user.stealth === true;
    }
    // user doc 尚未載入前 fallback localStorage
    return localStorage.getItem('admin_stealth') === '1';
  },
  _toggleAdminStealth() {
    const cur = this._isAdminStealth();
    const next = !cur;
    // 同步寫 localStorage（即時快取）+ Firestore（持久化）
    if (next) localStorage.setItem('admin_stealth', '1');
    else localStorage.removeItem('admin_stealth');
    ApiService.updateCurrentUser({ stealth: next });
    return next;
  },
  /** 啟動時從 Firestore user doc 同步隱身狀態到 localStorage */
  _syncStealthFromUser() {
    const user = ApiService.getCurrentUser();
    if (!user || typeof user.stealth === 'undefined') return;
    if (user.stealth === true) localStorage.setItem('admin_stealth', '1');
    else localStorage.removeItem('admin_stealth');
  },
  /** 若隱身模式啟用且 name 是自己，回傳 'user'；否則回傳原 role */
  _stealthRole(name, role) {
    if (!this._isAdminStealth()) return role;
    if (role !== 'admin' && role !== 'super_admin') return role;
    const cu = ApiService.getCurrentUser();
    const myName = (cu && (cu.displayName || cu.name)) || '';
    return (name === myName) ? 'user' : role;
  },

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

  _userTag(name, forceRole, options) {
    const rawRole = forceRole || ApiService.getUserRole(name);
    const role = this._stealthRole(name, rawRole);
    const user = this._findUserByName(name);
    const lvl = this._calcLevelFromExp((user && user.exp) || 0).level;
    // team-split: 右上角色衣 badge（可選，_tsJerseySvg 由動態模組提供）
    let jerseyHtml = '';
    if (options && options.teamKey && options.teams) {
      const team = options.teams.find(t => t.key === options.teamKey);
      let svg = '';
      if (team) {
        svg = this._tsJerseySvg?.(team.color, null, team.key, { width: 20, ariaLabel: `${team.key} 隊 - ${team.name || ''}` }) || '';
      } else {
        svg = this._tsJerseySvg?.(null, null, '?', { width: 20 }) || '';
      }
      if (options.canPickTeam) {
        const _oc = `event.stopPropagation();App._tsToggleJerseyPicker(event,'${escapeHTML(options.regDocId || '')}','${escapeHTML(options.eventId || '')}')`;
        jerseyHtml = `<span class="uc-jersey-tap" onclick="${_oc}">${svg}</span>`;
      } else {
        jerseyHtml = svg;
      }
    } else if (options && options.showEmptyJersey) {
      const svg = this._tsJerseySvg?.(null, null, '?', { width: 20 }) || '';
      if (options.canPickTeam) {
        const _oc = `event.stopPropagation();App._tsToggleJerseyPicker(event,'${escapeHTML(options.regDocId || '')}','${escapeHTML(options.eventId || '')}')`;
        jerseyHtml = `<span class="uc-jersey-tap" onclick="${_oc}">${svg}</span>`;
      } else {
        jerseyHtml = svg;
      }
    }
    const _uid = options && options.uid ? options.uid : '';
    const _onclick = _uid
      ? `App.showUserProfile('${escapeHTML(name)}',{uid:'${escapeHTML(_uid)}'})`
      : `App.showUserProfile('${escapeHTML(name)}')`;
    return `<span class="user-capsule uc-${role}" data-no-translate onclick="${_onclick}" title="${ROLES[role]?.label || '一般用戶'}"><span class="uc-lv">Lv${lvl}</span>${jerseyHtml}${escapeHTML(name)}</span>`;
  },

  _findUserByName(name) {
    const users = ApiService.getAdminUsers();
    return users.find(u => u.name === name) || null;
  },

  _findUserByUid(uid) {
    if (!uid) return null;
    const users = ApiService.getAdminUsers();
    return users.find(u => u.uid === uid || u.lineUserId === uid) || null;
  },

  async showUserProfile(name, options = {}) {
    if (!options.allowGuest && this._requireProtectedActionLogin({ type: 'showUserProfile', name }, { suppressToast: true })) {
      return;
    }
    // UID 優先查找：options.uid 存在時先用 UID 查找，找不到再 fallback 到 name
    const uidHint = options.uid || null;

    // 確保 profile 群組（profile-data-render / profile-data-stats / profile-card 等）已載入
    await ScriptLoader.ensureForPage('page-user-card');
    // 判斷是否為當前用戶（比對 UID / displayName / name）
    const isLoggedIn = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    const currentUser = isLoggedIn ? ApiService.getCurrentUser() : null;
    const lineProfile = isLoggedIn ? LineAuth.getProfile() : null;
    const currentName = (lineProfile && lineProfile.displayName) || (currentUser && currentUser.displayName) || '';
    const isSelf = currentUser && (
      (uidHint && (uidHint === currentUser.uid || uidHint === currentUser.lineUserId)) ||
      name === currentName || name === currentUser.displayName || name === currentUser.name
    );

    // 如果是自己，優先用 currentUser + LINE 資料；否則 UID 查找 → name 查找
    const user = isSelf
      ? currentUser
      : (this._findUserByUid(uidHint) || this._findUserByName(name));
    const rawRole = user ? user.role : ApiService.getUserRole(name);
    const role = this._stealthRole(name, rawRole);
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

    // 計算 target uid 與 cache 命中狀態（決定是否顯示毛玻璃遮蔽 — 節省 Firestore 讀取）
    const targetUid = user ? (user.uid || user.lineUserId) : null;
    const _statsCache = (typeof FirebaseService !== 'undefined' && FirebaseService.getUserStatsCache?.()) || {};
    const _statsCacheHit = targetUid && _statsCache.uid === targetUid && _statsCache.attendanceRecords !== null;
    const _badgeCacheUid = (typeof FirebaseService !== 'undefined') ? FirebaseService._userAchievementProgressUid : null;
    const _badgeCacheHit = targetUid && _badgeCacheUid === targetUid;
    // isSelf 不遮徽章（本地 cache 已有，同步計算）；非 self 才考慮遮
    const _showStatsBlur = targetUid && !_statsCacheHit;
    const _showBadgesBlur = targetUid && !isSelf && !_badgeCacheHit;

    const _blurOnClick = `App._loadUserCardUncovered('${escapeHTML(targetUid || '')}')`;
    const _statsBlurHtml = _showStatsBlur ? `<div class="uc-blur-overlay" onclick="${_blurOnClick}"><div class="uc-blur-text">點擊載入活動記錄</div></div>` : '';
    const _badgeBlurHtml = _showBadgesBlur ? `<div class="uc-blur-overlay" onclick="${_blurOnClick}"><div class="uc-blur-text">點擊載入此用戶的徽章</div></div>` : '';

    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-avatar-circle" style="margin:0 auto .6rem">${avatarHtml}</div>
        ${!isSelf ? this._buildUserCardActionPanel() : ''}
        <div class="profile-title" data-no-translate>${titleHtml}</div>
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
        ${_badgeBlurHtml}
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
        ${_statsBlurHtml}
      </div>
      <div style="text-align:center;padding:.5rem 0 1rem">
        <button class="outline-btn" style="font-size:.78rem;padding:.4rem 1rem;display:inline-flex;align-items:center;gap:.3rem" onclick="App._shareUserCard('${escapeHTML(name)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          分享名片
        </button>
      </div>
    `;
    this._bindAvatarFallbacks(document.getElementById('user-card-full'));

    // 顯示頁面（若 cache 命中則直接渲染；否則由毛玻璃遮蔽提示用戶點擊載入）
    this._ucRecordUid = targetUid || null;
    this.showPage('page-user-card');

    // 徽章異步載入：只在 cache 命中時才跑（避免自動讀取 Firestore）
    // 非 self 且 cache 未命中時，等用戶點擊遮蔽觸發 _loadUserCardUncovered
    if (!isSelf && user && _badgeCacheHit && achievementProfile?.buildEarnedBadgeListHtmlAsync) {
      achievementProfile.buildEarnedBadgeListHtmlAsync({
        useCategoryBorder: true,
        emptyText: '尚未獲得徽章',
        targetUser: user,
      }).then(asyncBadgeHtml => {
        const badgeContainer = document.getElementById('uc-badge-container');
        if (badgeContainer) badgeContainer.innerHTML = asyncBadgeHtml;
      }).catch(() => { /* keep sync result */ });
    }

    // 活動紀錄：只在 cache 命中時才渲染（否則遮蔽已在 HTML，等用戶點擊）
    if (targetUid && _statsCacheHit) {
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

  /**
   * 從毛玻璃遮蔽點擊觸發：首次載入用戶卡片的活動紀錄 + 徽章
   * 設計目的：預設不自動讀 Firestore，由用戶點擊才載入以節省成本
   */
  async _loadUserCardUncovered(uid) {
    if (!uid) return;
    if (this._userCardLoading) return;
    this._userCardLoading = true;

    // 載入中提示（所有遮蔽層同步更新）
    document.querySelectorAll('#page-user-card .uc-blur-overlay .uc-blur-text').forEach(el => {
      el.innerHTML = '載入中...';
    });

    try {
      // 並行載入 stats 與 badges
      const statsTask = (typeof FirebaseService !== 'undefined' && FirebaseService.ensureUserStatsLoaded)
        ? FirebaseService.ensureUserStatsLoaded(uid) : Promise.resolve();

      const achievementProfile = this._getAchievementProfile?.();
      const users = ApiService.getAdminUsers?.() || [];
      const targetUser = users.find(u => u.uid === uid || u.lineUserId === uid);
      let badgeTask = Promise.resolve(null);
      if (targetUser && achievementProfile?.buildEarnedBadgeListHtmlAsync) {
        badgeTask = achievementProfile.buildEarnedBadgeListHtmlAsync({
          useCategoryBorder: true,
          emptyText: '尚未獲得徽章',
          targetUser,
        });
      }

      const [, badgeHtml] = await Promise.all([statsTask, badgeTask]);

      // 頁面若已切走，不動 DOM（防 race）
      if (this.currentPage !== 'page-user-card') return;

      // 更新徽章 container
      if (typeof badgeHtml === 'string' && badgeHtml) {
        const badgeContainer = document.getElementById('uc-badge-container');
        if (badgeContainer) badgeContainer.innerHTML = badgeHtml;
      }

      // 移除所有遮蔽
      document.querySelectorAll('#page-user-card .uc-blur-overlay').forEach(el => el.remove());

      // 渲染活動紀錄（cache 已填好）
      this.renderUserCardRecords('all', 1);
    } catch (err) {
      console.warn('[_loadUserCardUncovered]', err);
      if (this.currentPage === 'page-user-card') {
        document.querySelectorAll('#page-user-card .uc-blur-overlay .uc-blur-text').forEach(el => {
          el.innerHTML = '載入失敗，點擊重試';
        });
      }
    } finally {
      this._userCardLoading = false;
    }
  },

  async _shareUserCard(name) {
    // 備用版本（profile-share.js 載入後會覆蓋此方法）
    const uid = this._ucRecordUid || '';
    const profileUrl = uid ? (MINI_APP_BASE_URL + '?profile=' + encodeURIComponent(uid)) : MINI_APP_BASE_URL;
    const shareText = `SportHub 用戶名片：${name}\n${profileUrl}`;
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

  // 用戶資料卡片右側三功能按鈕（純裝飾，功能未啟用）
  _buildUserCardActionPanel() {
    return `<div class="uc-action-panel" aria-hidden="true">
      <svg class="uc-action-lines" viewBox="0 0 100 120" preserveAspectRatio="none">
        <path d="M 0 60 Q 50 20 100 20" />
        <path d="M 0 60 L 100 60" />
        <path d="M 0 60 Q 50 100 100 100" />
      </svg>
      <button type="button" class="uc-action-btn" disabled>加好友</button>
      <button type="button" class="uc-action-btn" disabled>私訊</button>
      <button type="button" class="uc-action-btn" disabled>關注</button>
    </div>`;
  },

});
