/* ================================================
   ToosterX User Admin: Individual Permission Grants
   ================================================ */

Object.assign(App, {
  _userPermissionGrantSelectedUid: '',
  _userPermissionGrantSelectedUser: null,
  _userPermissionGrantDoc: null,
  _userPermissionGrantLoading: false,
  _userPermissionGrantShowCheckedOnly: false,

  _canManageUserPermissionGrants() {
    return (ROLE_LEVEL_MAP[this.currentRole] || 0) >= (ROLE_LEVEL_MAP.super_admin || 999);
  },

  _getUserPermissionGrantUid(user) {
    return String(user?.uid || user?.lineUserId || user?._docId || '').trim();
  },

  _getUserPermissionGrantLabel(user) {
    const uid = this._getUserPermissionGrantUid(user);
    return String(this._displayNameOrUidFallback?.(user?.name || user?.displayName, uid, '') || uid || '未命名用戶').trim();
  },

  _escapeUserPermissionGrantArg(value) {
    if (typeof this._escapeAdminUserArg === 'function') return this._escapeAdminUserArg(value);
    return escapeHTML(String(value || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },

  _getUserPermissionGrantAllowedSet() {
    const codes = typeof getUserPermissionGrantAllowedCodes === 'function'
      ? getUserPermissionGrantAllowedCodes()
      : getAllPermissionCodes(ApiService.getPermissions?.() || []);
    return new Set(codes || []);
  },

  _getUserPermissionGrantCatalog() {
    const allowed = this._getUserPermissionGrantAllowedSet();
    return (ApiService.getPermissions?.() || [])
      .map(category => {
        const items = (category.items || []).filter(item => item?.code && allowed.has(item.code));
        return { cat: category.cat, items };
      })
      .filter(category => category.items.length > 0);
  },

  _filterUserPermissionGrantUsers(query) {
    const q = String(query || '').trim().toLowerCase();
    const users = ApiService.getAdminUsers?.() || [];
    return users
      .filter(user => {
        const uid = this._getUserPermissionGrantUid(user);
        if (!uid) return false;
        if (!q) return true;
        const haystack = [user?.name, user?.displayName, uid, user?.lineUserId, user?._docId]
          .map(value => String(value || '').toLowerCase())
          .join(' ');
        return haystack.includes(q);
      })
      .sort((a, b) => this._getUserPermissionGrantLabel(a).localeCompare(this._getUserPermissionGrantLabel(b), 'zh-Hant'))
      .slice(0, 25);
  },

  async renderUserPermissionGrantShell() {
    if (typeof FirebaseService !== 'undefined' && FirebaseService.ensureStaticCollectionsLoaded) {
      await FirebaseService.ensureStaticCollectionsLoaded(['permissions', 'customRoles']).catch(() => {});
    }
    this.renderUserPermissionGrantSearchResults();
    this.renderUserPermissionGrantEditor();
  },

  filterUserPermissionGrantUsers() {
    this.renderUserPermissionGrantSearchResults();
  },

  renderUserPermissionGrantSearchResults() {
    const host = document.getElementById('user-permission-grant-results');
    if (!host) return;
    const query = document.getElementById('user-permission-grant-search')?.value || '';
    const users = this._filterUserPermissionGrantUsers(query);
    if (!users.length) {
      host.innerHTML = '<div class="permission-audit-empty">找不到符合的用戶</div>';
      return;
    }
    host.innerHTML = users.map(user => {
      const uid = this._getUserPermissionGrantUid(user);
      const label = this._getUserPermissionGrantLabel(user);
      const roleLabel = (typeof ROLES !== 'undefined' && ROLES[user?.role]?.label) || user?.role || 'user';
      const selected = uid === this._userPermissionGrantSelectedUid;
      const safeUid = this._escapeUserPermissionGrantArg(uid);
      return '<button type="button" class="permission-audit-issue ' + (selected ? 'is-selected' : '') + '" style="width:100%;text-align:left" onclick="App.selectUserPermissionGrantUser(\'' + safeUid + '\')">'
        + '<span class="permission-audit-badge ' + (selected ? 'ok' : 'neutral') + '">' + escapeHTML(roleLabel) + '</span>'
        + '<div><div class="permission-audit-issue-title">' + escapeHTML(label) + '</div>'
        + '<div class="permission-audit-issue-detail permission-audit-code">' + escapeHTML(uid) + '</div></div>'
        + '</button>';
    }).join('');
  },

  async selectUserPermissionGrantUser(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return;
    const users = ApiService.getAdminUsers?.() || [];
    const user = users.find(item => this._getUserPermissionGrantUid(item) === safeUid) || { uid: safeUid };
    this._userPermissionGrantSelectedUid = safeUid;
    this._userPermissionGrantSelectedUser = user;
    this._userPermissionGrantDoc = null;
    this._userPermissionGrantLoading = true;
    this.renderUserPermissionGrantSearchResults();
    this.renderUserPermissionGrantEditor();
    try {
      const grant = await ApiService.getUserPermissionGrant?.(safeUid);
      this._userPermissionGrantDoc = this._normalizeUserPermissionGrantDoc(safeUid, grant);
    } catch (err) {
      console.error('[selectUserPermissionGrantUser]', err);
      this._userPermissionGrantDoc = this._normalizeUserPermissionGrantDoc(safeUid, null);
      this.showToast('個別授權讀取失敗');
    } finally {
      this._userPermissionGrantLoading = false;
      this.renderUserPermissionGrantEditor();
    }
  },

  _normalizeUserPermissionGrantDoc(uid, grant) {
    const permissions = typeof sanitizeUserPermissionGrantCodeList === 'function'
      ? sanitizeUserPermissionGrantCodeList(grant?.permissions || [])
      : sanitizePermissionCodeList(grant?.permissions || []);
    return {
      uid,
      permissions,
      exists: !!grant?.exists,
      enabled: grant?.exists ? grant.enabled !== false : grant?.enabled === true,
      updatedAt: grant?.updatedAt || null,
    };
  },

  renderUserPermissionGrantEditor() {
    const host = document.getElementById('user-permission-grant-editor');
    if (!host) return;
    if (!this._userPermissionGrantSelectedUid) {
      host.innerHTML = '<div class="permission-audit-empty">請先搜尋並選擇用戶。</div>';
      return;
    }
    if (this._userPermissionGrantLoading) {
      host.innerHTML = '<div class="permission-audit-empty">讀取個別授權中...</div>';
      return;
    }
    const grant = this._userPermissionGrantDoc || this._normalizeUserPermissionGrantDoc(this._userPermissionGrantSelectedUid, null);
    const user = this._userPermissionGrantSelectedUser || { uid: this._userPermissionGrantSelectedUid };
    const label = this._getUserPermissionGrantLabel(user);
    const uid = this._userPermissionGrantSelectedUid;
    const checked = grant.enabled !== false;
    const disabledAttr = this._canManageUserPermissionGrants() ? '' : ' disabled';
    host.innerHTML = '<div class="permission-audit-section">'
      + '<div class="permission-audit-section-title"><span>' + escapeHTML(label) + '</span><span class="permission-audit-section-meta permission-audit-code">' + escapeHTML(uid) + '</span></div>'
      + '<div class="perm-item">'
      + '<span class="perm-item-label">啟用此用戶的個別授權</span>'
      + '<label class="toggle-switch ' + (checked ? 'active' : '') + '">'
      + '<input type="checkbox" ' + (checked ? 'checked' : '') + disabledAttr + ' onchange="App.toggleUserPermissionGrantEnabled()">'
      + '<span class="toggle-slider"></span></label></div>'
      + '<div class="role-perm-toolbar"><button class="text-btn role-perm-filter-btn ' + (this._userPermissionGrantShowCheckedOnly ? 'active' : '') + '" type="button" onclick="App.toggleUserPermissionGrantShowCheckedOnly()">' + (this._userPermissionGrantShowCheckedOnly ? '顯示全部權限' : '只顯示已開啟') + '</button></div>'
      + '<div class="permissions-list">' + this._renderUserPermissionGrantPermissionList(grant, disabledAttr) + '</div>'
      + '</div>';
  },

  _renderUserPermissionGrantPermissionList(grant, disabledAttr) {
    const current = new Set(grant.permissions || []);
    let categories = this._getUserPermissionGrantCatalog().map(category => {
      let entryItem = null;
      const subItems = [];
      category.items.forEach(item => {
        if (!entryItem && item.code.endsWith('.entry')) entryItem = item;
        else subItems.push(item);
      });
      return { cat: category.cat, entryItem, subItems };
    });
    if (this._userPermissionGrantShowCheckedOnly) {
      categories = categories
        .map(category => ({
          cat: category.cat,
          entryItem: category.entryItem && current.has(category.entryItem.code) ? category.entryItem : null,
          subItems: category.subItems.filter(item => current.has(item.code)),
        }))
        .filter(category => category.entryItem || category.subItems.length > 0);
    }
    if (!categories.length) return '<div style="padding:.75rem .3rem;color:var(--text-muted);font-size:.78rem">目前沒有符合篩選條件的權限。</div>';
    return categories.map(category => {
      const entryToggle = category.entryItem ? this._renderUserPermissionGrantToggle(category.entryItem, current, disabledAttr, true) : '';
      const subHtml = category.subItems.map(item => '<div class="perm-item"><span class="perm-item-label">' + escapeHTML(item.name) + '<button class="perm-info-btn" onclick="event.stopPropagation();App._showPermInfoPopup(\'' + item.code + '\')" title="說明">?</button></span>' + this._renderUserPermissionGrantToggle(item, current, disabledAttr) + '</div>').join('');
      const info = category.entryItem ? '<button class="perm-info-btn" onclick="event.stopPropagation();App._showPermInfoPopup(\'' + category.entryItem.code + '\')" title="說明">?</button>' : '';
      return '<div class="perm-category ' + (category.subItems.length ? '' : 'no-sub') + '">'
        + '<div class="perm-category-title" onclick="' + (category.subItems.length ? "this.parentElement.classList.toggle('collapsed')" : '') + '">'
        + '<span class="perm-cat-name">' + escapeHTML(category.cat) + info + '</span>' + entryToggle + '</div>'
        + (category.subItems.length ? '<div class="perm-items">' + subHtml + '</div>' : '')
        + '</div>';
    }).join('');
  },

  _renderUserPermissionGrantToggle(item, current, disabledAttr, isEntry = false) {
    const checked = current.has(item.code);
    return '<label class="toggle-switch ' + (checked ? 'active' : '') + '"' + (isEntry ? ' onclick="event.stopPropagation()"' : '') + '>'
      + '<input type="checkbox" ' + (checked ? 'checked' : '') + disabledAttr + ' onchange="App.toggleUserPermissionGrantCode(\'' + item.code + '\')">'
      + '<span class="toggle-slider"></span></label>';
  },

  toggleUserPermissionGrantShowCheckedOnly() {
    this._userPermissionGrantShowCheckedOnly = !this._userPermissionGrantShowCheckedOnly;
    this.renderUserPermissionGrantEditor();
  },

  async toggleUserPermissionGrantEnabled() {
    const grant = this._userPermissionGrantDoc;
    if (!grant) return;
    await this._saveUserPermissionGrant({ ...grant, enabled: grant.enabled === false });
  },

  async toggleUserPermissionGrantCode(code) {
    const grant = this._userPermissionGrantDoc;
    if (!grant) return;
    const allowed = this._getUserPermissionGrantAllowedSet();
    if (!allowed.has(code)) return;
    const next = new Set(grant.permissions || []);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    await this._saveUserPermissionGrant({ ...grant, enabled: true, permissions: Array.from(next), changedPermission: code });
  },

  async _saveUserPermissionGrant(nextGrant) {
    if (!this._canManageUserPermissionGrants()) {
      this.showToast('權限不足');
      this.renderUserPermissionGrantEditor();
      return;
    }
    const uid = this._userPermissionGrantSelectedUid;
    const prev = this._userPermissionGrantDoc || this._normalizeUserPermissionGrantDoc(uid, null);
    const sanitized = typeof sanitizeUserPermissionGrantCodeList === 'function'
      ? sanitizeUserPermissionGrantCodeList(nextGrant.permissions || [])
      : sanitizePermissionCodeList(nextGrant.permissions || []);
    this._userPermissionGrantDoc = { ...nextGrant, uid, permissions: sanitized, enabled: nextGrant.enabled !== false };
    this.renderUserPermissionGrantEditor();
    try {
      const saved = await ApiService.saveUserPermissionGrant(uid, {
        permissions: sanitized,
        enabled: this._userPermissionGrantDoc.enabled,
        targetName: this._getUserPermissionGrantLabel(this._userPermissionGrantSelectedUser),
        previousPermissions: prev.permissions || [],
        previousEnabled: prev.enabled !== false,
        changedPermission: nextGrant.changedPermission || '',
      });
      this._userPermissionGrantDoc = this._normalizeUserPermissionGrantDoc(uid, saved);
      this.renderUserPermissionGrantEditor();
      this.showToast('個別授權已更新');
    } catch (err) {
      this._userPermissionGrantDoc = prev;
      console.error('[saveUserPermissionGrant]', err);
      this.renderUserPermissionGrantEditor();
      this.showToast('個別授權更新失敗');
    }
  },
});