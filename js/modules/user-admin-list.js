/* ================================================
   SportHub — User Admin: List, Search, Edit
   ================================================ */

Object.assign(App, {

  // ─── 用戶列表: 當前篩選狀態 ───
  _userEditTarget: null,

  // ─── Step 1: 搜尋與篩選 ───
  filterAdminUsers() {
    const keyword = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
    const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';

    let users = ApiService.getAdminUsers();

    if (keyword) {
      users = users.filter(u =>
        u.name.toLowerCase().includes(keyword) ||
        u.uid.toLowerCase().includes(keyword)
      );
    }
    if (roleFilter) {
      users = users.filter(u => u.role === roleFilter);
    }

    this.renderAdminUsers(users);
  },

  // ─── Step 2: 用戶列表渲染（可接收篩選後的 users） ───
  renderAdminUsers(users) {
    const container = document.getElementById('admin-user-list');
    if (!container) return;

    if (!users) users = ApiService.getAdminUsers();

    if (users.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">找不到符合條件的使用者</div>';
      return;
    }

    container.innerHTML = users.map(u => {
      const avatar = u.pictureUrl
        ? `<img src="${u.pictureUrl}" class="au-avatar" style="object-fit:cover">`
        : `<div class="au-avatar au-avatar-fallback">${(u.name || '?')[0]}</div>`;

      const teamInfo = u.teamName ? ` ・${escapeHTML(u.teamName)}` : '';
      const genderIcon = u.gender === '男' ? '♂' : u.gender === '女' ? '♀' : '';
      const safeName = escapeHTML(u.name || '').replace(/'/g, "\\'");
      const canRestrictThisUser = u.role === 'user';
      const isRestricted = !!u.isRestricted;
      const restrictBtnHtml = canRestrictThisUser
        ? `<button class="au-btn ${isRestricted ? 'au-btn-view' : 'au-btn-edit'}" onclick="App.toggleUserRestriction('${safeName}')">${isRestricted ? '解除限制' : '限制'}</button>`
        : '';

      return `
        <div class="admin-user-card">
          ${avatar}
          <div class="admin-user-body">
            <div class="admin-user-info">
              <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
              <div class="admin-user-meta">${escapeHTML(u.uid)} ・${ROLES[u.role]?.label || u.role} ・Lv.${App._calcLevelFromExp(u.exp || 0).level} ・${escapeHTML(u.region || '—')}${genderIcon ? ' ' + genderIcon : ''}${teamInfo}</div>
              <div class="admin-user-meta">${escapeHTML(u.sports || '—')} ・EXP ${(u.exp || 0).toLocaleString()}</div>
              <div class="admin-user-meta">限制狀態：${isRestricted ? '限制中' : '正常'}</div>
            </div>
            <div class="admin-user-actions">
              ${u.role !== 'super_admin' ? `<button class="au-btn au-btn-edit" onclick="App.showUserEditModal('${safeName}')">編輯</button>` : ''}
              <button class="au-btn au-btn-view" onclick="App.showUserProfile('${safeName}')">查看</button>
              ${restrictBtnHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },
  async toggleUserRestriction(name) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('只有 super_admin 可操作');
      return;
    }

    const user = ApiService.getAdminUsers().find(u => u.name === name);
    if (!user) {
      this.showToast('找不到使用者');
      return;
    }
    if (user.role !== 'user') {
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
      await ApiService.updateAdminUser(name, updates);
    } catch (err) {
      console.error('[toggleUserRestriction]', err);
      this.filterAdminUsers();
      this.showToast(`${actionLabel}失敗，請稍後再試`);
      return;
    }

    ApiService._writeOpLog(
      'user_restriction',
      nextRestricted ? '帳號限制' : '解除限制',
      `${actionLabel}「${name}」`
    );

    this.filterAdminUsers();
    this.showToast(nextRestricted ? '已限制使用者' : '已解除限制');
  },

  async handlePromote(select, name) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    if (!select.value) return;
    const roleMap = { '管理員': 'admin', '教練': 'coach', '領隊': 'captain', '場主': 'venue_owner' };
    const roleKey = roleMap[select.value];
    if (!roleKey) return;
    const user = ApiService.getAdminUsers().find(u => u.name === name);
    try {
    // 後台手動晉升 → 同步設定 manualRole 底線
      await ApiService.updateAdminUser(name, { role: roleKey, manualRole: roleKey });
    } catch (err) {
      console.error('[handlePromote]', err);
      this.filterAdminUsers();
      this.showToast('閫霈失敗，請稍後再試');
      select.value = '';
      return;
    }
    ApiService._writeOpLog('role', '角色變更', `${name} → ${select.value}`);
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
  showUserEditModal(name) {
    const users = ApiService.getAdminUsers();
    const user = users.find(u => u.name === name);
    if (!user) { this.showToast('找不到該用戶'); return; }

    this._userEditTarget = name;
    document.getElementById('user-edit-modal-title').textContent = `編輯用戶 — ${name}`;

    document.getElementById('ue-role').value = user.role || 'user';
    document.getElementById('ue-region').value = user.region || '台北';
    document.getElementById('ue-gender').value = user.gender || '男';
    document.getElementById('ue-sports').value = user.sports || '';
    document.getElementById('ue-phone').value = user.phone || '';

    const bdInput = document.getElementById('ue-birthday');
    if (user.birthday) {
      bdInput.value = user.birthday.replace(/\//g, '-');
    } else {
      bdInput.value = '';
    }

    this.showModal('user-edit-modal');
  },

  async saveUserEdit() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const name = this._userEditTarget;
    if (!name) return;

    // 記錄舊角色以偵測變更
    const oldUser = ApiService.getAdminUsers().find(u => u.name === name);
    const oldRole = oldUser ? oldUser.role : null;

    const updates = {
      role: document.getElementById('ue-role').value,
      region: document.getElementById('ue-region').value,
      gender: document.getElementById('ue-gender').value,
      sports: document.getElementById('ue-sports').value.trim(),
      phone: document.getElementById('ue-phone').value.trim(),
    };

    const bdVal = document.getElementById('ue-birthday').value;
    if (bdVal) {
      updates.birthday = bdVal.replace(/-/g, '/');
    }

    // 後台編輯角色 → 同步設定 manualRole 底線
    if (oldRole !== updates.role) {
      updates.manualRole = updates.role;
    }

    let result = null;
    try {
      result = await ApiService.updateAdminUser(name, updates);
    } catch (err) {
      console.error('[saveUserEdit]', err);
      this.filterAdminUsers();
      this.showToast('儲存失敗，資料未更新');
      return;
    }

    // Trigger 5：身份變更通知
    if (result && oldRole && oldRole !== updates.role) {
      const roleName = ROLES[updates.role]?.label || updates.role;
      this._sendNotifFromTemplate('role_upgrade', {
        userName: name, roleName,
      }, result.uid, 'private', '私訊');
    }
    if (result) {
      this.closeUserEditModal();
      this.filterAdminUsers();
      this.showToast(`已更新「${name}」的資料`);

      // 寫入操作紀錄
      ApiService._writeOpLog('role', '角色變更', `編輯「${name}」資料（角色：${ROLES[updates.role]?.label || updates.role}、地區：${updates.region}）`);
    }
  },

  closeUserEditModal() {
    this._userEditTarget = null;
    this.closeModal();
  },

  // ── 歷史入隊審批修復（一次性資料修補）──
  async repairApprovedTeamJoins() {
    const curUser = ApiService.getCurrentUser();
    if (curUser?.role !== 'super_admin') { this.showToast('權限不足'); return; }

    const btn = document.getElementById('repair-team-joins-btn');
    const log = document.getElementById('repair-team-joins-log');
    if (btn) btn.disabled = true;
    if (log) log.textContent = '查詢中...';

    try {
      const snap = await db.collection('messages')
        .where('actionType', '==', 'team_join_request')
        .where('actionStatus', '==', 'approved')
        .get();

      if (snap.empty) { if (log) log.textContent = '沒有已批准的入隊記錄。'; return; }

      // 去重：同 applicantUid + teamId 只處理一次
      const seen = new Set();
      const toFix = [];
      snap.docs.forEach(doc => {
        const { applicantUid, teamId, teamName } = doc.data().meta || {};
        if (!applicantUid || !teamId) return;
        const key = `${applicantUid}__${teamId}`;
        if (!seen.has(key)) { seen.add(key); toFix.push({ applicantUid, teamId, teamName: teamName || '' }); }
      });

      let fixed = 0, skipped = 0, errors = 0;
      for (const { applicantUid, teamId, teamName } of toFix) {
        try {
          // 1. 先嘗試直接以 applicantUid 作為文件 ID 查詢
          let docId = null;
          let currentTeamId = null;
          const directSnap = await db.collection('users').doc(applicantUid).get();
          if (directSnap.exists) {
            docId = directSnap.id;
            currentTeamId = directSnap.data().teamId || null;
          } else {
            // 2. Fallback：legacy 用戶的 lineUserId 或 uid 欄位可能與文件 ID 不同
            const qSnap = await db.collection('users')
              .where('lineUserId', '==', applicantUid)
              .limit(1).get();
            if (!qSnap.empty) {
              docId = qSnap.docs[0].id;
              currentTeamId = qSnap.docs[0].data().teamId || null;
            } else {
              const qSnap2 = await db.collection('users')
                .where('uid', '==', applicantUid)
                .limit(1).get();
              if (!qSnap2.empty) {
                docId = qSnap2.docs[0].id;
                currentTeamId = qSnap2.docs[0].data().teamId || null;
              }
            }
          }
          if (!docId) { skipped++; continue; } // 找不到用戶
          if (currentTeamId === teamId) { skipped++; continue; } // 已正確
          await db.collection('users').doc(docId).update({
            teamId, teamName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          const cached = (ApiService.getAdminUsers() || []).find(u => u.uid === applicantUid || u._docId === docId);
          if (cached) Object.assign(cached, { teamId, teamName });
          fixed++;
        } catch (err) { console.error('[repairTeamJoins]', applicantUid, err); errors++; }
      }

      const summary = `完成！修復 ${fixed} 人，已正確跳過 ${skipped} 人，失敗 ${errors} 人`;
      if (log) log.textContent = summary;
      ApiService._writeOpLog('team_approve', '歷史入隊修復', summary);
      this.showToast(summary);
    } catch (err) {
      const msg = '查詢失敗：' + (err.message || err);
      if (log) log.textContent = msg;
      this.showToast(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

});
