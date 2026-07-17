/* ================================================
   SportHub — Team: Form Search UI (Leader/Captain/Coach)
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   ================================================ */

Object.assign(App, {

  _rememberTeamFormStaffName(uid, name) {
    const key = String(uid || '').trim();
    const value = String(name || '').trim();
    if (!key || !value) return;
    if (!this._teamFormState.staffNameHints || typeof this._teamFormState.staffNameHints !== 'object') {
      this._teamFormState.staffNameHints = {};
    }
    this._teamFormState.staffNameHints[key] = value;
  },

  _beginTeamFormStaffVerification(role) {
    const roleKey = String(role || '').trim();
    const verifySeqs = this._teamFormStaffVerifySeqs
      || (this._teamFormStaffVerifySeqs = {});
    const verifySeq = Number(verifySeqs[roleKey] || 0) + 1;
    verifySeqs[roleKey] = verifySeq;
    return {
      role: roleKey,
      verifySeq,
      requestSeq: Number(this._teamFormRequestSeq || 0),
      editId: String(this._teamFormState?.editId || ''),
      currentUid: String(ApiService.getCurrentUser?.()?.uid || ''),
      modal: document.getElementById('create-team-modal') || null,
    };
  },

  _isTeamFormStaffVerificationCurrent(context) {
    if (!context) return false;
    const verifySeqs = this._teamFormStaffVerifySeqs || {};
    if (Number(verifySeqs[context.role] || 0) !== Number(context.verifySeq)) return false;
    if (Number(this._teamFormRequestSeq || 0) !== Number(context.requestSeq)) return false;
    if (String(this._teamFormState?.editId || '') !== String(context.editId || '')) return false;
    if (String(ApiService.getCurrentUser?.()?.uid || '') !== String(context.currentUid || '')) return false;
    if (context.modal) {
      const currentModal = document.getElementById('create-team-modal');
      if (currentModal !== context.modal || !currentModal.classList?.contains?.('open')) return false;
    }
    return true;
  },

  async _verifyTeamFormStaffSelection(uid, role) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return { ok: false, reason: 'missing-uid' };
    const context = this._beginTeamFormStaffVerification(role);
    if (!this._isTeamFormStaffVerificationCurrent(context)) {
      return { ok: false, reason: 'stale' };
    }

    let result = null;
    let failureReason = '';
    try {
      if (typeof ApiService.verifyUserDirectorySelection !== 'function') {
        throw new Error('USER_DIRECTORY_VERIFICATION_UNAVAILABLE');
      }
      result = await ApiService.verifyUserDirectorySelection([safeUid]);
    } catch (err) {
      failureReason = err?.message || 'unavailable';
    }

    if (!this._isTeamFormStaffVerificationCurrent(context)) {
      return { ok: false, reason: 'stale' };
    }
    const verifiedUsers = Array.isArray(result?.users) ? result.users : [];
    const verifiedUser = verifiedUsers.find(user => user && (
      String(user.uid || '').trim() === safeUid
      || String(user._docId || '').trim() === safeUid
    )) || null;
    const missingUids = Array.isArray(result?.missingUids)
      ? result.missingUids.map(value => String(value || '').trim())
      : [];
    if (failureReason || !result?.ok || missingUids.includes(safeUid) || !verifiedUser) {
      this.showToast?.('\u7121\u6cd5\u78ba\u8a8d\u6b64\u4f7f\u7528\u8005\uff0c\u8acb\u91cd\u65b0\u641c\u5c0b\u5f8c\u518d\u8a66');
      return { ok: false, reason: failureReason || result?.reason || 'missing-user' };
    }
    return { ok: true, reason: 'ok', uid: safeUid, user: verifiedUser };
  },

  _getTeamFormStaffDisplayName(uid) {
    const key = String(uid || '').trim();
    if (!key) return '';
    const users = ApiService.getUserDirectory?.() || [];
    const user = users.find(item => item && (
      String(item.uid || '').trim() === key
      || String(item._docId || '').trim() === key
    ));
    return String(user?.name || user?.displayName || this._teamFormState.staffNameHints?.[key] || '').trim();
  },

  _ensureTeamFormUnresolvedStaffNames() {
    const current = this._teamFormState.unresolvedStaffNames;
    if (!current || typeof current !== 'object') {
      this._teamFormState.unresolvedStaffNames = { leaders: [], captain: '', coaches: [] };
    }
    if (!Array.isArray(this._teamFormState.unresolvedStaffNames.leaders)) {
      this._teamFormState.unresolvedStaffNames.leaders = [];
    }
    if (!Array.isArray(this._teamFormState.unresolvedStaffNames.coaches)) {
      this._teamFormState.unresolvedStaffNames.coaches = [];
    }
    this._teamFormState.unresolvedStaffNames.captain = String(
      this._teamFormState.unresolvedStaffNames.captain || ''
    ).trim();
    return this._teamFormState.unresolvedStaffNames;
  },

  _removeUnresolvedTeamStaffName(role, index) {
    if (!['leaders', 'coaches'].includes(role)) return;
    const state = this._ensureTeamFormUnresolvedStaffNames();
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= state[role].length) return;
    state[role].splice(safeIndex, 1);
    if (role === 'leaders') this._renderLeaderTags();
    else this._renderCoachTags();
  },
  _teamSearchUsers(query, excludeUids) {
    const users = ApiService.getUserDirectory?.() || [];
    const q = query.toLowerCase();
    return users.filter(u =>
      !excludeUids.includes(u.uid) &&
      ((u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q))
    ).slice(0, 5);
  },

  _renderSuggestList(containerId, results, onSelectFn) {
    const el = document.getElementById(containerId);
    if (!results.length) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.innerHTML = results.map(u => {
      const uidLabel = this._formatUidForDisplay ? this._formatUidForDisplay(u.uid) : u.uid;
      return `<div class="team-user-suggest-item" data-team-user-uid="${escapeHTML(String(u.uid || ''))}">
        <span class="tus-name">${escapeHTML(u.name)}</span>
        ${uidLabel ? `<span class="tus-uid">${escapeHTML(uidLabel)}</span>` : ''}
      </div>`;
    }).join('');
    el.querySelectorAll('[data-team-user-uid]').forEach(item => {
      item.addEventListener('click', () => {
        const selectHandler = this[onSelectFn];
        if (typeof selectHandler === 'function') void selectHandler.call(this, item.dataset.teamUserUid);
      });
    });
    el.classList.add('show');
  },

  searchTeamLeader() {
    const q = document.getElementById('ct-leader-search').value.trim();
    if (!q) { document.getElementById('ct-leader-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamFormState.leaders];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-leader-suggest', results, 'selectTeamLeader');
  },

  async selectTeamLeader(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid || this._teamFormState.leaders.includes(safeUid)) {
      return { ok: false, reason: safeUid ? 'duplicate' : 'missing-uid' };
    }
    const verification = await this._verifyTeamFormStaffSelection(safeUid, 'leaders');
    if (!verification.ok) return verification;
    if (this._teamFormState.leaders.includes(safeUid)) return { ok: false, reason: 'duplicate' };
    this._teamFormState.leaders.push(safeUid);
    this._rememberTeamFormStaffName(safeUid, verification.user?.name || verification.user?.displayName);
    document.getElementById('ct-leader-search').value = '';
    document.getElementById('ct-leader-suggest').innerHTML = '';
    document.getElementById('ct-leader-suggest').classList.remove('show');
    this._renderLeaderTags();
    return { ok: true, reason: 'ok' };
  },

  _removeLeader(uid) {
    this._teamFormState.leaders = this._teamFormState.leaders.filter(u => u !== uid);
    this._renderLeaderTags();
  },

  _renderLeaderTags() {
    const users = ApiService.getUserDirectory?.() || [];
    const resolvedHtml = this._teamFormState.leaders.map(uid => {
      const u = users.find(user => user.uid === uid || user._docId === uid);
      const name = u?.name || u?.displayName || this._getTeamFormStaffDisplayName(uid);
      return name ? `<span class="team-tag" data-no-translate>${escapeHTML(name)}<span class="team-tag-x" role="button" tabindex="0" data-team-leader-uid="${escapeHTML(String(uid || ''))}" aria-label="移除領隊">×</span></span>` : '';
    }).join('');
    const unresolved = this._ensureTeamFormUnresolvedStaffNames().leaders;
    const unresolvedHtml = unresolved.map((name, index) => (
      `<span class="team-tag" data-no-translate title="舊資料尚未連結用戶">${escapeHTML(name)}<span class="team-tag-x" onclick="App._removeUnresolvedTeamStaffName('leaders', ${index})">×</span></span>`
    )).join('');
    const container = document.getElementById('ct-leaders-tags');
    container.innerHTML = resolvedHtml + unresolvedHtml;
    container.querySelectorAll('[data-team-leader-uid]').forEach(button => {
      const remove = () => this._removeLeader(button.dataset.teamLeaderUid);
      button.addEventListener('click', remove);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          remove();
        }
      });
    });
  },
  searchTeamCaptain() {
    const q = document.getElementById('ct-captain-search').value.trim();
    if (!q) { document.getElementById('ct-captain-suggest').classList.remove('show'); return; }
    const exclude = [];
    if (this._teamFormState.captain) exclude.push(this._teamFormState.captain);
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-captain-suggest', results, 'selectTeamCaptain');
  },

  async selectTeamCaptain(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return { ok: false, reason: 'missing-uid' };
    const verification = await this._verifyTeamFormStaffSelection(safeUid, 'captain');
    if (!verification.ok) return verification;
    const user = verification.user;
    this._teamFormState.captain = safeUid;
    this._ensureTeamFormUnresolvedStaffNames().captain = '';
    this._rememberTeamFormStaffName(safeUid, user.name || user.displayName);
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    const prefix = this._teamFormState.editId ? '\u8f49\u79fb\u81f3\uff1a' : '';
    document.getElementById('ct-captain-selected').innerHTML =
      `<span class="team-tag" data-no-translate>${escapeHTML(prefix + (user.name || user.displayName || ''))}<span class="team-tag-x" onclick="App.clearTeamCaptain()">\u00d7</span></span>`;
    return { ok: true, reason: 'ok' };
  },
  clearTeamCaptain() {
    const unresolved = this._ensureTeamFormUnresolvedStaffNames();
    // 編輯模式：恢復原俱樂部經理（含只有姓名、尚未連結 UID 的舊資料）。
    if (this._teamFormState.editId) {
      const t = ApiService.getTeam(this._teamFormState.editId);
      const legacyCaptainName = String(t?.captainName || t?.captain || '').trim();
      if (t?.captainUid) {
        this._teamFormState.captain = String(t.captainUid);
        unresolved.captain = '';
        this._rememberTeamFormStaffName(t.captainUid, legacyCaptainName);
      } else if (legacyCaptainName) {
        this._teamFormState.captain = null;
        unresolved.captain = legacyCaptainName;
      } else {
        this._teamFormState.captain = null;
        unresolved.captain = '';
      }
    } else {
      // 新增模式：清除至空
      this._teamFormState.captain = null;
      unresolved.captain = '';
    }
    document.getElementById('ct-captain-selected').innerHTML = '';
  },
  searchTeamCoach() {
    if (this.hasPermission && !this.hasPermission('team.assign_coach') && !this.hasPermission('team.manage_all') && !this.hasPermission('team.manage.entry')) { this.showToast('權限不足'); return; }
    const q = document.getElementById('ct-coach-search').value.trim();
    if (!q) { document.getElementById('ct-coach-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamFormState.coaches];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-coach-suggest', results, 'selectTeamCoach');
  },

  async selectTeamCoach(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid || this._teamFormState.coaches.includes(safeUid)) {
      return { ok: false, reason: safeUid ? 'duplicate' : 'missing-uid' };
    }
    const verification = await this._verifyTeamFormStaffSelection(safeUid, 'coaches');
    if (!verification.ok) return verification;
    if (this._teamFormState.coaches.includes(safeUid)) return { ok: false, reason: 'duplicate' };
    this._teamFormState.coaches.push(safeUid);
    this._rememberTeamFormStaffName(safeUid, verification.user?.name || verification.user?.displayName);
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    this._renderCoachTags();
    return { ok: true, reason: 'ok' };
  },
  removeTeamCoach(uid) {
    this._teamFormState.coaches = this._teamFormState.coaches.filter(u => u !== uid);
    this._renderCoachTags();
  },

  _renderCoachTags() {
    const users = ApiService.getUserDirectory?.() || [];
    const resolvedHtml = this._teamFormState.coaches.map(uid => {
      const u = users.find(user => user.uid === uid || user._docId === uid);
      const name = u?.name || u?.displayName || this._getTeamFormStaffDisplayName(uid);
      return name ? `<span class="team-tag" data-no-translate>${escapeHTML(name)}<span class="team-tag-x" role="button" tabindex="0" data-team-coach-uid="${escapeHTML(String(uid || ''))}" aria-label="移除教練">×</span></span>` : '';
    }).join('');
    const unresolved = this._ensureTeamFormUnresolvedStaffNames().coaches;
    const unresolvedHtml = unresolved.map((name, index) => (
      `<span class="team-tag" data-no-translate title="舊資料尚未連結用戶">${escapeHTML(name)}<span class="team-tag-x" onclick="App._removeUnresolvedTeamStaffName('coaches', ${index})">×</span></span>`
    )).join('');
    const container = document.getElementById('ct-coach-tags');
    container.innerHTML = resolvedHtml + unresolvedHtml;
    container.querySelectorAll('[data-team-coach-uid]').forEach(button => {
      const remove = () => this.removeTeamCoach(button.dataset.teamCoachUid);
      button.addEventListener('click', remove);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          remove();
        }
      });
    });
  },
  // removeTeam → 已搬至 team-list.js

});
