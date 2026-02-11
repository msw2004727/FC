/* ================================================
   SportHub — Event: Create & Edit
   依賴：event-render.js (helpers)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Create Event
  // ══════════════════════════════════

  _editEventId: null,

  openCreateEventModal() {
    this._editEventId = null;
    this._delegates = [];
    this.showModal('create-event-modal');
    this._initDelegateSearch();
  },

  // ── 委託人搜尋 ──
  _delegates: [],
  _delegateSearchBound: false,

  _initDelegateSearch() {
    const input = document.getElementById('ce-delegate-search');
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!input || !dropdown) return;

    if (!this._delegateSearchBound) {
      this._delegateSearchBound = true;

      input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
        this._searchDelegates(q);
      });

      input.addEventListener('blur', () => {
        setTimeout(() => { dropdown.classList.remove('open'); }, 200);
      });

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 1) this._searchDelegates(q);
      });
    }

    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _searchDelegates(query) {
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!dropdown) return;
    const q = query.toLowerCase();
    const myUid = this._getEventCreatorUid();
    const selectedUids = this._delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (u.uid === myUid) return false;
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        return `<div class="ce-delegate-item" data-uid="${u.uid}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${u.uid} · ${roleLabel}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this._addDelegate(item.dataset.uid, item.dataset.name);
          document.getElementById('ce-delegate-search').value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
  },

  _addDelegate(uid, name) {
    if (this._delegates.length >= 3) return;
    if (this._delegates.some(d => d.uid === uid)) return;
    this._delegates.push({ uid, name });
    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _removeDelegate(uid) {
    this._delegates = this._delegates.filter(d => d.uid !== uid);
    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _renderDelegateTags() {
    const container = document.getElementById('ce-delegate-tags');
    if (!container) return;
    const users = ApiService.getAdminUsers?.() || [];
    container.innerHTML = this._delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}<span class="ce-delegate-remove" onclick="App._removeDelegate('${d.uid}')">✕</span></span>`;
    }).join('');
  },

  _updateDelegateInput() {
    const input = document.getElementById('ce-delegate-search');
    if (!input) return;
    input.disabled = this._delegates.length >= 3;
    input.placeholder = this._delegates.length >= 3 ? '已達上限 3 人' : '搜尋 UID 或暱稱...';
  },

  /** 球隊限定開關 label 更新 */
  _updateTeamOnlyLabel() {
    const cb = document.getElementById('ce-team-only');
    const label = document.getElementById('ce-team-only-label');
    const select = document.getElementById('ce-team-select');
    if (!cb || !label) return;
    if (cb.checked) {
      const team = this._getEventCreatorTeam();
      if (team.teamId) {
        // 用戶有球隊，直接顯示
        label.textContent = `開啟 — 僅 ${team.teamName || '您的球隊'} 可見`;
        label.style.color = '#e11d48';
        if (select) select.style.display = 'none';
      } else {
        // 用戶無球隊，顯示下拉選擇
        label.textContent = '開啟 — 選擇球隊：';
        label.style.color = '#e11d48';
        if (select) {
          const teams = ApiService.getTeams?.() || [];
          const activeTeams = teams.filter(t => t.active !== false);
          select.innerHTML = '<option value="">請選擇球隊</option>' +
            activeTeams.map(t => `<option value="${t.id}" data-name="${t.name}">${t.name}</option>`).join('');
          select.style.display = '';
        }
      }
    } else {
      label.textContent = '關閉 — 所有人可見';
      label.style.color = 'var(--text-muted)';
      if (select) select.style.display = 'none';
    }
  },

  /** 綁定球隊限定開關事件 */
  bindTeamOnlyToggle() {
    const cb = document.getElementById('ce-team-only');
    if (cb) cb.addEventListener('change', () => this._updateTeamOnlyLabel());
  },

  handleCreateEvent() {
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const ceTimeStart = document.getElementById('ce-time-start');
    const ceTimeEnd = document.getElementById('ce-time-end');
    const timeVal = (ceTimeStart && ceTimeEnd) ? `${ceTimeStart.value}~${ceTimeEnd.value}` : '';
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const waitlistMax = parseInt(document.getElementById('ce-waitlist').value) || 0;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();
    const teamOnly = !!document.getElementById('ce-team-only')?.checked;

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 12) { this.showToast('活動名稱不可超過 12 字'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }
    // 新增模式：不允許選擇過去的日期
    if (!this._editEventId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const selected = new Date(dateVal + 'T00:00:00');
      if (selected < today) { this.showToast('活動日期不可早於今天'); return; }
    }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }
    // 球隊限定：決定 teamId / teamName
    let resolvedTeamId = null, resolvedTeamName = null;
    if (teamOnly) {
      const team = this._getEventCreatorTeam();
      if (team.teamId) {
        resolvedTeamId = team.teamId;
        resolvedTeamName = team.teamName;
      } else {
        // 從下拉選單取
        const select = document.getElementById('ce-team-select');
        const selVal = select?.value;
        if (!selVal) { this.showToast('請選擇限定球隊'); return; }
        resolvedTeamId = selVal;
        resolvedTeamName = select.options[select.selectedIndex]?.dataset?.name || selVal;
      }
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const dateParts = dateVal.split('-');
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;

    if (this._editEventId) {
      const updates = {
        title, type, location, date: fullDate, fee, max, waitlistMax, minAge, notes, image,
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        teamOnly,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        delegates: [...this._delegates],
      };
      ApiService.updateEvent(this._editEventId, updates);
      this.closeModal();
      this._editEventId = null;
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已更新！`);
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();
      const newEvent = {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title, type, status: 'open', location, date: fullDate,
        fee, max, current: 0, waitlist: 0, waitlistMax, minAge, notes, image,
        creator: creatorName,
        creatorUid,
        contact: '',
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        icon: '',
        countdown: '即將開始',
        participants: [],
        waitlistNames: [],
        teamOnly,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        delegates: [...this._delegates],
      };
      ApiService.createEvent(newEvent);
      this.closeModal();
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已建立！`);
    }

    // 重置表單
    this._editEventId = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '5';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-image').value = '';
    if (ceTimeStart) ceTimeStart.value = '14:00';
    if (ceTimeEnd) ceTimeEnd.value = '16:00';
    this._delegates = [];
    this._renderDelegateTags();
    this._updateDelegateInput();
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

});
