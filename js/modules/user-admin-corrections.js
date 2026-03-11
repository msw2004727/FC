/* ================================================
   SportHub - User Admin: Corrections
   ================================================ */

Object.assign(App, {
  _adminRepairActiveTab: 'team-joins',
  _userCorrectionSelectedUid: '',
  _getUserCorrectionPrimaryLabel(user) {
    const candidates = [user?.name, user?.displayName, user?.uid, user?.lineUserId];
    for (const value of candidates) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '未命名用戶';
  },
  _getUserCorrectionIdentityText(user) {
    const primaryLabel = this._getUserCorrectionPrimaryLabel(user);
    const uid = String(user?.uid || '').trim();
    return uid && primaryLabel !== uid ? `${primaryLabel}（${uid}）` : primaryLabel;
  },
  _getAdminRepairTabAccess() {
    return {
      teamJoins: !!this.hasPermission?.('admin.repair.team_join_repair'),
      noShow: !!this.hasPermission?.('admin.repair.no_show_adjust'),
    };
  },
  renderUserCorrectionManager() {
    const access = this._getAdminRepairTabAccess();
    const tabsEl = document.getElementById('admin-repair-tabs');
    const emptyCard = document.getElementById('admin-repair-empty');
    const teamTab = tabsEl?.querySelector('[data-repair-tab="team-joins"]');
    const noShowTab = tabsEl?.querySelector('[data-repair-tab="no-show"]');
    const teamPane = document.getElementById('repair-pane-team-joins');
    const noShowPane = document.getElementById('repair-pane-no-show');

    if (!tabsEl || !emptyCard || !teamTab || !noShowTab || !teamPane || !noShowPane) return;

    teamTab.style.display = access.teamJoins ? '' : 'none';
    noShowTab.style.display = access.noShow ? '' : 'none';

    const availableTabs = [];
    if (access.teamJoins) availableTabs.push('team-joins');
    if (access.noShow) availableTabs.push('no-show');

    if (!availableTabs.length) {
      tabsEl.style.display = 'none';
      teamPane.style.display = 'none';
      noShowPane.style.display = 'none';
      emptyCard.style.display = '';
      emptyCard.innerHTML = '<div style="font-weight:600;margin-bottom:.35rem">目前沒有可用權限</div><div style="font-size:.8rem;color:var(--text-muted);line-height:1.7">請先在權限管理中開啟「用戶補正管理」下的子功能。</div>';
      return;
    }

    tabsEl.style.display = availableTabs.length > 1 ? '' : 'none';
    emptyCard.style.display = 'none';
    if (!availableTabs.includes(this._adminRepairActiveTab)) {
      this._adminRepairActiveTab = availableTabs[0];
    }

    tabsEl.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.repairTab === this._adminRepairActiveTab);
    });

    teamPane.style.display = this._adminRepairActiveTab === 'team-joins' ? '' : 'none';
    noShowPane.style.display = this._adminRepairActiveTab === 'no-show' ? '' : 'none';

    if (this._adminRepairActiveTab === 'no-show') {
      this._renderSelectedUserNoShowSummary();
    }
  },
  switchUserCorrectionTab(tab) {
    const access = this._getAdminRepairTabAccess();
    if (tab === 'team-joins' && !access.teamJoins) return;
    if (tab === 'no-show' && !access.noShow) return;
    this._adminRepairActiveTab = tab === 'no-show' ? 'no-show' : 'team-joins';
    this.renderUserCorrectionManager();
  },
  _findUserCorrectionTargetByUid(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return null;
    return (ApiService.getAdminUsers() || []).find(user =>
      String(user?.uid || '').trim() === safeUid
      || String(user?._docId || '').trim() === safeUid
      || String(user?.lineUserId || '').trim() === safeUid
    ) || null;
  },
  _formatCorrectionTime(value) {
    if (!value) return '—';
    const raw = typeof value?.toDate === 'function' ? value.toDate() : value;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  },
  _renderUserCorrectionDropdown(matches) {
    const dropdown = document.getElementById('user-correction-dropdown');
    if (!dropdown) return;

    if (!matches.length) {
      dropdown.innerHTML = '<div style="padding:.45rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
      dropdown.classList.add('open');
      return;
    }

    dropdown.innerHTML = matches.map(user => {
      const primaryLabel = this._getUserCorrectionPrimaryLabel(user);
      const roleLabel = ROLES[user.role]?.label || user.role || '使用者';
      const uid = String(user?.uid || '').trim();
      const lineUserId = String(user?.lineUserId || '').trim();
      const metaParts = [];
      if (uid && primaryLabel !== uid) metaParts.push(escapeHTML(uid));
      metaParts.push(escapeHTML(roleLabel));
      if (lineUserId && primaryLabel !== lineUserId && uid !== lineUserId) {
        metaParts.push(`LINE ID ${escapeHTML(lineUserId)}`);
      }
      return `<div class="ce-delegate-item" data-uid="${escapeHTML(user.uid)}">
        <span class="ce-delegate-item-name">${escapeHTML(primaryLabel)}</span>
        <span class="ce-delegate-item-meta">${metaParts.join(' · ')}</span>
      </div>`;
    }).join('');

    dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
      item.addEventListener('mousedown', event => {
        event.preventDefault();
        this.selectUserNoShowTarget(item.dataset.uid);
      });
    });
    dropdown.classList.add('open');
  },
  searchUserNoShowTarget() {
    if (!this.hasPermission?.('admin.repair.no_show_adjust')) return;

    const input = document.getElementById('user-correction-search');
    const dropdown = document.getElementById('user-correction-dropdown');
    const query = String(input?.value || '').trim().toLowerCase();

    this._userCorrectionSelectedUid = '';
    if (!query) {
      if (dropdown) {
        dropdown.innerHTML = '';
        dropdown.classList.remove('open');
      }
      this._renderSelectedUserNoShowSummary();
      return;
    }

    const matches = (ApiService.getAdminUsers() || [])
      .filter(user => {
        const fields = [
          user?.name,
          user?.displayName,
          user?.uid,
          user?.lineUserId,
        ];
        return fields.some(value => String(value || '').toLowerCase().includes(query));
      })
      .slice(0, 8);

    this._renderUserCorrectionDropdown(matches);
    this._renderSelectedUserNoShowSummary();
  },
  selectUserNoShowTarget(uid) {
    const user = this._findUserCorrectionTargetByUid(uid);
    const input = document.getElementById('user-correction-search');
    const dropdown = document.getElementById('user-correction-dropdown');
    const targetInput = document.getElementById('user-correction-target');
    if (!user) return;

    this._userCorrectionSelectedUid = String(user.uid || '').trim();
    if (input) input.value = this._getUserCorrectionPrimaryLabel(user);
    if (dropdown) dropdown.classList.remove('open');
    if (targetInput) targetInput.value = String(this._getEffectiveNoShowCount(this._userCorrectionSelectedUid));
    this._renderSelectedUserNoShowSummary();
  },
  _renderSelectedUserNoShowSummary() {
    const result = document.getElementById('user-correction-search-result');
    const summary = document.getElementById('user-correction-summary');
    const formula = document.getElementById('user-correction-formula');
    const targetInput = document.getElementById('user-correction-target');
    const user = this._findUserCorrectionTargetByUid(this._userCorrectionSelectedUid);

    if (!summary || !formula) return;

    if (!user) {
      if (result) result.textContent = '';
      summary.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);line-height:1.7">請先搜尋並選取用戶，再設定要顯示的放鴿子次數。</div>';
      formula.textContent = '公式預覽：原始次數 ± 補正差額 = 顯示次數';
      if (targetInput) targetInput.value = '0';
      return;
    }

    const correctionDoc = this._getUserNoShowCorrection(user.uid);
    const rawCount = this._getRawNoShowCount(user.uid);
    const adjustment = this._getUserNoShowAdjustment(user.uid);
    const effectiveCount = Math.max(0, rawCount + adjustment);
    const identityText = this._getUserCorrectionIdentityText(user);
    const roleLabel = ROLES[user.role]?.label || user.role || '使用者';
    const updatedAt = this._formatCorrectionTime(correctionDoc?.noShow?.updatedAt);
    const updatedBy = correctionDoc?.noShow?.updatedByName || '—';

    if (result) {
      result.innerHTML = `<span style="color:var(--success)">已選取：${escapeHTML(identityText)}</span>`;
    }
    if (targetInput && !String(targetInput.value || '').trim()) {
      targetInput.value = String(effectiveCount);
    }

    summary.innerHTML = `
      <div style="display:grid;gap:.45rem;font-size:.82rem">
        <div><strong>${escapeHTML(identityText)}</strong> · ${escapeHTML(roleLabel)}</div>
        <div>原始放鴿子次數：<strong>${rawCount}</strong></div>
        <div>目前補正差額：<strong>${adjustment >= 0 ? '+' : ''}${adjustment}</strong></div>
        <div>補正後顯示次數：<strong>${effectiveCount}</strong></div>
        <div>上次補正：<strong>${escapeHTML(updatedBy)}</strong> · ${escapeHTML(updatedAt)}</div>
      </div>
    `;

    this.previewUserNoShowCorrection();
  },
  previewUserNoShowCorrection() {
    const formula = document.getElementById('user-correction-formula');
    const targetInput = document.getElementById('user-correction-target');
    const user = this._findUserCorrectionTargetByUid(this._userCorrectionSelectedUid);
    if (!formula || !user) return;

    const rawCount = this._getRawNoShowCount(user.uid);
    const requested = Number(targetInput?.value ?? 0);
    const targetCount = Number.isFinite(requested) ? Math.max(0, Math.trunc(requested)) : 0;
    const adjustment = targetCount - rawCount;
    formula.textContent = `公式預覽：原始 ${rawCount} ${adjustment >= 0 ? '+ ' + adjustment : '- ' + Math.abs(adjustment)} = 顯示 ${Math.max(0, rawCount + adjustment)}`;
  },
  async submitUserNoShowCorrection() {
    if (!this.hasPermission?.('admin.repair.no_show_adjust')) {
      this.showToast('權限不足');
      return;
    }

    const user = this._findUserCorrectionTargetByUid(this._userCorrectionSelectedUid);
    const targetInput = document.getElementById('user-correction-target');
    const requested = Number(targetInput?.value ?? NaN);
    if (!user) { this.showToast('請先搜尋並選取用戶'); return; }
    if (!Number.isFinite(requested) || requested < 0) { this.showToast('請輸入 0 或以上的整數'); return; }

    const targetCount = Math.max(0, Math.trunc(requested));
    const rawCount = this._getRawNoShowCount(user.uid);
    const adjustment = targetCount - rawCount;
    const currentAdjustment = this._getUserNoShowAdjustment(user.uid);
    if (currentAdjustment === adjustment) {
      this.showToast('補正數值沒有變更');
      return;
    }

    const ok = await this.appConfirm(`確定要將「${user.name || user.uid}」的放鴿子顯示次數補正為 ${targetCount} 次嗎？`);
    if (!ok) return;

    const currentUser = ApiService.getCurrentUser() || {};
    const noShow = {
      adjustment,
      targetCount,
      baseRawCount: rawCount,
      updatedAt: new Date().toISOString(),
      updatedByUid: currentUser.uid || '',
      updatedByName: currentUser.displayName || currentUser.name || (ROLES[this.currentRole]?.label || '管理員'),
    };

    try {
      await ApiService.saveUserNoShowCorrection(user.uid, noShow);
      ApiService._writeOpLog(
        'user_no_show_adjust',
        '放鴿子補正',
        `${user.name || user.uid}：原始 ${rawCount} 次，補正 ${adjustment >= 0 ? '+' : ''}${adjustment}，顯示 ${targetCount} 次`
      );
      if (targetInput) targetInput.value = String(targetCount);
      this._renderSelectedUserNoShowSummary();
      this.showToast('放鴿子補正已儲存');
    } catch (err) {
      console.error('[submitUserNoShowCorrection]', err);
      this.showToast('補正儲存失敗，請稍後再試');
    }
  },
  async clearUserNoShowCorrection() {
    if (!this.hasPermission?.('admin.repair.no_show_adjust')) {
      this.showToast('權限不足');
      return;
    }

    const user = this._findUserCorrectionTargetByUid(this._userCorrectionSelectedUid);
    const targetInput = document.getElementById('user-correction-target');
    if (!user) { this.showToast('請先搜尋並選取用戶'); return; }
    if (!this._getUserNoShowCorrection(user.uid)) {
      this.showToast('目前沒有補正資料可清除');
      return;
    }

    const ok = await this.appConfirm(`確定要清除「${user.name || user.uid}」的放鴿子補正嗎？`);
    if (!ok) return;

    try {
      await ApiService.clearUserNoShowCorrection(user.uid);
      ApiService._writeOpLog('user_no_show_clear', '清除放鴿子補正', `${user.name || user.uid}：清除放鴿子補正`);
      if (targetInput) targetInput.value = String(this._getRawNoShowCount(user.uid));
      this._renderSelectedUserNoShowSummary();
      this.showToast('已清除放鴿子補正');
    } catch (err) {
      console.error('[clearUserNoShowCorrection]', err);
      this.showToast('清除補正失敗，請稍後再試');
    }
  },
});
