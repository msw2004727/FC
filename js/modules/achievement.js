/* ================================================
   SportHub — Achievement & Badge (Render + Admin CRUD)
   成就條件式系統 — 條件下拉組合 + 徽章圖片上傳
   ================================================ */

Object.assign(App, {

  _catOrder: { gold: 0, silver: 1, bronze: 2 },
  _catColors: { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' },
  _catBg: { gold: 'rgba(212,160,23,.12)', silver: 'rgba(156,163,175,.12)', bronze: 'rgba(184,115,51,.12)' },
  _catLabels: { gold: '金', silver: '銀', bronze: '銅' },

  _sortByCat(items) {
    return [...items].sort((a, b) => (this._catOrder[a.category] ?? 9) - (this._catOrder[b.category] ?? 9));
  },

  // ── 條件描述自動產生 ──

  _generateConditionDesc(condition, desc) {
    if (!condition) return desc || '（未設定條件）';
    const ac = ACHIEVEMENT_CONDITIONS;
    const actionCfg = ac.actions.find(a => a.key === condition.action);
    const timeRangeCfg = ac.timeRanges.find(t => t.key === condition.timeRange);
    const filterCfg = ac.filters.find(f => f.key === condition.filter);
    const actionLabel = actionCfg ? actionCfg.label : condition.action;
    const unit = actionCfg ? actionCfg.unit : '';
    const threshold = condition.threshold != null ? condition.threshold : 0;

    // 特殊：連續 N 天
    if (condition.timeRange === 'streak') {
      const days = condition.streakDays || threshold;
      const filterText = (filterCfg && condition.filter !== 'all' && actionCfg && actionCfg.needsFilter) ? ` ${filterCfg.label}` : '';
      return `連續 ${days} 天${actionLabel}${filterText}`;
    }

    // 無單位型（如 bind_line_notify, complete_profile, join_team）
    if (!unit && threshold <= 1) return actionLabel;

    const timeText = (timeRangeCfg && condition.timeRange !== 'none') ? `${timeRangeCfg.label}` : '';
    const filterText = (filterCfg && condition.filter !== 'all' && actionCfg && actionCfg.needsFilter) ? ` ${filterCfg.label}` : '';

    if (timeText) {
      return `${timeText}${actionLabel}${filterText} ${threshold}${unit ? ' ' + unit : ''}`.trim();
    }
    return `${actionLabel}${filterText} ${threshold}${unit ? ' ' + unit : ''}`.trim();
  },

  _getAchThreshold(ach) {
    if (ach.condition && ach.condition.threshold != null) return ach.condition.threshold;
    if (ach.target != null) return ach.target;
    return 1;
  },

  // ══════════════════════════════════
  //  User-facing: 合併成就+徽章頁面
  // ══════════════════════════════════

  renderAchievements() {
    const container = document.getElementById('achievement-grid');
    if (!container) return;
    const achievements = ApiService.getAchievements().filter(a => a.status !== 'archived');
    const badges = ApiService.getBadges();
    const sorted = this._sortByCat(achievements);
    const pending = sorted.filter(a => a.current < this._getAchThreshold(a));
    const completed = sorted.filter(a => a.current >= this._getAchThreshold(a));

    // 已完成的徽章（用於頂部展示區）
    const earnedBadges = completed.map(a => {
      const badge = badges.find(b => b.id === a.badgeId);
      if (!badge) return null;
      const color = this._catColors[a.category] || this._catColors.bronze;
      return { badge, color, achName: a.name };
    }).filter(Boolean);

    const renderCard = a => {
      const threshold = this._getAchThreshold(a);
      const done = a.current >= threshold;
      const pct = threshold > 0 ? Math.min(100, Math.round(a.current / threshold * 100)) : 0;
      const badge = badges.find(b => b.id === a.badgeId);
      const badgeImg = badge && badge.image
        ? `<img src="${badge.image}" alt="${escapeHTML(badge.name)}" loading="lazy">`
        : `<span style="font-size:1.2rem;color:var(--text-muted)">🏅</span>`;
      const desc = this._generateConditionDesc(a.condition, a.desc);
      const catColor = this._catColors[a.category] || this._catColors.bronze;

      return `
      <div class="ach-card ${done ? 'ach-card-done' : ''}" style="border-color:${catColor}">
        <div class="ach-card-badge ${done ? '' : 'ach-badge-gray'}">
          ${badgeImg}
          ${done ? '<div class="ach-card-done-overlay">已完成</div>' : ''}
        </div>
        <div class="ach-card-body">
          <div class="ach-card-top">
            <span class="ach-cat-chip ach-cat-${a.category}">${this._catLabels[a.category] || '銅'}</span>
            <span class="ach-card-name">${escapeHTML(a.name)}</span>
          </div>
          <div class="ach-card-desc">${escapeHTML(desc)}</div>
          ${done
            ? `<div class="ach-card-completed-date">${a.completedAt ? escapeHTML(a.completedAt) : ''}</div>`
            : `<div class="ach-card-progress">
                <div class="ach-bar-mini"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
                <span class="ach-card-num">${a.current}/${threshold}</span>
              </div>`
          }
        </div>
      </div>`;
    };

    let html = '';

    // ── 徽章展示區 ──
    if (earnedBadges.length) {
      html += '<div class="ach-section-title">已獲得徽章</div>';
      html += '<div class="ach-badge-showcase">' + earnedBadges.map(({ badge, color, achName }) => `
        <div class="ach-showcase-item">
          <div class="ach-showcase-img">${badge.image ? `<img src="${badge.image}" loading="lazy">` : '<span>🏅</span>'}</div>
          <span class="ach-showcase-name">${escapeHTML(badge.name)}</span>
        </div>
      `).join('') + '</div>';
      html += '<div class="ach-divider"></div>';
    }

    // ── 未完成 ──
    if (pending.length) {
      html += '<div class="ach-section-title">進行中</div>';
      html += '<div class="ach-card-grid">' + pending.map(renderCard).join('') + '</div>';
    }

    // ── 分隔線 ──
    if (pending.length && completed.length) {
      html += '<div class="ach-divider"></div>';
    }

    // ── 已完成 ──
    if (completed.length) {
      html += '<div class="ach-section-title">已完成</div>';
      html += '<div class="ach-card-grid">' + completed.map(renderCard).join('') + '</div>';
    }

    if (!pending.length && !completed.length) {
      html = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">尚無成就</div>';
    }
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Admin: 合併管理（無頁簽）
  // ══════════════════════════════════

  _populateAchConditionSelects() {
    const ac = ACHIEVEMENT_CONDITIONS;
    const trSel = document.getElementById('ach-cond-timerange');
    const actSel = document.getElementById('ach-cond-action');
    const filtSel = document.getElementById('ach-cond-filter');
    if (trSel && !trSel.options.length) {
      trSel.innerHTML = ac.timeRanges.map(t => `<option value="${t.key}">${escapeHTML(t.label)}</option>`).join('');
    }
    if (actSel && !actSel.options.length) {
      actSel.innerHTML = ac.actions.map(a => `<option value="${a.key}">${escapeHTML(a.label)}</option>`).join('');
    }
    if (filtSel && !filtSel.options.length) {
      filtSel.innerHTML = ac.filters.map(f => `<option value="${f.key}">${escapeHTML(f.label)}</option>`).join('');
    }
  },

  _achEditId: null,
  _achBadgeDataURL: null,

  renderAdminAchievements() {
    const container = document.getElementById('admin-ach-list');
    if (!container) return;
    const items = this._sortByCat(ApiService.getAchievements());
    const badges = ApiService.getBadges();

    container.innerHTML = items.map((a, i) => {
      const isArchived = a.status === 'archived';
      const color = this._catColors[a.category] || this._catColors.bronze;
      const threshold = this._getAchThreshold(a);
      const pct = threshold > 0 ? Math.min(100, Math.round(a.current / threshold * 100)) : 0;
      const completed = a.current >= threshold;
      const badge = badges.find(b => b.id === a.badgeId);
      const badgeImg = badge && badge.image
        ? `<img src="${badge.image}" style="width:100%;height:100%;object-fit:cover;border-radius:4px" loading="lazy">`
        : '<span style="font-size:.9rem">🏅</span>';
      const desc = this._generateConditionDesc(a.condition, a.desc);
      return `
      <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${isArchived ? 'var(--text-muted)' : color};${isArchived ? 'opacity:.55;' : ''}">
        <div class="badge-img-placeholder small" style="border-color:${color};flex-shrink:0">${badgeImg}</div>
        <div class="admin-ach-info" style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">
            <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${this._catLabels[a.category]}</span>
            <span class="admin-ach-name">${escapeHTML(a.name)}</span>
            ${isArchived ? '<span style="font-size:.6rem;color:var(--danger);font-weight:600">已下架</span>' : ''}
            ${!isArchived && completed ? '<span style="font-size:.6rem;color:var(--success);font-weight:600">已完成</span>' : ''}
          </div>
          <div class="admin-ach-status" style="color:var(--text-muted)">${escapeHTML(desc)}</div>
          <div class="ach-progress-bar-wrap" style="margin-top:.25rem;height:4px">
            <div class="ach-progress-bar" style="width:${pct}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
          </div>
        </div>
        <div class="admin-ach-actions">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editAchievement('${a.id}')">編輯</button>
          <button class="text-btn" style="font-size:.72rem;color:${isArchived ? 'var(--success)' : 'var(--danger)'}" onclick="App.toggleAchievementStatus('${a.id}')">${isArchived ? '上架' : '下架'}</button>
          <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.confirmDeleteAchievement('${a.id}')">刪除</button>
        </div>
      </div>`;
    }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無成就</div>';
  },

  // ── Achievement Form (條件選單) ──

  showAchForm(editData) {
    const form = document.getElementById('ach-form-card');
    if (!form) return;
    form.style.display = '';
    this._achEditId = editData ? editData.id : null;
    this._achBadgeDataURL = null;
    document.getElementById('ach-form-title').textContent = editData ? '編輯成就' : '新增成就';
    document.getElementById('ach-input-name').value = editData ? editData.name : '';
    document.getElementById('ach-input-category').value = editData ? editData.category : 'bronze';

    // 條件欄位
    const cond = editData && editData.condition ? editData.condition : {};
    document.getElementById('ach-cond-timerange').value = cond.timeRange || 'none';
    document.getElementById('ach-cond-streakdays').value = cond.streakDays || 7;
    document.getElementById('ach-cond-action').value = cond.action || 'complete_event';
    document.getElementById('ach-cond-filter').value = cond.filter || 'all';
    document.getElementById('ach-cond-threshold').value = cond.threshold != null ? cond.threshold : 1;

    // 徽章圖片預覽
    const preview = document.getElementById('ach-badge-preview');
    if (preview) {
      const badge = editData ? ApiService.getBadges().find(b => b.id === editData.badgeId) : null;
      if (badge && badge.image) {
        preview.innerHTML = `<img src="${badge.image}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`;
      } else {
        preview.innerHTML = '<span style="color:var(--text-muted);font-size:.7rem">點擊上傳</span>';
      }
    }

    this._updateAchConditionUI();
    this._updateConditionPreview();
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideAchForm() {
    const form = document.getElementById('ach-form-card');
    if (form) form.style.display = 'none';
    this._achEditId = null;
    this._achBadgeDataURL = null;
  },

  _updateAchConditionUI() {
    const timeRange = document.getElementById('ach-cond-timerange').value;
    const action = document.getElementById('ach-cond-action').value;
    const streakRow = document.getElementById('ach-cond-streakdays-row');
    const filterRow = document.getElementById('ach-cond-filter-row');
    const actionCfg = ACHIEVEMENT_CONDITIONS.actions.find(a => a.key === action);

    if (streakRow) streakRow.style.display = timeRange === 'streak' ? '' : 'none';
    if (filterRow) filterRow.style.display = (actionCfg && actionCfg.needsFilter) ? '' : 'none';
  },

  _updateConditionPreview() {
    const preview = document.getElementById('ach-cond-preview');
    if (!preview) return;
    const condition = {
      timeRange: document.getElementById('ach-cond-timerange').value,
      streakDays: parseInt(document.getElementById('ach-cond-streakdays').value) || 7,
      action: document.getElementById('ach-cond-action').value,
      filter: document.getElementById('ach-cond-filter').value,
      threshold: parseInt(document.getElementById('ach-cond-threshold').value) || 0,
    };
    preview.textContent = '「' + this._generateConditionDesc(condition) + '」';
  },

  _readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  _bindAchBadgeUpload() {
    const input = document.getElementById('ach-badge-image');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 5MB');
        input.value = '';
        return;
      }
      const dataURL = await this._compressImage(file, 400, 0.80);
      this._achBadgeDataURL = dataURL;
      const preview = document.getElementById('ach-badge-preview');
      if (preview) {
        preview.innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`;
      }
    });
  },

  saveAchievement() {
    const name = document.getElementById('ach-input-name').value.trim();
    const category = document.getElementById('ach-input-category').value;
    if (!name) { this.showToast('請輸入成就名稱'); return; }

    const condition = {
      timeRange: document.getElementById('ach-cond-timerange').value,
      streakDays: parseInt(document.getElementById('ach-cond-streakdays').value) || 7,
      action: document.getElementById('ach-cond-action').value,
      filter: document.getElementById('ach-cond-filter').value,
      threshold: parseInt(document.getElementById('ach-cond-threshold').value) || 0,
    };
    // 非 streak 時不保留 streakDays
    if (condition.timeRange !== 'streak') delete condition.streakDays;

    if (this._achEditId) {
      const item = ApiService.getAchievements().find(a => a.id === this._achEditId);
      if (item) {
        const oldThreshold = this._getAchThreshold(item);
        let completedAt = item.completedAt;
        if (item.current >= condition.threshold && !completedAt) {
          const d = new Date();
          completedAt = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        } else if (item.current < condition.threshold) {
          completedAt = null;
        }
        ApiService.updateAchievement(this._achEditId, { name, category, condition, completedAt });
        // 更新關聯徽章
        if (item.badgeId) {
          const updates = { name: name + '徽章', category };
          if (this._achBadgeDataURL) updates.image = this._achBadgeDataURL;
          ApiService.updateBadge(item.badgeId, updates);
        }
        ApiService._writeOpLog('ach_edit', '編輯成就', `編輯「${name}」`);
        this.showToast(`成就「${name}」已更新`);
      }
    } else {
      const newId = generateId('a');
      const newBadgeId = generateId('b');
      ApiService.createAchievement({ id: newId, name, category, badgeId: newBadgeId, completedAt: null, current: 0, status: 'active', condition });
      ApiService.createBadge({ id: newBadgeId, name: name + '徽章', achId: newId, category, image: this._achBadgeDataURL || null });
      ApiService._writeOpLog('ach_create', '建立成就', `建立「${name}」`);
      this.showToast(`成就「${name}」已建立，已自動建立關聯徽章`);
    }

    this.hideAchForm();
    this.renderAdminAchievements();
    this.renderAchievements();
  },

  editAchievement(id) {
    const item = ApiService.getAchievements().find(a => a.id === id);
    if (item) this.showAchForm(item);
  },

  toggleAchievementStatus(id) {
    const item = ApiService.getAchievements().find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'archived' ? 'active' : 'archived';
    ApiService.updateAchievement(id, { status: newStatus });
    ApiService._writeOpLog('ach_toggle', '成就上下架', `${newStatus === 'archived' ? '下架' : '上架'}「${item.name}」`);
    this.renderAdminAchievements();
    this.renderAchievements();
    this.showToast(`成就「${item.name}」已${newStatus === 'archived' ? '下架' : '上架'}`);
  },

  async confirmDeleteAchievement(id) {
    const item = ApiService.getAchievements().find(a => a.id === id);
    if (!item) return;
    const ok = await this.appConfirm(`確定要刪除成就「${item.name}」嗎？\n關聯的徽章也會一併刪除，此操作無法復原。`);
    if (!ok) return;
    // 刪除關聯徽章
    if (item.badgeId) {
      ApiService.deleteBadge(item.badgeId);
    }
    ApiService.deleteAchievement(id);
    ApiService._writeOpLog('ach_delete', '刪除成就', `刪除「${item.name}」`);
    this.renderAdminAchievements();
    this.renderAchievements();
    this.showToast(`成就「${item.name}」已刪除`);
  },

});
