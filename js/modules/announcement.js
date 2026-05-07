/* ================================================
   SportHub - Announcement: Marquee + Admin CRUD
   ================================================ */

Object.assign(App, {

  _annEditId: null,
  _annBusy: false,

  _annActionArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },

  _parseAnnDateTime(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === 'function') {
      const d = value.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'number') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\//g, '-').replace(' ', 'T');
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  },

  _formatAnnDisplayDate(value) {
    const d = this._parseAnnDateTime(value) || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  _formatAnnInputDate(value) {
    const d = this._parseAnnDateTime(value);
    if (!d) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  _getAnnStatusMeta(status, storedStatus) {
    if (status === 'active') {
      return { label: '上架中', className: 'active' };
    }
    if (status === 'scheduled') {
      return { label: '排程中', className: 'scheduled' };
    }
    return { label: storedStatus === 'active' ? '已到期' : '已下架', className: 'expired' };
  },

  _setAnnSaveBusy(isBusy) {
    this._annBusy = !!isBusy;
    const btn = document.getElementById('ann-save-btn');
    if (btn) {
      btn.disabled = this._annBusy;
      btn.textContent = this._annBusy ? '儲存中...' : '儲存';
    }
  },

  // Frontend marquee
  renderAnnouncement() {
    const wrap = document.getElementById('announce-marquee-wrap');
    const track = document.getElementById('announce-marquee-track');
    if (!wrap || !track) return;

    const items = ApiService.getActiveAnnouncements()
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    if (!items.length) {
      wrap.style.display = 'none';
      track.innerHTML = '';
      return;
    }

    const html = items.map(a => {
      const id = this._annActionArg(a.id);
      return `<span class="announce-marquee-item" onclick="App.showAnnDetail('${id}')">${escapeHTML(a.title || '公告')}：${escapeHTML(a.content || '')}</span>`;
    }).join('');

    track.innerHTML = `<div class="announce-marquee-inner">${html}${html}</div>`;
    wrap.style.display = '';

    const totalChars = items.reduce((sum, a) => sum + String((a.title || '') + (a.content || '')).length, 0);
    const duration = Math.max(10, totalChars * 0.35);
    track.querySelector('.announce-marquee-inner')?.style.setProperty('--marquee-duration', `${duration}s`);
  },

  showAnnDetail(id) {
    const ann = ApiService.getActiveAnnouncements().find(a => a.id === id);
    if (!ann) return;
    const overlay = document.getElementById('announce-detail-modal');
    const panel = overlay?.querySelector('.modal');
    if (!overlay || !panel) return;

    document.getElementById('ann-detail-title').textContent = ann.title || '公告';
    document.getElementById('ann-detail-body').textContent = ann.content || '';
    const footer = document.getElementById('ann-detail-footer');
    if (footer) footer.innerHTML = `<span>${escapeHTML(ann.publishAt || '')}</span>`;
    overlay.classList.add('open');
    panel.classList.add('open');
  },

  // Admin management
  renderAnnouncementManage() {
    const container = document.getElementById('announcement-manage-list');
    if (!container) return;

    const items = ApiService.getAnnouncements()
      .slice()
      .sort((a, b) => (Number(a.sortOrder) || 99) - (Number(b.sortOrder) || 99));
    const countEl = document.getElementById('ann-manage-count');
    if (countEl) countEl.textContent = `共 ${items.length}/5 則`;

    if (!items.length) {
      container.innerHTML = '<div class="announcement-empty">目前沒有公告</div>';
      return;
    }

    const now = new Date();
    container.innerHTML = items.map((a, idx) => {
      const id = this._annActionArg(a.id);
      const effectiveStatus = ApiService._getAnnouncementEffectiveStatus
        ? ApiService._getAnnouncementEffectiveStatus(a, now)
        : (a.status || 'active');
      const status = this._getAnnStatusMeta(effectiveStatus, a.status);
      const isFirst = idx === 0;
      const isLast = idx === items.length - 1;
      const canActivate = a.status !== 'active';
      return `
        <article class="announcement-card">
          <div class="announcement-order-controls" aria-label="公告排序">
            <button class="text-btn announcement-order-btn" type="button" onclick="App.moveAnnouncement('${id}','up')" ${isFirst || this._annBusy ? 'disabled' : ''} aria-label="上移">▲</button>
            <button class="text-btn announcement-order-btn" type="button" onclick="App.moveAnnouncement('${id}','down')" ${isLast || this._annBusy ? 'disabled' : ''} aria-label="下移">▼</button>
          </div>
          <div class="announcement-main">
            <div class="announcement-title-row">
              <span class="announcement-status-dot announcement-status-${status.className}" aria-hidden="true"></span>
              <span class="announcement-title">${escapeHTML(a.title || '未命名公告')}</span>
            </div>
            <div class="announcement-content">${escapeHTML(a.content || '')}</div>
            <div class="announcement-meta">
              <span>${status.label}</span>
              ${a.publishAt ? `<span>${escapeHTML(a.publishAt)}</span>` : ''}
              ${this._userTag(a.operatorName || a.createdBy)}
            </div>
          </div>
          <div class="announcement-actions">
            <button class="text-btn announcement-action-btn" type="button" onclick="App.editAnnouncementItem('${id}')" ${this._annBusy ? 'disabled' : ''}>編輯</button>
            <button class="text-btn announcement-action-btn ${canActivate ? 'announcement-action-accent' : 'announcement-action-muted'}" type="button" onclick="App.toggleAnnouncementStatus('${id}')" ${this._annBusy ? 'disabled' : ''}>${canActivate ? '上架' : '下架'}</button>
            <button class="text-btn announcement-action-btn announcement-action-danger" type="button" onclick="App.deleteAnnouncementItem('${id}')" ${this._annBusy ? 'disabled' : ''}>刪除</button>
          </div>
        </article>
      `;
    }).join('');
  },

  showAnnouncementForm(editData) {
    const overlay = document.getElementById('announcement-form-overlay');
    const panel = overlay?.querySelector('.modal');
    if (!overlay || !panel) return;

    if (!editData && ApiService.getAnnouncements().length >= 5) {
      this.showToast('公告最多 5 則，請先刪除舊公告');
      return;
    }

    this._annEditId = editData ? editData.id : null;
    const scheduledDate = this._parseAnnDateTime(editData?.publishAt);
    const isFutureScheduled = editData?.status === 'scheduled' && scheduledDate && scheduledDate > new Date();

    document.getElementById('announcement-form-title').textContent = editData ? '編輯公告' : '新增公告';
    document.getElementById('ann-input-title').value = editData?.title || '';
    document.getElementById('ann-input-content').value = editData?.content || '';
    document.getElementById('ann-content-count').textContent = `${String(editData?.content || '').length}/50`;
    document.getElementById('ann-input-publish-type').value = isFutureScheduled ? 'scheduled' : 'now';
    document.getElementById('ann-input-schedule').value = isFutureScheduled ? this._formatAnnInputDate(editData.publishAt) : '';
    document.getElementById('ann-input-unpublish').value = editData?.unpublishAt ? this._formatAnnInputDate(editData.unpublishAt) : '';
    this.toggleAnnSchedule();
    this._setAnnSaveBusy(false);

    overlay.classList.add('open');
    panel.classList.add('open');
  },

  hideAnnouncementForm() {
    const overlay = document.getElementById('announcement-form-overlay');
    const panel = overlay?.querySelector('.modal');
    if (!overlay || !panel || this._annBusy) return;
    overlay.classList.remove('open');
    panel.classList.remove('open');
    this._annEditId = null;
  },

  toggleAnnSchedule() {
    const type = document.getElementById('ann-input-publish-type')?.value;
    const row = document.getElementById('ann-schedule-row');
    if (row) row.style.display = type === 'scheduled' ? '' : 'none';
  },

  async saveAnnouncementItem() {
    if (!this.hasPermission('admin.announcements.entry')) {
      this.showToast('權限不足');
      return;
    }
    if (this._annBusy) return;

    const title = document.getElementById('ann-input-title')?.value.trim() || '';
    const content = document.getElementById('ann-input-content')?.value.trim() || '';
    const publishType = document.getElementById('ann-input-publish-type')?.value || 'now';
    const curUser = ApiService.getCurrentUser();
    const operatorName = curUser?.displayName || ROLES[this.currentRole]?.label || '管理員';

    if (!title) { this.showToast('請輸入公告標題'); return; }
    if (title.length > 12) { this.showToast('標題不能超過 12 字'); return; }
    if (!content) { this.showToast('請輸入公告內容'); return; }
    if (content.length > 50) { this.showToast('內容不能超過 50 字'); return; }
    if (!this._annEditId && ApiService.getAnnouncements().length >= 5) {
      this.showToast('公告最多 5 則，請先刪除舊公告');
      return;
    }

    const now = new Date();
    let publishAtDate = now;
    let status = 'active';
    if (publishType === 'scheduled') {
      publishAtDate = this._parseAnnDateTime(document.getElementById('ann-input-schedule')?.value);
      if (!publishAtDate) { this.showToast('請選擇有效的排程發布時間'); return; }
      if (publishAtDate <= now) { this.showToast('排程發布時間必須晚於現在'); return; }
      status = 'scheduled';
    }

    const unpublishAtDate = this._parseAnnDateTime(document.getElementById('ann-input-unpublish')?.value);
    if (document.getElementById('ann-input-unpublish')?.value && !unpublishAtDate) {
      this.showToast('請選擇有效的結束時間');
      return;
    }
    if (unpublishAtDate && unpublishAtDate <= publishAtDate) {
      this.showToast('結束時間必須晚於發布時間');
      return;
    }

    const publishAt = this._formatAnnDisplayDate(publishAtDate);
    const unpublishAt = unpublishAtDate ? this._formatAnnDisplayDate(unpublishAtDate) : null;

    try {
      this._setAnnSaveBusy(true);
      if (this._annEditId) {
        await ApiService.updateAnnouncementAwait(this._annEditId, { title, content, status, publishAt, unpublishAt, operatorName });
        ApiService._writeOpLog('ann_edit', '編輯公告', `編輯「${title}」`);
        this.showToast(`公告「${title}」已更新`);
      } else {
        const all = ApiService.getAnnouncements();
        const maxSort = all.reduce((m, a) => Math.max(m, Number(a.sortOrder) || 0), 0);
        await ApiService.createAnnouncementAwait({
          id: `ann${Date.now()}`,
          title,
          content,
          status,
          publishAt,
          unpublishAt,
          sortOrder: maxSort + 1,
          createdAt: this._formatAnnDisplayDate(now),
          createdBy: ROLES[this.currentRole]?.label || '管理員',
          operatorName
        });
        ApiService._writeOpLog('ann_create', '新增公告', `新增「${title}」`);
        this.showToast(status === 'scheduled' ? `公告「${title}」已排程` : `公告「${title}」已發布`);
      }
      this._setAnnSaveBusy(false);
      this.hideAnnouncementForm();
      this.renderAnnouncementManage();
      this.renderAnnouncement();
    } catch (err) {
      console.error('[Announcement:save]', err);
      if (!err?._toasted) this.showToast(`公告儲存失敗：${err?.message || '請稍後再試'}`);
      this._setAnnSaveBusy(false);
    }
  },

  editAnnouncementItem(id) {
    if (!this.hasPermission('admin.announcements.entry')) {
      this.showToast('權限不足');
      return;
    }
    if (this._annBusy) return;
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (item) this.showAnnouncementForm(item);
  },

  async deleteAnnouncementItem(id) {
    if (!this.hasPermission('admin.announcements.entry')) {
      this.showToast('權限不足');
      return;
    }
    if (this._annBusy) return;
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (!item) return;
    if (!(await this.appConfirm(`確定要刪除「${item.title}」嗎？`))) return;

    try {
      this._annBusy = true;
      this.renderAnnouncementManage();
      const deleted = await ApiService.deleteAnnouncementAwait(id);
      if (!deleted) throw new Error('找不到公告資料');
      ApiService._writeOpLog('ann_delete', '刪除公告', `刪除「${item.title}」`);
      this.showToast(`公告「${item.title}」已刪除`);
      this.renderAnnouncement();
    } catch (err) {
      console.error('[Announcement:delete]', err);
      if (!err?._toasted) this.showToast(`刪除失敗：${err?.message || '請稍後再試'}`);
    } finally {
      this._annBusy = false;
      this.renderAnnouncementManage();
    }
  },

  async toggleAnnouncementStatus(id) {
    if (!this.hasPermission('admin.announcements.entry')) {
      this.showToast('權限不足');
      return;
    }
    if (this._annBusy) return;
    const item = ApiService.getAnnouncements().find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'active' ? 'expired' : 'active';

    try {
      this._annBusy = true;
      this.renderAnnouncementManage();
      await ApiService.updateAnnouncementAwait(id, {
        status: newStatus,
        operatorName: ApiService.getCurrentUser()?.displayName || ROLES[this.currentRole]?.label || '管理員'
      });
      ApiService._writeOpLog('ann_toggle', '公告上下架', `${newStatus === 'active' ? '上架' : '下架'}「${item.title}」`);
      this.showToast(newStatus === 'active' ? `公告「${item.title}」已上架` : `公告「${item.title}」已下架`);
      this.renderAnnouncement();
    } catch (err) {
      console.error('[Announcement:toggle]', err);
      if (!err?._toasted) this.showToast(`更新失敗：${err?.message || '請稍後再試'}`);
    } finally {
      this._annBusy = false;
      this.renderAnnouncementManage();
    }
  },

  async moveAnnouncement(id, dir) {
    if (!this.hasPermission('admin.announcements.entry')) {
      this.showToast('權限不足');
      return;
    }
    if (this._annBusy) return;
    const items = ApiService.getAnnouncements()
      .slice()
      .sort((a, b) => (Number(a.sortOrder) || 99) - (Number(b.sortOrder) || 99));
    const idx = items.findIndex(a => a.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return;

    const currentOrder = Number(items[idx].sortOrder) || (idx + 1);
    const swapOrder = Number(items[swapIdx].sortOrder) || (swapIdx + 1);
    try {
      this._annBusy = true;
      this.renderAnnouncementManage();
      await ApiService.updateAnnouncementAwait(items[idx].id, { sortOrder: swapOrder });
      await ApiService.updateAnnouncementAwait(items[swapIdx].id, { sortOrder: currentOrder });
      this.renderAnnouncement();
    } catch (err) {
      console.error('[Announcement:move]', err);
      if (!err?._toasted) this.showToast(`排序失敗：${err?.message || '請稍後再試'}`);
    } finally {
      this._annBusy = false;
      this.renderAnnouncementManage();
    }
  },

});
