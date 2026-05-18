/* ================================================
   SportHub — User Admin: List, Search, Edit
   ================================================ */

Object.assign(App, {

  // ─── 用戶列表: 當前篩選狀態 ───
  _userEditTarget: null,
  // 2026-04-27：分頁渲染（避免 iOS PWA 模式 WKWebView memory pressure 觸發 OS kill webview）
  _adminUserPageSize: 30,

  _hasUserAdminCapability(code) {
    return !!this.hasPermission?.(code);
  },

  _canEditUserProfile() {
    return this._hasUserAdminCapability('admin.users.edit_profile');
  },

  _canChangeUserRole() {
    return this._hasUserAdminCapability('admin.users.change_role');
  },

  _canRestrictUser() {
    return this._hasUserAdminCapability('admin.users.restrict');
  },

  _canManageTargetSuperAdmin(user) {
    if (!user) return false;
    return this.currentRole === 'super_admin' || user.role !== 'super_admin';
  },

  _canOpenUserEditor(user) {
    return this._canManageTargetSuperAdmin(user)
      && (this._canEditUserProfile() || this._canChangeUserRole());
  },

  _canToggleUserRestrictionFor(user) {
    return this._canRestrictUser()
      && this._canManageTargetSuperAdmin(user)
      && user?.role === 'user';
  },

  _getAssignableRoleKeys() {
    const allRoleKeys = getRuntimeRoleSequence();
    if (this.currentRole === 'super_admin') {
      return allRoleKeys;
    }
    return allRoleKeys.filter(roleKey => (ROLE_LEVEL_MAP[roleKey] || 0) < ROLE_LEVEL_MAP.super_admin);
  },

  _getAdminUserKey(user) {
    return String(user?._docId || user?.uid || user?.lineUserId || user?.name || '').trim();
  },

  _getAdminUserLabel(user) {
    return String(user?.name || user?.displayName || user?.uid || user?._docId || '').trim();
  },

  _escapeAdminUserArg(value) {
    return escapeHTML(String(value || '')).replace(/'/g, "\\'");
  },

  _findAdminUserByKey(userKey) {
    const key = String(userKey || '').trim();
    if (!key) return null;
    const users = ApiService.getAdminUsers?.() || [];
    return users.find(u => String(u?._docId || '').trim() === key)
      || users.find(u => String(u?.uid || '').trim() === key)
      || users.find(u => String(u?.lineUserId || '').trim() === key)
      || users.find(u => String(u?.name || '').trim() === key)
      || null;
  },

  _findAdminUserByEditTarget() {
    const target = this._userEditTarget;
    if (!target) return null;
    if (typeof target === 'string') return this._findAdminUserByKey(target);
    return this._findAdminUserByKey(target.key)
      || this._findAdminUserByKey(target.docId)
      || this._findAdminUserByKey(target.uid)
      || this._findAdminUserByKey(target.name);
  },

  _setSelectValuePreservingUnknown(fieldId, value) {
    const select = document.getElementById(fieldId);
    if (!select) return;
    Array.from(select.querySelectorAll('option[data-admin-preserved-value="1"]')).forEach(option => option.remove());
    const raw = String(value ?? '').trim();
    if (!raw) {
      select.value = '';
      return;
    }

    const exists = Array.from(select.options || []).some(option => option.value === raw);
    if (!exists) {
      const option = document.createElement('option');
      option.value = raw;
      option.textContent = `目前值：${raw}`;
      option.dataset.adminPreservedValue = '1';
      const insertBefore = select.options?.[1] || null;
      select.insertBefore(option, insertBefore);
    }
    select.value = raw;
  },

  _normalizeUserEditBirthday(value) {
    if (!value) return '';
    try {
      const raw = typeof value?.toDate === 'function'
        ? value.toDate()
        : (value?.seconds ? new Date(value.seconds * 1000) : value);
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        const y = raw.getFullYear();
        const m = String(raw.getMonth() + 1).padStart(2, '0');
        const d = String(raw.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch (_) {}
    return String(value).replace(/\//g, '-').slice(0, 10);
  },

  _setUpdateIfChanged(updates, user, field, nextValue) {
    const oldValue = user?.[field];
    const oldText = oldValue == null ? '' : String(oldValue);
    const nextText = nextValue == null ? '' : String(nextValue);
    if (oldText !== nextText) {
      updates[field] = nextValue;
    }
  },

  _renderUserRoleSelectOptions(currentRole) {
    const select = document.getElementById('ue-role');
    if (!select) return;
    const options = this._getAssignableRoleKeys()
      .map(roleKey => {
        const roleInfo = ROLES[roleKey];
        const label = roleInfo?.label || roleKey;
        const selected = roleKey === currentRole ? ' selected' : '';
        return `<option value="${escapeHTML(roleKey)}"${selected}>${escapeHTML(label)}</option>`;
      });
    if (!options.length) {
      const roleInfo = ROLES[currentRole];
      const label = roleInfo?.label || currentRole || 'user';
      select.innerHTML = `<option value="${escapeHTML(currentRole || 'user')}">${escapeHTML(label)}</option>`;
      return;
    }
    select.innerHTML = options.join('');
  },

  _applyUserEditFieldPermissions(user) {
    const canEditProfile = this._canEditUserProfile() && this._canManageTargetSuperAdmin(user);
    const canChangeRole = this._canChangeUserRole() && this._canManageTargetSuperAdmin(user);
    const roleSelect = document.getElementById('ue-role');
    const profileFieldIds = ['ue-region', 'ue-gender', 'ue-birthday', 'ue-sports', 'ue-phone', 'ue-email'];

    this._renderUserRoleSelectOptions(user?.role || 'user');
    if (roleSelect) {
      roleSelect.disabled = !canChangeRole;
      if (!canChangeRole) {
        roleSelect.value = user?.role || 'user';
      }
    }

    profileFieldIds.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (!field) return;
      field.disabled = !canEditProfile;
    });
  },

  // ─── Step 1: 搜尋與篩選 ───
  filterAdminUsers() {
    const keyword = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
    const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';

    let users = ApiService.getAdminUsers();

    if (keyword) {
      users = users.filter(u => {
        const name = String(u?.name || u?.displayName || '').toLowerCase();
        const uid = String(u?.uid || u?.lineUserId || u?._docId || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        return name.includes(keyword) || uid.includes(keyword) || email.includes(keyword);
      });
    }
    if (roleFilter) {
      users = users.filter(u => u.role === roleFilter);
    }

    // 篩選/搜尋時 reset 分頁、避免「載入更多到 90 個 → 篩選後仍渲染 90 個」誤判
    this._adminUserPageSize = 30;
    this.renderAdminUsers(users);
  },

  /** 2026-04-27：載入更多用戶（分頁機制、避免 iOS PWA memory pressure） */
  _loadMoreAdminUsers() {
    this._adminUserPageSize = (this._adminUserPageSize || 30) + 30;
    // 重新讀篩選後的結果但**不**走 filterAdminUsers（避免 reset pageSize）
    const keyword = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
    const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';
    let users = ApiService.getAdminUsers();
    if (keyword) {
      users = users.filter(u => {
        const name = String(u?.name || u?.displayName || '').toLowerCase();
        const uid = String(u?.uid || u?.lineUserId || u?._docId || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        return name.includes(keyword) || uid.includes(keyword) || email.includes(keyword);
      });
    }
    if (roleFilter) users = users.filter(u => u.role === roleFilter);
    this.renderAdminUsers(users);
  },

  // ─── Step 2: 用戶列表渲染（可接收篩選後的 users） ───
  renderAdminUsers(users) {
    const container = document.getElementById('admin-user-list');
    if (!container) return;

    if (!users) users = ApiService.getAdminUsers();
    users = [...users].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (users.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">找不到符合條件的使用者</div>';
      return;
    }

    // 2026-04-27：分頁渲染避免 iOS PWA WKWebView memory pressure 觸發 OS kill webview
    const totalCount = users.length;
    const pageSize = this._adminUserPageSize || 30;
    const visibleUsers = users.slice(0, pageSize);
    const hasMore = totalCount > pageSize;

    const cardsHtml = visibleUsers.map(u => {
      const avatar = this._buildAvatarImageMarkup(
        u.pictureUrl,
        u.name || '?',
        'au-avatar',
        'au-avatar au-avatar-fallback',
        'loading="lazy" decoding="async" style="object-fit:cover"'
      );

      const teamInfo = u.teamName ? ` ・${escapeHTML(u.teamName)}` : '';
      const genderIcon = u.gender === '男' ? '♂' : u.gender === '女' ? '♀' : '';
      const safeName = escapeHTML(u.name || '').replace(/'/g, "\\'");
      const safeUserKey = this._escapeAdminUserArg(this._getAdminUserKey(u));
      const emailText = String(u.email || '').trim();
      const canEditThisUser = this._canOpenUserEditor(u);
      const isRestricted = !!u.isRestricted;
      const restrictBtnHtml = this._canToggleUserRestrictionFor(u)
        ? `<button class="au-btn ${isRestricted ? 'au-btn-view' : 'au-btn-edit'}" onclick="App.toggleUserRestriction('${safeUserKey}')">${isRestricted ? '解除限制' : '限制'}</button>`
        : '';

      return `
        <div class="admin-user-card">
          ${avatar}
          <div class="admin-user-body">
            <div class="admin-user-info">
              <div class="admin-user-name">${this._userTag(u.name, u.role, { uid: u.uid || '' })}</div>
              <div class="admin-user-meta">${escapeHTML(u.uid)} ・${ROLES[u.role]?.label || u.role} ・Lv.${App._calcLevelFromExp(u.exp || 0).level} ・${escapeHTML(u.region || '—')}${genderIcon ? ' ' + genderIcon : ''}${teamInfo}</div>
              <div class="admin-user-meta">${escapeHTML(u.sports || '—')} ・EXP ${(u.exp || 0).toLocaleString()}</div>
              <div class="admin-user-meta" style="word-break:break-all">Email：${escapeHTML(emailText || '—')}</div>
              <div class="admin-user-meta">限制狀態：${isRestricted ? '限制中' : '正常'}</div>
              <div class="admin-user-meta" style="word-break:break-all">最後登入：${this._formatLastLoginMeta(u)}</div>
            </div>
            <div class="admin-user-actions">
              ${canEditThisUser && u.role !== 'super_admin' ? `<button class="au-btn au-btn-edit" onclick="App.showUserEditModal('${safeUserKey}')">編輯</button>` : ''}
              <button class="au-btn au-btn-view" onclick="App.showUserProfile('${safeName}',{uid:'${escapeHTML(u.uid || '')}'})">查看</button>
              ${restrictBtnHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 2026-04-27：「載入更多」按鈕（仍有未渲染的用戶時顯示）
    const loadMoreHtml = hasMore
      ? `<div style="padding:1rem 0;text-align:center"><button class="outline-btn" style="font-size:.85rem;padding:.55rem 1.5rem" onclick="App._loadMoreAdminUsers()">載入更多（已顯示 ${pageSize} / ${totalCount}）</button></div>`
      : '';

    container.innerHTML = cardsHtml + loadMoreHtml;
    this._bindAvatarFallbacks(container);
  },
  async toggleUserRestriction(userKey) {
    if (!this._canRestrictUser()) {
      this.showToast('只有 super_admin 可操作');
      return;
    }

    const user = this._findAdminUserByKey(userKey);
    if (!user) {
      this.showToast('找不到使用者');
      return;
    }
    const name = this._getAdminUserLabel(user);
    if (!this._canToggleUserRestrictionFor(user)) {
      this.showToast('目前僅支援限制一般 user');
      return;
    }

    const me = ApiService.getCurrentUser?.();
    if (me && user.uid && me.uid === user.uid) {
      this.showToast('不可限制自己');
      return;
    }

    const nextRestricted = !user.isRestricted;
    const actionLabel = nextRestricted ? '限制' : '解除限制';
    const ok = await this.appConfirm(`確定要${actionLabel}「${name}」嗎？`);
    if (!ok) return;

    const updates = nextRestricted
      ? {
          isRestricted: true,
          restrictedAt: new Date().toISOString(),
          restrictedByUid: me?.uid || null,
          restrictedByName: me?.displayName || me?.name || null,
        }
      : {
          isRestricted: false,
          restrictedAt: null,
          restrictedByUid: null,
          restrictedByName: null,
        };

    try {
      await ApiService.updateAdminUser(this._getAdminUserKey(user), updates);
    } catch (err) {
      console.error('[toggleUserRestriction]', err);
      this.filterAdminUsers();
      this.showToast(`${actionLabel}失敗，請稍後再試`);
      return;
    }

    void ApiService.writeAuditLog({
      action: 'admin_user_edit',
      targetType: 'user',
      targetId: user.uid || '',
      targetLabel: user.name || name,
      result: 'success',
      source: 'web',
      meta: {
        statusFrom: nextRestricted ? 'active' : 'restricted',
        statusTo: nextRestricted ? 'restricted' : 'active',
      },
    });
    this.filterAdminUsers();
    this.showToast(nextRestricted ? '已限制使用者' : '已解除限制');
  },

  async handlePromote(select, userKey) {
    if (!this._canChangeUserRole()) {
      this.showToast('權限不足'); return;
    }
    if (!select.value) return;
    const roleMap = { '管理員': 'admin', '教練': 'coach', '領隊': 'captain', '場主': 'venue_owner' };
    const roleKey = roleMap[select.value];
    if (!roleKey) return;
    const user = this._findAdminUserByKey(userKey);
    if (!user) {
      this.showToast('找不到使用者');
      select.value = '';
      return;
    }
    const name = this._getAdminUserLabel(user);
    const oldRole = user?.role || '';
    try {
    // 後台手動晉升 → 同步設定 manualRole 底線
      await ApiService.updateAdminUser(this._getAdminUserKey(user), { role: roleKey, manualRole: roleKey });
    } catch (err) {
      console.error('[handlePromote]', err);
      this.filterAdminUsers();
      this.showToast('角色變更失敗，請稍後再試');
      select.value = '';
      return;
    }
    void ApiService.writeAuditLog({
      action: 'role_change',
      targetType: 'user',
      targetId: user?.uid || '',
      targetLabel: name,
      result: 'success',
      source: 'web',
      meta: {
        statusFrom: oldRole,
        statusTo: roleKey,
      },
    });
    // Trigger 5：身份變更通知
    if (user) {
      this._sendNotifFromTemplate('role_upgrade', {
        userName: name, roleName: select.value,
      }, user.uid, 'private', '私訊');
    }
    this.filterAdminUsers();
    this.showToast(`已將「${name}」晉升為「${select.value}」`);
    select.value = '';
  },

  // ─── Step 3: 用戶編輯 Modal ───
  showUserEditModal(userKey) {
    const user = this._findAdminUserByKey(userKey);
    if (user && !this._canOpenUserEditor(user)) {
      this.showToast('權限不足');
      return;
    }
    if (!user) { this.showToast('找不到該用戶'); return; }
    const name = this._getAdminUserLabel(user);

    this._userEditTarget = {
      key: this._getAdminUserKey(user),
      docId: user._docId || '',
      uid: user.uid || '',
      name,
    };
    document.getElementById('user-edit-modal-title').textContent = `編輯用戶 — ${name}`;

    this._setSelectValuePreservingUnknown('ue-region', user.region || '');
    this._setSelectValuePreservingUnknown('ue-gender', user.gender || '');
    document.getElementById('ue-sports').value = Array.isArray(user.sports) ? user.sports.join(', ') : (user.sports || '');
    document.getElementById('ue-phone').value = user.phone || '';
    document.getElementById('ue-email').value = user.email || '';

    const bdInput = document.getElementById('ue-birthday');
    bdInput.value = this._normalizeUserEditBirthday(user.birthday);

    this._applyUserEditFieldPermissions(user);
    this.showModal('user-edit-modal');
  },

  async saveUserEdit() {
    if (!this._canEditUserProfile() && !this._canChangeUserRole()) {
      this.showToast('權限不足'); return;
    }
    const oldUser = this._findAdminUserByEditTarget();
    if (!oldUser) {
      this.showToast('找不到該用戶');
      return;
    }
    const name = this._getAdminUserLabel(oldUser);
    const userKey = this._getAdminUserKey(oldUser);

    // 記錄舊角色以偵測變更
    const oldRole = oldUser ? oldUser.role : null;

    const updates = {};
    if (this._canChangeUserRole()) {
      const nextRole = document.getElementById('ue-role').value;
      if (oldRole !== nextRole) updates.role = nextRole;
    }
    if (this._canEditUserProfile()) {
      this._setUpdateIfChanged(updates, oldUser, 'region', document.getElementById('ue-region').value);
      this._setUpdateIfChanged(updates, oldUser, 'gender', document.getElementById('ue-gender').value);
      this._setUpdateIfChanged(updates, oldUser, 'sports', document.getElementById('ue-sports').value.trim());
      this._setUpdateIfChanged(updates, oldUser, 'phone', document.getElementById('ue-phone').value.trim());
      const email = document.getElementById('ue-email').value.trim();
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
        this.showToast('請輸入有效的電子郵件，或留空清除。');
        return;
      }
      this._setUpdateIfChanged(updates, oldUser, 'email', email || null);

      const bdVal = document.getElementById('ue-birthday').value;
      const nextBirthday = bdVal ? bdVal.replace(/-/g, '/') : null;
      this._setUpdateIfChanged(updates, oldUser, 'birthday', nextBirthday);
    }

    // 後台編輯角色 → 同步設定 manualRole 底線
    if (this._canChangeUserRole() && typeof updates.role === 'string' && oldRole !== updates.role) {
      updates.manualRole = updates.role;
    }

    if (Object.keys(updates).length === 0) {
      this.showToast('沒有變更');
      return;
    }

    let result = null;
    try {
      result = await ApiService.updateAdminUser(userKey, updates);
    } catch (err) {
      console.error('[saveUserEdit]', err);
      this.filterAdminUsers();
      this.showToast('儲存失敗，資料未更新');
      return;
    }

    // Trigger 5：身份變更通知
    if (result && typeof updates.role === 'string' && oldRole && oldRole !== updates.role) {
      const roleName = ROLES[updates.role]?.label || updates.role;
      this._sendNotifFromTemplate('role_upgrade', {
        userName: name, roleName,
      }, result.uid, 'private', '私訊');
    }
    if (result) {
      void ApiService.writeAuditLog({
        action: 'admin_user_edit',
        targetType: 'user',
        targetId: result.uid || oldUser?.uid || '',
        targetLabel: name,
        result: 'success',
        source: 'web',
        meta: {
          statusFrom: oldRole || '',
          statusTo: updates.role || '',
        },
      });
      if (typeof updates.role === 'string' && oldRole !== updates.role) {
        void ApiService.writeAuditLog({
          action: 'role_change',
          targetType: 'user',
          targetId: result.uid || oldUser?.uid || '',
          targetLabel: name,
          result: 'success',
          source: 'web',
          meta: {
            statusFrom: oldRole || '',
            statusTo: updates.role || '',
          },
        });
      }
      this.closeUserEditModal();
      this.filterAdminUsers();
      this.showToast(`已更新「${name}」的資料`);

    }
  },

  closeUserEditModal() {
    this._userEditTarget = null;
    this.closeModal();
  },

  // ── 歷史入隊審批修復（一次性資料修補）──
  async repairApprovedTeamJoins() {
    if (!this.hasPermission?.('admin.repair.team_join_repair')) {
      this.showToast('權限不足');
      return;
    }

    const btn = document.getElementById('repair-team-joins-btn');
    const log = document.getElementById('repair-team-joins-log');
    if (btn) btn.disabled = true;
    if (log) { log.innerHTML = '查詢中...'; log.style.display = 'block'; }

    const logLines = [];
    const addLog = (line) => {
      logLines.push(line);
      if (log) log.innerHTML = logLines.map(l => escapeHTML(l)).join('<br>');
    };

    try {
      addLog(`[${new Date().toLocaleTimeString()}] 開始查詢 approved 入隊記錄（強制讀 Server）...`);
      const snap = await db.collection('messages')
        .where('actionType', '==', 'team_join_request')
        .where('actionStatus', '==', 'approved')
        .get({ source: 'server' });

      if (snap.empty) { addLog('沒有已批准的入隊記錄。'); return; }
      addLog(`共找到 ${snap.docs.length} 筆 approved 訊息，開始去重...`);

      // 去重：同一申請人只保留最新一筆（依 timestamp 排序），防止跨俱樂部重複修復
      const latestByUid = new Map();
      snap.docs.forEach(doc => {
        const data = doc.data();
        const { applicantUid, applicantName, teamId, teamName } = data.meta || {};
        if (!applicantUid || !teamId) return;
        const ts = (data.timestamp?.toMillis?.() || data.timestamp || 0);
        const prev = latestByUid.get(applicantUid);
        if (!prev || ts > prev.ts) {
          latestByUid.set(applicantUid, { applicantUid, applicantName: applicantName || applicantUid, teamId, teamName: teamName || '', ts });
        }
      });
      const toFix = [...latestByUid.values()];
      addLog(`去重後需處理 ${toFix.length} 筆（每人取最新一筆），逐一驗證...`);

      let fixed = 0, skipped = 0, errors = 0;
      for (const { applicantUid, applicantName, teamId, teamName } of toFix) {
        try {
          // 1. 強制從 Server 讀取用戶文件（bypasslocal cache）
          let docId = null;
          let currentTeamId = null;
          let displayName = applicantName;
          const directSnap = await db.collection('users').doc(applicantUid).get({ source: 'server' });
          if (directSnap.exists) {
            docId = directSnap.id;
            currentTeamId = directSnap.data().teamId || null;
            displayName = directSnap.data().displayName || directSnap.data().name || applicantName;
          } else {
            // 2. Fallback：legacy 用戶
            const qSnap = await db.collection('users')
              .where('lineUserId', '==', applicantUid)
              .limit(1).get({ source: 'server' });
            if (!qSnap.empty) {
              docId = qSnap.docs[0].id;
              currentTeamId = qSnap.docs[0].data().teamId || null;
              displayName = qSnap.docs[0].data().displayName || qSnap.docs[0].data().name || applicantName;
            } else {
              const qSnap2 = await db.collection('users')
                .where('uid', '==', applicantUid)
                .limit(1).get({ source: 'server' });
              if (!qSnap2.empty) {
                docId = qSnap2.docs[0].id;
                currentTeamId = qSnap2.docs[0].data().teamId || null;
                displayName = qSnap2.docs[0].data().displayName || qSnap2.docs[0].data().name || applicantName;
              }
            }
          }

          if (!docId) {
            addLog(`  [跳過] ${applicantName}（uid:${applicantUid}）→ 找不到用戶文件`);
            skipped++; continue;
          }

          // 驗證目標俱樂部是否仍存在
          const teamSnap = await db.collection('teams').doc(teamId).get({ source: 'server' });
          if (!teamSnap.exists) {
            // 嘗試用 id 欄位查詢
            const teamQ = await db.collection('teams').where('id', '==', teamId).limit(1).get({ source: 'server' });
            if (teamQ.empty) {
              addLog(`  [跳過] ${displayName} → 目標俱樂部 ${teamId}（${teamName}）已不存在，略過`);
              skipped++; continue;
            }
          }

          if (currentTeamId === teamId) {
            addLog(`  [跳過] ${displayName} → 已在正確俱樂部（${teamId}）`);
            skipped++; continue;
          }

          addLog(`  [修復] ${displayName}（${applicantUid}）：teamId ${currentTeamId || 'null'} → ${teamId}（${teamName}）`);
          const updateData = {
            teamId, teamName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          };
          if (teamId) updateData.teamIds = firebase.firestore.FieldValue.arrayUnion(teamId);
          if (teamName) updateData.teamNames = firebase.firestore.FieldValue.arrayUnion(teamName);
          await db.collection('users').doc(docId).update(updateData);

          // 寫入後立即 server-read 驗證
          const verifySnap = await db.collection('users').doc(docId).get({ source: 'server' });
          const verifiedTeamId = verifySnap.exists ? verifySnap.data().teamId : null;
          if (verifiedTeamId === teamId) {
            addLog(`    ✓ 驗證成功：Firestore teamId 已確認為 ${teamId}`);
            const cached = (ApiService.getAdminUsers() || []).find(u => u.uid === applicantUid || u._docId === docId);
            if (cached) Object.assign(cached, { teamId, teamName });
            fixed++;
          } else {
            addLog(`    ✗ 驗證失敗：寫入後讀回 teamId=${verifiedTeamId}，預期 ${teamId}（可能是 rules 拒絕）`);
            errors++;
          }
        } catch (err) {
          addLog(`  [錯誤] ${applicantName}（${applicantUid}）：${err.message || err}`);
          console.error('[repairTeamJoins]', applicantUid, err);
          errors++;
        }
      }

      const summary = `完成！修復 ${fixed} 人，跳過 ${skipped} 人，失敗 ${errors} 人`;
      addLog(`\n${summary}`);
      ApiService._writeOpLog('team_join_repair', '歷史入隊補正', summary);
      this.showToast(summary);
    } catch (err) {
      const msg = '查詢失敗：' + (err.message || err);
      addLog(msg);
      this.showToast(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // 格式化「最後登入」meta 顯示（時間 + IP + 地區 / ISP）
  _formatLastLoginMeta(u) {
    const ts = u.lastLogin || u.lastActive;
    let timeStr = '尚無紀錄';
    if (ts) {
      try {
        const d = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
        if (!isNaN(d)) {
          timeStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      } catch (_) {}
    }
    const parts = [timeStr];
    if (u.lastLoginIp) parts.push(escapeHTML(u.lastLoginIp));
    const regionIsp = [u.lastLoginRegion, u.lastLoginIsp].filter(Boolean).join(' / ');
    if (regionIsp) parts.push(escapeHTML(regionIsp));
    return parts.join(' ・ ');
  },

});
