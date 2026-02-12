/* ================================================
   SportHub — Profile: User Card, QR Code & Social Links
   依賴：profile-core.js, profile-data.js
   ================================================ */
Object.assign(App, {
  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;

    const user = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;

    const displayName = (lineProfile && lineProfile.displayName) ? lineProfile.displayName : (user ? user.displayName : '-');
    const titleHtml = user ? this._buildTitleDisplayHtml(user, lineProfile ? lineProfile.displayName : null) : escapeHTML(displayName);
    const pic = (lineProfile && lineProfile.pictureUrl) || (user && user.pictureUrl) || null;
    const role = (user && user.role) || 'user';
    const roleInfo = ROLES[role] || ROLES.user;

    const totalExp = user ? (user.exp || 0) : 0;
    const { level, progress, needed } = App._calcLevelFromExp(totalExp);
    const expPct = Math.min(100, Math.round((progress / needed) * 100));

    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    const phone = (user && user.phone) || '-';
    const joinDate = (user && user.joinDate) || '-';

    const avatarHtml = pic
      ? `<img src="${pic}" alt="${escapeHTML(displayName)}">`
      : (displayName || '?').charAt(0);
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements().filter(a => a.status !== 'archived');
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      const threshold = ach && ach.condition && ach.condition.threshold != null ? ach.condition.threshold : (ach && ach.target != null ? ach.target : 1);
      return ach && ach.current >= threshold;
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };

    container.innerHTML = `
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
        <div class="info-row"><span>所屬球隊</span><span>${teamHtml}</span></div>
        <div class="info-row"><span>聯繫方式</span><span>${escapeHTML(phone)}</span></div>
        <div class="info-row"><span>加入時間</span><span>${escapeHTML(joinDate)}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = catColors[b.category] || catColors.bronze;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder">${b.image ? `<img src="${b.image}">` : '<span style="font-size:1.2rem">🏅</span>'}</div>
            <span class="uc-badge-name">${escapeHTML(b.name)}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
      <div class="info-card">
        <div class="info-title">活動紀錄</div>
        <div class="profile-stats" style="margin:-.2rem 0 .5rem" id="uc-record-stats">
          <div class="stat-item"><span class="stat-num" id="uc-stat-total">-</span><span class="stat-label">參加場次</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-done">-</span><span class="stat-label">完成</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-rate">-</span><span class="stat-label">出席率</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-badges">-</span><span class="stat-label">徽章</span></div>
        </div>
        <div class="tab-bar compact" id="uc-record-tabs">
          <button class="tab" data-filter="all">全部</button>
          <button class="tab" data-filter="completed">完成</button>
          <button class="tab" data-filter="cancelled">取消</button>
        </div>
        <div class="mini-activity-list" id="uc-activity-records"></div>
      </div>
      <div class="info-card">
        <div class="info-title">交易價值紀錄</div>
        <div style="font-size:.82rem;color:var(--text-muted)">目前無交易紀錄</div>
      </div>
    `;
    // 渲染活動紀錄
    const targetUid = user ? (user.uid || user.lineUserId) : null;
    if (targetUid) {
      this._ucRecordUid = targetUid;
      this.renderUserCardRecords('all', 1);
    }
  },

  /**
   * 穩定 QR Code 生成（本地庫優先 → API 圖片備援）
   * @param {HTMLElement} container - 放置 QR Code 的容器
   * @param {string} data - 要編碼的資料（UID）
   * @param {number} size - 尺寸（px）
   */
  _generateQrCode(container, data, size) {
    if (!container || !data || data === 'unknown') {
      if (container) container.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:1rem">無法生成 QR Code（UID 無效）</div>';
      return;
    }
    container.innerHTML = '';
    // 方案 A：本地 qrcode 庫（canvas）
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      const canvas = document.createElement('canvas');
      QRCode.toCanvas(canvas, data, { width: size, margin: 1, errorCorrectionLevel: 'H' }, (err) => {
        if (!err) {
          canvas.style.display = 'block';
          container.appendChild(canvas);
        } else {
          console.warn('[QR] 本地生成失敗，切換 API:', err);
          this._qrFallbackImg(container, data, size);
        }
      });
    } else {
      // 方案 B：外部 API 圖片
      console.warn('[QR] qrcode 庫未載入，使用 API 備援');
      this._qrFallbackImg(container, data, size);
    }
  },

  /** QR Code API 備援（純 img 標籤，不依賴任何 JS 庫） */
  _qrFallbackImg(container, data, size) {
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=H&data=${encodeURIComponent(data)}`;
    img.width = size;
    img.height = size;
    img.alt = 'QR Code';
    img.style.display = 'block';
    img.onerror = () => {
      container.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:1rem">QR Code 生成失敗，請檢查網路連線</div>';
    };
    container.appendChild(img);
  },

  /** 渲染「我的 QR Code」頁面 */
  renderQrCodePage() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || 'unknown';
    const container = document.getElementById('page-qr-canvas');
    const uidText = document.getElementById('page-qr-uid');
    if (!container) return;
    if (uidText) uidText.textContent = `UID: ${uid}`;
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    this._generateQrCode(container, uid, 160);
  },

  // ── 社群連結相關 ──
  _socialPlatforms: {
    fb:      { name: 'Facebook',    prefix: 'https://www.facebook.com/' },
    ig:      { name: 'Instagram',   prefix: 'https://www.instagram.com/' },
    threads: { name: 'Threads',     prefix: 'https://www.threads.net/@' },
    yt:      { name: 'YouTube',     prefix: 'https://www.youtube.com/@' },
    twitter: { name: 'X (Twitter)', prefix: 'https://x.com/' },
  },

  _currentSocialPlatform: null,

  _buildSocialLinksHtml(user) {
    const links = (user && user.socialLinks) || {};
    const platforms = this._socialPlatforms;
    const svgs = {
      fb: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
      ig: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
      threads: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.59 12c.025 3.086.718 5.496 2.057 7.164 1.432 1.781 3.632 2.695 6.54 2.717 2.227-.017 4.074-.517 5.49-1.482 1.2-.82 2.12-2.012 2.7-3.508l1.942.672a10.987 10.987 0 01-3.335 4.397C17.165 23.275 14.898 23.98 12.186 24zm4.394-8.858c-.095-1.17-.584-2.098-1.422-2.698-.7-.5-1.6-.775-2.617-.8-.87.02-1.653.26-2.262.687-.66.47-1.065 1.12-1.138 1.822-.078.78.225 1.41.85 1.776.54.313 1.19.48 1.92.49.95-.01 1.82-.32 2.42-.86.44-.39.7-.86.77-1.38.03-.16.04-.32.04-.48v-.01c-.005-.185-.02-.365-.046-.537l-.015-.01zm1.87-1.06c.068.36.113.73.134 1.11.03.52.003 1.04-.084 1.55-.242 1.39-.98 2.56-2.14 3.38-1.15.82-2.54 1.257-4.02 1.267h-.05c-1.12-.01-2.1-.275-2.913-.786-1.125-.706-1.68-1.844-1.54-3.15.12-1.13.747-2.097 1.76-2.72.88-.54 1.96-.837 3.12-.86h.06c.68.01 1.33.11 1.93.29-.16-.6-.48-1.07-.96-1.4-.58-.4-1.32-.61-2.16-.61h-.04c-.96.01-1.79.24-2.46.67l-.96-1.72c.97-.61 2.15-.95 3.44-.97h.06c1.34.02 2.5.4 3.39 1.1.78.62 1.3 1.45 1.55 2.44l.04.17z"/></svg>',
      yt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
      twitter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    };
    const active = Object.keys(platforms).filter(k => links[k]);
    if (!active.length) return '';
    const btns = active.map(k => {
      const url = platforms[k].prefix + encodeURIComponent(links[k]);
      return `<div style="display:inline-flex;align-items:center;gap:2px">
        <a class="social-btn active" data-platform="${k}" href="${url}" target="_blank" rel="noopener" title="${platforms[k].name}: @${escapeHTML(links[k])}">${svgs[k]}</a>
        <button class="social-copy-btn" onclick="event.stopPropagation();App._copySocialLink('${k}','${escapeHTML(links[k])}')" title="複製帳號">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>`;
    }).join('');
    return `<div class="social-grid" style="margin-bottom:.65rem">${btns}</div>`;
  },

  renderSocialLinks(user) {
    const links = (user && user.socialLinks) || {};
    document.querySelectorAll('.social-btn').forEach(btn => {
      const p = btn.dataset.platform;
      if (links[p]) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  },

  openSocialLinkModal(platform) {
    const info = this._socialPlatforms[platform];
    if (!info) return;
    this._currentSocialPlatform = platform;
    const user = ApiService.getCurrentUser();
    const links = (user && user.socialLinks) || {};
    const currentVal = links[platform] || '';

    document.getElementById('social-modal-title').textContent = `編輯 ${info.name} 連結`;
    document.getElementById('social-modal-label').textContent = `你的 ${info.name} ID`;
    document.getElementById('social-url-prefix').textContent = info.prefix;
    document.getElementById('social-link-input').value = currentVal;
    document.getElementById('social-clear-btn').style.display = currentVal ? '' : 'none';
    this.showModal('social-link-modal');
  },

  saveSocialLink() {
    const platform = this._currentSocialPlatform;
    if (!platform) return;
    const input = document.getElementById('social-link-input');
    const val = (input && input.value) ? input.value.trim() : '';
    const user = ApiService.getCurrentUser();
    const links = Object.assign({}, (user && user.socialLinks) || {});
    links[platform] = val || '';
    ApiService.updateCurrentUser({ socialLinks: links });
    this.closeModal();
    this.renderProfileData();
    this.showToast(val ? '社群連結已儲存' : '社群連結已清除');
  },

  clearSocialLink() {
    const platform = this._currentSocialPlatform;
    if (!platform) return;
    const user = ApiService.getCurrentUser();
    const links = Object.assign({}, (user && user.socialLinks) || {});
    links[platform] = '';
    ApiService.updateCurrentUser({ socialLinks: links });
    this.closeModal();
    this.renderProfileData();
    this.showToast('社群連結已清除');
  },

  /** 顯示 UID 專屬 QR Code 彈窗 */
  showUidQrCode() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || 'unknown';
    const modal = document.getElementById('uid-qr-modal');
    const content = document.getElementById('uid-qr-content');
    if (!modal || !content) return;
    content.innerHTML = `
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.8rem">我的 UID QR Code</div>
      <div id="uid-qr-canvas" style="background:#fff;display:inline-block;padding:12px;border-radius:var(--radius)"></div>
      <div style="margin-top:.7rem;font-size:.75rem;color:var(--text-muted);word-break:break-all">${escapeHTML(uid)}</div>
      <button onclick="App._copyUidToClipboard('${escapeHTML(uid)}')" style="margin-top:.6rem;padding:.45rem 1.2rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.8rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        複製 UID
      </button>
    `;
    this._generateQrCode(document.getElementById('uid-qr-canvas'), uid, 180);
    modal.style.display = 'flex';
  },

  /** 複製 UID 到剪貼簿 */
  _copyUidToClipboard(uid) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uid).then(() => {
        this.showToast('UID 已複製到剪貼簿');
      }).catch(() => {
        this._fallbackCopyText(uid);
      });
    } else {
      this._fallbackCopyText(uid);
    }
  },

  /** 複製社群帳號到剪貼簿 */
  _copySocialLink(platform, accountId) {
    const platformNames = { fb: 'Facebook', ig: 'Instagram', threads: 'Threads', yt: 'YouTube', twitter: 'X' };
    const name = platformNames[platform] || platform;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(accountId).then(() => {
        this.showToast(`${name} 帳號已複製`);
      }).catch(() => {
        this._fallbackCopyText(accountId);
        this.showToast(`${name} 帳號已複製`);
      });
    } else {
      this._fallbackCopyText(accountId);
      this.showToast(`${name} 帳號已複製`);
    }
  },

  _fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      this.showToast('UID 已複製到剪貼簿');
    } catch (e) {
      this.showToast('複製失敗，請手動複製');
    }
    document.body.removeChild(ta);
  },
});
