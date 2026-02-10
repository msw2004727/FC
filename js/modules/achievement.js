/* ================================================
   SportHub — Achievement & Badge (Render + Admin CRUD)
   ================================================ */

Object.assign(App, {

  _catOrder: { gold: 0, silver: 1, bronze: 2 },
  _catColors: { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' },
  _catBg: { gold: 'rgba(212,160,23,.12)', silver: 'rgba(156,163,175,.12)', bronze: 'rgba(184,115,51,.12)' },
  _catLabels: { gold: '金', silver: '銀', bronze: '銅' },

  _sortByCat(items) {
    return [...items].sort((a, b) => (this._catOrder[a.category] ?? 9) - (this._catOrder[b.category] ?? 9));
  },

  renderAchievements() {
    const container = document.getElementById('achievement-grid');
    if (!container) return;
    const sorted = this._sortByCat(ApiService.getAchievements());
    const pending = sorted.filter(a => a.current < a.target);
    const completed = sorted.filter(a => a.current >= a.target);
    const renderRow = a => {
      const done = a.current >= a.target;
      const pct = a.target > 0 ? Math.min(100, Math.round(a.current / a.target * 100)) : 0;
      const bg = this._catBg[a.category] || this._catBg.bronze;
      return `
      <div class="ach-row ${done ? 'ach-done' : ''}" style="background:${done ? 'var(--bg-elevated)' : bg}">
        <span class="ach-cat-chip ach-cat-${a.category}">${this._catLabels[a.category] || '銅'}</span>
        <span class="ach-row-name">${escapeHTML(a.name)}</span>
        <span class="ach-row-desc">${escapeHTML(a.desc)}</span>
        <div class="ach-bar-mini"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
        <span class="ach-row-num">${a.current}/${a.target}</span>
        ${done ? `<span class="ach-row-done">已完成</span>` : ''}
        ${done && a.completedAt ? `<span class="ach-row-time">${escapeHTML(a.completedAt)}</span>` : ''}
      </div>`;
    };
    let html = pending.map(renderRow).join('');
    if (pending.length && completed.length) {
      html += '<div class="ach-divider"><span>已完成</span></div>';
    }
    html += completed.map(renderRow).join('');
    container.innerHTML = html;
  },

  renderBadges() {
    const container = document.getElementById('badge-grid');
    if (!container) return;
    const achievements = ApiService.getAchievements();
    const sorted = this._sortByCat(ApiService.getBadges());
    container.innerHTML = sorted.map(b => {
      const ach = achievements.find(a => a.id === b.achId);
      const earned = ach ? ach.current >= ach.target : false;
      const color = this._catColors[b.category] || this._catColors.bronze;
      return `
      <div class="badge-card ${earned ? '' : 'badge-locked'}" style="border-color:${color}">
        <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
        <div class="badge-card-name">${escapeHTML(b.name)}</div>
        ${earned ? `<div class="badge-earned-tag" style="color:${color}">已獲得</div>` : '<div class="badge-locked-tag">未解鎖</div>'}
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Admin Achievement / Badge Management
  // ══════════════════════════════════

  _adminAchTab: 'achievements',
  _achEditId: null,
  _badgeEditId: null,

  renderAdminAchievements(type) {
    const container = document.getElementById('admin-ach-list');
    if (!container) return;
    const t = type || this._adminAchTab;
    this._adminAchTab = t;
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };
    const catLabels = { gold: '金', silver: '銀', bronze: '銅' };

    if (t === 'achievements') {
      const items = this._sortByCat(ApiService.getAchievements());
      container.innerHTML = items.map((a, i) => {
        const color = catColors[a.category] || catColors.bronze;
        const pct = a.target > 0 ? Math.min(100, Math.round(a.current / a.target * 100)) : 0;
        const completed = a.current >= a.target;
        return `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${color}">
          <div class="admin-ach-info" style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.3rem">
              <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${catLabels[a.category]}</span>
              <span class="admin-ach-name">${escapeHTML(a.name)}</span>
              ${completed ? '<span style="font-size:.6rem;color:var(--success);font-weight:600">已完成</span>' : ''}
            </div>
            <div class="admin-ach-status" style="color:var(--text-muted)">${escapeHTML(a.desc)} ・ 目標 ${a.target}</div>
            <div class="ach-progress-bar-wrap" style="margin-top:.25rem;height:4px">
              <div class="ach-progress-bar" style="width:${pct}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
            </div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.editAchievement('${a.id}')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteAchievement('${a.id}')">刪除</button>
          </div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無成就</div>';

    } else {
      const items = this._sortByCat(ApiService.getBadges());
      const achievements = ApiService.getAchievements();
      container.innerHTML = items.map((b, i) => {
        const color = catColors[b.category] || catColors.bronze;
        const ach = achievements.find(a => a.id === b.achId);
        const achName = ach ? ach.name : '（未關聯）';
        return `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'};border-left:3px solid ${color}">
          <div class="badge-img-placeholder small" style="border-color:${color};flex-shrink:0">${b.image ? `<img src="${b.image}">` : ''}</div>
          <div class="admin-ach-info" style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.3rem">
              <span class="ach-cat-tag" style="background:${color};font-size:.6rem;padding:.1rem .3rem">${catLabels[b.category]}</span>
              <span class="admin-ach-name">${escapeHTML(b.name)}</span>
            </div>
            <div class="admin-ach-status" style="color:var(--text-muted)">關聯成就：${escapeHTML(achName)}</div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.editBadge('${b.id}')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.deleteBadge('${b.id}')">刪除</button>
          </div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">尚無徽章</div>';
    }

    // Bind tabs once
    const tabs = document.getElementById('admin-ach-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
          tab.classList.add('active');
          this._adminAchTab = tab.dataset.atype;
          this.renderAdminAchievements(tab.dataset.atype);
        });
      });
    }
  },

  // ── Achievement CRUD ──

  showAchForm(editData) {
    const form = document.getElementById('ach-form-card');
    if (!form) return;
    form.style.display = '';
    this._achEditId = editData ? editData.id : null;
    document.getElementById('ach-form-title').textContent = editData ? '編輯成就' : '新增成就';
    document.getElementById('ach-input-name').value = editData ? editData.name : '';
    document.getElementById('ach-input-desc').value = editData ? editData.desc : '';
    document.getElementById('ach-input-target').value = editData ? editData.target : 10;
    document.getElementById('ach-input-category').value = editData ? editData.category : 'bronze';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideAchForm() {
    const form = document.getElementById('ach-form-card');
    if (form) form.style.display = 'none';
    this._achEditId = null;
  },

  saveAchievement() {
    const name = document.getElementById('ach-input-name').value.trim();
    const desc = document.getElementById('ach-input-desc').value.trim();
    const target = parseInt(document.getElementById('ach-input-target').value) || 1;
    const category = document.getElementById('ach-input-category').value;
    if (!name) { this.showToast('請輸入成就名稱'); return; }

    if (this._achEditId) {
      const item = ApiService.getAchievements().find(a => a.id === this._achEditId);
      if (item) {
        const oldTarget = item.target;
        let completedAt = item.completedAt;
        if (item.current >= target && !completedAt) {
          const d = new Date(); completedAt = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        } else if (item.current < target) {
          completedAt = null;
        }
        ApiService.updateAchievement(this._achEditId, { name, desc, target, category, completedAt });
        this.showToast(`成就「${name}」已更新（目標 ${oldTarget} → ${target}）`);
      }
    } else {
      const newId = generateId('a');
      const newBadgeId = generateId('b');
      ApiService.createAchievement({ id: newId, name, desc, target, current: 0, category, badgeId: newBadgeId, completedAt: null });
      ApiService.createBadge({ id: newBadgeId, name: name + '徽章', achId: newId, category, image: null });
      this.showToast(`成就「${name}」已建立，已自動建立關聯徽章`);
    }

    this.hideAchForm();
    this.renderAdminAchievements('achievements');
    this.renderAchievements();
    this.renderBadges();
  },

  editAchievement(id) {
    const item = ApiService.getAchievements().find(a => a.id === id);
    if (item) this.showAchForm(item);
  },

  deleteAchievement(id) {
    const data = ApiService.getAchievements();
    const item = data.find(a => a.id === id);
    if (!item) return;
    const name = item.name;
    const badgeId = item.badgeId;
    ApiService.deleteAchievement(id);
    if (badgeId) ApiService.deleteBadge(badgeId);
    this.renderAdminAchievements();
    this.renderAchievements();
    this.renderBadges();
    this.showToast(`成就「${name}」及關聯徽章已刪除，所有用戶同步移除`);
  },

  // ── Badge CRUD ──

  showBadgeForm(editData) {
    const form = document.getElementById('badge-form-card');
    if (!form) return;
    form.style.display = '';
    this._badgeEditId = editData ? editData.id : null;
    document.getElementById('badge-form-title').textContent = editData ? '編輯徽章' : '新增徽章';
    document.getElementById('badge-input-name').value = editData ? editData.name : '';
    document.getElementById('badge-input-category').value = editData ? editData.category : 'bronze';
    // Populate achievement select
    const select = document.getElementById('badge-input-ach');
    select.innerHTML = '<option value="">（不關聯成就）</option>' +
      ApiService.getAchievements().map(a => `<option value="${a.id}" ${editData && editData.achId === a.id ? 'selected' : ''}>${escapeHTML(a.name)}</option>`).join('');
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideBadgeForm() {
    const form = document.getElementById('badge-form-card');
    if (form) form.style.display = 'none';
    this._badgeEditId = null;
  },

  saveBadge() {
    const name = document.getElementById('badge-input-name').value.trim();
    const category = document.getElementById('badge-input-category').value;
    const achId = document.getElementById('badge-input-ach').value;
    if (!name) { this.showToast('請輸入徽章名稱'); return; }

    if (this._badgeEditId) {
      ApiService.updateBadge(this._badgeEditId, { name, category, achId });
      this.showToast(`徽章「${name}」已更新`);
    } else {
      ApiService.createBadge({ id: generateId('b'), name, achId, category, image: null });
      this.showToast(`徽章「${name}」已建立`);
    }

    this.hideBadgeForm();
    this.renderAdminAchievements('badges');
    this.renderBadges();
  },

  editBadge(id) {
    const item = ApiService.getBadges().find(b => b.id === id);
    if (item) this.showBadgeForm(item);
  },

  deleteBadge(id) {
    const badges = ApiService.getBadges();
    const item = badges.find(b => b.id === id);
    if (!item) return;
    const name = item.name;
    ApiService.deleteBadge(id);
    this.renderAdminAchievements();
    this.renderBadges();
    this.showToast(`徽章「${name}」已刪除，所有用戶同步移除`);
  },

});
