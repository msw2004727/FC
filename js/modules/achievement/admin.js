/* ================================================
   SportHub Achievement Admin Helpers
   Owns admin achievement list rendering, form
   behavior, badge upload, and CRUD flows while
   the legacy facade keeps old method names stable.
   ================================================ */

Object.assign(App, {

  _buildAchievementAdmin() {
    const state = {
      editId: null,
      badgeDataURL: null,
      cleanupInFlight: null,
    };

    const getRegistry = () => App._getAchievementRegistry?.();
    const getShared = () => App._getAchievementShared?.();
    const getStats = () => App._getAchievementStats?.();
    const normalizeString = (value) => String(value || '').trim();

    const getSupportedActions = () => {
      const registry = getRegistry();
      return registry?.getSupportedActions?.() || [];
    };

    const getSupportedTimeRanges = () => {
      const registry = getRegistry();
      return (registry?.getTimeRanges?.() || [])
        .filter(range => registry?.isStrictlySupportedTimeRange?.(range.key));
    };

    const getAllFilters = () => {
      return getRegistry()?.getFilters?.() || [];
    };

    const ensureLegacyOption = (selectEl, value, label) => {
      if (!selectEl || !value) return;
      const exists = Array.from(selectEl.options || []).some(option => option.value === value);
      if (exists) return;

      const option = document.createElement('option');
      option.value = value;
      option.textContent = `不支援: ${label || value}`;
      selectEl.prepend(option);
    };

    const buildConditionFromForm = () => {
      const registry = getRegistry();
      const rawCondition = {
        timeRange: document.getElementById('ach-cond-timerange')?.value || 'none',
        streakDays: parseInt(document.getElementById('ach-cond-streakdays')?.value || '7', 10) || 7,
        action: document.getElementById('ach-cond-action')?.value || 'complete_event',
        filter: document.getElementById('ach-cond-filter')?.value || 'all',
        threshold: parseInt(document.getElementById('ach-cond-threshold')?.value || '0', 10) || 0,
      };
      const condition = registry?.normalizeCondition?.(rawCondition) || rawCondition;
      if (condition.timeRange !== 'streak') delete condition.streakDays;
      return condition;
    };

    const getLegacyActionLabel = (actionKey) => {
      const registry = getRegistry();
      return registry?.findActionConfig?.(actionKey)?.label || actionKey;
    };

    const getLegacyTimeRangeLabel = (timeRangeKey) => {
      const registry = getRegistry();
      return registry?.findTimeRangeConfig?.(timeRangeKey)?.label || timeRangeKey;
    };

    const cleanupLegacyAchievements = async () => {
      if (state.cleanupInFlight) return state.cleanupInFlight;

      state.cleanupInFlight = (async () => {
        const registry = getRegistry();
        const achievements = ApiService.getAchievements() || [];
        const badges = ApiService.getBadges() || [];
        const invalidAchievements = achievements.filter(achievement => !registry?.isSupportedCondition?.(achievement?.condition));
        const validAchievementIds = new Set(
          achievements
            .filter(achievement => registry?.isSupportedCondition?.(achievement?.condition))
            .map(achievement => normalizeString(achievement.id))
            .filter(Boolean)
        );
        const badgeIdsToDelete = new Set(
          invalidAchievements
            .map(achievement => normalizeString(achievement.badgeId))
            .filter(Boolean)
        );

        badges.forEach(badge => {
          const badgeId = normalizeString(badge?.id);
          const achId = normalizeString(badge?.achId);
          if (!badgeId || !achId) return;
          if (!validAchievementIds.has(achId)) badgeIdsToDelete.add(badgeId);
        });

        if (!invalidAchievements.length && !badgeIdsToDelete.size) return null;

        for (const achievement of invalidAchievements) {
          try {
            await ApiService.deleteAchievement(achievement.id);
          } catch (error) {
            console.error('[achievementAdmin.cleanup.deleteAchievement]', achievement?.id, error);
          }
        }

        for (const badgeId of badgeIdsToDelete) {
          try {
            await ApiService.deleteBadge(badgeId);
          } catch (error) {
            console.error('[achievementAdmin.cleanup.deleteBadge]', badgeId, error);
          }
        }

        App.showToast(`已清理 ${invalidAchievements.length} 個舊成就與 ${badgeIdsToDelete.size} 個徽章`);
        return {
          removedAchievements: invalidAchievements.length,
          removedBadges: badgeIdsToDelete.size,
        };
      })();

      try {
        return await state.cleanupInFlight;
      } finally {
        state.cleanupInFlight = null;
      }
    };

    const populateAchConditionSelects = (legacyCondition = null) => {
      const registry = getRegistry();
      const trSel = document.getElementById('ach-cond-timerange');
      const actSel = document.getElementById('ach-cond-action');
      const filtSel = document.getElementById('ach-cond-filter');

      if (trSel) {
        trSel.innerHTML = getSupportedTimeRanges().map(range =>
          `<option value="${range.key}">${escapeHTML(range.label)}</option>`
        ).join('');
        const legacyTimeRange = legacyCondition?.timeRange;
        if (legacyTimeRange && !registry?.isStrictlySupportedTimeRange?.(legacyTimeRange)) {
          ensureLegacyOption(trSel, legacyTimeRange, getLegacyTimeRangeLabel(legacyTimeRange));
        }
      }

      if (actSel) {
        actSel.innerHTML = getSupportedActions().map(action =>
          `<option value="${action.key}">${escapeHTML(action.label)}</option>`
        ).join('');
        const legacyAction = legacyCondition?.action;
        if (legacyAction && !registry?.isSupportedAction?.(legacyAction)) {
          ensureLegacyOption(actSel, legacyAction, getLegacyActionLabel(legacyAction));
        }
      }

      if (filtSel) {
        filtSel.innerHTML = getAllFilters().map(filter =>
          `<option value="${filter.key}">${escapeHTML(filter.label)}</option>`
        ).join('');
      }
    };

    const renderAdminAchievements = async () => {
      const container = document.getElementById('admin-ach-list');
      if (!container) return;
      container.innerHTML = '<div style="text-align:center;padding:1.25rem;color:var(--text-muted);font-size:.82rem">載入成就管理中...</div>';

      await cleanupLegacyAchievements();

      populateAchConditionSelects();
      bindAchBadgeUpload();

      const registry = getRegistry();
      const shared = getShared();
      const stats = getStats();
      const items = App._sortByCat(ApiService.getAchievements());
      const badges = ApiService.getBadges();

      container.innerHTML = items.map((achievement, index) => {
        const isArchived = achievement.status === 'archived';
        const color = shared?.getCategoryColor?.(achievement.category) || App._catColors[achievement.category] || App._catColors.bronze;
        const threshold = App._getAchThreshold(achievement);
        const actionCfg = getRegistry()?.findActionMeta?.(achievement.condition?.action);
        const isReverse = !!actionCfg?.reverseComparison;
        const pct = isReverse
          ? ((achievement.current || 0) <= threshold ? 100 : 0)
          : (threshold > 0 ? Math.min(100, Math.round((achievement.current || 0) / threshold * 100)) : 0);
        const completed = stats?.isCompleted?.(achievement) ?? (isReverse ? (achievement.current || 0) <= threshold : (achievement.current || 0) >= threshold);
        const badge = badges.find(item => item.id === achievement.badgeId);
        const badgeImg = badge?.image
          ? `<img src="${escapeHTML(badge.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px" loading="lazy">`
          : '<span style="font-size:.9rem">🏅</span>';
        const desc = App._generateConditionDesc(achievement.condition, achievement.desc);
        const actionSupported = registry?.isSupportedAction?.(achievement.condition?.action || '') !== false;
        const timeRangeSupported = registry?.isStrictlySupportedTimeRange?.(achievement.condition?.timeRange || 'none') !== false;
        const hasLegacyWarning = !actionSupported || !timeRangeSupported;

        const isLocked = achievement.locked !== false;
        const lockIcon = isLocked
          ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>'
          : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M16 11V7a4 4 0 0 0-7.4-2.1"></path></svg>';
        const lockColor = isLocked ? 'var(--accent)' : 'var(--warning)';
        const lockTitle = isLocked ? '已鎖定（達成即永久）' : '未鎖定（條件消失會撤銷）';

        const isManualAward = normalizeString(achievement.condition?.action) === 'manual_award';
        const awardBtn = isManualAward && !isArchived
          ? `<button class="text-btn" style="font-size:.72rem;color:var(--accent)" onclick="App.openManualAwardPanel('${achievement.id}')">授予</button>`
          : '';

        return `
      <div class="admin-ach-row" style="background:${index % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${isArchived ? 'var(--text-muted)' : color};${isArchived ? 'opacity:.55;' : ''}">
        <div class="badge-img-placeholder small" style="border-color:${color};flex-shrink:0">${badgeImg}</div>
        <div class="admin-ach-info" style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">
            <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${shared?.getCategoryLabel?.(achievement.category) || App._catLabels[achievement.category]}</span>
            <span class="admin-ach-name">${escapeHTML(achievement.name)}</span>
            ${isArchived ? '<span style="font-size:.6rem;color:var(--danger);font-weight:600">已下架</span>' : ''}
            ${!isArchived && completed ? '<span style="font-size:.6rem;color:var(--success);font-weight:600">已完成</span>' : ''}
            ${hasLegacyWarning ? '<span style="font-size:.6rem;color:var(--warning);font-weight:600">條件未支援</span>' : ''}
          </div>
          <div class="admin-ach-status" style="color:var(--text-muted)">${escapeHTML(desc)}</div>
          <div class="ach-progress-bar-wrap" style="margin-top:.25rem;height:4px">
            <div class="ach-progress-bar" style="width:${pct}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
          </div>
        </div>
        <div class="admin-ach-actions">
          ${awardBtn}
          <button class="text-btn" style="font-size:.72rem;color:${lockColor};display:inline-flex;align-items:center;gap:.2rem" title="${lockTitle}" onclick="App.toggleAchievementLock('${achievement.id}')">${lockIcon}</button>
          <button class="text-btn" style="font-size:.72rem" onclick="App.editAchievement('${achievement.id}')">編輯</button>
          <button class="text-btn" style="font-size:.72rem;color:${isArchived ? 'var(--success)' : 'var(--danger)'}" onclick="App.toggleAchievementStatus('${achievement.id}')">${isArchived ? '上架' : '下架'}</button>
          <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.confirmDeleteAchievement('${achievement.id}')">刪除</button>
        </div>
      </div>`;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無成就</div>';
    };

    const showAchForm = (editData) => {
      const form = document.getElementById('ach-form-card');
      if (!form) return;

      populateAchConditionSelects(editData?.condition || null);
      bindAchBadgeUpload();

      form.style.display = '';
      state.editId = editData?.id || null;
      state.badgeDataURL = null;

      document.getElementById('ach-form-title').textContent = editData ? '編輯成就' : '新增成就';
      document.getElementById('ach-input-name').value = editData?.name || '';
      document.getElementById('ach-input-category').value = editData?.category || 'bronze';

      const condition = editData?.condition || {};
      const registry = getRegistry();
      document.getElementById('ach-cond-timerange').value = condition.timeRange || 'none';
      if (condition.timeRange && !registry?.isStrictlySupportedTimeRange?.(condition.timeRange)) {
        document.getElementById('ach-cond-timerange').value = condition.timeRange;
      }
      document.getElementById('ach-cond-streakdays').value = condition.streakDays || 7;
      document.getElementById('ach-cond-action').value = condition.action || 'complete_event';
      if (condition.action && !registry?.isSupportedAction?.(condition.action)) {
        document.getElementById('ach-cond-action').value = condition.action;
      }
      document.getElementById('ach-cond-filter').value = condition.filter || 'all';
      document.getElementById('ach-cond-threshold').value = condition.threshold != null ? condition.threshold : 1;

      const preview = document.getElementById('ach-badge-preview');
      if (preview) {
        const badge = editData ? ApiService.getBadges().find(item => item.id === editData.badgeId) : null;
        preview.innerHTML = badge?.image
          ? `<img src="${escapeHTML(badge.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`
          : '<span style="color:var(--text-muted);font-size:.7rem">尚未上傳</span>';
      }

      updateAchConditionUI();
      updateConditionPreview();
      form.scrollIntoView({ behavior: 'smooth' });
    };

    const hideAchForm = () => {
      const form = document.getElementById('ach-form-card');
      if (form) form.style.display = 'none';
      state.editId = null;
      state.badgeDataURL = null;

      const input = document.getElementById('ach-badge-image');
      if (input) input.value = '';
    };

    const updateAchConditionUI = () => {
      const timeRange = document.getElementById('ach-cond-timerange')?.value || 'none';
      const action = document.getElementById('ach-cond-action')?.value || 'complete_event';
      const streakRow = document.getElementById('ach-cond-streakdays-row');
      const filterRow = document.getElementById('ach-cond-filter-row');
      const thresholdRow = document.getElementById('ach-cond-threshold-row');
      const thresholdInput = document.getElementById('ach-cond-threshold');
      const actionCfg = getRegistry()?.findActionConfig?.(action)
        || ACHIEVEMENT_CONDITIONS.actions.find(item => item.key === action);
      const fieldState = getRegistry()?.getActionFieldState?.(action) || {
        showFilter: !!actionCfg?.needsFilter,
        showThreshold: true,
        fixedThreshold: null,
        defaultThreshold: 1,
      };

      if (streakRow) streakRow.style.display = timeRange === 'streak' ? '' : 'none';
      if (filterRow) filterRow.style.display = fieldState.showFilter ? '' : 'none';
      if (thresholdRow) thresholdRow.style.display = fieldState.showThreshold ? '' : 'none';
      if (thresholdInput && fieldState.fixedThreshold != null) {
        thresholdInput.value = String(fieldState.fixedThreshold);
      } else if (thresholdInput && !thresholdInput.value) {
        thresholdInput.value = String(fieldState.defaultThreshold || 1);
      }
    };

    const updateConditionPreview = () => {
      const preview = document.getElementById('ach-cond-preview');
      if (!preview) return;

      const condition = buildConditionFromForm();
      const registry = getRegistry();
      const actionSupported = registry?.isSupportedAction?.(condition.action) !== false;
      const timeRangeSupported = registry?.isStrictlySupportedTimeRange?.(document.getElementById('ach-cond-timerange')?.value || 'none') !== false;
      const prefix = (!actionSupported || !timeRangeSupported) ? '未支援條件: ' : '';
      preview.textContent = `「${prefix}${App._generateConditionDesc(condition)}」`;
    };

    const bindAchBadgeUpload = () => {
      const input = document.getElementById('ach-badge-image');
      if (!input || input.dataset.bound === '1') return;

      input.dataset.bound = '1';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          App.showToast('請上傳 JPG 或 PNG 圖片');
          input.value = '';
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          App.showToast('圖片大小不可超過 5MB');
          input.value = '';
          return;
        }

        try {
          const dataURL = await App._compressImage(file, 400, 0.80, 'image/png');
          const setPreview = (finalURL) => {
            state.badgeDataURL = finalURL;
            const preview = document.getElementById('ach-badge-preview');
            if (preview) {
              preview.innerHTML = `<img src="${escapeHTML(finalURL)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`;
            }
          };

          if (App.showImageCropper) {
            App.showImageCropper(dataURL, {
              aspectRatio: 1,
              onConfirm: setPreview,
              onCancel: () => { input.value = ''; },
            });
          } else {
            setPreview(dataURL);
          }
        } catch (error) {
          console.error('[achievementAdmin.bindAchBadgeUpload]', error);
          App.showToast('徽章圖片處理失敗，請稍後再試');
          input.value = '';
        }
      });
    };

    const saveAchievement = async () => {
      const name = document.getElementById('ach-input-name')?.value.trim() || '';
      const category = document.getElementById('ach-input-category')?.value || 'bronze';
      if (!name) {
        App.showToast('請填寫成就名稱');
        return;
      }

      const condition = buildConditionFromForm();
      const registry = getRegistry();
      if (!registry?.isSupportedAction?.(condition.action)) {
        App.showToast('這個條件目前尚未支援');
        return;
      }

      try {
        if (state.editId) {
          const item = ApiService.getAchievements().find(achievement => achievement.id === state.editId);
          if (!item) {
            App.showToast('找不到要編輯的成就');
            return;
          }

          let completedAt = item.completedAt || null;
          const editActionCfg = getRegistry()?.findActionMeta?.(condition.action);
          const editIsReverse = !!editActionCfg?.reverseComparison;
          const editMet = editIsReverse
            ? (item.current || 0) <= condition.threshold
            : (item.current || 0) >= condition.threshold;
          if (editMet && !completedAt) {
            const d = new Date();
            completedAt = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
          } else if (!editMet) {
            completedAt = null;
          }

          await ApiService.updateAchievement(state.editId, { name, category, condition, completedAt });
          if (item.badgeId) {
            const badgeUpdates = { name, category };
            if (state.badgeDataURL) badgeUpdates.image = state.badgeDataURL;
            await ApiService.updateBadge(item.badgeId, badgeUpdates);
          }
          ApiService._writeOpLog?.('ach_edit', '編輯成就', `編輯成就 ${name}`);
          App.showToast(`成就 ${name} 已更新`);
        } else {
          const newId = generateId('a');
          const newBadgeId = generateId('b');
          await ApiService.createAchievement({
            id: newId,
            name,
            category,
            badgeId: newBadgeId,
            completedAt: null,
            current: 0,
            status: 'active',
            condition,
          });
          await ApiService.createBadge({
            id: newBadgeId,
            name,
            achId: newId,
            category,
            image: state.badgeDataURL || null,
          });
          ApiService._writeOpLog?.('ach_create', '新增成就', `新增成就 ${name}`);
          App.showToast(`成就 ${name} 已建立`);
        }

        hideAchForm();
        renderAdminAchievements();
        App.renderAchievements?.();
      } catch (error) {
        console.error('[achievementAdmin.saveAchievement]', error);
        App.showToast('儲存成就失敗，請稍後再試');
      }
    };

    const editAchievement = (id) => {
      const item = ApiService.getAchievements().find(achievement => achievement.id === id);
      if (item) showAchForm(item);
    };

    const toggleAchievementStatus = async (id) => {
      const item = ApiService.getAchievements().find(achievement => achievement.id === id);
      if (!item) return;

      const newStatus = item.status === 'archived' ? 'active' : 'archived';
      try {
        await ApiService.updateAchievement(id, { status: newStatus });
        ApiService._writeOpLog?.('ach_toggle', '切換成就狀態', `${newStatus === 'archived' ? '下架' : '上架'} ${item.name}`);
        renderAdminAchievements();
        App.renderAchievements?.();
        App.showToast(`成就 ${item.name} 已${newStatus === 'archived' ? '下架' : '上架'}`);
      } catch (error) {
        console.error('[achievementAdmin.toggleAchievementStatus]', error);
        App.showToast('切換成就狀態失敗，請稍後再試');
      }
    };

    const toggleAchievementLock = async (id) => {
      const item = ApiService.getAchievements().find(achievement => achievement.id === id);
      if (!item) return;

      const isCurrentlyLocked = item.locked !== false;
      const newLocked = !isCurrentlyLocked;

      const message = newLocked
        ? `確定要鎖定「${item.name}」嗎？\n\n` +
          '鎖定後，用戶一旦達成此成就就永久保留，\n' +
          '即使後續條件不再滿足也不會被撤銷。\n\n' +
          '適合：累計型成就（報名 N 場、完成 N 場）'
        : `確定要解鎖「${item.name}」嗎？\n\n` +
          '解鎖後，若用戶不再滿足條件，\n' +
          '成就會在下次評估時被自動撤銷。\n\n' +
          '適合：持續維持型成就（出席率、連續無放鴿子）';

      const ok = await App.appConfirm(message);
      if (!ok) return;

      try {
        await ApiService.updateAchievement(id, { locked: newLocked });
        ApiService._writeOpLog?.('ach_edit', '切換成就鎖定', `${newLocked ? '鎖定' : '解鎖'} ${item.name}`);
        renderAdminAchievements();
        App.showToast(`成就「${item.name}」已${newLocked ? '鎖定' : '解鎖'}`);
      } catch (error) {
        console.error('[achievementAdmin.toggleAchievementLock]', error);
        App.showToast('切換鎖定狀態失敗，請稍後再試');
      }
    };

    const confirmDeleteAchievement = async (id) => {
      const item = ApiService.getAchievements().find(achievement => achievement.id === id);
      if (!item) return;

      const ok = await App.appConfirm(`確定要刪除成就「${item.name}」嗎？\n對應徽章也會一起刪除，且無法復原。`);
      if (!ok) return;

      try {
        if (item.badgeId) {
          await ApiService.deleteBadge(item.badgeId);
        }
        await ApiService.deleteAchievement(id);
        ApiService._writeOpLog?.('ach_delete', '刪除成就', `刪除成就 ${item.name}`);
        renderAdminAchievements();
        App.renderAchievements?.();
        App.showToast(`成就 ${item.name} 已刪除`);
      } catch (error) {
        console.error('[achievementAdmin.confirmDeleteAchievement]', error);
        App.showToast('刪除成就失敗，請稍後再試');
      }
    };

    const openManualAwardPanel = async (achId) => {
      const achievement = (ApiService.getAchievements() || []).find(a => a.id === achId);
      if (!achievement) return;

      const users = ApiService.getAdminUsers?.() || [];
      const badge = (ApiService.getBadges() || []).find(b => b.id === achievement.badgeId);
      const badgeName = badge?.name || achievement.name;

      const overlay = document.createElement('div');
      overlay.id = 'manual-award-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1rem';
      overlay.innerHTML = `
        <div style="background:var(--bg-card);border-radius:12px;width:100%;max-width:420px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:.75rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <span style="font-weight:600;font-size:.9rem">手動授予 — ${escapeHTML(badgeName)}</span>
            <button id="manual-award-close" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted);padding:.2rem">&times;</button>
          </div>
          <div style="padding:.75rem 1rem">
            <input id="manual-award-search" type="text" placeholder="搜尋用戶名稱..."
              style="width:100%;padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;font-size:.82rem;background:var(--bg-elevated);color:var(--text-primary);box-sizing:border-box">
            <div id="manual-award-results" style="max-height:180px;overflow-y:auto;margin-top:.5rem"></div>
          </div>
          <div style="padding:0 1rem .75rem;flex:1;overflow-y:auto">
            <div style="font-size:.76rem;color:var(--text-muted);margin-bottom:.4rem">已授予用戶</div>
            <div id="manual-award-list"></div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const closePanel = () => overlay.remove();
      overlay.querySelector('#manual-award-close').addEventListener('click', closePanel);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

      // Load current awardees
      const awardeeList = overlay.querySelector('#manual-award-list');
      const renderAwardees = async () => {
        let awardees = [];
        try {
          const db = typeof FirebaseService !== 'undefined' ? FirebaseService._db : null;
          if (!db) { awardeeList.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted)">無法讀取</div>'; return; }
          const allUsers = users;
          for (const u of allUsers) {
            const uid = normalizeString(u?.uid || u?._docId);
            if (!uid) continue;
            try {
              const doc = await db.collection('users').doc(uid).collection('achievements').doc(achId).get();
              if (doc.exists) {
                const data = doc.data();
                if (data?.completedAt) {
                  awardees.push({ uid, name: u.displayName || u.name || uid, completedAt: data.completedAt });
                }
              }
            } catch (_) {}
          }
        } catch (_) {}

        if (!awardees.length) {
          awardeeList.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted)">尚無已授予用戶</div>';
          return;
        }
        awardeeList.innerHTML = awardees.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--border)">
            <span style="font-size:.8rem">${escapeHTML(a.name)}</span>
            <button class="text-btn" style="font-size:.7rem;color:var(--danger)" data-revoke-uid="${a.uid}">撤銷</button>
          </div>`).join('');
        awardeeList.querySelectorAll('[data-revoke-uid]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const uid = btn.dataset.revokeUid;
            const ok = await App.appConfirm(`確定要撤銷「${escapeHTML(badgeName)}」？`);
            if (!ok) return;
            try {
              const db = FirebaseService._db;
              await db.collection('users').doc(uid).collection('achievements').doc(achId).set({
                achId, current: 0, completedAt: null, updatedAt: new Date().toISOString(),
              });
              ApiService._writeOpLog?.('ach_manual_revoke', '撤銷手動成就', `撤銷 ${badgeName} from ${uid}`);
              App.showToast('已撤銷');
              await renderAwardees();
            } catch (err) {
              console.error('[manualAward.revoke]', err);
              App.showToast('撤銷失敗');
            }
          });
        });
      };
      await renderAwardees();

      // Search and award
      const searchInput = overlay.querySelector('#manual-award-search');
      const resultsDiv = overlay.querySelector('#manual-award-results');
      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          const query = normalizeString(searchInput.value).toLowerCase();
          if (!query || query.length < 1) { resultsDiv.innerHTML = ''; return; }
          const matches = users.filter(u => {
            const name = (u.displayName || u.name || '').toLowerCase();
            const uid = normalizeString(u.uid || u._docId).toLowerCase();
            return name.includes(query) || uid.includes(query);
          }).slice(0, 10);
          if (!matches.length) {
            resultsDiv.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:.3rem 0">無符合用戶</div>';
            return;
          }
          resultsDiv.innerHTML = matches.map(u => {
            const uid = normalizeString(u.uid || u._docId);
            const name = u.displayName || u.name || uid;
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border)">
              <span style="font-size:.8rem">${escapeHTML(name)}</span>
              <button class="text-btn" style="font-size:.7rem;color:var(--accent)" data-award-uid="${uid}" data-award-name="${escapeHTML(name)}">授予</button>
            </div>`;
          }).join('');
          resultsDiv.querySelectorAll('[data-award-uid]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const uid = btn.dataset.awardUid;
              const userName = btn.dataset.awardName;
              const ok = await App.appConfirm(`確定要授予「${escapeHTML(badgeName)}」給 ${userName}？`);
              if (!ok) return;
              try {
                const db = FirebaseService._db;
                const now = new Date();
                const completedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
                await db.collection('users').doc(uid).collection('achievements').doc(achId).set({
                  achId, current: 1, completedAt, updatedAt: now.toISOString(),
                });
                ApiService._writeOpLog?.('ach_manual_award', '手動授予成就', `授予 ${badgeName} to ${userName}(${uid})`);
                App.showToast(`已授予「${badgeName}」給 ${userName}`);
                searchInput.value = '';
                resultsDiv.innerHTML = '';
                await renderAwardees();
              } catch (err) {
                console.error('[manualAward.award]', err);
                App.showToast('授予失敗');
              }
            });
          });
        }, 200);
      });
    };

    return {
      populateAchConditionSelects,
      renderAdminAchievements,
      showAchForm,
      hideAchForm,
      updateAchConditionUI,
      updateConditionPreview,
      bindAchBadgeUpload,
      saveAchievement,
      editAchievement,
      toggleAchievementStatus,
      toggleAchievementLock,
      confirmDeleteAchievement,
      openManualAwardPanel,
    };
  },

});

App._registerAchievementPart('admin', App._buildAchievementAdmin());
