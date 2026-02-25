/* ================================================
   SportHub — Announcement: Marquee (Frontend) + CRUD (Admin)
   ================================================ */

Object.assign(App, {

  _annEditId: null,

  // ════════════════════════════════
  //  Frontend — Marquee
  // ════════════════════════════════

  renderAnnouncement() {
    const wrap = document.getElementById('announce-marquee-wrap');
    const track = document.getElementById('announce-marquee-track');
    if (!wrap || !track) return;

    const items = ApiService.getActiveAnnouncements();
    if (!items.length) {
      wrap.style.display = 'none';
      track.innerHTML = '';
      return;
    }

    // Build marquee items
    const html = items.map(a =>
      `<span class="announce-marquee-item" onclick="App.showAnnDetail('${a.id}')">${escapeHTML(a.title)}：${escapeHTML(a.content)}</span>`
    ).join('');

    // Duplicate for seamless loop
    track.innerHTML = `<div class="announce-marquee-inner">${html}${html}</div>`;
    wrap.style.display = '';

    // Calculate duration based on total character count
    const totalChars = items.reduce((sum, a) => sum + (a.title + a.content).length, 0);
    const duration = Math.max(10, totalChars * 0.35);
    track.querySelector('.announce-marquee-inner').style.setProperty('--marquee-duration', duration + 's');
  },

  showAnnDetail(id) {
    const items = ApiService.getActiveAnnouncements();
    const ann = items.find(a => a.id === id);
    if (!ann) return;
    const modal = document.getElementById('announce-detail-modal');
    if (!modal) return;
    document.getElementById('ann-detail-title').textContent = ann.title;
    document.getElementById('ann-detail-body').textContent = ann.content;
    const footer = document.getElementById('ann-detail-footer');
    footer.innerHTML = `<span>${escapeHTML(ann.publishAt)}</span>`;
    modal.classList.add('open');
    modal.querySelector('.modal').classList.add('open');
  },

  // ════════════════════════════════
  //  Backend — Admin Management
  // ════════════════════════════════

  renderAnnouncementManage() {
    const container = document.getElementById('announcement-manage-list');
    if (!container) return;
    const items = ApiService.getAnnouncements().slice().sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    const countEl = document.getElementById('ann-manage-count');
    if (countEl) countEl.textContent = `共 ${items.length}/5 則`;

    const statusLabels = { active: '上架中', scheduled: '已排程', expired: '已下架' };
    const statusColors = { active: '#10b981', scheduled: '#f59e0b', expired: '#6b7280' };

    container.innerHTML = items.length ? items.map((a, idx) => `
      <div class="banner-manage-card" style="align-items:center">
        <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;margin-right:.4rem">
          <button class="text-btn" style="font-size:.85rem;padding:0;line-height:1" onclick="App.moveAnnouncement('${a.id}','up')" ${idx === 0 ? 'disabled style="opacity:.3;font-size:.85rem;padding:0;line-height:1"' : ''}>▲</button>
          <button class="text-btn" style="font-size:.85rem;padding:0;line-height:1" onclick="App.moveAnnouncement('${a.id}','down')" ${idx === items.length - 1 ? 'disabled style="opacity:.3;font-size:.85rem;padding:0;line-height:1"' : ''}>▼</button>
        </div>
        <div class="banner-manage-info" style="flex:1;min-width:0">
          <div class="banner-manage-title">${escapeHTML(a.title)}</div>
          <div class="banner-manage-meta" style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[a.status] || '#6b7280'}"></span>
            <span>${statusLabels[a.status] || a.status}</span>
            <span>・</span>
            ${this._userTag(a.operatorName || a.createdBy)}
          </div>
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:.25rem;align-items:flex-end">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editAnnouncementItem('${a.id}')">編輯</button>
          <button class="text-btn" style="font-size:.72rem;color:${a.status === 'active' ? 'var(--text-muted)' : 'var(--accent)'}" onclick="App.toggleAnnouncementStatus('${a.id}')">${a.status === 'active' ? '下架' : '上架'}</button>
          <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteAnnouncementItem('${a.id}')">刪除</button>
        </div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無公告</div>';
  },

  showAnnouncementForm(editData) {
    const overlay = document.getElementById('announcement-form-overlay');
    if (!overlay) return;

    // Check max 5 limit for new
    if (!editData) {
      const count = ApiService.getAnnouncements().length;
      if (count >= 5) {
        this.showToast('公告最多 5 則，請先刪除舊公告');
        return;
      }
    }

    this._annEditId = editData ? editData.id : null;
    document.getElementById('announcement-form-title').textContent = editData ? '編輯公告' : '新增公告';
    document.getElementById('ann-input-title').value = editData ? editData.title : '';
    document.getElementById('ann-input-content').value = editData ? editData.content : '';
    document.getElementById('ann-content-count').textContent = (editData ? editData.content.length : 0) + '/50';

    const isScheduled = editData && editData.status === 'scheduled';
    document.getElementById('ann-input-publish-type').value = isScheduled ? 'scheduled' : 'now';
    this.toggleAnnSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('ann-input-schedule').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    // Unpublish time
    const unpubInput = document.getElementById('ann-input-unpublish');
    if (unpubInput) {
      unpubInput.value = (editData && editData.unpublishAt) ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    }

    overlay.classList.add('open');
    overlay.querySelector('.modal').classList.add('open');
  },

  hideAnnouncementForm() {
    const overlay = document.getElementById('announcement-form-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.querySelector('.modal').classList.remove('open');
    this._annEditId = null;
  },

  toggleAnnSchedule() {
    const type = document.getElementById('ann-input-publish-type').value;
    document.getElementById('ann-schedule-row').style.display = type === 'scheduled' ? '' : 'none';
  },

  saveAnnouncementItem() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const title = document.getElementById('ann-input-title').value.trim();
    const content = document.getElementById('ann-input-content').value.trim();
    const publishType = document.getElementById('ann-input-publish-type').value;
    const curUser = ApiService.getCurrentUser();
    const operatorName = curUser?.displayName || ROLES[this.currentRole]?.label || '總管';

    if (!title) { this.showToast('請輸入公告標題'); return; }
    if (title.length > 12) { this.showToast('標題不得超過 12 字'); return; }
    if (!content) { this.showToast('請輸入公告內容'); return; }
    if (content.length > 50) { this.showToast('內容不得超過 50 字'); return; }

    // Max 5 check (new only)
    if (!this._annEditId && ApiService.getAnnouncements().length >= 5) {
      this.showToast('公告最多 5 則，請先刪除舊公告');
      return;
    }

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

    const unpubVal = document.getElementById('ann-input-unpublish').value;
    const unpublishAt = unpubVal ? this._formatDT(unpubVal) : null;

    if (this._annEditId) {
      ApiService.updateAnnouncement(this._annEditId, { title, content, status, publishAt, unpublishAt, operatorName });
      ApiService._writeOpLog('ann_edit', '編輯公告', `編輯「${title}」`);
      this.showToast(`公告「${title}」已更新`);
    } else {
      // Assign sortOrder
      const all = ApiService.getAnnouncements();
      const maxSort = all.reduce((m, a) => Math.max(m, a.sortOrder || 0), 0);
      ApiService.createAnnouncement({
        id: 'ann' + Date.now(),
        title, content, status, publishAt, unpublishAt,
        sortOrder: maxSort + 1,
        createdAt: this._formatDT(new Date().toISOString()),
        createdBy: ROLES[this.currentRole]?.label || '總管',
        operatorName
      });
      ApiService._writeOpLog('ann_create', '建立公告', `發布「${title}」`);
      this.showToast(status === 'scheduled' ? `公告「${title}」已排程` : `公告「${title}」已發布`);
    }
    this.hideAnnouncementForm();
    this.renderAnnouncementManage();
    this.renderAnnouncement();
  },

  editAnnouncementItem(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (item) this.showAnnouncementForm(item);
  },

  async deleteAnnouncementItem(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const items = ApiService.getAnnouncements();
    const item = items.find(a => a.id === id);
    if (!item) return;
    if (!(await this.appConfirm(`確定要刪除公告「${item.title}」？`))) return;
    ApiService.deleteAnnouncement(id);
    ApiService._writeOpLog('ann_delete', '刪除公告', `刪除「${item.title}」`);
    this.renderAnnouncementManage();
    this.renderAnnouncement();
    this.showToast(`公告「${item.title}」已刪除`);
  },

  toggleAnnouncementStatus(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'active' ? 'expired' : 'active';
    ApiService.updateAnnouncement(id, { status: newStatus });
    ApiService._writeOpLog('ann_toggle', '公告上下架', `${newStatus === 'active' ? '上架' : '下架'}「${item.title}」`);
    this.renderAnnouncementManage();
    this.renderAnnouncement();
    this.showToast(newStatus === 'active' ? `公告「${item.title}」已上架` : `公告「${item.title}」已下架`);
  },

  moveAnnouncement(id, dir) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const items = ApiService.getAnnouncements().slice().sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    const idx = items.findIndex(a => a.id === id);
    if (idx < 0) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;

    // Swap sortOrder values
    const tempOrder = items[idx].sortOrder;
    ApiService.updateAnnouncement(items[idx].id, { sortOrder: items[swapIdx].sortOrder });
    ApiService.updateAnnouncement(items[swapIdx].id, { sortOrder: tempOrder });

    this.renderAnnouncementManage();
    this.renderAnnouncement();
  },

});
