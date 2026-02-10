/* ================================================
   SportHub — Announcement CRUD (Admin)
   ================================================ */

Object.assign(App, {

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

});
