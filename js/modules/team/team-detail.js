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
      { key: 'courses', label: '\u8ab2\u7a0b\u8207\u5b78\u54e1', desc: '\u8ab2\u7a0b\u3001\u73ed\u7d1a\u8207\u5b78\u54e1\u9801\u7c64' },
      { key: 'feed', label: '\u52d5\u614b', desc: '\u4ff1\u6a02\u90e8\u8cbc\u6587\u8207\u7559\u8a00' },
      { key: 'info', label: '\u4ff1\u6a02\u90e8\u8cc7\u8a0a', desc: '\u7d93\u7406\u3001\u9818\u968a\u3001\u6559\u7df4\u8207\u5730\u5340' },
      { key: 'bio', label: '\u7c21\u4ecb', desc: '\u4ff1\u6a02\u90e8\u4ecb\u7d39\u6587\u5b57' },
      { key: 'record', label: '\u6230\u7e3e', desc: '\u52dd\u6557\u8207\u9032\u5931\u7403\u8cc7\u6599' },
      { key: 'history', label: '\u8cfd\u4e8b\u7d00\u9304', desc: '\u6b77\u53f2\u6bd4\u8cfd\u7d00\u9304' },
      { key: 'members', label: '\u6210\u54e1\u5217\u8868', desc: '\u968a\u54e1\u8207\u7ba1\u7406\u540d\u55ae' },
    ];
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
    const rows = this._getTeamDetailSettingsItems().map(item => {
      const checked = visibility[item.key] !== false ? ' checked' : '';
      return '<div class="td-settings-row">' +
        '<div><strong>' + item.label + '</strong><span>' + item.desc + '</span></div>' +
        '<label class="toggle-switch"><input type="checkbox" data-setting-key="' + item.key + '"' + checked + ' onchange="App.toggleTeamDetailVisibility(\'' + item.key + '\', this.checked, this)"><span class="toggle-slider"></span></label>' +
        '</div>';
    }).join('');
    body.innerHTML = '<div class="td-settings-group">' +
      '<div class="td-settings-row td-settings-row-primary">' +
      '<div><strong>\u6559\u5b78\u6a19\u7c64</strong><span>\u958b\u555f\u5f8c\u6703\u5728\u4ff1\u6a02\u90e8\u6e05\u55ae\u6b78\u985e\u70ba\u6559\u5b78\uff0c\u4e26\u5728\u5c01\u9762\u986f\u793a\u6559\u5b78\u7dde\u5e36\u3002</span></div>' +
      '<label class="toggle-switch"><input type="checkbox"' + (teachingChecked ? ' checked' : '') + ' onchange="App.toggleTeamTeachingTag(this.checked, this)"><span class="toggle-slider"></span></label>' +
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
      const detailSportIcon = t.sportTag && typeof getSportIconSvg === 'function' ? (getSportIconSvg(t.sportTag) || '') : '';
      const detailSportBadge = detailSportIcon ? '<span class="tc-sport-badge" style="top:8px;left:8px;padding:3px 9px;font-size:1.3rem">' + detailSportIcon + '</span>' : '';
      const detailTeachingRibbon = (typeof this._isTeamTeachingTagged === 'function' && this._isTeamTeachingTagged(t))
        ? '<span class="tc-edu-ribbon td-cover-ribbon">\u6559\u5b78</span>'
        : '';
      const detailImage = this._getTeamImageUrl?.(t, 'cover') || t.image || '';
      imgEl.style.position = 'relative';
      if (detailImage) {
        imgEl.innerHTML = detailSportBadge + '<img src="' + escapeHTML(detailImage) + '" loading="eager" decoding="async" fetchpriority="high" style="width:100%;height:100%;object-fit:cover">' + detailTeachingRibbon + '<span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      } else {
        imgEl.innerHTML = detailSportBadge + '\u7403\u968a\u5c01\u9762 800 \u00d7 300' + detailTeachingRibbon + '<span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      }

      const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
      const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

      // 載入 feed subcollection 資料；教育型也共用同一套詳細頁 UI。
      if (this._isTeamDetailSectionVisible?.(t, 'feed') !== false && typeof this._loadTeamFeed === 'function') {
        await this._loadTeamFeed(id);
      }
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
    await this._refreshTeamDetailMembers(teamId);
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
      (typeof this._isUserInTeam === 'function' ? this._isUserInTeam(member, teamId) : member.teamId === teamId)
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
    if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u79fb\u9664\u968a\u54e1\u300c' + memberName + '\u300d\uff1f'))) return;

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
