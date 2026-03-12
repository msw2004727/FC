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
    };

    const getRegistry = () => App._getAchievementRegistry?.();
    const getShared = () => App._getAchievementShared?.();
    const getStats = () => App._getAchievementStats?.();

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
      const rawTimeRange = document.getElementById('ach-cond-timerange')?.value || 'none';
      const condition = {
        timeRange: registry?.getEffectiveTimeRangeKey?.(rawTimeRange) || rawTimeRange || 'none',
        streakDays: parseInt(document.getElementById('ach-cond-streakdays')?.value || '7', 10) || 7,
        action: document.getElementById('ach-cond-action')?.value || 'complete_event',
        filter: document.getElementById('ach-cond-filter')?.value || 'all',
        threshold: parseInt(document.getElementById('ach-cond-threshold')?.value || '0', 10) || 0,
      };
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

    const renderAdminAchievements = () => {
      const container = document.getElementById('admin-ach-list');
      if (!container) return;

      App._evaluateAchievements?.();
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
        const pct = threshold > 0 ? Math.min(100, Math.round((achievement.current || 0) / threshold * 100)) : 0;
        const completed = stats?.isCompleted?.(achievement) ?? (achievement.current >= threshold);
        const badge = badges.find(item => item.id === achievement.badgeId);
        const badgeImg = badge?.image
          ? `<img src="${escapeHTML(badge.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px" loading="lazy">`
          : '<span style="font-size:.9rem">🏅</span>';
        const desc = App._generateConditionDesc(achievement.condition, achievement.desc);
        const actionSupported = registry?.isSupportedAction?.(achievement.condition?.action || '') !== false;
        const timeRangeSupported = registry?.isStrictlySupportedTimeRange?.(achievement.condition?.timeRange || 'none') !== false;
        const hasLegacyWarning = !actionSupported || !timeRangeSupported;

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
      const actionCfg = getRegistry()?.findActionConfig?.(action)
        || ACHIEVEMENT_CONDITIONS.actions.find(item => item.key === action);

      if (streakRow) streakRow.style.display = timeRange === 'streak' ? '' : 'none';
      if (filterRow) filterRow.style.display = (actionCfg && actionCfg.needsFilter) ? '' : 'none';
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
          if ((item.current || 0) >= condition.threshold && !completedAt) {
            const d = new Date();
            completedAt = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
          } else if ((item.current || 0) < condition.threshold) {
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
      confirmDeleteAchievement,
    };
  },

});

App._registerAchievementPart('admin', App._buildAchievementAdmin());
