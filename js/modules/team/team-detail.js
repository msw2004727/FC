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
  _teamDetailEventCreateTeamId: null,
  _teamDetailEventCreateTransitionSeq: 0,
  _teamDetailEducationLoadPromise: null,
  _teamDetailEducationRouteIntent: null,
  _FEED_PAGE_SIZE: 20,
  _MAX_PINNED: 5,

  _isCurrentTeamDetailEducationRequest(teamId, requestSeq = 0) {
    const normalizedTeamId = String(teamId || '').trim();
    return !!normalizedTeamId
      && this.currentPage === 'page-team-detail'
      && String(this._teamDetailId || '').trim() === normalizedTeamId
      && (!requestSeq || Number(requestSeq) === Number(this._teamDetailRequestSeq));
  },

  _replaceDeferredTeamEducationSection(teamId) {
    const team = ApiService.getTeam?.(teamId);
    const section = typeof document !== 'undefined'
      ? document.getElementById('edu-detail-section')
      : null;
    if (!team || !section) return false;
    if (section.querySelector?.('#edu-detail-tab-content')) return true;
    if (typeof this._buildTeamEducationSection !== 'function') return false;

    const template = document.createElement('template');
    template.innerHTML = this._buildTeamEducationSection(team).trim();
    const readySection = template.content.firstElementChild;
    if (!readySection) return false;
    section.replaceWith(readySection);
    return true;
  },

  _renderTeamDetailEducationLoadError(teamId) {
    if (!this._isCurrentTeamDetailEducationRequest(teamId)) return false;
    const section = document.getElementById('edu-detail-section');
    if (!section) return false;
    section.setAttribute('aria-busy', 'false');
    section.innerHTML = '<div class="td-card-title td-card-title-row"><span>俱樂部課程</span></div>'
      + '<div class="reg-loading" role="alert"><strong>課程功能載入失敗</strong>'
      + '<div style="margin-top:.75rem"><button type="button" class="outline-btn small"'
      + ' data-team-education-retry>重新載入</button></div></div>';
    section.querySelector('[data-team-education-retry]')?.addEventListener('click', () => {
      void this.retryTeamDetailEducation(teamId);
    });
    return true;
  },

  _hydrateDeferredTeamEducation(teamId, options = {}) {
    if (!this._isCurrentTeamDetailEducationRequest(teamId, options.requestSeq)) return false;
    const intent = this._teamDetailEducationRouteIntent;
    if (intent && String(intent.teamId || '') === String(teamId || '')) {
      this._primeEduCoursePlanShareIntent?.(teamId, intent.options || {});
    }
    if (!this._replaceDeferredTeamEducationSection(teamId)) return false;
    this._initEduClubDetailSection?.(teamId);
    this._applyEduCoursePlanShareFocus?.(teamId);
    if (this._teamDetailEducationRouteIntent === intent) {
      this._teamDetailEducationRouteIntent = null;
    }
    return true;
  },

  async _ensureTeamDetailEducationReady(teamId, options = {}) {
    if (!this._isCurrentTeamDetailEducationRequest(teamId, options.requestSeq)) return false;
    if (typeof this._initEduClubDetailSection === 'function'
      && typeof this._renderEduTabContent === 'function') {
      return this._hydrateDeferredTeamEducation(teamId, options);
    }
    if (typeof ScriptLoader === 'undefined' || typeof ScriptLoader.ensureGroup !== 'function') {
      this._renderTeamDetailEducationLoadError(teamId);
      if (options.userInitiated) this.showToast?.('課程功能載入失敗，請稍後再試');
      return false;
    }

    let loadPromise = this._teamDetailEducationLoadPromise;
    if (!loadPromise) {
      loadPromise = ScriptLoader.ensureGroup('education');
      this._teamDetailEducationLoadPromise = loadPromise;
    }
    try {
      await loadPromise;
      return this._hydrateDeferredTeamEducation(teamId, options);
    } catch (err) {
      console.warn('[TeamDetail] education scripts failed to load:', err);
      this._renderTeamDetailEducationLoadError(teamId);
      if (options.userInitiated) {
        this.showToast?.(
          err?.code === 'script-load-timeout'
            ? '課程功能載入逾時，請檢查網路後再試'
            : '課程功能載入失敗，請稍後再試'
        );
      }
      return false;
    } finally {
      if (this._teamDetailEducationLoadPromise === loadPromise) {
        this._teamDetailEducationLoadPromise = null;
      }
    }
  },

  retryTeamDetailEducation(teamId = this._teamDetailId) {
    return this._ensureTeamDetailEducationReady(teamId, {
      requestSeq: this._teamDetailRequestSeq,
      userInitiated: true,
    });
  },

  _teamLeaderTag(name) {
    return '<span class="user-capsule uc-team-leader" data-no-translate onclick="App.showUserProfile(\'' + escapeHTML(name) + '\')" title="\u7403\u968a\u9818\u968a">' + escapeHTML(name) + '</span>';
  },

  _completeTeamMemberManagement(teamId) {
    const modes = this._teamMemberEditModeByTeam || {};
    const key = String(teamId || this._teamDetailId || '').trim();
    if (!key || !modes[key]) return false;
    delete modes[key];
    return true;
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

  _isCurrentTeamDetailTransition(teamId, transitionSeq) {
    const normalizedTeamId = String(teamId || '').trim();
    const normalizedTransitionSeq = Number(transitionSeq);
    return !!normalizedTeamId
      && this.currentPage === 'page-team-detail'
      && String(this._teamDetailId || '').trim() === normalizedTeamId
      && Number.isSafeInteger(normalizedTransitionSeq)
      && normalizedTransitionSeq > 0
      && typeof this._isPageTransitionCurrent === 'function'
      && this._isPageTransitionCurrent(normalizedTransitionSeq);
  },

  _refreshCurrentTeamDetail(teamId, transitionSeq, options = {}) {
    const normalizedTransitionSeq = Number(transitionSeq);
    if (!this._isCurrentTeamDetailTransition(teamId, normalizedTransitionSeq)) {
      return Promise.resolve({ ok: false, reason: 'stale' });
    }
    return this.showTeamDetail(teamId, {
      ...options,
      skipPageHistory: true,
      bypassPageLock: true,
      _navigationTransitionSeq: normalizedTransitionSeq,
    });
  },

  async _refreshTeamDetailMembers(teamId) {
    const result = await this._refreshCurrentTeamDetail(teamId, this._activePageTransitionSeq);
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

  _getTeamAvatarUploadInput() {
    if (typeof document === 'undefined') return null;
    let input = document.getElementById('team-avatar-upload-input');
    if (input) return input;
    if (typeof document.createElement !== 'function') return null;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'team-avatar-upload-input';
    input.style.display = 'none';
    document.body?.appendChild(input);
    return input;
  },

  openTeamAvatarUpload(btn) {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u6b64\u4ff1\u6a02\u90e8\u7684\u6b0a\u9650');
      return;
    }
    const input = this._getTeamAvatarUploadInput();
    if (!input) {
      this.showToast('\u7121\u6cd5\u958b\u555f\u5716\u7247\u4e0a\u50b3\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66');
      return;
    }
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await this._uploadTeamAvatarFile(btn, team, file);
    };
    input.click();
  },

  _readTeamAvatarFileAsDataUrl(file) {
    if (typeof this._readImageFileAsDataURL === 'function') {
      return this._readImageFileAsDataURL(file);
    }
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        reject(new Error('FILE_READER_UNAVAILABLE'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = event => resolve(event.target.result);
      reader.readAsDataURL(file);
    });
  },

  _getTeamAvatarCropOptions() {
    return {
      aspectRatio: 1,
      outputWidth: 900,
      outputHeight: 900,
      outputType: 'image/webp',
      quality: 0.9,
      title: '\u4ff1\u6a02\u90e8\u982d\u50cf',
      subtitle: '\u8acb\u5c07\u5716\u7247\u653e\u5728\u65b9\u5f62\u7bc4\u570d\u5167\uff0c\u5b8c\u6210\u5f8c\u6703\u76f4\u63a5\u4f5c\u70ba\u4ff1\u6a02\u90e8\u982d\u50cf\u3002',
      targetLabel: '\u4ff1\u6a02\u90e8\u982d\u50cf',
      recommendedSize: '900 x 900',
      aspectLabel: '1:1',
    };
  },

  async _prepareTeamAvatarDataUrl(file) {
    if (typeof this.showImageCropper === 'function') {
      const sourceDataURL = await this._readTeamAvatarFileAsDataUrl(file);
      const cropOptions = this._getTeamAvatarCropOptions();
      return new Promise((resolve) => {
        this.showImageCropper(sourceDataURL, {
          ...cropOptions,
          onConfirm: (dataURL) => resolve(dataURL),
          onCancel: () => resolve(null),
        });
      });
    }
    if (typeof this._compressImage === 'function') {
      return this._compressImage(file, 900, 0.9, 'image/webp');
    }
    return this._readTeamAvatarFileAsDataUrl(file);
  },

  async _uploadTeamAvatarFile(btn, team, file) {
    const teamId = String(team?.id || this._teamDetailId || '').trim();
    const detailTransitionSeq = Number(this._activePageTransitionSeq);
    if (!teamId || !file) return;
    const isAllowed = typeof this._isAllowedImageFile === 'function'
      ? this._isAllowedImageFile(file)
      : /^image\//.test(String(file.type || ''));
    if (!isAllowed) {
      this.showToast('\u8acb\u4e0a\u50b3 JPG / PNG / WebP \u5716\u7247');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('\u5716\u7247\u592a\u5927\uff0c\u4e0d\u80fd\u8d85\u904e 5MB');
      return;
    }

    let dataUrl = '';
    try {
      dataUrl = await this._prepareTeamAvatarDataUrl(file);
    } catch (cropErr) {
      console.error('[TeamDetail] avatar crop failed:', cropErr);
      this.showToast('\u5716\u7247\u8655\u7406\u5931\u6557\uff0c\u8acb\u91cd\u8a66');
      return;
    }
    if (!dataUrl) return;

    const run = async () => {
      try {
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        if (typeof FirebaseService === 'undefined' || typeof FirebaseService._uploadImage !== 'function') {
          throw new Error('TEAM_AVATAR_UPLOAD_UNAVAILABLE');
        }
        const avatarUrl = await FirebaseService._uploadImage(dataUrl, `teams/${teamId}_avatar`);
        if (!avatarUrl) throw new Error('TEAM_AVATAR_UPLOAD_FAILED');
        await ApiService.updateTeamAwait(teamId, { avatarUrl });
        if (team) team.avatarUrl = avatarUrl;
        this.renderTeamList?.();
        this.renderTeamManage?.();
        this.renderAdminTeams?.();
        await this._refreshCurrentTeamDetail(teamId, detailTransitionSeq);
        this.showToast('\u4ff1\u6a02\u90e8\u982d\u50cf\u5df2\u66f4\u65b0');
      } catch (err) {
        console.error('[TeamDetail] avatar upload failed:', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog({ fn: 'uploadTeamAvatar', teamId }, err);
        }
        if (!err?._toasted) this.showToast('\u982d\u50cf\u4e0a\u50b3\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      await this._withButtonLoading(btn, '\u4e0a\u50b3\u4e2d', run);
    } else {
      await run();
    }
  },

  _getTeamCoverUploadInput() {
    if (typeof document === 'undefined') return null;
    let input = document.getElementById('team-cover-upload-input');
    if (input) return input;
    if (typeof document.createElement !== 'function') return null;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'team-cover-upload-input';
    input.style.display = 'none';
    document.body?.appendChild(input);
    return input;
  },

  openTeamCoverUpload(btn) {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('您沒有編輯此俱樂部的權限');
      return;
    }
    const input = this._getTeamCoverUploadInput();
    if (!input) {
      this.showToast('無法開啟圖片上傳，請重新整理後再試');
      return;
    }
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await this._uploadTeamCoverFile(btn, team, file);
    };
    input.click();
  },

  async _prepareTeamCoverPayload(file) {
    const sourceDataURL = await this._readTeamAvatarFileAsDataUrl(file);
    const targets = typeof this._getTeamImageVariantTargets === 'function'
      ? this._getTeamImageVariantTargets()
      : null;
    if (typeof this._openImageVariantCropSequence === 'function' && Array.isArray(targets) && targets.length) {
      return new Promise((resolve) => {
        this._openImageVariantCropSequence(sourceDataURL, targets, {
          onConfirm: (variants) => resolve({
            imageVariants: variants,
            image: variants?.cover || variants?.card || '',
          }),
          onCancel: () => resolve(null),
        });
      });
    }
    if (typeof this._compressImage === 'function') {
      const image = await this._compressImage(file, 1200, 0.9, 'image/webp');
      return { image, imageVariants: { cover: image } };
    }
    return { image: sourceDataURL, imageVariants: { cover: sourceDataURL } };
  },

  async _uploadTeamCoverFile(btn, team, file) {
    const teamId = String(team?.id || this._teamDetailId || '').trim();
    const detailTransitionSeq = Number(this._activePageTransitionSeq);
    if (!teamId || !file) return;
    const isAllowed = typeof this._isAllowedImageFile === 'function'
      ? this._isAllowedImageFile(file)
      : /^image\//.test(String(file.type || ''));
    if (!isAllowed) {
      this.showToast('請上傳 JPG / PNG / WebP 圖片');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('圖片太大，不能超過 5MB');
      return;
    }

    let updates = null;
    try {
      updates = await this._prepareTeamCoverPayload(file);
    } catch (cropErr) {
      console.error('[TeamDetail] cover crop failed:', cropErr);
      this.showToast('圖片處理失敗，請重試');
      return;
    }
    if (!updates) return;

    const run = async () => {
      try {
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('登入已過期，請重新整理頁面後再試');
            return;
          }
        }
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._uploadTeamImageVariants === 'function') {
          await FirebaseService._uploadTeamImageVariants(teamId, updates);
        } else if (updates.image && typeof FirebaseService !== 'undefined' && typeof FirebaseService._uploadImage === 'function' && updates.image.startsWith('data:')) {
          updates.image = await FirebaseService._uploadImage(updates.image, `teams/${teamId}_cover`);
          updates.imageVariants = { cover: updates.image };
        } else if (updates.image && updates.image.startsWith('data:')) {
          throw new Error('TEAM_COVER_UPLOAD_UNAVAILABLE');
        }
        await ApiService.updateTeamAwait(teamId, updates);
        Object.assign(team, updates);
        this.renderTeamList?.();
        this.renderTeamManage?.();
        this.renderAdminTeams?.();
        await this._refreshCurrentTeamDetail(teamId, detailTransitionSeq);
        this.showToast('俱樂部封面已更新');
      } catch (err) {
        console.error('[TeamDetail] cover upload failed:', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog({ fn: 'uploadTeamCover', teamId }, err);
        }
        if (!err?._toasted) this.showToast('封面上傳失敗，請稍後再試');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      await this._withButtonLoading(btn, '上傳中', run);
    } else {
      await run();
    }
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

  _getTeamDetailCategoryOptions() {
    if (typeof this._getTeamCategoryOptions === 'function') return this._getTeamCategoryOptions();
    return [
      { key: 'none', label: '無', formHint: '不顯示任何標籤與緞帶，也不啟用課程功能。' },
      { key: 'competitive', label: '競技', formHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。' },
      { key: 'education', label: '教學', formHint: '教學標籤會啟用課程、學員與待審核功能。' },
      { key: 'leisure', label: '休閒', formHint: '休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。' },
    ];
  },

  _getTeamDetailCategoryKey(team) {
    if (!team) return 'competitive';
    if (typeof this._getTeamCategoryMeta === 'function') return this._getTeamCategoryMeta(team)?.key || 'competitive';
    if (team.teachingEnabled === true || team.isTeaching === true || team.educationTag === true || team.eduSettings?.teachingEnabled === true) return 'education';
    if (team.teachingEnabled === false && (!team.type || team.type === 'education')) return 'competitive';
    if (team.type === 'none') return 'none';
    if (team.type === 'education') return 'education';
    if (team.type === 'leisure') return 'leisure';
    return 'competitive';
  },

  _normalizeTeamDetailCategoryKey(type) {
    if (typeof this._normalizeTeamCategory === 'function') return this._normalizeTeamCategory(type);
    return type === 'none' ? 'none' : (type === 'education' ? 'education' : (type === 'leisure' ? 'leisure' : 'competitive'));
  },

  _buildTeamDetailCategorySelector(team) {
    const activeKey = this._getTeamDetailCategoryKey(team);
    const options = this._getTeamDetailCategoryOptions();
    const buttons = options.map(option => {
      const active = option.key === activeKey;
      return '<button type="button" class="td-category-tag-btn td-category-tag-' + escapeHTML(option.key) + (active ? ' active' : '') + '" aria-pressed="' + (active ? 'true' : 'false') + '" onclick="App.setTeamCategoryTag(\'' + escapeHTML(option.key) + '\', this)">' +
        '<strong>' + escapeHTML(option.label) + '</strong>' +
        '<span>' + escapeHTML(option.formHint || '') + '</span>' +
        '</button>';
    }).join('');
    return '<div class="td-category-tag-group" role="radiogroup" aria-label="俱樂部分類標籤">' + buttons + '</div>';
  },

  _renderTeamDetailSettingsBody(team) {
    const body = document.getElementById('team-detail-settings-body');
    if (!body || !team) return;
    const visibility = typeof this._getTeamDetailVisibility === 'function'
      ? this._getTeamDetailVisibility(team)
      : {};
    const categoryKey = this._getTeamDetailCategoryKey(team);
    const memberInviteChecked = team.allowMemberInvite !== false;
    const themeColor = this._getTeamThemeColor?.(team) || '';
    const themeOverlayChecked = this._isTeamThemeOverlayEnabled?.(team) !== false;
    const themePickerValue = themeColor || '#0d9488';
    const rows = this._getTeamDetailSettingsItems().filter(item => {
      return item.key !== 'courses' || categoryKey === 'education';
    }).map(item => {
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
      '<div class="td-settings-row td-settings-row-primary td-category-settings-row">' +
      '<div><strong>\u4ff1\u6a02\u90e8\u6a19\u7c64</strong><span>\u56db\u7a2e\u6a19\u7c64\u50c5\u80fd\u64c7\u4e00\uff1b\u300c\u7121\u300d\u4e0d\u986f\u793a\u6a19\u7c64\u8207\u7dde\u5e36\uff0c\u53ea\u6709\u6559\u5b78\u6a19\u7c64\u6703\u958b\u555f\u8ab2\u7a0b\u8207\u5b78\u54e1\u529f\u80fd\u3002</span></div>' +
      this._buildTeamDetailCategorySelector(team) +
      '</div>' +
      '<div class="td-settings-row">' +
      '<div><strong>' + I18N.t('teamDetail.memberCanInvite') + '</strong><span>\u958b\u555f\u5f8c\uff0c\u73fe\u6709\u968a\u54e1\u53ef\u4ee5\u7522\u751f\u9080\u8acb QR Code\u3002</span></div>' +
      this._buildTeamDetailSettingsSwitch(memberInviteChecked, 'App.toggleTeamMemberInviteSetting(this.checked, this)', I18N.t('teamDetail.memberCanInvite')) +
      '</div>' +
      '<div class="td-settings-row td-theme-settings-row">' +
      '<div><strong>\u4ff1\u6a02\u90e8\u4e3b\u984c\u8272</strong><span>\u9078\u64c7\u5f8c\u6703\u5957\u7528\u5728\u4ff1\u6a02\u90e8\u5361\u7247\u8207\u8a73\u60c5\u91cd\u9ede\u5bb9\u5668\uff1b\u7559\u7a7a\u5247\u4f7f\u7528\u7cfb\u7d71\u9810\u8a2d\u914d\u8272\u3002</span></div>' +
      '<div class="td-theme-control">' +
      '<span class="td-theme-current" style="' + (themeColor ? 'background:' + escapeHTML(themeColor) : '') + '"></span>' +
      '<input class="td-theme-color-input" type="color" value="' + escapeHTML(themePickerValue) + '" onchange="App.changeTeamThemeColor(this.value, this)" aria-label="\u4ff1\u6a02\u90e8\u4e3b\u984c\u8272">' +
      '<button type="button" class="td-theme-reset-btn" onclick="App.clearTeamThemeColor(this)">\u9810\u8a2d</button>' +
      '</div>' +
      '</div>' +
      '<div class="td-settings-row td-theme-overlay-row">' +
      '<div><strong>\u534a\u900f\u660e\u906e\u7f69</strong><span>\u958b\u555f\u5f8c\u6703\u5728\u4e3b\u984c\u8272\u8207\u6587\u5b57\u4e4b\u9593\u52a0\u4e0a\u6dfa\u8272\u6216\u6df1\u8272\u906e\u7f69\uff0c\u8b93\u6587\u5b57\u66f4\u6e05\u695a\uff1b\u95dc\u9589\u5f8c\u984f\u8272\u6703\u66f4\u63a5\u8fd1\u5be6\u969b\u9078\u8272\uff0c\u4f46\u6587\u5b57\u5c0d\u6bd4\u53ef\u80fd\u964d\u4f4e\u3002</span></div>' +
      this._buildTeamDetailSettingsSwitch(themeOverlayChecked, 'App.toggleTeamThemeOverlay(this.checked, this)', '\u534a\u900f\u660e\u906e\u7f69') +
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
    const detailTransitionSeq = Number(this._activePageTransitionSeq);
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
      const refreshResult = await this._refreshCurrentTeamDetail(teamId, detailTransitionSeq);
      if (refreshResult?.ok) this._renderTeamDetailSettingsBody(ApiService.getTeam(teamId));
      this.showToast('\u8a2d\u5b9a\u5df2\u66f4\u65b0');
    } catch (err) {
      console.error('[TeamDetail] settings update failed:', err);
      if (inputEl && inputEl.type === 'checkbox') inputEl.checked = !inputEl.checked;
      else this._renderTeamDetailSettingsBody(team);
      if (!err?._toasted) this.showToast('\u8a2d\u5b9a\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  },

  setTeamCategoryTag(type, inputEl) {
    const categoryKey = this._normalizeTeamDetailCategoryKey(type);
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    const isTeaching = categoryKey === 'education';
    const updates = {
      type: categoryKey,
      teachingEnabled: isTeaching,
    };
    if (isTeaching) {
      updates.eduSettings = {
        ...(team?.eduSettings || {}),
        acceptingStudents: team?.eduSettings?.acceptingStudents !== false,
        teachingEnabled: true,
      };
    } else {
      const deleteField = typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.delete
        ? firebase.firestore.FieldValue.delete()
        : null;
      updates.eduSettings = deleteField;
    }
    return this._saveTeamDetailSettingsPatch(updates, inputEl);
  },

  toggleTeamTeachingTag(enabled, inputEl) {
    return this.setTeamCategoryTag(enabled ? 'education' : 'competitive', inputEl);
  },

  toggleTeamMemberInviteSetting(enabled, inputEl) {
    return this._saveTeamDetailSettingsPatch({ allowMemberInvite: !!enabled }, inputEl);
  },

  changeTeamThemeColor(colorValue, inputEl) {
    const themeColor = this._normalizeTeamThemeColor?.(colorValue) || '';
    if (!themeColor) {
      this.showToast?.('\u4e3b\u984c\u8272\u683c\u5f0f\u4e0d\u6b63\u78ba');
      return;
    }
    return this._saveTeamDetailSettingsPatch({ themeColor }, inputEl);
  },

  clearTeamThemeColor(btnEl) {
    return this._saveTeamDetailSettingsPatch({ themeColor: null }, btnEl);
  },

  toggleTeamThemeOverlay(enabled, inputEl) {
    return this._saveTeamDetailSettingsPatch({ themeOverlayEnabled: !!enabled }, inputEl);
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

  _isCurrentUserTeamStaffForCreate(teamOrId) {
    const team = typeof teamOrId === 'string' ? ApiService.getTeam?.(teamOrId) : teamOrId;
    const currentUid = String(ApiService.getCurrentUser?.()?.uid || '').trim();
    if (!team || !currentUid) return false;

    const staffIds = [
      team.captainUid,
      team.creatorUid,
      team.ownerUid,
      team.leaderUid,
      ...(Array.isArray(team.leaderUids) ? team.leaderUids : []),
      ...(Array.isArray(team.coachUids) ? team.coachUids : []),
    ].map(value => String(value || '').trim()).filter(Boolean);
    return staffIds.includes(currentUid);
  },

  _canCreateTeamDetailActivity(teamOrId) {
    const team = typeof teamOrId === 'string' ? ApiService.getTeam?.(teamOrId) : teamOrId;
    const currentUser = ApiService.getCurrentUser?.() || null;
    if (!team || !currentUser?.uid) return false;

    const roleKey = String(
      this._getCurrentActivityRoleKey?.()
      || currentUser.role
      || this.currentRole
      || 'user'
    ).trim().toLowerCase() || 'user';
    const hasPermission = code => !!this.hasPermission?.(code);
    const canManageAllActivities = roleKey === 'super_admin'
      || !!this._canManageAllActivities?.()
      || hasPermission('event.edit_all');
    const hasExactStaffScope = this._isCurrentUserTeamStaffForCreate(team);
    const hasEventCreate = hasPermission('event.create');

    if (roleKey === 'user') {
      const hasTeamCreateEvent = hasPermission('team.create_event');
      const hasCapability = code => (typeof this._hasUserActivityCapability === 'function'
        ? !!this._hasUserActivityCapability(code)
        : !!ApiService.hasRoleActivityCapability?.('user', code));
      const hasBasicCreateCapability = hasCapability('user.activity.basic_create');
      const hasAddonCapability = hasCapability('user.activity.addons_use');
      return (hasEventCreate && hasTeamCreateEvent && hasExactStaffScope)
        || (
          hasAddonCapability
          && (hasBasicCreateCapability || hasEventCreate)
          && (canManageAllActivities || (hasTeamCreateEvent && hasExactStaffScope))
        );
    }

    const isCoachPlusRole = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'].includes(roleKey);
    const hasCreateEntry = isCoachPlusRole
      || hasPermission('activity.manage.entry')
      || hasPermission('event.edit_all')
      || hasEventCreate;
    return hasCreateEntry && (canManageAllActivities || hasExactStaffScope);
  },

  async openTeamDetailCreateEvent(teamId) {
    if (this._requireProtectedActionLogin?.({ type: 'createEvent', teamId }, { suppressToast: true })) return;
    const team = teamId ? ApiService.getTeam?.(teamId) : null;
    if (!this._canCreateTeamDetailActivity?.(team || teamId)) {
      this.showToast('\u53ea\u6709\u4ff1\u6a02\u90e8\u8077\u54e1\u53ef\u4ee5\u65b0\u589e\u4ff1\u6a02\u90e8\u6d3b\u52d5');
      return;
    }
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
      const presetTeamId = String(teamId || '').trim();
      const sportTag = (typeof getSportKeySafe === 'function')
        ? getSportKeySafe(team?.sportTag || '')
        : String(team?.sportTag || '').trim();
      this._teamDetailEventCreateTeamId = presetTeamId;
      this._teamDetailEventCreateTransitionSeq = Number(this._activePageTransitionSeq) || 0;
      this._teamDetailEventPreset = {
        teamId: presetTeamId || teamId,
        teamName: team?.name || teamId,
        sportTag,
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
    const sportTag = String(preset.sportTag || '').trim();
    if (sportTag) {
      if (typeof this._initSportTagPicker === 'function') {
        this._initSportTagPicker(sportTag);
      } else {
        const sportInput = document.getElementById('ce-sport-tag');
        if (sportInput) sportInput.value = sportTag;
        this._selectedSportTag = sportTag;
      }
    }
    this._teamDetailEventPreset = null;
    return true;
  },

  async _refreshTeamDetailAfterEventSave(teamIds = []) {
    const targetTeamId = String(this._teamDetailEventCreateTeamId || this._teamDetailId || '').trim();
    const targetTransitionSeq = Number(this._teamDetailEventCreateTransitionSeq);
    const eventTeamIds = (Array.isArray(teamIds) ? teamIds : [teamIds])
      .map(id => String(id || '').trim())
      .filter(Boolean);
    let refreshed = false;
    try {
      if (!targetTeamId || eventTeamIds.length === 0 || !eventTeamIds.includes(targetTeamId)) return false;
      const result = await this._refreshCurrentTeamDetail(targetTeamId, targetTransitionSeq);
      refreshed = !!result?.ok;
      return refreshed;
    } catch (err) {
      console.warn('[TeamDetail] refresh after event save failed:', err);
      return false;
    } finally {
      this._teamDetailEventCreateTeamId = null;
      this._teamDetailEventCreateTransitionSeq = 0;
      if (!refreshed && this._teamDetailEventPreset) this._teamDetailEventPreset = null;
    }
  },

  async _showTeamDetailLoaded(id, options = {}) {
    if (!options.allowGuest && this._requireProtectedActionLogin({ type: 'showTeamDetail', teamId: id }, { suppressToast: true })) {
      return { ok: false, reason: 'auth' };
    }
    const inheritedRouteTransitionSeq = Number(options?._navigationTransitionSeq);
    const isSameTeamRefresh = this.currentPage === 'page-team-detail' && this._teamDetailId === id;
    const routeTransitionOptions = isSameTeamRefresh
      && !(Number.isSafeInteger(inheritedRouteTransitionSeq) && inheritedRouteTransitionSeq > 0)
      ? { ...options, _navigationTransitionSeq: this._activePageTransitionSeq }
      : options;
    const routeTransitionSeq = this._claimPageTransition('page-team-detail', routeTransitionOptions);
    if (!this._isPageTransitionCurrent(routeTransitionSeq)) {
      return this._abortStalePageTransition('showTeamDetail-entry', 'page-team-detail', routeTransitionSeq);
    }
    const requestSeq = ++this._teamDetailRequestSeq;
    try {
      let t = ApiService.getTeam(id);
      if (!t) {
        // 快取 miss → 單筆查詢 Firestore（Phase 2A §7.4）
        const teamRequest = ApiService.getTeamAsync(id);
        t = typeof this._awaitRouteStep === 'function'
          ? await this._awaitRouteStep(teamRequest, 'page-team-detail', 'cloud')
          : await teamRequest;
        if (requestSeq !== this._teamDetailRequestSeq) {
          return { ok: false, reason: 'stale' };
        }
        if (!this._isPageTransitionCurrent(routeTransitionSeq)) {
          return this._abortStalePageTransition('showTeamDetail-record', 'page-team-detail', routeTransitionSeq);
        }
        if (!t) return { ok: false, reason: 'missing' };
      }

      // ── 確保頁面 HTML + Script 已載入（不切換顯示），避免空白模板閃現 ──
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await PageLoader.ensurePage('page-team-detail');
      }
      if (requestSeq !== this._teamDetailRequestSeq) {
        return { ok: false, reason: 'stale' };
      }
      if (!this._isPageTransitionCurrent(routeTransitionSeq)) {
        return this._abortStalePageTransition('showTeamDetail-page-html', 'page-team-detail', routeTransitionSeq);
      }
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage('page-team-detail');
      }
      if (requestSeq !== this._teamDetailRequestSeq) {
        return { ok: false, reason: 'stale' };
      }
      if (!this._isPageTransitionCurrent(routeTransitionSeq)) {
        return this._abortStalePageTransition('showTeamDetail-page-ready', 'page-team-detail', routeTransitionSeq);
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
      if (this.currentPage === 'page-team-detail') this._teamDetailId = id;
      this._refreshTeamDetailEditButton(t);
      const canManageMembers = this._canManageTeamMembers(t);
      const memberEditMode = !!this._teamMemberEditModeByTeam[t.id];
      const staffIdentity = this._getTeamStaffIdentity(t);
      this._teamDetailEducationRouteIntent = {
        teamId: id,
        options: {
          ...options,
          _navigationTransitionSeq: routeTransitionSeq,
        },
      };
      this._primeEduCoursePlanShareIntent?.(id, {
        ...options,
        _navigationTransitionSeq: routeTransitionSeq,
      });
      nodes.title.textContent = t.name;
      nodes.nameEn.textContent = t.nameEn || '';

      const imgEl = nodes.image;
      const useV2 = typeof isTeamDetailV2Enabled === 'function' && isTeamDetailV2Enabled();
      this._setTeamDetailV2ShellActive?.(useV2);
      if (useV2) {
        imgEl.innerHTML = '';
      } else {
        const detailRank = this._getTeamRank(t.teamExp);
        const detailImage = this._getTeamCoverImageUrl?.(t, 'cover') || this._getTeamImageUrl?.(t, 'cover') || t.image || '';
        imgEl.style.position = 'relative';
        if (detailImage) {
          imgEl.innerHTML = '<img src="' + escapeHTML(detailImage) + '" width="1200" height="450" loading="eager" decoding="async" fetchpriority="high" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
        } else {
          imgEl.innerHTML = '\u4ff1\u6a02\u90e8\u5c01\u9762 800 \u00d7 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
        }
      }

      const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
      const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

      nodes.body.innerHTML = this._buildTeamDetailBodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate);
      this._syncTeamDetailV2RuntimeAfterBodyRender?.(id, requestSeq);

      // ── 內容已渲染就緒，切換顯示頁面（避免空白模板閃現）──
      await this.showPage('page-team-detail', {
        suppressHashSync: true,
        bypassPageLock: options?.bypassPageLock,
        skipPageHistory: options?.skipPageHistory,
        _navigationTransitionSeq: routeTransitionSeq,
      });
      if (!this._isPageTransitionCurrent(routeTransitionSeq)) {
        this._cleanupTeamDetailV2Runtime?.(id, requestSeq);
        return this._abortStalePageTransition('showTeamDetail-after-showPage', 'page-team-detail', routeTransitionSeq);
      }
      if (requestSeq !== this._teamDetailRequestSeq || this.currentPage !== 'page-team-detail') {
        this._cleanupTeamDetailV2Runtime?.(id, requestSeq);
        return { ok: false, reason: 'stale' };
      }
      this._teamDetailId = id;
      if (this._isTeamDetailSectionVisible?.(t, 'courses') !== false) {
        void this._ensureTeamDetailEducationReady(id, {
          requestSeq,
          routeTransitionSeq,
        });
      }
      this._setRouteUrl?.({ pageId: 'page-team-detail', id }, {
        mode: this._hasLegacyRouteSignal?.() ? 'replace' : undefined,
      });
      this._updateRouteMetaTags?.('page-team-detail', { id });
      this._applyEduCoursePlanShareFocus?.(id);
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

  _canQuickPromoteTeamMember(team) {
    if (!team) return false;
    return !!this._canEditTeamByRoleOrCaptain?.(team);
  },

  _getCurrentTeamRoleLevel(team) {
    if (!team) return 0;
    const currentUser = ApiService.getCurrentUser?.();
    const currentIds = [currentUser?.uid, currentUser?._docId]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    if (this._hasRolePermission?.('team.manage_all')) return 4;
    if (!currentIds.length) return 0;
    const hasCurrentId = (value) => {
      const id = String(value || '').trim();
      return !!id && currentIds.includes(id);
    };
    if (['captainUid', 'creatorUid', 'ownerUid'].some(field => hasCurrentId(team[field]))) return 3;
    const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []);
    if (leaderUids.some(hasCurrentId)) return 2;
    if (Array.isArray(team.coachUids) && team.coachUids.some(hasCurrentId)) return 1;
    return 0;
  },

  _getTeamMemberClubRoleLevel(row) {
    const roles = row?.roles instanceof Set ? row.roles : new Set();
    if (roles.has('\u7403\u7d93')) return 3;
    if (roles.has('\u9818\u968a')) return 2;
    if (roles.has('\u6559\u7df4')) return 1;
    return 0;
  },

  _getTeamRoleLevelTargetConfig(targetRole) {
    const key = String(targetRole || '').trim();
    const configs = {
      member: { key: 'member', label: '\u968a\u54e1', roleName: '\u968a\u54e1', level: 0, lineSource: 'team_role_assignment:member' },
      coach: { key: 'coach', label: '\u6559\u7df4', roleName: '\u6559\u7df4', level: 1, lineSource: 'team_role_assignment:coach' },
      leader: { key: 'leader', label: '\u9818\u968a', roleName: '\u9818\u968a', level: 2, lineSource: 'team_role_assignment:leader' },
    };
    return configs[key] || null;
  },

  _getTeamQuickPromoteTargetConfig(targetRole) {
    return this._getTeamRoleLevelTargetConfig(targetRole);
  },

  _getTeamMemberRoleActionTarget(team, row, direction) {
    if (!team || !row?.uid || !row?.user || !row.isMember) return null;
    if (!this._canQuickPromoteTeamMember(team)) return null;
    const isInTeam = typeof this._isUserInTeam === 'function'
      ? this._isUserInTeam(row.user, team.id)
      : row.user.teamId === team.id || (Array.isArray(row.user.teamIds) && row.user.teamIds.map(String).includes(String(team.id)));
    if (!isInTeam) return null;
    const currentLevel = this._getTeamMemberClubRoleLevel(row);
    if (currentLevel >= 3) return null;
    const actorLevel = this._getCurrentTeamRoleLevel(team);
    const targetByDirection = {
      promote: {
        actionText: '\u6649\u5347',
        targetByLevel: {
          0: 'coach',
          1: 'leader',
        },
      },
      demote: {
        actionText: '\u964d\u7d1a',
        targetByLevel: {
          2: 'coach',
          1: 'member',
        },
      },
    };
    const action = targetByDirection[String(direction || '')];
    const target = this._getTeamRoleLevelTargetConfig(action?.targetByLevel?.[currentLevel]);
    if (!action || !target || target.level >= actorLevel) return null;
    return Object.assign({ direction, actionText: action.actionText }, target);
  },

  _buildTeamRoleLevelUpdates(team, row, targetRole) {
    const target = this._getTeamRoleLevelTargetConfig(targetRole);
    if (!team || !row || !target) return null;
    const uid = String(row.uid || row.user?.uid || row.user?._docId || '').trim();
    if (!uid) return null;
    const displayName = String(row.name || row.user?.name || row.user?.displayName || '').trim() || uid;
    const normalizedName = displayName.toLowerCase();
    const unique = (values) => {
      const seen = new Set();
      return (Array.isArray(values) ? values : [])
        .map(v => String(v || '').trim())
        .filter(v => {
          if (!v || seen.has(v)) return false;
          seen.add(v);
          return true;
        });
    };
    const uniqueNames = (values) => {
      const seen = new Set();
      return (Array.isArray(values) ? values : [])
        .map(v => String(v || '').trim())
        .filter(v => {
          const key = v.toLowerCase();
          if (!v || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    };
    const namesFrom = (primary, fallback) => {
      if (Array.isArray(primary)) return uniqueNames(primary);
      return uniqueNames(fallback);
    };
    const removePerson = (uids, names) => {
      const nextUids = unique(uids).filter(itemUid => itemUid !== uid);
      const nextNames = uniqueNames(names).filter(name => name.toLowerCase() !== normalizedName);
      return { uids: nextUids, names: nextNames };
    };
    const addPerson = (uids, names) => {
      const nextUids = unique(uids);
      const nextNames = uniqueNames(names);
      if (!nextUids.includes(uid)) nextUids.push(uid);
      if (!nextNames.some(name => name.toLowerCase() === normalizedName)) nextNames.push(displayName);
      return { uids: nextUids, names: nextNames };
    };

    let leaderUids = unique(Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []));
    let leaders = namesFrom(team.leaders, Array.isArray(team.leaderNames) ? team.leaderNames : (team.leader ? [team.leader] : []));
    let coachUids = unique(team.coachUids);
    let coaches = namesFrom(team.coaches, team.coachNames);

    if (target.key === 'leader') {
      const removedCoach = removePerson(coachUids, coaches);
      coachUids = removedCoach.uids;
      coaches = removedCoach.names;
      const addedLeader = addPerson(leaderUids, leaders);
      leaderUids = addedLeader.uids;
      leaders = addedLeader.names;
    } else if (target.key === 'coach') {
      const removedLeader = removePerson(leaderUids, leaders);
      leaderUids = removedLeader.uids;
      leaders = removedLeader.names;
      const addedCoach = addPerson(coachUids, coaches);
      coachUids = addedCoach.uids;
      coaches = addedCoach.names;
    } else if (target.key === 'member') {
      const removedLeader = removePerson(leaderUids, leaders);
      const removedCoach = removePerson(coachUids, coaches);
      leaderUids = removedLeader.uids;
      leaders = removedLeader.names;
      coachUids = removedCoach.uids;
      coaches = removedCoach.names;
    } else {
      return null;
    }

    return {
      leaderUids,
      leaders,
      leaderNames: leaders,
      leaderUid: leaderUids[0] || null,
      leader: leaders[0] || '',
      coachUids,
      coaches,
      coachNames: coaches,
    };
  },

  _sendTeamRoleLevelChangeNotice(team, row, target) {
    const uid = String(row?.uid || row?.user?.uid || row?.user?._docId || '').trim();
    if (!uid || typeof this._deliverMessageWithLinePush !== 'function') return;
    const teamName = team?.name || '\u4ff1\u6a02\u90e8';
    const targetRoleName = target?.roleName || target?.label || '\u76ee\u6a19\u5c64\u7d1a';
    this._deliverMessageWithLinePush(
      '\u4ff1\u6a02\u90e8\u5c64\u7d1a\u8abf\u6574',
      `\u60a8\u5728\u300c${teamName}\u300d\u7684\u4ff1\u6a02\u90e8\u5c64\u7d1a\u5df2\u8abf\u6574\u70ba${targetRoleName}\u3002`,
      'system', '\u7cfb\u7d71', uid, '\u7cfb\u7d71', null,
      { lineOptions: { source: target.lineSource } }
    );
  },

  _sendTeamQuickPromoteNotice(team, row, target) {
    this._sendTeamRoleLevelChangeNotice(team, row, target);
  },

  _getTeamMemberClubRoleLabel(row) {
    const roles = row?.roles instanceof Set ? row.roles : new Set();
    if (roles.has('\u7403\u7d93')) return '\u7403\u7d93';
    if (roles.has('\u9818\u968a')) return '\u9818\u968a';
    if (roles.has('\u6559\u7df4')) return '\u6559\u7df4';
    if (row?.isStudent && !row?.isMember) return '\u5b78\u54e1';
    return '\u968a\u54e1';
  },

  _getTeamMemberClubRoleClass(roleOrKey) {
    const value = String(roleOrKey || '').trim();
    if (value === 'manager' || value === '\u7403\u7d93') return 'role-manager';
    if (value === 'leader' || value === '\u9818\u968a') return 'role-leader';
    if (value === 'coach' || value === '\u6559\u7df4') return 'role-coach';
    return 'role-default';
  },

  _buildTeamRoleChangeConfirmText(memberName, actionText, targetRoleName) {
    return '\u78ba\u8a8d\u5c07\u300c' + memberName + '\u300d' + actionText + '\u70ba\u300c' + targetRoleName + '\u300d\u5c64\u7d1a\uff1f';
  },

  _buildTeamRoleChangeConfirmHtml(row, memberName, target) {
    const direction = target?.direction === 'demote' ? 'demote' : 'promote';
    const currentRoleLabel = this._getTeamMemberClubRoleLabel(row);
    const currentRoleClass = this._getTeamMemberClubRoleClass(currentRoleLabel);
    const targetRoleName = target?.roleName || target?.label || '\u76ee\u6a19\u5c64\u7d1a';
    const targetRoleClass = this._getTeamMemberClubRoleClass(target?.key || targetRoleName);
    const actionText = target?.actionText || (direction === 'demote' ? '\u964d\u7d1a' : '\u6649\u5347');
    const actionLabel = direction === 'demote' ? '\u964d\u7d1a\u78ba\u8a8d' : '\u6649\u5347\u78ba\u8a8d';
    return '<div class="td-role-confirm-card">'
      + '<div class="td-role-confirm-heading">'
      + '<span class="td-role-confirm-kicker">\u4ff1\u6a02\u90e8\u6210\u54e1\u5c64\u7d1a\u8abf\u6574</span>'
      + '<span class="td-role-confirm-action ' + direction + '">' + actionLabel + '</span>'
      + '</div>'
      + '<div class="td-role-confirm-flow">'
      + '<span class="td-role-confirm-name-pill ' + currentRoleClass + '" data-no-translate>' + escapeHTML(memberName) + '</span>'
      + '<span class="td-role-confirm-role-pill ' + currentRoleClass + '">\u76ee\u524d ' + escapeHTML(currentRoleLabel) + '</span>'
      + '<span class="td-role-confirm-arrow ' + direction + '" aria-hidden="true">\u2192</span>'
      + '<span class="td-role-confirm-role-pill ' + targetRoleClass + '">' + escapeHTML(actionText) + '\u70ba ' + escapeHTML(targetRoleName) + '</span>'
      + '</div>'
      + '<div class="td-role-confirm-meta">\u78ba\u8a8d\u5f8c\u5c07\u7acb\u5373\u540c\u6b65\u66f4\u65b0\u6210\u54e1\u540d\u55ae\u8207\u4ff1\u6a02\u90e8\u8a2d\u5b9a\u3002</div>'
      + '</div>';
  },

  _confirmTeamMemberRoleLevelChange(row, memberName, target) {
    const direction = target?.direction === 'demote' ? 'demote' : 'promote';
    const targetRoleName = target?.roleName || target?.label || '\u76ee\u6a19\u5c64\u7d1a';
    const actionText = target?.actionText || (direction === 'demote' ? '\u964d\u7d1a' : '\u6649\u5347');
    const fallbackText = this._buildTeamRoleChangeConfirmText(memberName, actionText, targetRoleName);
    const modal = document.getElementById('app-confirm-modal');
    const msgEl = document.getElementById('app-confirm-msg');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    if (!modal || !msgEl || !ok || !cancel) {
      return typeof this.appConfirm === 'function'
        ? this.appConfirm(fallbackText)
        : Promise.resolve(true);
    }
    const box = modal.querySelector?.('.app-confirm-box') || null;
    const originalOkText = ok.textContent;
    const originalCancelText = cancel.textContent;
    const originalCancelDisplay = cancel.style?.display || '';
    msgEl.innerHTML = this._buildTeamRoleChangeConfirmHtml(row, memberName, Object.assign({}, target, { roleName: targetRoleName, actionText }));
    ok.textContent = direction === 'demote' ? '\u78ba\u8a8d\u964d\u7d1a' : '\u78ba\u8a8d\u6649\u5347';
    cancel.textContent = '\u53d6\u6d88';
    modal.classList.add('open');
    modal.classList.add('td-role-confirm-open');
    box?.classList?.add('td-role-confirm-box');
    document.body?.classList?.add('modal-open');

    return new Promise(resolve => {
      const cleanup = (value) => {
        ok.removeEventListener?.('click', onOk);
        cancel.removeEventListener?.('click', onCancel);
        modal.classList.remove('open');
        modal.classList.remove('td-role-confirm-open');
        box?.classList?.remove('td-role-confirm-box');
        document.body?.classList?.remove('modal-open');
        msgEl.innerHTML = '';
        ok.textContent = originalOkText;
        cancel.textContent = originalCancelText;
        if (cancel.style) cancel.style.display = originalCancelDisplay;
        resolve(value);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  },

  async changeTeamMemberRoleLevel(btn, teamId, memberKey, direction) {
    const t = ApiService.getTeam(teamId);
    const actionDirection = String(direction || '');
    if (!t || !memberKey) return;
    if (!this._canQuickPromoteTeamMember(t)) {
      this.showToast('\u53ea\u6709\u4ff1\u6a02\u90e8\u7d93\u7406\u53ef\u8abf\u6574\u6210\u54e1\u5c64\u7d1a');
      return;
    }
    const row = this._findTeamDetailRosterRow(teamId, memberKey);
    if (!row?.uid || !row?.user) {
      this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
      return;
    }
    const target = this._getTeamMemberRoleActionTarget(t, row, actionDirection);
    if (!target) {
      this.showToast(actionDirection === 'demote' ? '\u6b64\u6210\u54e1\u76ee\u524d\u7121\u6cd5\u964d\u7d1a' : '\u6b64\u6210\u54e1\u76ee\u524d\u7121\u6cd5\u6649\u5347');
      return;
    }
    const targetRoleName = target.roleName || target.label || '\u76ee\u6a19\u5c64\u7d1a';
    const memberName = this._displayNameOrUidFallback?.(row.name || row.user.name || row.user.displayName, row.uid, '\u6210\u54e1')
      || row.name || row.user.name || row.user.displayName || '\u6210\u54e1';
    const confirmed = typeof this._confirmTeamMemberRoleLevelChange === 'function'
      ? await this._confirmTeamMemberRoleLevelChange(row, memberName, Object.assign({}, target, { roleName: targetRoleName }))
      : (typeof this.appConfirm === 'function'
        ? await this.appConfirm(this._buildTeamRoleChangeConfirmText(memberName, target.actionText, targetRoleName))
        : true);
    if (!confirmed) return;

    const run = async () => {
      try {
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        const currentTeam = ApiService.getTeam(teamId) || t;
        if (!this._canQuickPromoteTeamMember(currentTeam)) {
          this.showToast('\u53ea\u6709\u4ff1\u6a02\u90e8\u7d93\u7406\u53ef\u8abf\u6574\u6210\u54e1\u5c64\u7d1a');
          return;
        }
        const currentRow = this._findTeamDetailRosterRow(teamId, memberKey) || row;
        const currentTarget = this._getTeamMemberRoleActionTarget(currentTeam, currentRow, actionDirection);
        if (!currentTarget || currentTarget.key !== target.key) {
          this.showToast(actionDirection === 'demote' ? '\u6b64\u6210\u54e1\u76ee\u524d\u7121\u6cd5\u964d\u7d1a' : '\u6b64\u6210\u54e1\u76ee\u524d\u7121\u6cd5\u6649\u5347');
          if (typeof this._refreshTeamMembersCardFromCache === 'function') this._refreshTeamMembersCardFromCache(teamId);
          return;
        }
        const updates = this._buildTeamRoleLevelUpdates(currentTeam, currentRow, target.key);
        if (!updates) {
          this.showToast('\u6b64\u6210\u54e1\u5c64\u7d1a\u5df2\u662f\u6700\u65b0\u72c0\u614b');
          return;
        }
        const nextTeam = Object.assign({}, currentTeam, updates);
        const users = ApiService.getAdminUsers?.() || [];
        if (typeof this._calcTeamMemberCountByTeam === 'function') {
          updates.members = this._calcTeamMemberCountByTeam(nextTeam, users);
        }
        const updater = ApiService.updateTeamAwait || ApiService.updateTeam;
        const result = updater.call(ApiService, teamId, updates);
        if (result && typeof result.then === 'function') await result;

        const roleChange = ApiService._recalcUserRole?.(currentRow.uid, teamId);
        this._applyRoleChange?.(roleChange);
        this._sendTeamRoleLevelChangeNotice(currentTeam, currentRow, target);
        ApiService._writeOpLog?.(
          actionDirection === 'demote' ? 'team_member_level_demote' : 'team_member_level_promote',
          '\u4ff1\u6a02\u90e8\u5c64\u7d1a\u8b8a\u66f4',
          target.actionText + '\u300c' + memberName + '\u300d\u70ba\u300c' + currentTeam.name + '\u300d' + targetRoleName
        );
        this.showToast('\u5df2' + target.actionText + '\u70ba' + targetRoleName);
        if (typeof this._refreshTeamMembersCardFromCache !== 'function' || !this._refreshTeamMembersCardFromCache(teamId)) {
          await this._refreshTeamDetailMembers(teamId);
        }
      } catch (err) {
        console.error('[changeTeamMemberRoleLevel]', err);
        ApiService._writeErrorLog?.(
          {
            fn: 'changeTeamMemberRoleLevel',
            teamId,
            memberKey,
            direction: actionDirection,
            targetRole: target.key,
            memberUid: row?.uid || '',
            authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
          },
          err
        );
        if (!err?._toasted) this.showToast(target.actionText + '\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      }
    };
    if (typeof this._withButtonLoading === 'function' && btn) {
      return this._withButtonLoading(btn, target.actionText + '\u4e2d...', run);
    }
    return run();
  },

  async quickPromoteTeamMember(btn, teamId, memberKey) {
    return this.changeTeamMemberRoleLevel(btn, teamId, memberKey, 'promote');
  },

  async quickDemoteTeamMember(btn, teamId, memberKey) {
    return this.changeTeamMemberRoleLevel(btn, teamId, memberKey, 'demote');
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
        teamDataKey: 'memberCourseData',
        title: '\u7de8\u8f2f\u8ab2\u7a0b\u5099\u8a3b',
        logType: 'team_member_course_note_update',
        logTitle: '\u7de8\u8f2f\u6210\u54e1\u8ab2\u7a0b\u5099\u8a3b',
        toast: '\u8ab2\u7a0b\u5099\u8a3b\u5df2\u66f4\u65b0',
      };
    }
    return {
      dataKey: 'teamActivityData',
      teamDataKey: 'memberActivityData',
      title: '\u7de8\u8f2f\u6d3b\u52d5\u5099\u8a3b',
      logType: 'team_member_activity_note_update',
      logTitle: '\u7de8\u8f2f\u6210\u54e1\u6d3b\u52d5\u5099\u8a3b',
      toast: '\u6d3b\u52d5\u5099\u8a3b\u5df2\u66f4\u65b0',
    };
  },

  _getTeamMemberScopedDataKey(row) {
    const candidates = [
      row?.uid,
      row?.user?.uid,
      row?.user?._docId,
      row?.key,
    ];
    for (const value of candidates) {
      const safe = String(value || '').trim();
      if (!safe) continue;
      return safe.replace(/^uid:/, '').replace(/^doc:/, '');
    }
    return '';
  },

  async _saveTeamMemberScopedTeamData(teamId, fieldName, memberDataKey, nextRecord) {
    const team = ApiService.getTeam(teamId);
    if (!team || !fieldName || !memberDataKey) return false;
    const currentMap = team[fieldName] && typeof team[fieldName] === 'object'
      ? Object.assign({}, team[fieldName])
      : {};
    currentMap[String(memberDataKey)] = Object.assign({}, currentMap[String(memberDataKey)] || {}, nextRecord);
    const updater = ApiService.updateTeamAwait || ApiService.updateTeam;
    const result = updater.call(ApiService, teamId, { [fieldName]: currentMap });
    if (result && typeof result.then === 'function') await result;
    team[fieldName] = currentMap;
    return true;
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
        if (row.user?._docId || row.uid) {
          const memberDataKey = this._getTeamMemberScopedDataKey(row);
          if (!memberDataKey) {
            this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
            return;
          }
          if (typeof FirebaseService._ensureAuth === 'function') {
            const authed = await FirebaseService._ensureAuth();
            if (!authed) {
              this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
              return;
            }
          }
          await this._saveTeamMemberScopedTeamData(teamId, config.teamDataKey, memberDataKey, nextRecord);
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
      if (row.user?._docId || row.uid) {
        const memberDataKey = this._getTeamMemberScopedDataKey(row);
        if (!memberDataKey) {
          this.showToast('\u627e\u4e0d\u5230\u6210\u54e1\u8cc7\u6599');
          return;
        }
        if (typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        await this._saveTeamMemberScopedTeamData(teamId, 'memberMatchData', memberDataKey, nextRecord);
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
    const memberName = this._displayNameOrUidFallback?.(row.name || member.name || member.displayName, member.uid, '\u8077\u52d9\u6210\u54e1') || '\u8077\u52d9\u6210\u54e1';
    const memberLogName = row.name || member.name || member.displayName || member.uid || '\u8077\u52d9\u6210\u54e1';
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

        ApiService._writeOpLog?.('team_staff_remove', '\u5254\u9664\u8077\u52d9\u6210\u54e1', '\u5c07\u300c' + memberLogName + '\u300d\u5f9e\u300c' + t.name + '\u300d\u7684' + roleText + '\u8207\u6210\u54e1\u540d\u55ae\u4e2d\u5254\u9664');
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

    const memberName = this._displayNameOrUidFallback?.(member.name || member.displayName, member.uid, '\u968a\u54e1') || '\u968a\u54e1';
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

if (App._lazyRouteLoadedMethodNames?.showTeamDetail !== '_showTeamDetailLoaded') {
  App.showTeamDetail = function showTeamDetailCompat(id, options = {}) {
    return this._showTeamDetailLoaded(id, options);
  };
}
