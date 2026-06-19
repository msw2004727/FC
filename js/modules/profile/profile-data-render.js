/* ================================================
   SportHub — Profile Data: Page Rendering
   依賴：profile-core.js, profile-data.js (core)
   ================================================ */
Object.assign(App, {

  _getUserTeamHtml(user) {
    const teams = ApiService.getTeams();
    const userName = user.displayName || user.name;
    const myUid = user.uid || user._docId || '';
    const teamSet = new Map();
    // 用戶自身的 teamId / teamIds（一般成員）
    const ownTeamIds = (typeof App._getUserTeamIds === 'function')
      ? App._getUserTeamIds(user)
      : (() => {
        const ids = [];
        const seen = new Set();
        const pushId = (id) => {
          const v = String(id || '').trim();
          if (!v || seen.has(v)) return;
          seen.add(v);
          ids.push(v);
        };
        if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
        pushId(user.teamId);
        return ids;
      })();
    ownTeamIds.forEach((tid, idx) => {
      const teamObj = teams.find(t => t.id === tid);
      const fallbackName = Array.isArray(user.teamNames) ? user.teamNames[idx] : null;
      teamSet.set(tid, (teamObj && teamObj.name) || fallbackName || user.teamName || '俱樂部');
    });
    // 檢查是否為任何俱樂部的隊長、領隊或教練
    teams.forEach(t => {
      if (teamSet.has(t.id)) return;
      const isCaptain = (myUid && t.captainUid === myUid) || (userName && t.captain === userName);
      const isLeader  = (myUid && t.leaderUid  === myUid) || (userName && t.leader  === userName);
      const isCoach   = userName && (t.coaches || []).includes(userName);
      if (isCaptain || isLeader || isCoach) teamSet.set(t.id, t.name);
    });
    if (teamSet.size === 0) return '無';
    return Array.from(teamSet.entries()).map(([id, name]) =>
      `<span class="uc-team-link" onclick="App.showTeamDetail('${escapeHTML(id)}')">${escapeHTML(name)}</span>`
    ).join('');
  },

  renderProfileData() {
    const el = (id) => document.getElementById(id);
    const v = (val) => val || '-';
    const user = ApiService.getCurrentUser();
    if (!user) return;

    const identity = ApiService.getCurrentIdentity?.('profile') || null;
    const lineName = identity?.displayName || user.displayName;
    const identityCandidates = Array.isArray(identity?.avatarCandidates) ? identity.avatarCandidates : [];
    const avatarCandidates = identity?.identityId === 'secondary'
      ? this._getAvatarCandidateUrls(...identityCandidates)
      : this._getAvatarCandidateUrls(...identityCandidates, user.pictureUrl);
    const pic = avatarCandidates[0] || null;

    // 頭像
    this._setAvatarContent(el('profile-avatar'), pic, lineName, {
      fallbackClass: 'profile-avatar',
      containerImageClass: 'profile-avatar profile-avatar-img',
      candidateUrls: avatarCandidates,
      identityCrown: identity?.identityId === 'secondary',
    });

    // 稱號（HTML 版：金色/銀色標籤）
    const titleHtml = this._buildTitleDisplayHtml(user, lineName);
    if (el('profile-title')) el('profile-title').innerHTML = titleHtml;

    // UID 顯示 + 迷你 QR 按鈕
    const uidWrap = el('profile-uid-wrap');
    if (uidWrap) {
      const uid = user.uid || user.lineUserId || '-';
      const uidText = this._formatUidForDisplay ? this._formatUidForDisplay(uid) : uid;
      const uidHtml = uidText ? `<span style="font-size:.72rem;color:var(--text-muted);letter-spacing:.3px">${escapeHTML(uidText)}</span>` : '';
      uidWrap.innerHTML = uidHtml
        + `<button onclick="App.showUidQrCode()" style="background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center" title="顯示簽到 QR Code">`
        + `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="17"/><line x1="17" y1="21" x2="21" y2="21"/></svg>`
        + `</button>`;
    }

    // 角色膠囊
    const roleTagWrap = el('profile-role-tag-wrap');
    if (roleTagWrap) {
      const rawRole = user.role || 'user';
      const role = this._stealthRole(user.displayName || user.name || '', rawRole);
      const roleInfo = ROLES[role] || ROLES.user;
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span>`;
    }

    // 等級 & 經驗值（由累計積分推算）
    const totalExp = user.exp || 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${progress.toLocaleString()} / ${needed.toLocaleString()}`;
    if (el('profile-exp-fill')) el('profile-exp-fill').style.width = `${Math.min(100, Math.round((progress / needed) * 100))}%`;

    // 統計數據（方向 B：以掃碼紀錄為依據）
    // cache 未 ready 時顯示 "--"，由 renderActivityRecords 背景載入完成後重繪，避免首次進場顯示 0 誤導
    if (this._calcScanStats) {
      const _uid = user.uid || user.lineUserId || '';
      const _usc = typeof FirebaseService !== 'undefined' && FirebaseService.getUserStatsCache?.();
      const _statsReady = _usc && _usc.uid === _uid && _usc.attendanceRecords !== null;
      if (_statsReady) {
        const { expectedCount, completedCount, attendRate } = this._calcScanStats(_uid);
        if (el('profile-stat-total')) el('profile-stat-total').textContent = expectedCount;
        if (el('profile-stat-done')) el('profile-stat-done').textContent = completedCount;
        if (el('profile-stat-rate')) el('profile-stat-rate').textContent = `${attendRate}%`;
      } else {
        if (el('profile-stat-total')) el('profile-stat-total').textContent = '--';
        if (el('profile-stat-done')) el('profile-stat-done').textContent = '--';
        if (el('profile-stat-rate')) el('profile-stat-rate').textContent = '--';
      }
    }
    // 徽章數量：從成就資料動態計算
    if (el('profile-stat-badges')) {
      const _achievementProfile = this._getAchievementProfile?.();
      el('profile-stat-badges').textContent = _achievementProfile
        ? (_achievementProfile.getCurrentBadgeCount?.() || 0)
        : '--';
    }

    // 我的資料（顯示模式）
    if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
    if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
    if (el('profile-region')) el('profile-region').textContent = v(user.region);
    if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
    if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);
    const _fmtCreatedAt = (ca) => { if (!ca) return '-'; const d = ca.toDate ? ca.toDate() : (ca.seconds ? new Date(ca.seconds * 1000) : new Date(ca)); return isNaN(d) ? '-' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; };
    if (el('profile-join-date')) el('profile-join-date').textContent = _fmtCreatedAt(user.createdAt);
    if (el('profile-join-date-edit')) el('profile-join-date-edit').textContent = _fmtCreatedAt(user.createdAt);

    // 所屬俱樂部（含領隊俱樂部，可點擊）
    const teamEl = el('profile-team');
    if (teamEl) teamEl.innerHTML = this._getUserTeamHtml(user);

    // 社群連結（profile-card.js 可能尚未載入）
    this.renderSocialLinks?.(user);

    // LINE 推播通知卡片
    this.renderLineNotifyCard?.();
    this.renderProfileRelatedActivities?.();
    this.renderIdentitySettings?.();

    // 編輯模式的靜態欄位
    if (el('profile-edit-gender')) el('profile-edit-gender').value = user.gender || '';
    if (el('profile-sports-display')) el('profile-sports-display').textContent = v(user.sports);
    if (el('profile-team-display')) el('profile-team-display').innerHTML = this._getUserTeamHtml(user);

    // 我的俱樂部申請（profile-data-history.js 可能尚未載入）
    this._renderMyApplications?.();

    // 同行者數量標記
    const compBadge = document.getElementById('companions-count');
    if (compBadge) compBadge.textContent = ApiService.getCompanions().length;

    // 新徽章稱號自動推薦（每次會話只檢查一次）
    if (!this._titleSuggestionChecked) {
      this._titleSuggestionChecked = true;
      setTimeout(() => this._checkTitleSuggestion(), 800);
    }
    this._markPageSnapshotReady?.('page-profile');
  },

  _getCurrentIdentitySettingsNormalized() {
    if (typeof IdentityResolver === 'undefined') return null;
    return IdentityResolver.normalizeSettings(ApiService.getCurrentIdentitySettings?.());
  },

  _canUseSecondaryIdentityFeature() {
    if (typeof ApiService === 'undefined' || typeof ApiService.canUseSecondaryIdentityFeature !== 'function') {
      return false;
    }
    return ApiService.canUseSecondaryIdentityFeature();
  },

  _syncSecondaryIdentityFeatureVisibility() {
    const card = document.getElementById('profile-identity-card');
    if (!card) return false;
    const allowed = this._canUseSecondaryIdentityFeature();
    card.hidden = !allowed;
    card.style.display = allowed ? '' : 'none';
    if (!allowed) this._identitySettingsEditing = false;
    return allowed;
  },

  _warnSecondaryIdentityPermissionDenied(input = null) {
    if (input) input.value = '';
    this._syncSecondaryIdentityFeatureVisibility();
    this.showToast('\u6c92\u6709\u7b2c\u4e8c\u8eab\u4efd\u6b0a\u9650');
  },

  _getIdentityFormValues() {
    const enabledEl = document.getElementById('profile-secondary-enabled');
    const nameEl = document.getElementById('profile-secondary-display-name');
    return {
      enabled: !!enabledEl?.checked,
      displayName: String(nameEl?.value || '').trim(),
    };
  },

  _isIdentityFormDirty() {
    const baseline = this._identityFormBaseline || null;
    if (!baseline) return false;
    const current = this._getIdentityFormValues();
    return current.enabled !== !!baseline.enabled
      || current.displayName !== String(baseline.displayName || '').trim();
  },

  _mergeSecondaryIdentityLocalCache(updates = {}) {
    try {
      if (typeof FirebaseService === 'undefined' || !FirebaseService?._cache) return null;
      const safeUpdates = { ...(updates || {}) };
      const draftName = String(document.getElementById('profile-secondary-display-name')?.value || '').trim();
      if (!Object.prototype.hasOwnProperty.call(safeUpdates, 'displayName') && draftName) {
        safeUpdates.displayName = draftName;
      }
      const current = this._getCurrentIdentitySettingsNormalized?.() || {
        profileActiveIdentityId: 'main',
        identities: { secondary: null },
      };
      const previousSecondary = current?.identities?.secondary || {};
      const next = {
        ...current,
        identities: {
          ...(current.identities || {}),
          secondary: {
            identityId: 'secondary',
            enabled: false,
            displayName: '',
            displayRoleLabel: '\u4e00\u822c\u4f7f\u7528\u8005',
            isPrimary: false,
            editable: true,
            ...previousSecondary,
            ...safeUpdates,
          },
        },
      };
      FirebaseService._cache.currentUserIdentitySettings = next;
      return next;
    } catch (_) {
      return null;
    }
  },

  _syncIdentityFormState() {
    if (!this._syncSecondaryIdentityFeatureVisibility()) return;
    const card = document.getElementById('profile-identity-card');
    const enabledEl = document.getElementById('profile-secondary-enabled');
    const nameEl = document.getElementById('profile-secondary-display-name');
    const summaryNameEl = document.getElementById('profile-secondary-summary-name');
    const summaryStatusEl = document.getElementById('profile-secondary-summary-status');
    const editBtn = document.getElementById('profile-identity-edit-btn');
    const { enabled, displayName } = this._getIdentityFormValues();
    const editing = !!this._identitySettingsEditing;
    const dirty = this._isIdentityFormDirty();
    const canEditDetails = !enabled && editing;
    const toggle = enabledEl?.closest?.('.profile-identity-toggle') || null;
    const uploadBtn = card?.querySelector?.('.profile-avatar-upload-btn') || null;
    const clearBtn = card?.querySelector?.('.profile-identity-actions button') || null;

    card?.classList.toggle('is-secondary-enabled', enabled);
    card?.classList.toggle('is-identity-editing', editing);
    card?.classList.toggle('is-identity-dirty', dirty);
    toggle?.classList.toggle('active', enabled);

    if (nameEl) nameEl.disabled = !canEditDetails;
    if (uploadBtn) {
      uploadBtn.classList.toggle('disabled', !canEditDetails);
      uploadBtn.setAttribute('aria-disabled', canEditDetails ? 'false' : 'true');
      uploadBtn.tabIndex = canEditDetails ? 0 : -1;
    }
    if (clearBtn) clearBtn.disabled = !canEditDetails;
    if (editBtn) {
      const saveMode = !enabled && editing;
      editBtn.textContent = saveMode ? '\u5132\u5b58' : '\u7de8\u8f2f';
      editBtn.classList.toggle('is-save-mode', saveMode);
    }
    if (summaryNameEl) {
      summaryNameEl.textContent = enabled
        ? this._getResolvedSecondaryDisplayName(displayName)
        : (displayName || '\u4f7f\u7528\u4e3b\u8eab\u4efd');
    }
    if (summaryStatusEl) {
      summaryStatusEl.innerHTML = enabled
        ? '\u76ee\u524d\u8eab\u4efd\u5df2\u555f\u7528<ul class="profile-identity-capability-list"><li>\u6d3b\u52d5\u7559\u8a00\u8207\u56de\u8986</li><li>\u7528\u6236\u8cc7\u6599\u5361\u7247</li><li>\u53f3\u4e0a\u89d2\u8207\u6211\u7684\u8cc7\u6599\u986f\u793a</li></ul>'
        : (dirty
          ? '\u6309\u5132\u5b58\u5f8c\u66f4\u65b0\u7b2c\u4e8c\u8eab\u4efd\u8cc7\u6599'
          : '\u555f\u7528\u5f8c\u6703\u76f4\u63a5\u4ee5\u7b2c\u4e8c\u8eab\u4efd\u986f\u793a');
    }
  },

  async handleSecondaryIdentityToggleChange() {
    const enabledEl = document.getElementById('profile-secondary-enabled');
    if (!this._canUseSecondaryIdentityFeature()) {
      if (enabledEl) enabledEl.checked = !!this._identityFormBaseline?.enabled;
      this._warnSecondaryIdentityPermissionDenied();
      return;
    }
    const previousEnabled = !!this._identityFormBaseline?.enabled;
    const { enabled } = this._getIdentityFormValues();
    this._identitySettingsEditing = false;
    if (enabledEl) enabledEl.disabled = true;
    this._syncIdentityFormState();
    const ok = await this.saveIdentitySettings({
      exitEdit: true,
      toastMessage: enabled ? '\u7b2c\u4e8c\u8eab\u4efd\u5df2\u555f\u7528' : '\u5df2\u6062\u5fa9\u4e3b\u8eab\u4efd\u986f\u793a',
    });
    if (!ok && enabledEl) {
      enabledEl.checked = previousEnabled;
    }
    if (enabledEl) enabledEl.disabled = false;
    this._syncIdentityFormState();
  },

  _getResolvedSecondaryDisplayName(value) {
    const text = String(value || '').trim();
    return text || '\u6b21\u8eab\u4efd';
  },

  _syncSecondaryIdentityInputValue(value, options = {}) {
    const nameEl = document.getElementById('profile-secondary-display-name');
    const resolved = this._getResolvedSecondaryDisplayName(value);
    if (nameEl && (options.force || document.activeElement !== nameEl)) {
      nameEl.value = resolved;
    }
    return resolved;
  },

  async toggleIdentitySettingsEdit() {
    if (!this._canUseSecondaryIdentityFeature()) {
      this._warnSecondaryIdentityPermissionDenied();
      return;
    }
    const { enabled } = this._getIdentityFormValues();
    if (enabled) {
      this.showToast('\u8acb\u5148\u95dc\u9589\u7b2c\u4e8c\u8eab\u4efd\u624d\u53ef\u4ee5\u7de8\u8f2f');
      return;
    }
    if (this._identitySettingsEditing || this._isIdentityFormDirty()) {
      await this.saveIdentitySettings({ exitEdit: true });
      return;
    }
    this._identitySettingsEditing = true;
    this._syncIdentityFormState();
    setTimeout(() => {
      try { document.getElementById('profile-secondary-display-name')?.focus(); } catch (_) {}
    }, 0);
  },

  renderIdentitySettings() {
    const card = document.getElementById('profile-identity-card');
    if (!card || typeof IdentityResolver === 'undefined') return;
    if (!this._syncSecondaryIdentityFeatureVisibility()) return;
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const settings = this._getCurrentIdentitySettingsNormalized();
    const secondary = settings?.identities?.secondary || null;
    const enabledEl = document.getElementById('profile-secondary-enabled');
    const nameEl = document.getElementById('profile-secondary-display-name');
    const preview = document.getElementById('profile-secondary-avatar-preview');

    const editing = !!this._identitySettingsEditing;
    const draftName = String(nameEl?.value || '').trim();
    const secondaryName = secondary?.displayName || '';
    const preserveDraft = editing && draftName && draftName !== secondaryName;

    if (enabledEl) enabledEl.checked = !!secondary?.enabled;
    if (nameEl && !preserveDraft && document.activeElement !== nameEl) nameEl.value = secondaryName;
    if (!editing || !this._identityFormBaseline) {
      this._identityFormBaseline = {
        enabled: !!secondary?.enabled,
        displayName: secondaryName,
      };
    }

    const previewName = (preserveDraft ? draftName : secondaryName) || nameEl?.value || '次身份';
    const previewUrl = secondary?.avatarUrl || '';
    this._setAvatarContent?.(preview, previewUrl, previewName, {
      fallbackClass: 'profile-identity-avatar',
      containerImageClass: 'profile-identity-avatar',
      candidateUrls: previewUrl ? [previewUrl] : [],
      identityCrown: true,
    });
    this._syncIdentityFormState();
  },

  async saveIdentitySettings(options = {}) {
    if (!this._canUseSecondaryIdentityFeature()) {
      this._warnSecondaryIdentityPermissionDenied();
      return false;
    }
    const enabledEl = document.getElementById('profile-secondary-enabled');
    const nameEl = document.getElementById('profile-secondary-display-name');
    const enabled = !!enabledEl?.checked;
    const displayName = this._getResolvedSecondaryDisplayName(nameEl?.value);
    if (displayName.length > 40) {
      this.showToast('次身份暱稱不能超過 40 字');
      return false;
    }

    const activeId = enabled ? 'secondary' : 'main';
    const secondary = {
      identityId: 'secondary',
      enabled,
      displayName,
      displayRoleLabel: '一般用戶',
      isPrimary: false,
      editable: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const previousSettings = this._getCurrentIdentitySettingsNormalized?.() || null;
    const previousBaseline = this._identityFormBaseline ? { ...this._identityFormBaseline } : null;
    const previousEditing = !!this._identitySettingsEditing;

    try {
      this._mergeSecondaryIdentityLocalCache(secondary);
      if (typeof FirebaseService !== 'undefined' && FirebaseService?._cache?.currentUserIdentitySettings) {
        FirebaseService._cache.currentUserIdentitySettings.profileActiveIdentityId = activeId;
      }
      this._identityFormBaseline = { enabled, displayName };
      this._syncSecondaryIdentityInputValue(displayName, { force: true });
      this._identitySettingsEditing = options.exitEdit !== false ? false : !!this._identitySettingsEditing;
      this.renderLoginUI?.();
      if (this.currentPage === 'page-profile') {
        this.renderProfileData?.();
      } else {
        this._syncIdentityFormState();
      }
      await ApiService.updateCurrentIdentitySettings({
        profileActiveIdentityId: activeId,
        identities: { secondary },
      });
      this.showToast(options.toastMessage || '第二身份已儲存');
      return true;
    } catch (err) {
      console.error('[saveIdentitySettings]', err);
      if (typeof FirebaseService !== 'undefined' && FirebaseService?._cache) {
        FirebaseService._cache.currentUserIdentitySettings = previousSettings;
      }
      this._identityFormBaseline = previousBaseline;
      this._identitySettingsEditing = previousEditing;
      this.renderLoginUI?.();
      if (this.currentPage === 'page-profile') {
        this.renderProfileData?.();
      } else {
        this._syncIdentityFormState();
      }
      this.showToast('第二身份儲存失敗');
      return false;
    }
  },

  _cropSecondaryIdentityAvatarFile(file) {
    return new Promise((resolve, reject) => {
      (async () => {
        if (typeof this.showImageCropper !== 'function' || typeof this._readImageFileAsDataURL !== 'function') {
          resolve(await this._compressImage(file, 512, 0.88, 'image/webp'));
          return;
        }
        const sourceDataURL = await this._readImageFileAsDataURL(file);
        this.showImageCropper(sourceDataURL, {
          aspectRatio: 1,
          outputWidth: 512,
          outputHeight: 512,
          outputType: 'image/webp',
          quality: 0.88,
          title: '次身份頭像',
          subtitle: '拖曳調整位置，使用滑桿或滾輪放大縮小',
          targetLabel: '次身份頭像',
          recommendedSize: '512 x 512',
          aspectLabel: '1:1',
          confirmText: '使用此頭像',
          onConfirm: (dataURL) => resolve(dataURL),
          onCancel: () => resolve(null),
        });
      })().catch(reject);
    });
  },

  async uploadSecondaryIdentityAvatar(input) {
    if (!this._canUseSecondaryIdentityFeature()) {
      this._warnSecondaryIdentityPermissionDenied(input);
      return;
    }
    const { enabled } = this._getIdentityFormValues();
    if (enabled) {
      this.showToast('\u8acb\u5148\u95dc\u9589\u7b2c\u4e8c\u8eab\u4efd\u624d\u53ef\u4ee5\u7de8\u8f2f');
      if (input) input.value = '';
      return;
    }
    const file = input?.files?.[0] || null;
    if (!file) return;
    if (!this._isAllowedImageFile?.(file)) {
      this.showToast('請上傳 JPG / PNG / WebP 圖片');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('圖片太大，不能超過 5MB');
      input.value = '';
      return;
    }
    try {
      const dataUrl = await this._cropSecondaryIdentityAvatarFile(file);
      if (!dataUrl) return;
      const avatarUrl = await ApiService.uploadSecondaryIdentityAvatar(dataUrl);
      if (!avatarUrl) return;
      this._mergeSecondaryIdentityLocalCache({ avatarUrl });
      const preview = document.getElementById('profile-secondary-avatar-preview');
      const name = document.getElementById('profile-secondary-display-name')?.value || '次身份';
      this._setAvatarContent?.(preview, avatarUrl, name, {
        fallbackClass: 'profile-identity-avatar',
        containerImageClass: 'profile-identity-avatar',
        candidateUrls: [avatarUrl],
        identityCrown: true,
      });
      this.renderLoginUI?.();
      this.showToast('次身份頭像已更新');
    } catch (err) {
      console.error('[uploadSecondaryIdentityAvatar]', err);
      this.showToast('次身份頭像更新失敗');
    } finally {
      if (input) input.value = '';
    }
  },

  async clearSecondaryIdentityAvatar() {
    if (!this._canUseSecondaryIdentityFeature()) {
      this._warnSecondaryIdentityPermissionDenied();
      return;
    }
    const { enabled } = this._getIdentityFormValues();
    if (enabled) {
      this.showToast('\u8acb\u5148\u95dc\u9589\u7b2c\u4e8c\u8eab\u4efd\u624d\u53ef\u4ee5\u7de8\u8f2f');
      return;
    }
    try {
      await ApiService.clearSecondaryIdentityAvatar();
      this._mergeSecondaryIdentityLocalCache({
        avatarUrl: '',
        avatarStoragePath: '',
        avatarStorageBucket: '',
      });
      const preview = document.getElementById('profile-secondary-avatar-preview');
      const name = document.getElementById('profile-secondary-display-name')?.value || '次身份';
      this._setAvatarContent?.(preview, '', name, {
        fallbackClass: 'profile-identity-avatar',
        containerImageClass: 'profile-identity-avatar',
        candidateUrls: [],
        identityCrown: true,
      });
      this.renderLoginUI?.();
      this.showToast('次身份頭像已清除');
    } catch (err) {
      console.error('[clearSecondaryIdentityAvatar]', err);
      this.showToast('次身份頭像清除失敗');
    }
  },

  toggleProfileEdit() {
    const display = document.getElementById('profile-info-display');
    const edit = document.getElementById('profile-info-edit');
    const btn = document.getElementById('profile-edit-btn');
    if (!display || !edit) return;
    const isEditing = edit.style.display !== 'none';
    if (isEditing) {
      // 關閉編輯
      display.style.display = '';
      edit.style.display = 'none';
      if (btn) btn.textContent = '編輯';
    } else {
      // 開啟編輯，預填現有值
      const user = ApiService.getCurrentUser();
      const genderInput = document.getElementById('profile-edit-gender');
      const regionInput = document.getElementById('profile-edit-region');
      const phoneInput = document.getElementById('profile-edit-phone');
      if (genderInput) genderInput.value = (user && user.gender) || '';
      this._populateBirthdaySelects?.('profile-edit-birthday-y', 'profile-edit-birthday-m', 'profile-edit-birthday-d', user?.birthday || '');
      if (regionInput) regionInput.value = (user && user.region) || '';
      if (phoneInput) phoneInput.value = (user && user.phone) || '';
      display.style.display = 'none';
      edit.style.display = '';
      if (btn) btn.textContent = '取消';
    }
  },

  /** 個人資料地區模糊搜尋（DOM + event delegation，相容 LINE WebView） */
  _filterProfileRegion(keyword) {
    var list = document.getElementById('profile-region-list');
    if (!list) return;
    var q = String(keyword || '').trim().replace(/\u81FA/g, '\u53F0');
    var matched = (typeof filterTwRegions === 'function') ? filterTwRegions(keyword, true) : [];
    list.innerHTML = '';
    if (!matched.length) {
      list.style.display = 'none';
      return;
    }
    matched.forEach(function(name) {
      var item = document.createElement('div');
      item.textContent = name;
      item.setAttribute('data-region', name);
      item.style.cssText = 'padding:6px 10px;font-size:.78rem;border-bottom:1px solid var(--border);cursor:pointer';
      list.appendChild(item);
    });
    list.style.display = '';
  },

  _selectProfileRegion(e) {
    var region = e.target.getAttribute('data-region');
    if (!region) return;
    var input = document.getElementById('profile-edit-region');
    if (input) input.value = region;
    var list = document.getElementById('profile-region-list');
    if (list) { list.innerHTML = ''; list.style.display = 'none'; }
  },

  saveProfileInfo() {
    const genderInput = document.getElementById('profile-edit-gender');
    const regionInput = document.getElementById('profile-edit-region');
    const phoneInput = document.getElementById('profile-edit-phone');
    const regions = typeof TW_REGIONS !== 'undefined' ? TW_REGIONS : [];
    const updates = {};
    if (genderInput) updates.gender = genderInput.value || null;
    const bdVal = this._getBirthdayFromSelects?.('profile-edit-birthday-y', 'profile-edit-birthday-m', 'profile-edit-birthday-d') || '';
    if (bdVal) {
      updates.birthday = bdVal;
    }
    const regionVal = regionInput ? regionInput.value.trim() : '';
    if (regionVal && regions.length && !regions.includes(regionVal)) {
      this.showToast('請從 22 縣市中選擇有效地區');
      return;
    }
    if (regionInput) updates.region = regionVal || null;
    if (phoneInput) updates.phone = phoneInput.value.trim() || null;
    const updatedUser = ApiService.updateCurrentUser(updates);
    if (updatedUser) {
      this._pendingFirstLogin = !['gender', 'birthday', 'region'].every(key => String(updatedUser[key] || '').trim());
    }
    this.toggleProfileEdit();
    this.renderProfileData();
    this._refreshActivityCreateButton?.();
    this.showToast('個人資料已更新');
  },

  /** 收折切換：展開時 lazy load 對應區塊 */
  toggleProfileSection(labelEl, section) {
    const isOpen = labelEl.classList.toggle('open');
    const content = labelEl.nextElementSibling;
    if (!content) return;
    content.style.display = isOpen ? '' : 'none';
    if (isOpen) {
      if (section === 'favorites') this.renderProfileFavorites();
      if (section === 'applications') this._renderMyApplications();
      if (section === 'companions') this.renderCompanions();
      if (section === 'records') this.renderActivityRecords('all');
      if (section === 'registeredActivities' || section === 'hostedActivities') {
        this.renderProfileRelatedActivities?.();
      }
    }
  },

  /** 輕量判斷：有無俱樂部申請 → 控制卡片顯示 + badge */
  _showApplicationsCard() {
    const card = document.getElementById('profile-applications-card');
    if (!card) return;
    const count = this._getMyLatestTeamApplications().length;
    if (!count) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = count;
    // 重置收折狀態
    const toggle = card.querySelector('.profile-collapse-toggle');
    const content = document.getElementById('profile-applications-list');
    if (toggle) toggle.classList.remove('open');
    if (content) content.style.display = 'none';
  },

});
