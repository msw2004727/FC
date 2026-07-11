/* ================================================
   SportHub — Profile Data: Applications & Companions
   依賴：profile-core.js, profile-data-render.js
   ================================================ */
Object.assign(App, {

  _profileHostedActivityPageSize: 10,
  _profileHostedActivityVisibleLimit: 10,

  _getTeamApplicationTimeMs(msg) {
    const parseValue = (value) => {
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') {
        return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
      }
      if (typeof value === 'number') return value;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const direct = parseValue(msg?.timestamp) || parseValue(msg?.createdAt);
    if (direct) return direct;

    const timeStr = String(msg?.time || '').trim();
    if (timeStr) {
      const [datePart, timePart = '0:0'] = timeStr.split(' ');
      const [y, mo, d] = datePart.split('/').map(Number);
      const [h, mi] = timePart.split(':').map(Number);
      const parsed = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }

    return parseValue(msg?.rejectedAt);
  },

  _getMyLatestTeamApplications() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || null;
    if (!uid) return [];
    const currentTeamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(user)
      : (() => {
        const ids = [];
        const seen = new Set();
        const pushId = (id) => {
          const value = String(id || '').trim();
          if (!value || seen.has(value)) return;
          seen.add(value);
          ids.push(value);
        };
        if (Array.isArray(user?.teamIds)) user.teamIds.forEach(pushId);
        pushId(user?.teamId);
        return ids;
      })();
    const liveTeams = ApiService.getTeams() || [];
    const liveTeamIds = new Set(liveTeams.map(team => String(team?.id || '').trim()).filter(Boolean));
    const liveTeamNames = new Set(liveTeams.map(team => String(team?.name || '').trim()).filter(Boolean));

    const allMsgs = ApiService.getMessages() || [];
    const statusWeight = {
      approved: 3,
      rejected: 3,
      ignored: 3,
      pending: 2,
    };

    const groupMap = new Map();
    allMsgs.forEach(msg => {
      if (msg.actionType !== 'team_join_request' || !msg.meta || msg.meta.applicantUid !== uid) return;

      const groupKey = String(msg.meta.groupId || msg.id || '').trim();
      const prev = groupMap.get(groupKey);
      if (!prev) {
        groupMap.set(groupKey, msg);
        return;
      }

      const prevWeight = statusWeight[prev.actionStatus] || 0;
      const nextWeight = statusWeight[msg.actionStatus] || 0;
      const prevTime = this._getTeamApplicationTimeMs(prev);
      const nextTime = this._getTeamApplicationTimeMs(msg);
      if (nextWeight > prevWeight || (nextWeight === prevWeight && nextTime > prevTime)) {
        groupMap.set(groupKey, msg);
      }
    });

    const teamMap = new Map();
    Array.from(groupMap.values()).forEach(msg => {
      const teamKey = String(msg.meta?.teamId || msg.meta?.teamName || msg.id || '').trim();
      const prev = teamMap.get(teamKey);
      if (!prev) {
        teamMap.set(teamKey, msg);
        return;
      }

      const prevTime = this._getTeamApplicationTimeMs(prev);
      const nextTime = this._getTeamApplicationTimeMs(msg);
      const prevWeight = statusWeight[prev.actionStatus] || 0;
      const nextWeight = statusWeight[msg.actionStatus] || 0;
      if (nextTime > prevTime || (nextTime === prevTime && nextWeight > prevWeight)) {
        teamMap.set(teamKey, msg);
      }
    });

    return Array.from(teamMap.values()).filter(msg => {
      const teamId = String(msg.meta?.teamId || '').trim();
      const teamName = String(msg.meta?.teamName || '').trim();
      const teamExists = teamId ? liveTeamIds.has(teamId) : !!teamName && liveTeamNames.has(teamName);
      if (!teamExists) return false;
      // 已入隊 → 不再顯示該俱樂部的申請紀錄（無論 message 狀態為何）
      if (teamId && currentTeamIds.includes(teamId)) return false;
      // name-only 舊 message（無 teamId）：透過俱樂部名稱反查 ID 比對 membership
      if (!teamId && teamName) {
        const matchedTeam = liveTeams.find(t => String(t.name || '').trim() === teamName);
        if (matchedTeam && currentTeamIds.includes(String(matchedTeam.id || '').trim())) return false;
      }
      return true;
    }).sort((a, b) => {
      const diff = this._getTeamApplicationTimeMs(b) - this._getTeamApplicationTimeMs(a);
      if (diff !== 0) return diff;
      return String(a.meta?.teamName || '').localeCompare(String(b.meta?.teamName || ''));
    });
  },

  _renderMyApplications() {
    const card = document.getElementById('profile-applications-card');
    const list = document.getElementById('profile-applications-list');
    if (!card || !list) return;
    const latestByTeam = this._getMyLatestTeamApplications();
    if (!latestByTeam.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = latestByTeam.length;
    const statusMap = {
      pending:  { label: '審核中', color: 'var(--warning)' },
      approved: { label: '已通過', color: 'var(--success)' },
      rejected: { label: '已拒絕', color: 'var(--danger)' },
      ignored:  { label: '已逾期', color: 'var(--text-muted)' },
    };
    list.innerHTML = latestByTeam.map(m => {
      const s = statusMap[m.actionStatus] || statusMap.pending;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.82rem">${escapeHTML(m.meta.teamName || '-')}</span>
        <span style="font-size:.72rem;font-weight:600;color:${s.color}">${s.label}</span>
      </div>`;
    }).join('');
  },

  renderProfileRelatedActivities() {
    const registeredItems = this._getProfileRegisteredActivityItems();
    const hostedItems = this._getProfileHostedActivityItems();
    this._renderProfileRelatedActivitySection('registered', registeredItems);
    this._renderProfileRelatedActivitySection('hosted', hostedItems);
  },

  _getProfileActivityUserContext() {
    const user = ApiService.getCurrentUser?.() || null;
    const uidSet = new Set();
    const nameSet = new Set();
    const addUid = (value) => {
      const uid = String(value || '').trim();
      if (uid && uid !== 'unknown') uidSet.add(uid);
    };
    const addName = (value) => {
      const name = String(value || '').trim();
      if (name) nameSet.add(name.toLowerCase());
    };
    addUid(user?.uid);
    addUid(user?.lineUserId);
    addUid(user?._docId);
    addUid(user?.userId);
    addName(user?.displayName);
    addName(user?.name);
    return {
      user,
      uidSet,
      uidList: Array.from(uidSet),
      nameSet,
    };
  },

  _getProfileRegisteredActivityItems() {
    const ctx = this._getProfileActivityUserContext();
    if (!ctx.uidList.length) return [];
    const activeStatuses = new Set(['confirmed', 'registered', 'waitlisted']);
    const statusRank = { confirmed: 3, registered: 2, waitlisted: 1 };
    const byEventId = new Map();

    ctx.uidList.forEach(uid => {
      const records = ApiService.getRegistrationsByUser?.(uid) || [];
      records.forEach(reg => {
        if (!reg) return;
        const recordUid = String(reg.userId || reg.uid || reg.ownerUid || '').trim();
        if (recordUid && !ctx.uidSet.has(recordUid)) return;
        const participantType = String(reg.participantType || '').trim();
        if (participantType === 'companion' || String(reg.companionId || '').trim()) return;
        const status = String(reg.status || '').trim();
        if (!activeStatuses.has(status)) return;
        const eventId = String(reg.eventId || reg.activityId || '').trim();
        if (!eventId) return;

        const eventRecord = ApiService.getEvent?.(eventId);
        if (!eventRecord) return;
        const effectiveStatus = this._getProfileActivityEffectiveStatus(eventRecord);
        if (effectiveStatus === 'cancelled' || effectiveStatus === 'ended') return;

        const previous = byEventId.get(eventId);
        if (!previous || (statusRank[status] || 0) > (statusRank[previous.registrationStatus] || 0)) {
          byEventId.set(eventId, {
            event: eventRecord,
            registration: reg,
            registrationStatus: status,
          });
        }
      });
    });

    return Array.from(byEventId.values()).sort((a, b) => {
      const diff = this._profileActivityDateMs(a.event) - this._profileActivityDateMs(b.event);
      if (diff !== 0) return diff;
      return String(a.event?.title || '').localeCompare(String(b.event?.title || ''));
    });
  },

  _getProfileHostedActivityItems() {
    const ctx = this._getProfileActivityUserContext();
    if (!ctx.uidList.length) return [];
    const nowMs = Date.now();
    const items = (ApiService.getEvents?.() || [])
      .filter(eventRecord => this._isProfileHostedActivity(eventRecord, ctx))
      .filter(eventRecord => this._getProfileActivityEffectiveStatus(eventRecord) === 'open')
      .map(eventRecord => ({ event: eventRecord }));

    return items.sort((a, b) => {
      const aMs = this._profileActivityDateMs(a.event);
      const bMs = this._profileActivityDateMs(b.event);
      const aFuture = aMs >= nowMs;
      const bFuture = bMs >= nowMs;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      const diff = aFuture ? aMs - bMs : bMs - aMs;
      if (diff !== 0) return diff;
      return String(a.event?.title || '').localeCompare(String(b.event?.title || ''));
    });
  },

  _isProfileHostedActivity(eventRecord, ctx = this._getProfileActivityUserContext()) {
    if (!eventRecord || !ctx?.uidSet?.size) return false;
    if (typeof this._isEventOwner === 'function' && this._isEventOwner(eventRecord)) return true;
    const ownerUidFields = [
      eventRecord.creatorUid,
      eventRecord.ownerUid,
      eventRecord.createdByUid,
      eventRecord.organizerUid,
      eventRecord.captainUid,
    ].map(uid => String(uid || '').trim()).filter(Boolean);
    if (ownerUidFields.length > 0) return ownerUidFields.some(uid => ctx.uidSet.has(uid));
    const ownerNameFields = [
      eventRecord.creator,
      eventRecord.creatorName,
      eventRecord.ownerName,
      eventRecord.organizer,
      eventRecord.hostName,
    ];
    return ownerNameFields.some(name => ctx.nameSet.has(String(name || '').trim().toLowerCase()));
  },

  _getProfileActivityEffectiveStatus(eventRecord) {
    if (!eventRecord) return 'open';
    if (typeof this._getEventEffectiveStatus === 'function') {
      return this._getEventEffectiveStatus(eventRecord);
    }
    return eventRecord.status || 'open';
  },

  _profileActivityDateMs(eventRecord) {
    const parsed = typeof this._parseEventStartDate === 'function'
      ? this._parseEventStartDate(eventRecord?.date || '')
      : null;
    if (parsed instanceof Date && Number.isFinite(parsed.getTime())) return parsed.getTime();
    const fallback = Date.parse(String(eventRecord?.date || '').replace(/\//g, '-'));
    return Number.isFinite(fallback) ? fallback : Number.MAX_SAFE_INTEGER;
  },

  _renderProfileRelatedActivitySection(kind, items) {
    const isHosted = kind === 'hosted';
    const list = document.getElementById(isHosted ? 'profile-hosted-activities-list' : 'profile-registered-activities-list');
    const count = document.getElementById(isHosted ? 'profile-hosted-activities-count' : 'profile-registered-activities-count');
    if (!list) return;
    if (count) count.textContent = String(items.length);
    if (!items.length) {
      list.innerHTML = `<div class="profile-related-empty">${isHosted ? '目前沒有報名中的主辦活動' : '目前沒有正取或候補中的報名活動'}</div>`;
      return;
    }
    const pageSize = Math.max(1, Number(this._profileHostedActivityPageSize) || 10);
    const hostedLimit = Math.max(pageSize, Number(this._profileHostedActivityVisibleLimit) || pageSize);
    const visibleItems = isHosted ? items.slice(0, hostedLimit) : items;
    list.innerHTML = visibleItems.map(item => this._renderProfileRelatedActivityCard(item, kind)).join('');
    if (isHosted && visibleItems.length < items.length) {
      list.insertAdjacentHTML('beforeend', this._renderProfileHostedActivityLoadMore(visibleItems.length, items.length));
    }
  },

  _renderProfileHostedActivityLoadMore(visibleCount, totalCount) {
    return `<div class="profile-related-load-more">
      <div class="profile-related-load-more-note">已顯示 ${visibleCount} / ${totalCount}</div>
      <button type="button" class="outline-btn profile-related-load-more-btn" onclick="App.loadMoreProfileHostedActivities()">查看更多</button>
    </div>`;
  },

  loadMoreProfileHostedActivities() {
    const pageSize = Math.max(1, Number(this._profileHostedActivityPageSize) || 10);
    const currentLimit = Math.max(pageSize, Number(this._profileHostedActivityVisibleLimit) || pageSize);
    this._profileHostedActivityVisibleLimit = currentLimit + pageSize;
    this.renderProfileRelatedActivities?.();
  },

  _renderProfileRelatedActivityCard(item, kind) {
    const e = item?.event || {};
    const safeId = escapeHTML(e.id || '');
    const typeMap = typeof TYPE_CONFIG !== 'undefined' ? TYPE_CONFIG : {};
    const statusMap = typeof STATUS_CONFIG !== 'undefined' ? STATUS_CONFIG : {};
    const typeKey = this._getEventDisplayTypeKey?.(e) || (typeMap[e.type] ? e.type : 'friendly');
    const typeConf = this._getEventDisplayTypeConfig?.(e) || typeMap[typeKey] || typeMap.friendly || { label: '活動' };
    const effectiveStatus = this._getProfileActivityEffectiveStatus(e);
    const statusConf = statusMap[effectiveStatus] || statusMap[e.status] || statusMap.open || { label: '開放', css: 'open' };
    const isEnded = effectiveStatus === 'ended' || effectiveStatus === 'cancelled';
    const eventImage = this._getEventImageUrl?.(e, 'cover') || e.image || '';
    const title = escapeHTML(e.title || '活動');
    const dateParts = String(e.date || '').split(' ');
    const dateText = dateParts[0] || '';
    const timeText = (dateParts[1] || '').trim();
    const locationText = String(e.location || '');
    const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : '';
    const rowBaseClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${typeKey}`;
    const metaParts = [typeConf.label, timeText, locationText].filter(Boolean);
    const registrationStamp = kind === 'registered' ? this._renderProfileRegistrationStamp(item.registrationStatus) : '';
    const actionsHtml = this._renderProfileRelatedActivityActions(item, kind, effectiveStatus);

    return `
      <div class="tl-event-row profile-related-event-card ${rowBaseClass}${isEnded ? ' tl-past' : ''}" data-event-id="${safeId}" onclick="App.openProfileRelatedActivity(this.dataset.eventId)">
        ${eventImage ? `<div class="tl-event-thumb profile-related-thumb"><img src="${escapeHTML(eventImage)}" alt="${title}" width="42" height="42" loading="lazy" decoding="async">${registrationStamp}</div>` : ''}
        <div class="tl-event-info">
          <div class="tl-event-title-row"><div class="tl-event-title">${title}${teamBadge}</div></div>
          <div class="tl-event-meta">${dateText ? `${escapeHTML(dateText)} ・ ` : ''}${metaParts.map(escapeHTML).join(' ・ ')}</div>
        </div>
        <div class="profile-related-card-right">
          <span class="tl-event-status ${statusConf.css || 'open'}">${escapeHTML(statusConf.label || '開放')}</span>
          <div class="profile-related-event-actions">${actionsHtml}</div>
          <span class="tl-event-arrow">›</span>
        </div>
      </div>`;
  },

  _renderProfileRegistrationStamp(status) {
    const isWaitlist = status === 'waitlisted';
    return `<span class="profile-related-registration-stamp ${isWaitlist ? 'waitlisted' : 'confirmed'}">${isWaitlist ? '候補' : '正取'}</span>`;
  },

  _profileRelatedActionIcon(type) {
    const icons = {
      cancelRegistration: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/><path d="M9 12h11"/><path d="M4 5v14"/></svg>',
      edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
      cancelEvent: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 8l8 8"/><path d="M16 8l-8 8"/></svg>',
    };
    return icons[type] || '';
  },

  _renderProfileRelatedActivityActions(item, kind, effectiveStatus) {
    const eventRecord = item?.event || {};
    const safeId = escapeHTML(eventRecord.id || '');
    if (!safeId) return '';
    if (kind === 'registered') {
      const label = item.registrationStatus === 'waitlisted' ? '取消候補' : '取消報名';
      return `<button type="button" class="profile-related-icon-btn danger" data-event-id="${safeId}" onclick="event.stopPropagation();App.cancelProfileRegisteredActivity(this.dataset.eventId)" aria-label="${label}" title="${label}">${this._profileRelatedActionIcon('cancelRegistration')}</button>`;
    }

    const isTerminal = effectiveStatus === 'cancelled' || effectiveStatus === 'ended';
    const cancelBtn = isTerminal ? '' : `<button type="button" class="profile-related-icon-btn danger" data-event-id="${safeId}" onclick="event.stopPropagation();App.cancelProfileHostedActivity(this.dataset.eventId)" aria-label="取消活動" title="取消活動">${this._profileRelatedActionIcon('cancelEvent')}</button>`;
    return `<button type="button" class="profile-related-icon-btn" data-event-id="${safeId}" onclick="event.stopPropagation();App.editProfileHostedActivity(this.dataset.eventId)" aria-label="編輯活動" title="編輯活動">${this._profileRelatedActionIcon('edit')}</button>${cancelBtn}`;
  },

  async _ensureProfileActivityModulesReady() {
    if (typeof ScriptLoader !== 'undefined' && ScriptLoader?.loadGroup && ScriptLoader?._groups?.activity) {
      await ScriptLoader.loadGroup(ScriptLoader._groups.activity);
    }
  },

  async openProfileRelatedActivity(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    await this._ensureProfileActivityModulesReady();
    return this.showEventDetail?.(id);
  },

  async cancelProfileRegisteredActivity(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    await this._ensureProfileActivityModulesReady();
    try {
      await this.handleCancelSignup?.(id);
    } finally {
      this.renderProfileRelatedActivities?.();
    }
  },

  async editProfileHostedActivity(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    await this._ensureProfileActivityModulesReady();
    return this.editMyActivity?.(id);
  },

  async cancelProfileHostedActivity(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    await this._ensureProfileActivityModulesReady();
    try {
      await this.cancelMyActivity?.(id);
    } finally {
      this.renderProfileRelatedActivities?.();
    }
  },

  // ── 同行者管理 ──

  renderCompanions() {
    const companions = ApiService.getCompanions();
    const countEl = document.getElementById('companions-count');
    if (countEl) countEl.textContent = companions.length;
    const list = document.getElementById('companions-inner-list');
    if (!list) return;
    if (!companions.length) {
      list.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無同行者</div>';
      return;
    }
    const genderIcon = { '男': '♂', '女': '♀' };
    const circledNums = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    list.innerHTML = companions.map((c, idx) => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <span style="font-size:.85rem;font-weight:600"><span style="color:var(--text-muted);margin-right:.2rem">${circledNums[idx] || (idx + 1)}</span>${escapeHTML(c.name)}</span>
          ${c.gender ? `<span style="font-size:.72rem;color:var(--text-muted);margin-left:.3rem">${genderIcon[c.gender] || ''}${escapeHTML(c.gender)}</span>` : ''}
          ${c.notes ? `<div style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(c.notes)}</div>` : ''}
        </div>
        <button class="outline-btn" style="font-size:.7rem;padding:.15rem .45rem" onclick="App.openCompanionModal('${escapeHTML(c.id)}')">編輯</button>
        <button class="outline-btn" style="font-size:.7rem;padding:.15rem .45rem;color:var(--danger);border-color:var(--danger)" onclick="App.deleteCompanion('${escapeHTML(c.id)}')">刪除</button>
      </div>
    `).join('') +
    (companions.length > 0 ? '<div style="font-size:.7rem;color:var(--text-muted);margin-top:.3rem">※ 序號為幫夥伴報名時的候補遞補順序</div>' : '');
  },

  toggleCompanionsSection(labelEl) {
    this.toggleProfileSection(labelEl, 'companions');
  },

  openCompanionModal(companionId) {
    const overlay = document.getElementById('companion-modal-overlay');
    const titleEl = document.getElementById('companion-modal-title');
    const idInput = document.getElementById('companion-modal-id');
    const nameInput = document.getElementById('companion-modal-name');
    const genderSelect = document.getElementById('companion-modal-gender');
    const notesInput = document.getElementById('companion-modal-notes');
    if (!overlay) return;
    if (companionId) {
      const comp = ApiService.getCompanions().find(c => c.id === companionId);
      if (!comp) return;
      if (titleEl) titleEl.textContent = '編輯同行者';
      if (idInput) idInput.value = comp.id;
      if (nameInput) nameInput.value = comp.name || '';
      if (genderSelect) genderSelect.value = comp.gender || '';
      if (notesInput) notesInput.value = comp.notes || '';
    } else {
      if (titleEl) titleEl.textContent = '新增同行者';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (genderSelect) genderSelect.value = '';
      if (notesInput) notesInput.value = '';
    }
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  closeCompanionModal() {
    const overlay = document.getElementById('companion-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
  },

  saveCompanion() {
    const id = document.getElementById('companion-modal-id')?.value || '';
    const name = (document.getElementById('companion-modal-name')?.value || '').trim();
    const gender = document.getElementById('companion-modal-gender')?.value || '';
    const notes = (document.getElementById('companion-modal-notes')?.value || '').trim();
    if (!name) { this.showToast('請填寫姓名'); return; }
    if (id) {
      ApiService.updateCompanion(id, { name, gender, notes });
      this.showToast('同行者已更新');
    } else {
      const newId = 'comp_' + Date.now();
      ApiService.addCompanion({ id: newId, name, gender, notes });
      this.showToast('同行者已新增');
    }
    this.closeCompanionModal();
    this.renderCompanions();
  },

  async deleteCompanion(companionId) {
    if (!await this.appConfirm('確定要刪除此同行者？')) return;
    ApiService.deleteCompanion(companionId);
    this.renderCompanions();
    this.showToast('同行者已刪除');
  },

});
