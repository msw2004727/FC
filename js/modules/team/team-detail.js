/* ================================================
   SportHub — Team: Detail View Core
   Split into: team-detail-render.js, team-detail-invite.js
   This file: state, helpers, showTeamDetail, member ops.
   Dynamic HTML uses escapeHTML() per project rules.
   ================================================ */

Object.assign(App, {

  _teamDetailId: null,
  _teamDetailRequestSeq: 0,
  _teamFeedPage: {},
  _teamMemberEditModeByTeam: {},
  _teamMemberTabByTeam: {},
  _teamTournamentTabByTeam: {},
  _FEED_PAGE_SIZE: 20,
  _MAX_PINNED: 5,

  _teamLeaderTag(name) {
    return '<span class="user-capsule uc-team-leader" data-no-translate onclick="App.showUserProfile(\'' + escapeHTML(name) + '\')" title="\u7403\u968a\u9818\u968a">' + escapeHTML(name) + '</span>';
  },

  _isTeamMember(teamId) {
    const user = ApiService.getCurrentUser();
    if (user && typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    if (user && user.teamId === teamId) return true;
    const team = ApiService.getTeam(teamId);
    if (!team || !user || !user.uid) return false;
    if (team.captainUid === user.uid) return true;
    const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []);
    if (leaderUids.includes(user.uid)) return true;
    if (Array.isArray(team.coachUids) && team.coachUids.includes(user.uid)) return true;
    return false;
  },

  _refreshTeamDetailEditButton(team) {
    const btn = document.getElementById('team-detail-edit-btn');
    const settingsBtn = document.getElementById('team-detail-settings-btn');
    const canEdit = !!this._canEditTeamByRoleOrCaptain?.(team);
    if (btn) btn.style.display = 'none';
    if (settingsBtn) settingsBtn.style.display = canEdit ? '' : 'none';
  },

  // _canManageTeamMembers → 已搬至 team-list-helpers.js

  _getTeamStaffIdentity(team) {
    const users = ApiService.getAdminUsers() || [];
    const built = (typeof this._buildTeamStaffIdentity === 'function')
      ? this._buildTeamStaffIdentity(team, users)
      : { keys: new Set(), names: new Set() };
    return {
      keys: built.keys || new Set(),
      names: built.names || new Set(),
    };
  },

  _isRegularTeamMember(user, staffIdentity) {
    if (!user) return false;
    const key = (typeof this._getUserIdentityKey === 'function')
      ? this._getUserIdentityKey(user)
      : null;
    if (key && staffIdentity?.keys?.has(key)) return false;
    const names = [user.name, user.displayName]
      .map(name => String(name || '').trim().toLowerCase())
      .filter(Boolean);
    if (names.some(name => staffIdentity?.names?.has(name))) return false;
    return true;
  },

  _buildTeamMemberRemovalUpdates(teamId, member) {
    const teamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(member)
      : (() => {
        const ids = [];
        if (Array.isArray(member?.teamIds)) ids.push(...member.teamIds.map(v => String(v || '').trim()).filter(Boolean));
        if (member?.teamId) ids.push(String(member.teamId));
        return Array.from(new Set(ids));
      })();
    const nextTeamIds = teamIds.filter(id => id !== String(teamId));
    const nextTeamNames = nextTeamIds.map(id => {
      const tm = ApiService.getTeam(id);
      return tm ? tm.name : id;
    });
    return nextTeamIds.length > 0
      ? { teamId: nextTeamIds[0], teamName: nextTeamNames[0] || '', teamIds: nextTeamIds, teamNames: nextTeamNames }
      : { teamId: null, teamName: null, teamIds: [], teamNames: [] };
  },

  _buildTeamStaffRemovalUpdates(team, row) {
    const uid = String(row?.uid || row?.user?.uid || row?.user?._docId || '').trim();
    const name = String(row?.name || row?.user?.name || row?.user?.displayName || '').trim();
    const normalizedName = name.toLowerCase();
    const roles = row?.roles instanceof Set ? row.roles : new Set();
    const updates = {};
    const removeUid = (list) => (Array.isArray(list) ? list : [])
      .map(v => String(v || '').trim())
      .filter(v => v && (!uid || v !== uid));
    const removePairedNames = (names, uids) => (Array.isArray(names) ? names : [])
      .filter((value, idx) => {
        const itemName = String(value || '').trim();
        const itemUid = String((uids || [])[idx] || '').trim();
        if (uid && itemUid && itemUid === uid) return false;
        if (normalizedName && itemName.toLowerCase() === normalizedName) return false;
        return true;
      });

    if (roles.has('\u9818\u968a')) {
      const leaderUids = Array.isArray(team?.leaderUids) ? team.leaderUids : (team?.leaderUid ? [team.leaderUid] : []);
      const leaderNames = Array.isArray(team?.leaders) ? team.leaders : (team?.leader ? [team.leader] : []);
      const nextLeaderUids = removeUid(leaderUids);
      const nextLeaderNames = removePairedNames(leaderNames, leaderUids);
      updates.leaderUids = nextLeaderUids;
      updates.leaders = nextLeaderNames;
      updates.leaderNames = nextLeaderNames;
      if (team?.leaderUid === uid || !nextLeaderUids.includes(team?.leaderUid)) updates.leaderUid = nextLeaderUids[0] || null;
      if (!team?.leader || !nextLeaderNames.includes(team.leader)) updates.leader = nextLeaderNames[0] || '';
    }

    if (roles.has('\u6559\u7df4')) {
      const coachUids = Array.isArray(team?.coachUids) ? team.coachUids : [];
      const coachNames = Array.isArray(team?.coaches) ? team.coaches : [];
      const nextCoachUids = removeUid(coachUids);
      const nextCoachNames = removePairedNames(coachNames, coachUids);
      updates.coachUids = nextCoachUids;
      updates.coaches = nextCoachNames;
      updates.coachNames = nextCoachNames;
    }

    return updates;
  },

  toggleTeamDetailSection(labelEl) {
    if (!labelEl) return;
    const isOpen = labelEl.classList.toggle('open');
    const content = labelEl.nextElementSibling;
    if (!content) return;
    content.style.display = isOpen ? '' : 'none';
  },

  _keepTeamMembersSectionOpen() {
    const toggle = document.getElementById('team-members-toggle');
    if (!toggle) return;
    const content = toggle.nextElementSibling;
    if (content && content.style.display === 'none') {
      this.toggleTeamDetailSection(toggle, 'teamMembers');
    }
  },

  _getTeamDetailNodes() {
    const nodes = {
      title: document.getElementById('team-detail-title'),
      nameEn: document.getElementById('team-detail-name-en'),
      image: document.getElementById('team-detail-img'),
      body: document.getElementById('team-detail-body'),
      editButton: document.getElementById('team-detail-edit-btn'),
      settingsButton: document.getElementById('team-detail-settings-btn'),
    };
    return [nodes.title, nodes.nameEn, nodes.image, nodes.body, nodes.editButton].every(Boolean) ? nodes : null;
  },

  async _refreshTeamDetailMembers(teamId) {
    const result = await this.showTeamDetail(teamId);
    if (result?.ok) this._keepTeamMembersSectionOpen();
    return result;
  },

  _recordTeamDetailView(team) {
    try {
      if (!team?.id || typeof localStorage === 'undefined') return;
      const key = 'team_view_' + String(team.id);
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      team.viewCount = Number(team.viewCount || team.views || 0) + 1;
      if (typeof firebase === 'undefined' || !firebase.firestore) return;
      const docId = team._docId || team.id;
      const fieldValue = firebase.firestore.FieldValue;
      if (!docId || !fieldValue?.increment) return;
      firebase.firestore().collection('teams').doc(docId).update({
        viewCount: fieldValue.increment(1),
      }).catch(() => {});
    } catch (_) {}
  },

  async openTeamDetailEdit() {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u6b64\u7403\u968a\u7684\u6b0a\u9650');
      return;
    }
    if (typeof this.showTeamForm !== 'function'
      && typeof ScriptLoader !== 'undefined'
      && typeof ScriptLoader.ensureGroup === 'function') {
      try {
        await ScriptLoader.ensureGroup('teamForm');
      } catch (err) {
        console.error('[TeamDetail] team form scripts failed to load:', err);
        this.showToast('\u7121\u6cd5\u958b\u555f\u7de8\u8f2f\u8868\u55ae\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
        return;
      }
    }
    if (typeof this.showTeamForm !== 'function') {
      this.showToast('\u7121\u6cd5\u958b\u555f\u7de8\u8f2f\u8868\u55ae\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66');
      return;
    }
    this.showTeamForm(team.id);
  },

  _getTeamDetailSettingsItems() {
    return [
      { key: 'events', label: '\u6d3b\u52d5', desc: '\u4ff1\u6a02\u90e8\u6d3b\u52d5\u5217\u8868' },
      { key: 'courses', label: '\u4ff1\u6a02\u90e8\u8ab2\u7a0b', desc: '\u8ab2\u7a0b\u3001\u5206\u7d44\u3001\u5b78\u54e1\u8207\u5f85\u5be9\u6838\u9801\u7c64' },
      { key: 'matches', label: '\u4ff1\u6a02\u90e8\u8cfd\u4e8b', desc: '\u8207\u4ff1\u6a02\u90e8\u95dc\u806f\u7684\u8cfd\u4e8b\u5217\u8868' },
      { key: 'info', label: '\u4ff1\u6a02\u90e8\u8cc7\u8a0a', desc: '\u7d93\u7406\u3001\u9818\u968a\u3001\u6559\u7df4\u8207\u5730\u5340' },
      { key: 'bio', label: '\u7c21\u4ecb', desc: '\u4ff1\u6a02\u90e8\u4ecb\u7d39\u6587\u5b57' },
      { key: 'record', label: '\u6230\u7e3e', desc: '\u52dd\u6557\u8207\u9032\u5931\u7403\u8cc7\u6599' },
      { key: 'members', label: '\u6210\u54e1\u5217\u8868', desc: '\u968a\u54e1\u8207\u7ba1\u7406\u540d\u55ae' },
    ];
  },

  _buildTeamDetailSettingsSwitch(checked, onchange, label) {
    return '<label class="td-settings-switch" aria-label="' + escapeHTML(label || '') + '">' +
      '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="' + onchange + '">' +
      '<span class="td-settings-switch-track"><span class="td-settings-switch-thumb"></span></span>' +
      '</label>';
  },

  _renderTeamDetailSettingsBody(team) {
    const body = document.getElementById('team-detail-settings-body');
    if (!body || !team) return;
    const visibility = typeof this._getTeamDetailVisibility === 'function'
      ? this._getTeamDetailVisibility(team)
      : {};
    const teachingChecked = typeof this._isTeamTeachingTagged === 'function'
      ? this._isTeamTeachingTagged(team)
      : team.type === 'education';
    const memberInviteChecked = team.allowMemberInvite !== false;
    const rows = this._getTeamDetailSettingsItems().map(item => {
      const checked = visibility[item.key] !== false;
      return '<div class="td-settings-row">' +
        '<div><strong>' + item.label + '</strong><span>' + item.desc + '</span></div>' +
        this._buildTeamDetailSettingsSwitch(
          checked,
          'App.toggleTeamDetailVisibility(\'' + item.key + '\', this.checked, this)',
          item.label
        ) +
        '</div>';
    }).join('');
    body.innerHTML = '<div class="td-settings-group">' +
      '<div class="td-settings-row td-settings-row-primary">' +
      '<div><strong>\u6559\u5b78\u6a19\u7c64</strong><span>\u958b\u555f\u5f8c\u6703\u5728\u4ff1\u6a02\u90e8\u6e05\u55ae\u6b78\u985e\u70ba\u6559\u5b78\uff0c\u4e26\u5728\u5c01\u9762\u986f\u793a\u6559\u5b78\u7dde\u5e36\u3002</span></div>' +
      this._buildTeamDetailSettingsSwitch(teachingChecked, 'App.toggleTeamTeachingTag(this.checked, this)', '\u6559\u5b78\u6a19\u7c64') +
      '</div>' +
      '<div class="td-settings-row">' +
      '<div><strong>' + I18N.t('teamDetail.memberCanInvite') + '</strong><span>\u958b\u555f\u5f8c\uff0c\u73fe\u6709\u968a\u54e1\u53ef\u4ee5\u7522\u751f\u9080\u8acb QR Code\u3002</span></div>' +
      this._buildTeamDetailSettingsSwitch(memberInviteChecked, 'App.toggleTeamMemberInviteSetting(this.checked, this)', I18N.t('teamDetail.memberCanInvite')) +
      '</div>' +
      '</div>' +
      '<div class="td-settings-group"><div class="td-settings-title">\u6b04\u4f4d\u5bb9\u5668\u986f\u793a</div>' + rows + '</div>' +
      '<button class="outline-btn td-settings-edit-btn" type="button" onclick="App.openTeamDetailEdit()">\u7de8\u8f2f\u57fa\u672c\u8cc7\u6599</button>';
  },

  openTeamDetailSettings() {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u6b64\u4ff1\u6a02\u90e8\u7684\u6b0a\u9650');
      return;
    }
    this._renderTeamDetailSettingsBody(team);
    const modal = document.getElementById('team-detail-settings-modal');
    if (modal && !modal.classList.contains('open')) {
      this.showModal('team-detail-settings-modal');
    }
  },

  async _saveTeamDetailSettingsPatch(updates, inputEl) {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u6b64\u4ff1\u6a02\u90e8\u7684\u6b0a\u9650');
      return;
    }
    if (inputEl) inputEl.disabled = true;
    try {
      await ApiService.updateTeamAwait(teamId, updates);
      this.renderTeamList?.();
      this.renderTeamManage?.();
      this.renderAdminTeams?.();
      await this.showTeamDetail(teamId, { skipPageHistory: true, bypassPageLock: true });
      this._renderTeamDetailSettingsBody(ApiService.getTeam(teamId));
      this.showToast('\u8a2d\u5b9a\u5df2\u66f4\u65b0');
    } catch (err) {
      console.error('[TeamDetail] settings update failed:', err);
      if (inputEl) inputEl.checked = !inputEl.checked;
      if (!err?._toasted) this.showToast('\u8a2d\u5b9a\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  },

  toggleTeamTeachingTag(enabled, inputEl) {
    return this._saveTeamDetailSettingsPatch({ teachingEnabled: !!enabled }, inputEl);
  },

  toggleTeamMemberInviteSetting(enabled, inputEl) {
    return this._saveTeamDetailSettingsPatch({ allowMemberInvite: !!enabled }, inputEl);
  },

  toggleTeamDetailVisibility(key, enabled, inputEl) {
    const allowed = new Set(this._getTeamDetailSettingsItems().map(item => item.key));
    if (!allowed.has(key)) return;
    const team = this._teamDetailId ? ApiService.getTeam(this._teamDetailId) : null;
    if (!team) return;
    const current = team.detailVisibility && typeof team.detailVisibility === 'object'
      ? { ...team.detailVisibility }
      : {};
    current[key] = !!enabled;
    return this._saveTeamDetailSettingsPatch({ detailVisibility: current }, inputEl);
  },

  async openTeamDetailCreateEvent(teamId) {
    if (this._requireProtectedActionLogin?.({ type: 'createEvent', teamId }, { suppressToast: true })) return;
    const team = teamId ? ApiService.getTeam?.(teamId) : null;
    if (typeof this._canCreateActivityByPermission !== 'function'
      && typeof ScriptLoader !== 'undefined'
      && typeof ScriptLoader.ensureGroup === 'function') {
      try {
        await ScriptLoader.ensureGroup('activity');
      } catch (err) {
        console.warn('[TeamDetail] load activity create failed:', err);
      }
    }
    if (!this._canCreateActivityByPermission?.()) {
      this.showToast('\u6b0a\u9650\u4e0d\u8db3\uff1a\u9700\u8981\u5efa\u7acb\u6d3b\u52d5\u6b0a\u9650');
      return;
    }
    if (this._canCreateBasicActivity?.() && typeof this._openCreateCustomEventModal === 'function') {
      this._teamDetailEventPreset = {
        teamId,
        teamName: team?.name || teamId,
      };
      this._openCreateCustomEventModal();
      this._applyTeamDetailEventPreset();
      return;
    }
    if (typeof this.openCreateEventModal === 'function') {
      this.openCreateEventModal();
      return;
    }
    this.showToast('\u6d3b\u52d5\u5efa\u7acb\u529f\u80fd\u5c1a\u672a\u8f09\u5165\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
  },

  _applyTeamDetailEventPreset() {
    const preset = this._teamDetailEventPreset;
    if (!preset?.teamId) return false;
    const teamOnly = document.getElementById('ce-team-only');
    const teamSelect = document.getElementById('ce-team-select');
    if (!teamOnly || !teamSelect) return false;
    teamOnly.checked = true;
    if (typeof this._populateTeamSelect === 'function') {
      this._populateTeamSelect(teamSelect, [preset.teamId], [preset.teamName || preset.teamId]);
    } else {
      teamSelect.innerHTML = '<option value="' + escapeHTML(preset.teamId) + '" data-name="' + escapeHTML(preset.teamName || preset.teamId) + '" selected>' + escapeHTML(preset.teamName || preset.teamId) + '</option>';
      teamSelect.multiple = true;
    }
    if (typeof this._setTeamSelectValues === 'function') this._setTeamSelectValues(teamSelect, [preset.teamId]);
    if (typeof this._updateTeamOnlyLabel === 'function') this._updateTeamOnlyLabel();
    this._teamDetailEventPreset = null;
    return true;
  },

  async showTeamDetail(id, options = {}) {
    if (!options.allowGuest && this._requireProtectedActionLogin({ type: 'showTeamDetail', teamId: id }, { suppressToast: true })) {
      return { ok: false, reason: 'auth' };
    }
    try {
      let t = ApiService.getTeam(id);
      if (!t) {
        // 快取 miss → 單筆查詢 Firestore（Phase 2A §7.4）
        t = await ApiService.getTeamAsync(id);
        if (!t) return { ok: false, reason: 'missing' };
      }
      const requestSeq = ++this._teamDetailRequestSeq;

      // ── 確保頁面 HTML + Script 已載入（不切換顯示），避免空白模板閃現 ──
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await PageLoader.ensurePage('page-team-detail');
      }
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage('page-team-detail');
      }
      if (requestSeq !== this._teamDetailRequestSeq) {
        return { ok: false, reason: 'stale' };
      }

      t = ApiService.getTeam(id);
      if (!t) return { ok: false, reason: 'missing' };
      this._recordTeamDetailView(t);

      const nodes = this._getTeamDetailNodes();
      if (!nodes) {
        console.warn('[TeamDetail] detail shell missing after navigation');
        this.showToast('\u7403\u968a\u8a73\u60c5\u9801\u9762\u8f09\u5165\u5931\u6557');
        return { ok: false, reason: 'page-not-ready' };
      }

      // ── 先渲染內容到隱藏 DOM ──
      this._teamDetailId = id;
      this._refreshTeamDetailEditButton(t);
      const canManageMembers = this._canManageTeamMembers(t);
      const memberEditMode = !!this._teamMemberEditModeByTeam[t.id];
      const staffIdentity = this._getTeamStaffIdentity(t);
      nodes.title.textContent = t.name;
      nodes.nameEn.textContent = t.nameEn || '';

      const imgEl = nodes.image;
      const detailRank = this._getTeamRank(t.teamExp);
      const detailImage = this._getTeamImageUrl?.(t, 'cover') || t.image || '';
      imgEl.style.position = 'relative';
      if (detailImage) {
        imgEl.innerHTML = '<img src="' + escapeHTML(detailImage) + '" loading="eager" decoding="async" fetchpriority="high" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      } else {
        imgEl.innerHTML = '\u4ff1\u6a02\u90e8\u5c01\u9762 800 \u00d7 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      }

      const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
      const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

      nodes.body.innerHTML = this._buildTeamDetailBodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate);
      if (this._isTeamDetailSectionVisible?.(t, 'courses') !== false && typeof this._initEduClubDetailSection === 'function') {
        this._initEduClubDetailSection(id);
      }

      // ── 內容已渲染就緒，切換顯示頁面（避免空白模板閃現）──
      await this.showPage('page-team-detail', {
        suppressHashSync: true,
        bypassPageLock: options?.bypassPageLock,
        skipPageHistory: options?.skipPageHistory,
      });
      if (requestSeq !== this._teamDetailRequestSeq || this.currentPage !== 'page-team-detail') {
        return { ok: false, reason: 'stale' };
      }
      this._setRouteUrl?.({ pageId: 'page-team-detail', id }, {
        mode: this._hasLegacyRouteSignal?.() ? 'replace' : undefined,
      });
      this._updateRouteMetaTags?.('page-team-detail', { id });
      this._markPageSnapshotReady?.('page-team-detail');
      return { ok: true, reason: 'ok' };
    } catch (err) {
      console.error('[TeamDetail] showTeamDetail failed:', err);
      this.showToast('\u7121\u6cd5\u958b\u555f\u7403\u968a\u8a73\u60c5');
      return { ok: false, reason: 'error' };
    }
  },

  async toggleTeamMemberEditMode(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    this._teamMemberEditModeByTeam[teamId] = !this._teamMemberEditModeByTeam[teamId];
    if (typeof this._refreshTeamMembersCardFromCache === 'function' && this._refreshTeamMembersCardFromCache(teamId)) {
      return;
    }
    await this._refreshTeamDetailMembers(teamId);
  },

  _findTeamDetailRosterRow(teamId, memberKey) {
    const t = ApiService.getTeam(teamId);
    if (!t || typeof this._getTeamDetailRoster !== 'function') return null;
    const key = String(memberKey || '');
    return this._getTeamDetailRoster(t).find(row =>
      String(row.key || '') === key
      || (row.uid && String(row.uid) === key)
      || (row.studentId && String(row.studentId) === key)
    ) || null;
  },

  _promptTeamMemberMatchData(row, current) {
    const fallback = () => {
      const ask = typeof window !== 'undefined' && typeof window.prompt === 'function'
        ? window.prompt.bind(window)
        : null;
      if (!ask) return Promise.resolve(null);
      const jerseyNumber = ask('\u80cc\u865f', current?.jerseyNumber && current.jerseyNumber !== '-' ? current.jerseyNumber : '') || '';
      const position = ask('\u4f4d\u7f6e', current?.position && current.position !== '-' ? current.position : '') || '';
      const notes = ask('\u5099\u8a3b', current?.notes && current.notes !== '-' ? current.notes : '') || '';
      return Promise.resolve({ jerseyNumber: jerseyNumber.trim(), position: position.trim(), notes: notes.trim() });
    };
    const modal = document.getElementById('app-confirm-modal');
    const msgEl = document.getElementById('app-confirm-msg');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    if (!modal || !msgEl || !ok || !cancel) return fallback();
    const name = row?.name || '\u6210\u54e1';
    const jerseyValue = current?.jerseyNumber && current.jerseyNumber !== '-' ? current.jerseyNumber : '';
    const positionValue = current?.position && current.position !== '-' ? current.position : '';
    const notesValue = current?.notes && current.notes !== '-' ? current.notes : '';
    msgEl.innerHTML = '<div class="td-member-match-form">'
      + '<strong>\u7de8\u8f2f\u8cfd\u4e8b\u6578\u64da</strong>'
      + '<span>' + escapeHTML(name) + '</span>'
      + '<label>\u80cc\u865f<input id="td-member-match-jersey" maxlength="12" value="' + escapeHTML(jerseyValue) + '"></label>'
      + '<label>\u4f4d\u7f6e<input id="td-member-match-position" maxlength="20" value="' + escapeHTML(positionValue) + '"></label>'
      + '<label>\u5099\u8a3b<textarea id="td-member-match-notes" rows="2" maxlength="80">' + escapeHTML(notesValue) + '</textarea></label>'
      + '</div>';
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    cancel.style.display = '';
    ok.textContent = '\u5132\u5b58';
    cancel.textContent = '\u53d6\u6d88';
    return new Promise(resolve => {
      const cleanup = (result) => {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
        msgEl.innerHTML = '';
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(result);
      };
      ok.addEventListener('click', () => cleanup({
        jerseyNumber: (document.getElementById('td-member-match-jersey')?.value || '').trim(),
        position: (document.getElementById('td-member-match-position')?.value || '').trim(),
        notes: (document.getElementById('td-member-match-notes')?.value || '').trim(),
      }), { once: true });
      cancel.addEventListener('click', () => cleanup(null), { once: true });
    });
  },

  _getTeamMemberNoteEditConfig(kind) {
    if (kind === 'course') {
      return {
        dataKey: 'teamCourseData',
        title: '\u7de8\u8f2f\u8ab2\u7a0b\u5099\u8a3b',
        logType: 'team_member_course_note_update',
        logTitle: '\u7de8\u8f2f\u6210\u54e1\u8ab2\u7a0b\u5099\u8a3b',
        toast: '\u8ab2\u7a0b\u5099\u8a3b\u5df2\u66f4\u65b0',
      };
    }
    return {
      dataKey: 'teamActivityData',
      title: '\u7de8\u8f2f\u6d3b\u52d5\u5099\u8a3b',
      logType: 'team_member_activity_note_update',
      logTitle: '\u7de8\u8f2f\u6210\u54e1\u6d3b\u52d5\u5099\u8a3b',
      toast: '\u6d3b\u52d5\u5099\u8a3b\u5df2\u66f4\u65b0',
    };
  },

  _promptTeamMemberNoteData(row, currentNote, kind) {
    const config = this._getTeamMemberNoteEditConfig(kind);
    const current = currentNote && currentNote !== '-' ? currentNote : '';
    const fallback = () => {
      const ask = typeof window !== 'undefined' && typeof window.prompt === 'function'
        ? window.prompt.bind(window)
        : null;
      if (!ask) return Promise.resolve(null);
      const notes = ask('\u5099\u8a3b', current) || '';
      return Promise.resolve({ notes: notes.trim() });
    };
    const modal = document.getElementById('app-confirm-modal');
    const msgEl = document.getElementById('app-confirm-msg');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    if (!modal || !msgEl || !ok || !cancel) return fallback();
    const name = row?.name || '\u6210\u54e1';
    msgEl.innerHTML = '<div class="td-member-match-form">'
      + '<strong>' + config.title + '</strong>'
      + '<span>' + escapeHTML(name) + '</span>'
      + '<label>\u5099\u8a3b<textarea id="td-member-note-editor" rows="3" maxlength="120">' + escapeHTML(current) + '</textarea></label>'
      + '</div>';
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    cancel.style.display = '';
    ok.textContent = '\u5132\u5b58';
    cancel.textContent = '\u53d6\u6d88';
    return new Promise(resolve => {
      const cleanup = (result) => {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
        msgEl.innerHTML = '';
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(result);
      };
      ok.addEventListener('click', () => cleanup({
        notes: (document.getElementById('td-member-note-editor')?.value || '').trim(),
      }), { once: true });
      cancel.addEventListener('click', () => cleanup(null), { once: true });
    });
  },

  async editTeamMemberNote(btn, teamId, memberKey, kind) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    const normalizedKind = kind === 'course' ? 'course' : 'activity';
    const row = this._findTeamDetailRosterRow(teamId, memberKey);
    if (!row) {
      this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
      return;
    }
    const canEditSource = this._isTeamDetailMemberNoteEditableRow?.(row)
      || !!(row?.user?._docId || (row?.studentId && row?.student));
    if (!canEditSource) {
      this.showToast('\u6b64\u6210\u54e1\u76ee\u524d\u7121\u53ef\u7de8\u8f2f\u7684\u8cc7\u6599\u4f86\u6e90');
      return;
    }
    const currentData = normalizedKind === 'course'
      ? (this._getTeamDetailMemberCourseData?.(t, row) || {})
      : (this._getTeamDetailMemberActivityData?.(t, row) || {});
    const data = await this._promptTeamMemberNoteData(row, currentData.notes, normalizedKind);
    if (!data) return;
    const config = this._getTeamMemberNoteEditConfig(normalizedKind);
    const save = async () => {
      try {
        const nextRecord = {
          notes: data.notes,
          updatedAt: new Date().toISOString(),
        };
        if (row.user?._docId) {
          const currentMap = row.user[config.dataKey] && typeof row.user[config.dataKey] === 'object'
            ? Object.assign({}, row.user[config.dataKey])
            : {};
          currentMap[String(teamId)] = Object.assign({}, currentMap[String(teamId)] || {}, nextRecord);
          if (typeof FirebaseService._ensureAuth === 'function') {
            const authed = await FirebaseService._ensureAuth();
            if (!authed) {
              this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
              return;
            }
          }
          await FirebaseService.updateUser(row.user._docId, { [config.dataKey]: currentMap });
          row.user[config.dataKey] = currentMap;
        } else if (row.studentId && row.student && typeof FirebaseService.updateEduStudent === 'function') {
          const currentMap = row.student[config.dataKey] && typeof row.student[config.dataKey] === 'object'
            ? Object.assign({}, row.student[config.dataKey])
            : {};
          currentMap[String(teamId)] = Object.assign({}, currentMap[String(teamId)] || {}, nextRecord);
          await FirebaseService.updateEduStudent(teamId, row.studentId, { [config.dataKey]: currentMap });
          row.student[config.dataKey] = currentMap;
          const cached = this._eduStudentsCache?.[teamId];
          const cachedStudent = Array.isArray(cached) ? cached.find(s => String(s.id || s._docId || '') === String(row.studentId)) : null;
          if (cachedStudent) cachedStudent[config.dataKey] = currentMap;
        }
        ApiService._writeOpLog?.(config.logType, config.logTitle, '\u66f4\u65b0\u300c' + (row.name || row.uid || row.studentId) + '\u300d\u5728\u300c' + t.name + '\u300d\u7684\u5099\u8a3b');
        this.showToast(config.toast);
        if (typeof this._refreshTeamMembersCardFromCache !== 'function' || !this._refreshTeamMembersCardFromCache(teamId)) {
          await this._refreshTeamDetailMembers(teamId);
        }
      } catch (err) {
        console.error('[editTeamMemberNote]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'editTeamMemberNote',
              teamId,
              memberKey,
              kind: normalizedKind,
              docId: row.user?._docId || row.studentId || '',
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      return this._withButtonLoading(btn, '\u5132\u5b58\u4e2d...', save);
    }
    return save();
  },

  async editTeamMemberMatchData(btn, teamId, memberKey) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    const row = this._findTeamDetailRosterRow(teamId, memberKey);
    if (!row) {
      this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
      return;
    }
    if (!this._isTeamDetailMatchDataEditableRow?.(row)) {
      this.showToast('\u6b64\u6210\u54e1\u76ee\u524d\u7121\u53ef\u7de8\u8f2f\u7684\u8cc7\u6599\u4f86\u6e90');
      return;
    }
    const current = typeof this._getTeamDetailMemberMatchData === 'function'
      ? this._getTeamDetailMemberMatchData(t, row)
      : {};
    const data = await this._promptTeamMemberMatchData(row, current);
    if (!data) return;
    const save = async () => {
      try {
      const nextRecord = {
        jerseyNumber: data.jerseyNumber,
        position: data.position,
        notes: data.notes,
        updatedAt: new Date().toISOString(),
      };
      if (row.user?._docId) {
        const currentMap = row.user.teamMatchData && typeof row.user.teamMatchData === 'object'
          ? Object.assign({}, row.user.teamMatchData)
          : {};
        currentMap[String(teamId)] = Object.assign({}, currentMap[String(teamId)] || {}, nextRecord);
        if (typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        await FirebaseService.updateUser(row.user._docId, { teamMatchData: currentMap });
        row.user.teamMatchData = currentMap;
      } else if (row.studentId && row.student && typeof FirebaseService.updateEduStudent === 'function') {
        const currentMap = row.student.teamMatchData && typeof row.student.teamMatchData === 'object'
          ? Object.assign({}, row.student.teamMatchData)
          : {};
        currentMap[String(teamId)] = Object.assign({}, currentMap[String(teamId)] || {}, nextRecord);
        await FirebaseService.updateEduStudent(teamId, row.studentId, { teamMatchData: currentMap });
        row.student.teamMatchData = currentMap;
        const cached = this._eduStudentsCache?.[teamId];
        const cachedStudent = Array.isArray(cached) ? cached.find(s => String(s.id || s._docId || '') === String(row.studentId)) : null;
        if (cachedStudent) cachedStudent.teamMatchData = currentMap;
      }
      ApiService._writeOpLog?.('team_member_match_data_update', '\u7de8\u8f2f\u6210\u54e1\u8cfd\u4e8b\u6578\u64da', '\u66f4\u65b0\u300c' + (row.name || row.uid || row.studentId) + '\u300d\u5728\u300c' + t.name + '\u300d\u7684\u8cfd\u4e8b\u6578\u64da');
      this.showToast('\u8cfd\u4e8b\u6578\u64da\u5df2\u66f4\u65b0');
      if (typeof this._refreshTeamMembersCardFromCache !== 'function' || !this._refreshTeamMembersCardFromCache(teamId)) {
        await this._refreshTeamDetailMembers(teamId);
      }
      } catch (err) {
        console.error('[editTeamMemberMatchData]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'editTeamMemberMatchData',
              teamId,
              memberKey,
              docId: row.user?._docId || row.studentId || '',
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      return this._withButtonLoading(btn, '\u5132\u5b58\u4e2d...', save);
    }
    return save();
  },

  async _removeTeamStaffRosterRow(btn, teamId, row) {
    const t = ApiService.getTeam(teamId);
    if (!t || !row?.uid || !row?.user) return;
    const member = row.user;
    const memberName = row.name || member.name || member.displayName || member.uid || '\u8077\u52d9\u6210\u54e1';
    const roles = Array.from(row.roles || []).filter(role => role === '\u6559\u7df4' || role === '\u9818\u968a');
    const roleText = roles.join('\u3001') || '\u8077\u52d9';
    if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u5c07\u300c' + memberName + '\u300d\u5f9e\u300c' + t.name + '\u300d\u7684' + roleText + '\u8207\u6210\u54e1\u540d\u55ae\u4e2d\u5254\u9664\uff1f'))) return;

    const run = async () => {
      try {
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }

        const isInTeam = member && (
          typeof this._isUserInTeam === 'function'
            ? this._isUserInTeam(member, teamId)
            : member.teamId === teamId || (Array.isArray(member.teamIds) && member.teamIds.map(String).includes(String(teamId)))
        );
        const userUpdates = isInTeam ? this._buildTeamMemberRemovalUpdates(teamId, member) : null;
        if (userUpdates && member._docId && typeof FirebaseService !== 'undefined' && FirebaseService.updateUser) {
          await FirebaseService.updateUser(member._docId, userUpdates);
          Object.assign(member, userUpdates);
          const currentUser = ApiService.getCurrentUser?.();
          if (currentUser && currentUser.uid === member.uid) ApiService.updateCurrentUser?.(userUpdates);
        }

        const staffUpdates = this._buildTeamStaffRemovalUpdates(t, row);
        const users = ApiService.getAdminUsers?.() || [];
        const nextTeam = Object.assign({}, t, staffUpdates);
        const memberCount = typeof this._calcTeamMemberCountByTeam === 'function'
          ? this._calcTeamMemberCountByTeam(nextTeam, users)
          : this._calcTeamMemberCount(teamId);
        const teamUpdates = Object.assign({}, staffUpdates, { members: memberCount });
        const updater = ApiService.updateTeamAwait || ApiService.updateTeam;
        const updateResult = updater.call(ApiService, teamId, teamUpdates);
        if (updateResult && typeof updateResult.then === 'function') await updateResult;

        ApiService._writeOpLog?.('team_staff_remove', '\u5254\u9664\u8077\u52d9\u6210\u54e1', '\u5c07\u300c' + memberName + '\u300d\u5f9e\u300c' + t.name + '\u300d\u7684' + roleText + '\u8207\u6210\u54e1\u540d\u55ae\u4e2d\u5254\u9664');
        this.showToast('\u5df2\u5254\u9664\u300c' + memberName + '\u300d');
        if (typeof this._refreshTeamMembersCardFromCache !== 'function' || !this._refreshTeamMembersCardFromCache(teamId)) {
          await this._refreshTeamDetailMembers(teamId);
        }
      } catch (err) {
        console.error('[removeTeamStaffRosterRow]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'removeTeamStaffRosterRow',
              teamId,
              memberKey: row.key,
              memberUid: row.uid,
              docId: member?._docId || '',
              roles,
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u5254\u9664\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      return this._withButtonLoading(btn, '\u79fb\u9664\u4e2d...', run);
    }
    return run();
  },

  async removeTeamRosterRow(btn, teamId, memberKey) {
    const t = ApiService.getTeam(teamId);
    if (!t || !memberKey) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u79fb\u9664\u6210\u54e1\u7684\u6b0a\u9650');
      return;
    }
    const row = this._findTeamDetailRosterRow(teamId, memberKey);
    if (!row) {
      this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
      return;
    }
    const staffIdentity = this._getTeamStaffIdentity(t);
    const removalKind = typeof this._getTeamDetailRemovalKind === 'function'
      ? this._getTeamDetailRemovalKind(t, row, staffIdentity)
      : '';
    if (removalKind === 'member' && row.uid) {
      return this.removeTeamMember(btn, teamId, row.uid);
    }
    if (removalKind === 'staff' && row.uid) {
      return this._removeTeamStaffRosterRow(btn, teamId, row);
    }
    if (removalKind === 'protected') {
      this.showToast('\u7403\u7d93/\u968a\u9577\u662f\u4ff1\u6a02\u90e8\u7ba1\u7406\u8077\u52d9\uff0c\u4e0d\u80fd\u76f4\u63a5\u5f9e\u6210\u54e1\u5217\u8868\u5254\u9664\u3002\u8acb\u5148\u5230\u4ff1\u6a02\u90e8\u8a2d\u5b9a\u79fb\u4ea4\u6216\u8abf\u6574\u8077\u52d9\u5f8c\u518d\u64cd\u4f5c\u3002');
      return;
    }
    if (removalKind !== 'student' || !row.studentId || !row.student) {
      this.showToast('\u6b64\u5217\u76ee\u524d\u4e0d\u53ef\u5254\u9664');
      return;
    }
    const memberName = row.name || row.student.name || '\u5b78\u54e1';
    if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u5254\u9664\u300c' + memberName + '\u300d\uff1f'))) return;
    const run = async () => {
      try {
        if (!FirebaseService.updateEduStudent) {
          this.showToast('\u5b78\u54e1\u529f\u80fd\u5c1a\u672a\u8f09\u5165\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
          return;
        }
        await FirebaseService.updateEduStudent(teamId, row.studentId, { enrollStatus: 'inactive' });
        row.student.enrollStatus = 'inactive';
        const cached = this._eduStudentsCache?.[teamId];
        const cachedStudent = Array.isArray(cached)
          ? cached.find(s => String(s.id || s._docId || s.studentId || '') === String(row.studentId))
          : null;
        if (cachedStudent) cachedStudent.enrollStatus = 'inactive';
        if (typeof this._updateGroupMemberCounts === 'function') this._updateGroupMemberCounts(teamId);
        ApiService._writeOpLog?.('team_student_remove', '\u5254\u9664\u5b78\u54e1', '\u5c07\u300c' + memberName + '\u300d\u79fb\u51fa\u300c' + t.name + '\u300d');
        this.showToast('\u5df2\u5254\u9664\u300c' + memberName + '\u300d');
        if (typeof this._refreshTeamMembersCardFromCache !== 'function' || !this._refreshTeamMembersCardFromCache(teamId)) {
          await this._refreshTeamDetailMembers(teamId);
        }
      } catch (err) {
        console.error('[removeTeamRosterRow]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'removeTeamRosterRow',
              teamId,
              memberKey,
              studentId: row.studentId,
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u5254\u9664\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      return this._withButtonLoading(btn, '\u79fb\u9664\u4e2d...', run);
    }
    return run();
  },

  async removeTeamMember(btn, teamId, memberUid) {
    const t = ApiService.getTeam(teamId);
    if (!t || !memberUid) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u79fb\u9664\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    const users = ApiService.getAdminUsers() || [];
    const member = users.find(u => u.uid === memberUid);
    const isInTeam = member && (
      (typeof this._isUserInTeam === 'function'
        ? this._isUserInTeam(member, teamId)
        : member.teamId === teamId || (Array.isArray(member.teamIds) && member.teamIds.map(String).includes(String(teamId))))
    );
    if (!member || !isInTeam) {
      this.showToast('\u968a\u54e1\u8cc7\u6599\u4e0d\u5b58\u5728\u6216\u5df2\u4e0d\u5728\u7403\u968a\u4e2d');
      this.showTeamDetail(teamId);
      this._keepTeamMembersSectionOpen();
      return;
    }
    const staffIdentity = this._getTeamStaffIdentity(t);
    if (!this._isRegularTeamMember(member, staffIdentity)) {
      this.showToast('\u50c5\u53ef\u79fb\u9664\u4e00\u822c\u968a\u54e1');
      return;
    }

    const memberName = member.name || member.displayName || member.uid;
    if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u5254\u9664\u300c' + memberName + '\u300d\uff1f'))) return;

    return this._withButtonLoading(btn, '\u79fb\u9664\u4e2d...', async () => {

    const teamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(member)
      : (() => {
        const ids = [];
        if (Array.isArray(member.teamIds)) ids.push(...member.teamIds.map(v => String(v || '').trim()).filter(Boolean));
        if (member.teamId) ids.push(String(member.teamId));
        return Array.from(new Set(ids));
      })();
    const nextTeamIds = teamIds.filter(id => id !== String(teamId));
    const nextTeamNames = nextTeamIds.map(id => {
      const tm = ApiService.getTeam(id);
      return tm ? tm.name : id;
    });
    const updates = nextTeamIds.length > 0
      ? { teamId: nextTeamIds[0], teamName: nextTeamNames[0] || '', teamIds: nextTeamIds, teamNames: nextTeamNames }
      : { teamId: null, teamName: null, teamIds: [], teamNames: [] };

    if (member._docId) {
      try {
        if (typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        await FirebaseService.updateUser(member._docId, updates);
      } catch (err) {
        console.error('[removeTeamMember]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'removeTeamMember',
              teamId,
              memberUid,
              docId: member._docId,
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u79fb\u9664\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
        return;
      }
    }

    Object.assign(member, updates);
    const currentUser = ApiService.getCurrentUser?.();
    if (currentUser && currentUser.uid === memberUid) {
      ApiService.updateCurrentUser(updates);
    }

    const memberCount = this._calcTeamMemberCount(teamId);
    ApiService.updateTeam(teamId, { members: memberCount });

    const actorName = currentUser?.displayName || currentUser?.name || '\u8077\u54e1';
    ApiService._writeOpLog('team_member_remove', '\u79fb\u9664\u968a\u54e1', actorName + ' \u5c07\u300c' + memberName + '\u300d\u79fb\u51fa\u300c' + t.name + '\u300d');
    this.showToast('\u5df2\u79fb\u9664\u968a\u54e1\u300c' + memberName + '\u300d');
    await this._refreshTeamDetailMembers(teamId);

    });  // _withButtonLoading
  },

});
