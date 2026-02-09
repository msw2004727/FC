/* ================================================
   SportHub — Admin Render & Create Methods
   依賴：config.js, data.js, api-service.js, app.js (core)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Render: Admin Users
  // ══════════════════════════════════

  renderAdminUsers() {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    container.innerHTML = ApiService.getAdminUsers().map(u => {
      let promoteOptions = '';
      if (myLevel >= 5) {
        promoteOptions = '<option value="">晉升▼</option><option>管理員</option><option>教練</option><option>領隊</option><option>場主</option>';
      } else if (myLevel >= 4) {
        promoteOptions = '<option value="">晉升▼</option><option>教練</option><option>領隊</option><option>場主</option>';
      }

      return `
        <div class="admin-user-card">
          <div class="profile-avatar small">${u.name[0]}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
            <div class="admin-user-meta">${u.uid} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${u.region}</div>
          </div>
          <div class="admin-user-actions">
            ${promoteOptions ? `<select class="promote-select" onchange="App.handlePromote(this, '${u.name}')">${promoteOptions}</select>` : ''}
            <button class="text-btn" onclick="App.showUserProfile('${u.name}')">查看</button>
          </div>
        </div>
      `;
    }).join('');
  },

  handlePromote(select, name) {
    if (select.value) {
      this.showToast(`已將「${name}」晉升為「${select.value}」`);
      select.value = '';
    }
  },

  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getExpLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">${this._userTag(l.target)} <strong>${l.amount}</strong>「${l.reason}」</span>
      </div>
    `).join('');
  },

  demoExpSearch() {
    this.showToast('已搜尋到用戶「暱稱A」');
  },

  renderOperationLogs() {
    const container = document.getElementById('operation-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getOperationLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${l.typeName}</span>
          ${l.operator}：${l.content}
        </span>
      </div>
    `).join('');
  },

  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getBanners().map(b => `
      <div class="banner-manage-card">
        <div class="banner-thumb" style="background:${b.gradient}">${b.title.slice(0,2)}</div>
        <div class="banner-manage-info">
          <div class="banner-manage-title">${b.title}</div>
          <div class="banner-manage-meta">${b.position} ・ ${b.publishAt}~${b.unpublishAt} ・ 點擊 ${b.clicks}</div>
          <span class="banner-manage-status status-${b.status}">${b.status === 'active' ? '啟用中' : b.status === 'scheduled' ? '已排程' : '已到期'}</span>
        </div>
      </div>
    `).join('');
  },

  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getShopItems().map(s => `
      <div class="sm-card">
        <div class="sm-thumb">商品縮圖<br>60 × 60</div>
        <div class="sm-info">
          <div class="sm-title">${s.name}</div>
          <div class="sm-meta">${s.condition} ・ ${s.size} ・ <strong style="color:var(--accent)">$${s.price}</strong></div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showShopDetail('${s.id}')">查看</button>
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)">下架</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Message Management
  // ══════════════════════════════════

  _msgData: [
    { id:'mg1', title:'春季聯賽報名開始', target:'全體', readRate:'72%', time:'03/01', status:'sent', body:'2026 春季足球聯賽現已開放報名，請至賽事中心查看詳情。' },
    { id:'mg2', title:'系統維護通知', target:'全體', readRate:'85%', time:'02/18', status:'sent', body:'本週六凌晨將進行系統更新，預計停機2小時。' },
    { id:'mg3', title:'球隊集訓通知', target:'雷霆隊', readRate:'90%', time:'02/15', status:'sent', body:'本週六下午2點集合於大安運動中心進行球隊集訓。' },
    { id:'mg4', title:'新春盃報名提醒', target:'全體', readRate:'-', time:'03/20', status:'scheduled', body:'新春盃淘汰賽即將截止報名，請把握機會。' },
    { id:'mg5', title:'舊版本停用通知', target:'全體', readRate:'45%', time:'01/10', status:'recalled', body:'此信件已回收。' },
  ],

  renderMsgManage(filter) {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    const f = filter || 'sent';
    const items = this._msgData.filter(m => m.status === f);
    container.innerHTML = items.length ? items.map(m => `
      <div class="msg-manage-card">
        <div class="msg-manage-header">
          <span class="msg-manage-title">${m.title}</span>
          <span class="msg-read-rate">${m.status === 'sent' ? '已讀率 ' + m.readRate : m.status === 'scheduled' ? '排程中' : '已回收'}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">對象：${m.target} ・ ${m.time}</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.body}</div>
        <div style="margin-top:.4rem;display:flex;gap:.3rem">
          ${m.status === 'sent' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('信件內容：${m.body.slice(0,20)}...')">查看</button><button class="text-btn" style="font-size:.75rem;color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>` : ''}
          ${m.status === 'scheduled' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('已取消排程')">取消排程</button>` : ''}
          ${m.status === 'recalled' ? `<button class="text-btn" style="font-size:.75rem;color:var(--text-muted)">已回收</button>` : ''}
        </div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">無信件</div>';

    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMsgManage(tab.dataset.mfilter);
        });
      });
    }
  },

  recallMsg(id) {
    const m = this._msgData.find(x => x.id === id);
    if (m) { m.status = 'recalled'; this.renderMsgManage('sent'); this.showToast('已回收信件'); }
  },

  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (el) { el.style.display = ''; el.scrollIntoView({ behavior: 'smooth' }); }
  },

  sendDemoMsg() {
    const title = document.getElementById('msg-title')?.value || '未命名信件';
    const target = document.getElementById('msg-target')?.value || '全體用戶';
    const body = document.getElementById('msg-body')?.value || '';
    const schedule = document.getElementById('msg-schedule')?.value;
    this._msgData.unshift({
      id: 'mg' + Date.now(), title, target, readRate: '-', time: new Date().toLocaleDateString('zh-TW').replace(/\//g, '/'),
      status: schedule ? 'scheduled' : 'sent', body: body || title
    });
    document.getElementById('msg-compose').style.display = 'none';
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    this.renderMsgManage(schedule ? 'scheduled' : 'sent');
    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.querySelector(`[data-mfilter="${schedule ? 'scheduled' : 'sent'}"]`)?.classList.add('active');
    }
    this.showToast(schedule ? '信件已排程' : '信件已發送');
  },

  // ══════════════════════════════════
  //  Render: Tournament Management
  // ══════════════════════════════════

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div class="event-card-title">${t.name}</div>
          <div class="event-meta">
            <span class="event-meta-item">${t.type}</span>
            <span class="event-meta-item">${t.teams} 隊</span>
            <span class="event-meta-item">${t.status}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small">管理賽程</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">輸入比分</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">交易設定</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">紅黃牌</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Admin Team Management
  // ══════════════════════════════════

  filterAdminTeams() {
    const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
    this.renderAdminTeams(q);
  },

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t => t.name.toLowerCase().includes(q) || t.nameEn.toLowerCase().includes(q) || t.captain.includes(q) || t.region.includes(q));
    container.innerHTML = teams.length ? teams.map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${t.emblem} ${t.name} <span style="font-size:.72rem;color:var(--text-muted)">${t.nameEn}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">至頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${t.captain}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${t.region}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消至頂' : '至頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
          </div>
        </div>
      </div>
    `).join('') : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的球隊</div>';
  },

  _pinCounter: 100,
  toggleTeamPin(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) {
      this._pinCounter++;
      t.pinOrder = this._pinCounter;
    } else {
      t.pinOrder = 0;
    }
    ApiService.updateTeam(id, { pinned: t.pinned, pinOrder: t.pinOrder });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.pinned ? `已至頂「${t.name}」` : `已取消至頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

  // ══════════════════════════════════
  //  Render: Admin Achievements/Badges
  // ══════════════════════════════════

  renderAdminAchievements(type) {
    const container = document.getElementById('admin-ach-list');
    if (!container) return;
    const t = type || 'achievements';
    if (t === 'achievements') {
      const items = ApiService.getAchievements();
      container.innerHTML = items.map((a, i) => `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'}">
          <div class="admin-ach-icon" style="background:${a.unlocked ? 'var(--accent)' : 'var(--text-muted)'}">${a.icon}</div>
          <div class="admin-ach-info">
            <div class="admin-ach-name">${a.name}</div>
            <div class="admin-ach-status" style="color:${a.unlocked ? 'var(--success)' : 'var(--text-muted)'}">預設：${a.unlocked ? '已解鎖' : '未解鎖'}</div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.showToast('編輯成就：${a.name}（Demo）')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.showToast('已刪除：${a.name}（Demo）')">刪除</button>
          </div>
        </div>
      `).join('');
    } else {
      const items = ApiService.getBadges();
      container.innerHTML = items.map((b, i) => `
        <div class="admin-ach-row" style="background:${i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent'}">
          <div class="admin-ach-icon" style="background:var(--accent)">${b.icon}</div>
          <div class="admin-ach-info">
            <div class="admin-ach-name">${b.name}</div>
            <div class="admin-ach-status" style="color:var(--text-muted)">徽章</div>
          </div>
          <div class="admin-ach-actions">
            <button class="text-btn" style="font-size:.72rem" onclick="App.showToast('編輯徽章：${b.name}（Demo）')">編輯</button>
            <button class="text-btn" style="font-size:.72rem;color:var(--danger)" onclick="App.showToast('已刪除：${b.name}（Demo）')">刪除</button>
          </div>
        </div>
      `).join('');
    }
    // Bind tabs once
    const tabs = document.getElementById('admin-ach-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
          tab.classList.add('active');
          this.renderAdminAchievements(tab.dataset.atype);
        });
      });
    }
  },

  // ══════════════════════════════════
  //  Render: Permissions & Inactive
  // ══════════════════════════════════

  renderPermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;
    container.innerHTML = ApiService.getPermissions().map((cat, ci) => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map((p, pi) => `
            <label class="perm-item">
              <input type="checkbox" ${Math.random() > 0.5 ? 'checked' : ''}>
              <span>${p.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

  renderRoleHierarchy() {
    const container = document.getElementById('role-hierarchy-list');
    if (!container) return;
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];
    container.innerHTML = roles.map((key, i) => {
      const r = ROLES[key];
      return `<div class="role-level-row">
        <span class="role-level-num">Lv.${i}</span>
        <span class="role-level-badge" style="background:${r.color}">${r.label}</span>
        <span class="role-level-key">${key}</span>
        ${i >= 4 ? '' : '<button class="role-insert-btn" onclick="App.openRoleEditorAt(' + i + ')">＋ 插入</button>'}
      </div>`;
    }).join('');
  },

  openRoleEditor() {
    const editor = document.getElementById('role-editor-card');
    editor.style.display = '';
    document.getElementById('role-editor-title').textContent = '新增自訂層級';
    document.getElementById('role-name-input').value = '';
    const select = document.getElementById('role-position-select');
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin'];
    select.innerHTML = roles.map((key, i) => {
      const next = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'][i];
      return `<option value="${i}">${ROLES[key].label} 與 ${ROLES[next].label} 之間</option>`;
    }).join('');
    this.renderPermissions();
    editor.scrollIntoView({ behavior: 'smooth' });
  },

  openRoleEditorAt(levelIndex) {
    this.openRoleEditor();
    document.getElementById('role-position-select').value = levelIndex;
  },

  renderInactiveData() {
    const container = document.getElementById('inactive-list');
    if (!container) return;
    container.innerHTML = `
      <div class="inactive-card">
        <div style="font-weight:700">鳳凰隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/12/15</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱Z ・ 原成員：14 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
      <div class="inactive-card">
        <div style="font-weight:700">颱風隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/08/20</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱W ・ 原成員：10 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Render: My Activities
  // ══════════════════════════════════

  renderMyActivities() {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const myEvents = ApiService.getActiveEvents().slice(0, 6);
    container.innerHTML = myEvents.length > 0
      ? myEvents.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        return `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${e.title}</div>
            <span class="tl-event-status ${statusConf.css}" style="font-size:.68rem">${statusConf.label}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${e.location}</span>
            <span class="event-meta-item">${e.date}</span>
            <span class="event-meta-item">${e.current}/${e.max} 人</span>
          </div>
          <div style="display:flex;gap:.3rem;margin-top:.5rem">
            <button class="primary-btn small">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">查看名單</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)">關閉</button>
          </div>
        </div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">尚無管理中的活動</div>';
  },

  // ══════════════════════════════════
  //  Render: User Card
  // ══════════════════════════════════

  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;
    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-doll-frame"></div>
        <div class="profile-title">全勤.王小明</div>
        <div style="margin-top:.3rem">${this._userTag('王小明')}</div>
        <div class="profile-level">
          <span>Lv.10</span>
          <div class="exp-bar"><div class="exp-fill" style="width:40%"></div></div>
          <span class="exp-text">800/2000</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>男</span></div>
        <div class="info-row"><span>生日</span><span>2000/05/20</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>運動類別</span><span>足球</span></div>
        <div class="info-row"><span>所屬球隊</span><span>雷霆隊</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">成就 & 徽章</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <span class="ach-mini">新手</span>
          <span class="ach-mini">全勤</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">交易價值紀錄</div>
        <div style="font-size:.82rem;color:var(--text-muted)">目前無交易紀錄</div>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Create Event
  // ══════════════════════════════════

  _eventCounter: 100,
  handleCreateEvent() {
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const timeVal = document.getElementById('ce-time').value.trim();
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const waitlistMax = parseInt(document.getElementById('ce-waitlist').value) || 0;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const dateParts = dateVal.split('-');
    const dateStr = `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : dateStr;

    this._eventCounter++;
    const newEvent = {
      id: 'ce' + this._eventCounter,
      title, type, status: 'open', location, date: fullDate,
      fee, max, current: 0, waitlist: 0, waitlistMax, minAge, notes, image,
      creator: ROLES[this.currentRole]?.label || '一般用戶',
      contact: '',
      gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
      icon: '',
      countdown: '即將開始',
      participants: [],
      waitlistNames: [],
    };

    ApiService.createEvent(newEvent);
    this.renderActivityList();
    this.renderHotEvents();
    this.renderMyActivities();
    this.closeModal();
    this.showToast(`活動「${title}」已建立！`);

    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '5';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-image').value = '';
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Image Upload Preview
  // ══════════════════════════════════

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 2MB');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
          preview.classList.add('has-image');
        }
      };
      reader.readAsDataURL(file);
    });
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  _tournamentCounter: 100,
  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const status = document.getElementById('ct-status').value;

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    const ctPreviewEl = document.getElementById('ct-upload-preview');
    const ctImg = ctPreviewEl?.querySelector('img');
    const image = ctImg ? ctImg.src : null;

    this._tournamentCounter++;
    ApiService.createTournament({
      id: 'ct' + this._tournamentCounter,
      name, type, teams,
      matches: type.includes('聯賽') ? teams * (teams - 1) : teams - 1,
      status, image,
      gradient: TOURNAMENT_GRADIENT_MAP[type] || TOURNAMENT_GRADIENT_MAP['聯賽（雙循環）'],
    });

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    document.getElementById('ct-name').value = '';
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Create Shop Item
  // ══════════════════════════════════

  _shopCounter: 100,
  handleCreateShopItem() {
    const name = document.getElementById('cs-name').value.trim();
    const condition = document.getElementById('cs-condition').value;
    const price = parseInt(document.getElementById('cs-price').value) || 0;
    const size = document.getElementById('cs-size').value.trim() || '—';
    const desc = document.getElementById('cs-desc').value.trim();

    if (!name) { this.showToast('請輸入商品名稱'); return; }
    if (price <= 0) { this.showToast('請輸入價格'); return; }
    if (desc.length > 500) { this.showToast('描述不可超過 500 字'); return; }

    this._shopCounter++;
    ApiService.createShopItem({
      id: 'cs' + this._shopCounter,
      name, price, condition, year: 2026, size,
      desc: desc || '賣家未提供描述。',
    });

    this.renderShop();
    this.renderShopManage();
    this.closeModal();
    this.showToast(`商品「${name}」已上架！`);

    document.getElementById('cs-name').value = '';
    document.getElementById('cs-price').value = '';
    document.getElementById('cs-size').value = '';
    document.getElementById('cs-desc').value = '';
    ['cs-img1','cs-img2','cs-img3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['cs-preview1','cs-preview2','cs-preview3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-image'); el.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-hint">JPG/PNG 2MB</span>'; }
    });
  },

});
