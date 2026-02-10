/* ================================================
   SportHub — Admin Render & Create Methods
   依賴：config.js, data.js, api-service.js, app.js (core)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Render: Admin Users
  // ══════════════════════════════════

  renderAdminUsers() {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    container.innerHTML = ApiService.getAdminUsers().map(u => {
      let promoteOptions = '';
      if (myLevel >= 5) {
        promoteOptions = '<option value="">晉升▼</option><option>管理員</option><option>教練</option><option>領隊</option><option>場主</option>';
      } else if (myLevel >= 4) {
        promoteOptions = '<option value="">晉升▼</option><option>教練</option><option>領隊</option><option>場主</option>';
      }

      return `
        <div class="admin-user-card">
          <div class="profile-avatar small">${u.name[0]}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
            <div class="admin-user-meta">${u.uid} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${u.region}</div>
          </div>
          <div class="admin-user-actions">
            ${promoteOptions ? `<select class="promote-select" onchange="App.handlePromote(this, '${u.name}')">${promoteOptions}</select>` : ''}
            <button class="text-btn" onclick="App.showUserProfile('${u.name}')">查看</button>
          </div>
        </div>
      `;
    }).join('');
  },

  handlePromote(select, name) {
    if (!select.value) return;
    const roleMap = { '管理員': 'admin', '教練': 'coach', '領隊': 'captain', '場主': 'venue_owner' };
    const roleKey = roleMap[select.value];
    if (!roleKey) return;
    ApiService.promoteUser(name, roleKey);
    this.renderAdminUsers();
    this.showToast(`已將「${name}」晉升為「${select.value}」`);
    select.value = '';
  },

  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getExpLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">${this._userTag(l.target)} <strong>${l.amount}</strong>「${l.reason}」</span>
      </div>
    `).join('');
  },

  demoExpSearch() {
    const keyword = (document.getElementById('exp-search')?.value || '').trim();
    if (!keyword) { this.showToast('請輸入 UID 或暱稱'); return; }
    const users = ApiService.getAdminUsers();
    const found = users.find(u => u.name === keyword || u.uid === keyword);
    const card = document.getElementById('exp-target-card');
    if (!card) return;
    if (found) {
      card.style.display = '';
      card.querySelector('.exp-target-name').textContent = found.name;
      card.querySelector('.exp-target-detail').textContent = `UID: ${found.uid} ・ Lv.${found.level} ・ EXP: ${found.exp}`;
      card.querySelector('.profile-avatar').textContent = found.name[0];
      card.dataset.targetName = found.name;
      this.showToast(`已搜尋到用戶「${found.name}」`);
    } else {
      card.style.display = 'none';
      this.showToast('找不到該用戶');
    }
  },

  handleExpSubmit() {
    const card = document.getElementById('exp-target-card');
    const targetName = card?.dataset.targetName;
    if (!targetName) { this.showToast('請先搜尋用戶'); return; }
    const amountInput = card.querySelector('input[type="number"]');
    const reasonInput = card.querySelectorAll('input[type="text"]')[0];
    const amount = parseInt(amountInput?.value) || 0;
    const reason = (reasonInput?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入 EXP 調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = ROLES[this.currentRole]?.label || '管理員';
    const user = ApiService.adjustUserExp(targetName, amount, reason, operatorLabel);
    if (user) {
      card.querySelector('.exp-target-detail').textContent = `UID: ${user.uid} ・ Lv.${user.level} ・ EXP: ${user.exp}`;
      this.renderExpLogs();
      this.renderOperationLogs();
      this.showToast(`已調整「${targetName}」EXP ${amount > 0 ? '+' : ''}${amount}`);
    }
  },

  renderOperationLogs() {
    const container = document.getElementById('operation-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getOperationLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${l.typeName}</span>
          ${l.operator}：${l.content}
        </span>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Ad Management — Banner CRUD
  // ══════════════════════════════════

  _bannerEditId: null,

  _formatDT(isoStr) {
    const d = new Date(isoStr);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  _remainDays(unpublishAt) {
    const diff = new Date(unpublishAt.replace(/\//g, '-')) - new Date();
    return Math.max(0, Math.ceil(diff / 86400000));
  },

  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    const items = ApiService.getBanners();
    container.innerHTML = items.map(b => {
      const isActive = b.status === 'active';
      const isScheduled = b.status === 'scheduled';
      const remain = b.unpublishAt ? this._remainDays(b.unpublishAt) : 0;
      const statusLabel = isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = b.publishAt && b.unpublishAt ? `${b.publishAt} ~ ${b.unpublishAt}` : '尚未設定時間';
      const remainText = isActive ? `剩餘 ${remain} 天` : '';
      const thumb = b.image
        ? `<div class="banner-thumb" style="overflow:hidden"><img src="${b.image}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="banner-thumb banner-thumb-empty"><span>1200<br>×<br>400</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div class="banner-manage-title">廣告位 ${b.slot}${b.title ? ' — ' + b.title : ''}</div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}</div>
          <div class="banner-manage-meta">點擊 ${b.clicks}</div>
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div style="flex-shrink:0">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editBannerItem('${b.id}')">編輯</button>
        </div>
      </div>`;
    }).join('');
  },

  showBannerForm(editData) {
    const form = document.getElementById('banner-form-card');
    if (!form) return;
    form.style.display = '';
    this._bannerEditId = editData.id;
    document.getElementById('banner-form-title').textContent = `編輯廣告位 ${editData.slot}`;
    document.getElementById('banner-input-title').value = editData.title || '';
    document.getElementById('banner-slot-display').textContent = `廣告位 ${editData.slot}`;
    const preview = document.getElementById('banner-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 1200 × 400 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('banner-image').value = '';
    // Mode
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('banner-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleBannerSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('banner-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('banner-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideBannerForm() {
    const form = document.getElementById('banner-form-card');
    if (form) form.style.display = 'none';
    this._bannerEditId = null;
  },

  toggleBannerSchedule() {
    const mode = document.getElementById('banner-input-mode').value;
    document.getElementById('banner-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  saveBanner() {
    const unpublishVal = document.getElementById('banner-input-unpublish').value;
    if (!unpublishVal) { this.showToast('請選擇結束時間'); return; }
    const title = document.getElementById('banner-input-title').value.trim();
    const mode = document.getElementById('banner-input-mode').value;
    const unpublishAt = this._formatDT(unpublishVal);
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('banner-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    // Get image from preview
    const previewImg = document.querySelector('#banner-preview img');
    const image = previewImg ? previewImg.src : (ApiService.getBanners().find(b => b.id === this._bannerEditId)?.image || null);
    ApiService.updateBanner(this._bannerEditId, { title, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `Banner 已排程，將於 ${publishAt} 啟用` : 'Banner 已更新並立即啟用');
    this.hideBannerForm();
    this.renderBannerManage();
    this.renderBannerCarousel();
  },

  editBannerItem(id) {
    const item = ApiService.getBanners().find(b => b.id === id);
    if (item) this.showBannerForm(item);
  },

  // ══════════════════════════════════
  //  Ad Management — Floating Ad CRUD
  // ══════════════════════════════════

  _floatAdEditId: null,

  renderFloatingAdManage() {
    const container = document.getElementById('floating-ad-manage-list');
    if (!container) return;
    const ads = ApiService.getFloatingAds();
    container.innerHTML = ads.map(ad => {
      const isActive = ad.status === 'active';
      const isScheduled = ad.status === 'scheduled';
      const remain = ad.unpublishAt ? this._remainDays(ad.unpublishAt) : 0;
      const statusLabel = isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = ad.publishAt && ad.unpublishAt ? `${ad.publishAt} ~ ${ad.unpublishAt}` : '尚未設定時間';
      const remainText = isActive ? `剩餘 ${remain} 天` : '';
      const thumb = ad.image
        ? `<div class="banner-thumb banner-thumb-circle" style="overflow:hidden"><img src="${ad.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
        : `<div class="banner-thumb banner-thumb-circle banner-thumb-empty"><span>200<br>×<br>200</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div class="banner-manage-title">${ad.slot}${ad.title ? ' — ' + ad.title : ''}</div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}</div>
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div style="flex-shrink:0">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editFloatingAd('${ad.id}')">編輯</button>
        </div>
      </div>`;
    }).join('');
  },

  showFloatingAdForm(editData) {
    const form = document.getElementById('floatad-form-card');
    if (!form) return;
    form.style.display = '';
    this._floatAdEditId = editData.id;
    document.getElementById('floatad-form-title').textContent = `編輯 ${editData.slot}`;
    document.getElementById('floatad-input-title').value = editData.title || '';
    const preview = document.getElementById('floatad-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 200 × 200 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('floatad-image').value = '';
    // Mode
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('floatad-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleFloatAdSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('floatad-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('floatad-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideFloatingAdForm() {
    const form = document.getElementById('floatad-form-card');
    if (form) form.style.display = 'none';
    this._floatAdEditId = null;
  },

  toggleFloatAdSchedule() {
    const mode = document.getElementById('floatad-input-mode').value;
    document.getElementById('floatad-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  saveFloatingAd() {
    const unpublishVal = document.getElementById('floatad-input-unpublish').value;
    if (!unpublishVal) { this.showToast('請選擇結束時間'); return; }
    const title = document.getElementById('floatad-input-title').value.trim();
    const mode = document.getElementById('floatad-input-mode').value;
    const unpublishAt = this._formatDT(unpublishVal);
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('floatad-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    // Get image from preview
    const previewImg = document.querySelector('#floatad-preview img');
    const image = previewImg ? previewImg.src : (ApiService.getFloatingAds().find(a => a.id === this._floatAdEditId)?.image || null);
    ApiService.updateFloatingAd(this._floatAdEditId, { title, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `浮動廣告已排程，將於 ${publishAt} 啟用` : '浮動廣告已更新並立即啟用');
    this.hideFloatingAdForm();
    this.renderFloatingAdManage();
    this.renderFloatingAds();
  },

  editFloatingAd(id) {
    const item = ApiService.getFloatingAds().find(a => a.id === id);
    if (item) this.showFloatingAdForm(item);
  },

  // ══════════════════════════════════
  //  Announcement CRUD
  // ══════════════════════════════════

  _annEditId: null,

  renderAnnouncementManage() {
    const container = document.getElementById('announcement-manage-list');
    if (!container) return;
    const items = ApiService.getAnnouncements();
    const statusLabels = { active: '已發布', scheduled: '已排程', expired: '已過期' };
    container.innerHTML = items.length ? items.map(a => `
      <div class="banner-manage-card">
        <div class="banner-thumb" style="background:var(--accent)">公告</div>
        <div class="banner-manage-info">
          <div class="banner-manage-title">${a.title}</div>
          <div class="banner-manage-meta">${a.publishAt} ・ ${a.createdBy}</div>
          <span class="banner-manage-status status-${a.status}">${statusLabels[a.status] || a.status}</span>
        </div>
        <div class="admin-ach-actions" style="flex-shrink:0;display:flex;flex-direction:column;gap:.2rem">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editAnnouncementItem('${a.id}')">編輯</button>
          <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteAnnouncementItem('${a.id}')">刪除</button>
        </div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無公告</div>';
  },

  showAnnouncementForm(editData) {
    const form = document.getElementById('announcement-form-card');
    if (!form) return;
    form.style.display = '';
    this._annEditId = editData ? editData.id : null;
    document.getElementById('announcement-form-title').textContent = editData ? '編輯公告' : '新增公告';
    document.getElementById('ann-input-title').value = editData ? editData.title : '';
    document.getElementById('ann-input-content').value = editData ? editData.content : '';
    const isScheduled = editData && editData.status === 'scheduled';
    document.getElementById('ann-input-publish-type').value = isScheduled ? 'scheduled' : 'now';
    this.toggleAnnSchedule();
    if (isScheduled) {
      document.getElementById('ann-input-schedule').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideAnnouncementForm() {
    const form = document.getElementById('announcement-form-card');
    if (form) form.style.display = 'none';
    this._annEditId = null;
  },

  toggleAnnSchedule() {
    const type = document.getElementById('ann-input-publish-type').value;
    document.getElementById('ann-schedule-row').style.display = type === 'scheduled' ? '' : 'none';
  },

  saveAnnouncementItem() {
    const title = document.getElementById('ann-input-title').value.trim();
    const content = document.getElementById('ann-input-content').value.trim();
    const publishType = document.getElementById('ann-input-publish-type').value;
    if (!title) { this.showToast('請輸入公告標題'); return; }
    if (!content) { this.showToast('請輸入公告內容'); return; }
    let publishAt, status;
    if (publishType === 'scheduled') {
      const scheduleVal = document.getElementById('ann-input-schedule').value;
      if (!scheduleVal) { this.showToast('請選擇預約發布時間'); return; }
      publishAt = this._formatDT(scheduleVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    if (this._annEditId) {
      ApiService.updateAnnouncement(this._annEditId, { title, content, status, publishAt });
      this.showToast(`公告「${title}」已更新`);
    } else {
      ApiService.createAnnouncement({ id: 'ann' + Date.now(), title, content, status, publishAt, createdAt: this._formatDT(new Date().toISOString()), createdBy: ROLES[this.currentRole]?.label || '總管' });
      this.showToast(status === 'scheduled' ? `公告「${title}」已排程` : `公告「${title}」已發布`);
    }
    this.hideAnnouncementForm();
    this.renderAnnouncementManage();
    this.renderAnnouncement();
  },

  editAnnouncementItem(id) {
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (item) this.showAnnouncementForm(item);
  },

  deleteAnnouncementItem(id) {
    const items = ApiService.getAnnouncements();
    const item = items.find(a => a.id === id);
    if (!item) return;
    ApiService.deleteAnnouncement(id);
    this.renderAnnouncementManage();
    this.renderAnnouncement();
    this.showToast(`公告「${item.title}」已刪除`);
  },

  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getShopItems().map(s => `
      <div class="sm-card">
        <div class="sm-thumb">商品縮圖<br>60 × 60</div>
        <div class="sm-info">
          <div class="sm-title">${s.name}</div>
          <div class="sm-meta">${s.condition} ・ ${s.size} ・ <strong style="color:var(--accent)">$${s.price}</strong></div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showShopDetail('${s.id}')">查看</button>
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)">下架</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Message Management
  // ══════════════════════════════════

  renderMsgManage(filter) {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    const f = filter || 'sent';
    const items = ApiService.getAdminMessages().filter(m => m.status === f);
    container.innerHTML = items.length ? items.map(m => `
      <div class="msg-manage-card">
        <div class="msg-manage-header">
          <span class="msg-manage-title">${m.title}</span>
          <span class="msg-read-rate">${m.status === 'sent' ? '已讀率 ' + m.readRate : m.status === 'scheduled' ? '排程中' : '已回收'}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">對象：${m.target} ・ ${m.time}</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.body}</div>
        <div style="margin-top:.4rem;display:flex;gap:.3rem">
          ${m.status === 'sent' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('信件內容：${m.body.slice(0,20)}...')">查看</button><button class="text-btn" style="font-size:.75rem;color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>` : ''}
          ${m.status === 'scheduled' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('已取消排程')">取消排程</button>` : ''}
          ${m.status === 'recalled' ? `<button class="text-btn" style="font-size:.75rem;color:var(--text-muted)">已回收</button>` : ''}
        </div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">無信件</div>';

    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMsgManage(tab.dataset.mfilter);
        });
      });
    }
  },

  recallMsg(id) {
    ApiService.updateAdminMessage(id, { status: 'recalled' });
    this.renderMsgManage('sent');
    this.showToast('已回收信件');
  },

  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (el) { el.style.display = ''; el.scrollIntoView({ behavior: 'smooth' }); }
  },

  sendDemoMsg() {
    const title = document.getElementById('msg-title')?.value || '未命名信件';
    const target = document.getElementById('msg-target')?.value || '全體用戶';
    const body = document.getElementById('msg-body')?.value || '';
    const schedule = document.getElementById('msg-schedule')?.value;
    ApiService.createAdminMessage({
      id: 'mg' + Date.now(), title, target, readRate: '-', time: new Date().toLocaleDateString('zh-TW').replace(/\//g, '/'),
      status: schedule ? 'scheduled' : 'sent', body: body || title
    });
    document.getElementById('msg-compose').style.display = 'none';
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    this.renderMsgManage(schedule ? 'scheduled' : 'sent');
    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.querySelector(`[data-mfilter="${schedule ? 'scheduled' : 'sent'}"]`)?.classList.add('active');
    }
    this.showToast(schedule ? '信件已排程' : '信件已發送');
  },

  // ══════════════════════════════════
  //  Render: Tournament Management
  // ══════════════════════════════════

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div class="event-card-title">${t.name}</div>
          <div class="event-meta">
            <span class="event-meta-item">${t.type}</span>
            <span class="event-meta-item">${t.teams} 隊</span>
            <span class="event-meta-item">${t.status}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small">管理賽程</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">輸入比分</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">交易設定</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">紅黃牌</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Admin Team Management
  // ══════════════════════════════════

  filterAdminTeams() {
    const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
    this.renderAdminTeams(q);
  },

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t => t.name.toLowerCase().includes(q) || t.nameEn.toLowerCase().includes(q) || t.captain.includes(q) || t.region.includes(q));
    container.innerHTML = teams.length ? teams.map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${t.name} <span style="font-size:.72rem;color:var(--text-muted)">${t.nameEn}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">至頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${t.captain}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${t.region}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消至頂' : '至頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
          </div>
        </div>
      </div>
    `).join('') : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的球隊</div>';
  },

  _pinCounter: 100,
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
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

  // ══════════════════════════════════
  //  Render: Admin Achievements/Badges
  // ══════════════════════════════════

  _adminAchTab: 'achievements',
  _achEditId: null,
  _badgeEditId: null,

  renderAdminAchievements(type) {
    const container = document.getElementById('admin-ach-list');
    if (!container) return;
    const t = type || this._adminAchTab;
    this._adminAchTab = t;
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };
    const catLabels = { gold: '金', silver: '銀', bronze: '銅' };

    if (t === 'achievements') {
      const items = this._sortByCat(ApiService.getAchievements());
      container.innerHTML = items.map((a, i) => {
        const color = catColors[a.category] || catColors.bronze;
        const pct = a.target > 0 ? Math.min(100, Math.round(a.current / a.target * 100)) : 0;
        const completed = a.current >= a.target;
        return `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${color}">
          <div class="admin-ach-info" style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.3rem">
              <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${catLabels[a.category]}</span>
              <span class="admin-ach-name">${a.name}</span>
              ${completed ? '<span style="font-size:.6rem;color:var(--success);font-weight:600">已完成</span>' : ''}
            </div>
            <div class="admin-ach-status" style="color:var(--text-muted)">${a.desc} ・ 目標 ${a.target}</div>
            <div class="ach-progress-bar-wrap" style="margin-top:.25rem;height:4px">
              <div class="ach-progress-bar" style="width:${pct}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
            </div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.editAchievement('${a.id}')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteAchievement('${a.id}')">刪除</button>
          </div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無成就</div>';

    } else {
      const items = this._sortByCat(ApiService.getBadges());
      const achievements = ApiService.getAchievements();
      container.innerHTML = items.map((b, i) => {
        const color = catColors[b.category] || catColors.bronze;
        const ach = achievements.find(a => a.id === b.achId);
        const achName = ach ? ach.name : '（未關聯）';
        return `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${color}">
          <div class="badge-img-placeholder small" style="border-color:${color};flex-shrink:0">${b.image ? `<img src="${b.image}">` : ''}</div>
          <div class="admin-ach-info" style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.3rem">
              <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${catLabels[b.category]}</span>
              <span class="admin-ach-name">${b.name}</span>
            </div>
            <div class="admin-ach-status" style="color:var(--text-muted)">關聯成就：${achName}</div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.editBadge('${b.id}')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteBadge('${b.id}')">刪除</button>
          </div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無徽章</div>';
    }

    // Bind tabs once
    const tabs = document.getElementById('admin-ach-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
          tab.classList.add('active');
          this._adminAchTab = tab.dataset.atype;
          this.renderAdminAchievements(tab.dataset.atype);
        });
      });
    }
  },

  // ── Achievement CRUD ──

  showAchForm(editData) {
    const form = document.getElementById('ach-form-card');
    if (!form) return;
    form.style.display = '';
    this._achEditId = editData ? editData.id : null;
    document.getElementById('ach-form-title').textContent = editData ? '編輯成就' : '新增成就';
    document.getElementById('ach-input-name').value = editData ? editData.name : '';
    document.getElementById('ach-input-desc').value = editData ? editData.desc : '';
    document.getElementById('ach-input-target').value = editData ? editData.target : 10;
    document.getElementById('ach-input-category').value = editData ? editData.category : 'bronze';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideAchForm() {
    const form = document.getElementById('ach-form-card');
    if (form) form.style.display = 'none';
    this._achEditId = null;
  },

  saveAchievement() {
    const name = document.getElementById('ach-input-name').value.trim();
    const desc = document.getElementById('ach-input-desc').value.trim();
    const target = parseInt(document.getElementById('ach-input-target').value) || 1;
    const category = document.getElementById('ach-input-category').value;
    if (!name) { this.showToast('請輸入成就名稱'); return; }

    if (this._achEditId) {
      const item = ApiService.getAchievements().find(a => a.id === this._achEditId);
      if (item) {
        const oldTarget = item.target;
        let completedAt = item.completedAt;
        if (item.current >= target && !completedAt) {
          const d = new Date(); completedAt = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        } else if (item.current < target) {
          completedAt = null;
        }
        ApiService.updateAchievement(this._achEditId, { name, desc, target, category, completedAt });
        this.showToast(`成就「${name}」已更新（目標 ${oldTarget} → ${target}）`);
      }
    } else {
      const newId = 'a' + Date.now();
      const newBadgeId = 'b' + Date.now();
      ApiService.createAchievement({ id: newId, name, desc, target, current: 0, category, badgeId: newBadgeId, completedAt: null });
      ApiService.createBadge({ id: newBadgeId, name: name + '徽章', achId: newId, category, image: null });
      this.showToast(`成就「${name}」已建立，已自動建立關聯徽章`);
    }

    this.hideAchForm();
    this.renderAdminAchievements('achievements');
    this.renderAchievements();
    this.renderBadges();
  },

  editAchievement(id) {
    const item = ApiService.getAchievements().find(a => a.id === id);
    if (item) this.showAchForm(item);
  },

  deleteAchievement(id) {
    const data = ApiService.getAchievements();
    const item = data.find(a => a.id === id);
    if (!item) return;
    const name = item.name;
    const badgeId = item.badgeId;
    ApiService.deleteAchievement(id);
    if (badgeId) ApiService.deleteBadge(badgeId);
    this.renderAdminAchievements();
    this.renderAchievements();
    this.renderBadges();
    this.showToast(`成就「${name}」及關聯徽章已刪除，所有用戶同步移除`);
  },

  // ── Badge CRUD ──

  showBadgeForm(editData) {
    const form = document.getElementById('badge-form-card');
    if (!form) return;
    form.style.display = '';
    this._badgeEditId = editData ? editData.id : null;
    document.getElementById('badge-form-title').textContent = editData ? '編輯徽章' : '新增徽章';
    document.getElementById('badge-input-name').value = editData ? editData.name : '';
    document.getElementById('badge-input-category').value = editData ? editData.category : 'bronze';
    // Populate achievement select
    const select = document.getElementById('badge-input-ach');
    select.innerHTML = '<option value="">（不關聯成就）</option>' +
      ApiService.getAchievements().map(a => `<option value="${a.id}" ${editData && editData.achId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideBadgeForm() {
    const form = document.getElementById('badge-form-card');
    if (form) form.style.display = 'none';
    this._badgeEditId = null;
  },

  saveBadge() {
    const name = document.getElementById('badge-input-name').value.trim();
    const category = document.getElementById('badge-input-category').value;
    const achId = document.getElementById('badge-input-ach').value;
    if (!name) { this.showToast('請輸入徽章名稱'); return; }

    if (this._badgeEditId) {
      ApiService.updateBadge(this._badgeEditId, { name, category, achId });
      this.showToast(`徽章「${name}」已更新`);
    } else {
      ApiService.createBadge({ id: 'b' + Date.now(), name, achId, category, image: null });
      this.showToast(`徽章「${name}」已建立`);
    }

    this.hideBadgeForm();
    this.renderAdminAchievements('badges');
    this.renderBadges();
  },

  editBadge(id) {
    const item = ApiService.getBadges().find(b => b.id === id);
    if (item) this.showBadgeForm(item);
  },

  deleteBadge(id) {
    const badges = ApiService.getBadges();
    const item = badges.find(b => b.id === id);
    if (!item) return;
    const name = item.name;
    ApiService.deleteBadge(id);
    this.renderAdminAchievements();
    this.renderBadges();
    this.showToast(`徽章「${name}」已刪除，所有用戶同步移除`);
  },

  // ══════════════════════════════════
  //  Render: Permissions & Inactive
  // ══════════════════════════════════

  renderPermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;
    container.innerHTML = ApiService.getPermissions().map((cat, ci) => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map((p, pi) => `
            <label class="perm-item">
              <input type="checkbox" ${Math.random() > 0.5 ? 'checked' : ''}>
              <span>${p.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

  renderRoleHierarchy() {
    const container = document.getElementById('role-hierarchy-list');
    if (!container) return;
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];
    container.innerHTML = roles.map((key, i) => {
      const r = ROLES[key];
      return `<div class="role-level-row">
        <span class="role-level-num">Lv.${i}</span>
        <span class="role-level-badge" style="background:${r.color}">${r.label}</span>
        <span class="role-level-key">${key}</span>
        ${i >= 4 ? '' : '<button class="role-insert-btn" onclick="App.openRoleEditorAt(' + i + ')">＋ 插入</button>'}
      </div>`;
    }).join('');
  },

  openRoleEditor() {
    const editor = document.getElementById('role-editor-card');
    editor.style.display = '';
    document.getElementById('role-editor-title').textContent = '新增自訂層級';
    document.getElementById('role-name-input').value = '';
    const select = document.getElementById('role-position-select');
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin'];
    select.innerHTML = roles.map((key, i) => {
      const next = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'][i];
      return `<option value="${i}">${ROLES[key].label} 與 ${ROLES[next].label} 之間</option>`;
    }).join('');
    this.renderPermissions();
    editor.scrollIntoView({ behavior: 'smooth' });
  },

  openRoleEditorAt(levelIndex) {
    this.openRoleEditor();
    document.getElementById('role-position-select').value = levelIndex;
  },

  renderInactiveData() {
    const container = document.getElementById('inactive-list');
    if (!container) return;
    container.innerHTML = `
      <div class="inactive-card">
        <div style="font-weight:700">鳳凰隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/12/15</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱Z ・ 原成員：14 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
      <div class="inactive-card">
        <div style="font-weight:700">颱風隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/08/20</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱W ・ 原成員：10 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Render: My Activities
  // ══════════════════════════════════

  renderMyActivities() {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const myEvents = ApiService.getActiveEvents().slice(0, 6);
    container.innerHTML = myEvents.length > 0
      ? myEvents.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        return `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${e.title}</div>
            <span class="tl-event-status ${statusConf.css}" style="font-size:.68rem">${statusConf.label}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${e.location}</span>
            <span class="event-meta-item">${e.date}</span>
            <span class="event-meta-item">${e.current}/${e.max} 人</span>
          </div>
          <div style="display:flex;gap:.3rem;margin-top:.5rem">
            <button class="primary-btn small">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">查看名單</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)">關閉</button>
          </div>
        </div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">尚無管理中的活動</div>';
  },

  // ══════════════════════════════════
  //  Render: User Card
  // ══════════════════════════════════

  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;
    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const teamName = this._userTeam ? (ApiService.getTeam(this._userTeam)?.name || '—') : '無';
    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">王</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">全勤.王小明</div>
        <div style="margin-top:.3rem">${this._userTag('王小明')}</div>
        <div class="profile-level">
          <span>Lv.10</span>
          <div class="exp-bar"><div class="exp-fill" style="width:40%"></div></div>
          <span class="exp-text">800/2000</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>男</span></div>
        <div class="info-row"><span>生日</span><span>2000/05/20</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>運動類別</span><span>足球</span></div>
        <div class="info-row"><span>所屬球隊</span><span>${teamName}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = this._catColors[b.category] || this._catColors.bronze;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
            <span class="uc-badge-name">${b.name}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
      <div class="info-card">
        <div class="info-title">交易價值紀錄</div>
        <div style="font-size:.82rem;color:var(--text-muted)">目前無交易紀錄</div>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Create Event
  // ══════════════════════════════════

  _eventCounter: 100,
  handleCreateEvent() {
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const timeVal = document.getElementById('ce-time').value.trim();
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const waitlistMax = parseInt(document.getElementById('ce-waitlist').value) || 0;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const dateParts = dateVal.split('-');
    const dateStr = `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : dateStr;

    this._eventCounter++;
    const newEvent = {
      id: 'ce' + this._eventCounter,
      title, type, status: 'open', location, date: fullDate,
      fee, max, current: 0, waitlist: 0, waitlistMax, minAge, notes, image,
      creator: ROLES[this.currentRole]?.label || '一般用戶',
      contact: '',
      gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
      icon: '',
      countdown: '即將開始',
      participants: [],
      waitlistNames: [],
    };

    ApiService.createEvent(newEvent);
    this.renderActivityList();
    this.renderHotEvents();
    this.renderMyActivities();
    this.closeModal();
    this.showToast(`活動「${title}」已建立！`);

    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '5';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-image').value = '';
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Image Upload Preview
  // ══════════════════════════════════

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 2MB');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
          preview.classList.add('has-image');
        }
      };
      reader.readAsDataURL(file);
    });
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  _tournamentCounter: 100,
  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const status = document.getElementById('ct-status').value;

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    const ctPreviewEl = document.getElementById('ct-upload-preview');
    const ctImg = ctPreviewEl?.querySelector('img');
    const image = ctImg ? ctImg.src : null;

    this._tournamentCounter++;
    ApiService.createTournament({
      id: 'ct' + this._tournamentCounter,
      name, type, teams,
      matches: type.includes('聯賽') ? teams * (teams - 1) : teams - 1,
      status, image,
      gradient: TOURNAMENT_GRADIENT_MAP[type] || TOURNAMENT_GRADIENT_MAP['聯賽（雙循環）'],
    });

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    document.getElementById('ct-name').value = '';
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Create Shop Item
  // ══════════════════════════════════

  _shopCounter: 100,
  handleCreateShopItem() {
    const name = document.getElementById('cs-name').value.trim();
    const condition = document.getElementById('cs-condition').value;
    const price = parseInt(document.getElementById('cs-price').value) || 0;
    const size = document.getElementById('cs-size').value.trim() || '—';
    const desc = document.getElementById('cs-desc').value.trim();

    if (!name) { this.showToast('請輸入商品名稱'); return; }
    if (price <= 0) { this.showToast('請輸入價格'); return; }
    if (desc.length > 500) { this.showToast('描述不可超過 500 字'); return; }

    this._shopCounter++;
    ApiService.createShopItem({
      id: 'cs' + this._shopCounter,
      name, price, condition, year: 2026, size,
      desc: desc || '賣家未提供描述。',
    });

    this.renderShop();
    this.renderShopManage();
    this.closeModal();
    this.showToast(`商品「${name}」已上架！`);

    document.getElementById('cs-name').value = '';
    document.getElementById('cs-price').value = '';
    document.getElementById('cs-size').value = '';
    document.getElementById('cs-desc').value = '';
    ['cs-img1','cs-img2','cs-img3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['cs-preview1','cs-preview2','cs-preview3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-image'); el.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-hint">JPG/PNG 2MB</span>'; }
    });
  },

});
