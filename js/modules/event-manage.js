/* ================================================
   SportHub — Event: My Activity Management (Coach+)
   依賴：event-render.js (helpers)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  My Activities (Coach+)
  // ══════════════════════════════════

  _myActivityFilter: 'all',
  _myActivityCreatorFilter: '',

  renderMyActivities(filter) {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const f = filter || this._myActivityFilter || 'all';
    this._myActivityFilter = f;

    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    const isAdmin = myLevel >= ROLE_LEVEL_MAP.admin;

    // 場主(含)以下只看自己的活動或受委託的活動
    let allEvents = ApiService.getEvents();
    if (!isAdmin) {
      allEvents = allEvents.filter(e => this._isEventOwner(e) || this._isEventDelegate(e));
    }

    // 管理員主辦人篩選
    const creatorWrap = document.getElementById('my-activity-creator-wrap');
    if (creatorWrap) creatorWrap.style.display = isAdmin ? '' : 'none';
    const creatorInput = document.getElementById('my-activity-creator-input');
    const creatorClear = document.getElementById('my-activity-creator-clear');
    const creatorFilter = this._myActivityCreatorFilter;
    if (creatorInput && creatorFilter) creatorInput.value = creatorFilter;
    if (creatorClear) creatorClear.style.display = creatorFilter ? '' : 'none';
    if (creatorFilter) {
      allEvents = allEvents.filter(e => e.creator === creatorFilter);
    }

    const filtered = f === 'all' ? allEvents : allEvents.filter(e => e.status === f);

    // 統計
    const statsEl = document.getElementById('my-activity-stats');
    if (statsEl) {
      const upcomingCount = allEvents.filter(e => e.status === 'upcoming').length;
      const openCount = allEvents.filter(e => e.status === 'open').length;
      const fullCount = allEvents.filter(e => e.status === 'full').length;
      const endedCount = allEvents.filter(e => e.status === 'ended').length;
      const cancelledCount = allEvents.filter(e => e.status === 'cancelled').length;
      statsEl.textContent = `共 ${allEvents.length} 場${upcomingCount ? ' ・ 即將開放 ' + upcomingCount : ''} ・ 報名中 ${openCount} ・ 已額滿 ${fullCount} ・ 已結束 ${endedCount} ・ 已取消 ${cancelledCount}`;
    }

    const s = 'font-size:.72rem;padding:.2rem .5rem';
    container.innerHTML = filtered.length > 0
      ? filtered.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        const canManage = this._canManageEvent(e);
        let btns = '';
        if (canManage) {
          if (e.status === 'upcoming') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'open' || e.status === 'full') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.closeMyActivity('${e.id}')">結束</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'ended') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>`;
          } else if (e.status === 'cancelled') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>`;
          }
        } else {
          btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`;
        }
        const progressPct = e.max > 0 ? Math.min(100, Math.round(e.current / e.max * 100)) : 0;
        const progressColor = progressPct >= 100 ? 'var(--danger)' : progressPct >= 70 ? 'var(--warning)' : 'var(--success)';
        const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge" style="margin-left:.3rem">限定</span>' : '';
        // Fee summary
        const fee = e.fee || 0;
        const checkoutCount = fee > 0 ? new Set(ApiService.getAttendanceRecords(e.id).filter(r => r.type === 'checkout').map(r => r.uid)).size : 0;
        const feeExpected = fee * e.current;
        const feeActual = fee * checkoutCount;
        const feeShort = feeExpected - feeActual;
        const feeBox = fee > 0 ? `<div style="margin-left:auto;padding:.2rem .45rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.68rem;color:var(--text-secondary);display:inline-flex;gap:.5rem;background:var(--bg-elevated);white-space:nowrap">
          <span>應收<b style="color:var(--text-primary)">$${feeExpected}</b></span>
          <span>實收<b style="color:var(--success)">$${feeActual}</b></span>
          <span>短收<b style="color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}">$${feeShort}</b></span>
        </div>` : '';
        return `
      <div class="msg-manage-card" style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(e.title)}${teamBadge}</span>
          ${this._userTag(e.creator, ApiService.getUserRole(e.creator))}
          <span class="banner-manage-status status-${statusConf.css}">${statusConf.label}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${escapeHTML(e.location)} ・ ${escapeHTML(e.date)}</div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${progressPct}%;height:100%;background:${progressColor};border-radius:3px;transition:width .3s"></div>
          </div>
          <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">${e.current}/${e.max} 人${e.waitlist > 0 ? ' ・ 候補 ' + e.waitlist : ''}</span>
        </div>
        <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap;align-items:center">${btns}${feeBox}</div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">此分類沒有活動</div>';

    // 綁定 tabs
    const tabs = document.getElementById('my-activity-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMyActivities(tab.dataset.afilter);
        });
      });
    }
  },

  // ── 查看活動名單 ──
  showMyActivityDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const modal = document.getElementById('my-activity-detail-modal');
    const content = document.getElementById('my-activity-detail-content');
    if (!modal || !content) return;
    const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
    const participants = (e.participants || []).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.72rem;color:var(--text-muted);min-width:1.5rem">${i + 1}.</span>
        <span style="font-size:.82rem">${escapeHTML(p)}</span>
      </div>`
    ).join('');
    const waitlist = (e.waitlistNames || []).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.72rem;color:var(--text-muted);min-width:1.5rem">${i + 1}.</span>
        <span style="font-size:.82rem">${escapeHTML(p)}</span>
      </div>`
    ).join('');
    content.innerHTML = `
      <h3 style="margin:0 0 .4rem;font-size:1rem">${escapeHTML(e.title)}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem">
        <div>${escapeHTML(e.location)} ・ ${escapeHTML(e.date)}</div>
        <div>費用：${e.fee > 0 ? 'NT$' + e.fee : '免費'} ・ 狀態：${statusConf.label} ・ 主辦：${escapeHTML(e.creator)}</div>
      </div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.3rem">報名名單（${e.current}/${e.max}）</div>
      ${participants || '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>'}
      ${e.waitlist > 0 ? `
        <div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">候補名單（${e.waitlist}）</div>
        ${waitlist}
      ` : ''}
    `;
    modal.style.display = 'flex';
  },

  // ── 編輯活動 ──
  editMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this._editEventId = id;
    this.showModal('create-event-modal');
    document.getElementById('ce-title').value = e.title || '';
    document.getElementById('ce-type').value = e.type || 'friendly';
    document.getElementById('ce-location').value = e.location || '';
    const dateTime = (e.date || '').split(' ');
    const dateParts = (dateTime[0] || '').split('/');
    if (dateParts.length === 3) {
      document.getElementById('ce-date').value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
    }
    const timeStr = dateTime[1] || '';
    const timeParts = timeStr.split('~');
    const ceTimeStart = document.getElementById('ce-time-start');
    const ceTimeEnd = document.getElementById('ce-time-end');
    if (ceTimeStart && ceTimeEnd) {
      ceTimeStart.value = timeParts[0] || '14:00';
      ceTimeEnd.value = timeParts[1] || '16:00';
    }
    document.getElementById('ce-fee').value = e.fee || 0;
    document.getElementById('ce-max').value = e.max || 20;
    document.getElementById('ce-waitlist').value = 0;
    document.getElementById('ce-min-age').value = e.minAge || 0;
    document.getElementById('ce-notes').value = e.notes || '';
    // 開放報名時間
    const regOpenInput = document.getElementById('ce-reg-open-time');
    if (regOpenInput) regOpenInput.value = e.regOpenTime || '';
    // 球隊限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      this._updateTeamOnlyLabel();
    }
    const preview = document.getElementById('ce-upload-preview');
    if (e.image && preview) {
      preview.innerHTML = `<img src="${e.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    }
    // 委託人預填
    this._delegates = Array.isArray(e.delegates) ? [...e.delegates] : [];
    this._initDelegateSearch();
  },

  // ── 結束活動 ──
  async closeMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!await this.appConfirm('確定要結束此活動？')) return;
    ApiService.updateEvent(id, { status: 'ended' });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已結束');
  },

  // ── 取消活動 ──
  async cancelMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!await this.appConfirm('確定要取消此活動？')) return;

    // Trigger 4：活動取消通知 — 通知所有報名者與候補者
    if (e) {
      const adminUsers = ApiService.getAdminUsers();
      const allNames = [...(e.participants || []), ...(e.waitlistNames || [])];
      allNames.forEach(name => {
        const u = adminUsers.find(au => au.name === name);
        if (u) {
          this._sendNotifFromTemplate('event_cancelled', {
            eventName: e.title, date: e.date, location: e.location,
          }, u.uid, 'activity', '活動');
        }
      });
      // Firebase 模式：補查 registrations 確保不遺漏
      if (!ModeManager.isDemo()) {
        const regs = (FirebaseService._cache.registrations || []).filter(
          r => r.eventId === id && r.status !== 'cancelled'
        );
        const notifiedNames = new Set(allNames);
        regs.forEach(r => {
          if (r.userId && !notifiedNames.has(r.userName)) {
            this._sendNotifFromTemplate('event_cancelled', {
              eventName: e.title, date: e.date, location: e.location,
            }, r.userId, 'activity', '活動');
          }
        });
      }
    }

    ApiService.updateEvent(id, { status: 'cancelled' });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已取消');
  },

  // ── 重新開放 ──
  reopenMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    const newStatus = this._isEventTrulyFull(e) ? 'full' : 'open';
    ApiService.updateEvent(id, { status: newStatus });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新開放');
  },

  // ── 主辦人模糊搜尋篩選（管理員+） ──
  searchCreatorFilter() {
    const input = document.getElementById('my-activity-creator-input');
    const dd = document.getElementById('my-activity-creator-dropdown');
    if (!input || !dd) return;
    const keyword = input.value.trim().toLowerCase();
    if (!keyword) {
      dd.classList.remove('open');
      if (this._myActivityCreatorFilter) {
        this._myActivityCreatorFilter = '';
        this.renderMyActivities();
      }
      return;
    }
    const allEvents = ApiService.getEvents();
    const creators = [...new Set(allEvents.map(e => e.creator).filter(Boolean))];
    const matched = creators.filter(c => c.toLowerCase().includes(keyword)).slice(0, 8);
    if (!matched.length) { dd.classList.remove('open'); return; }
    dd.innerHTML = matched.map(c => {
      const safeC = escapeHTML(c).replace(/'/g, "\\'");
      const count = allEvents.filter(e => e.creator === c).length;
      return `<div class="ce-delegate-item" onclick="App._selectCreatorFilter('${safeC}')"><span class="ce-delegate-item-name">${escapeHTML(c)}</span><span style="color:var(--text-muted);font-size:.68rem">${count} 場</span></div>`;
    }).join('');
    dd.classList.add('open');
  },

  _selectCreatorFilter(name) {
    const input = document.getElementById('my-activity-creator-input');
    const dd = document.getElementById('my-activity-creator-dropdown');
    if (input) input.value = name;
    if (dd) dd.classList.remove('open');
    this._myActivityCreatorFilter = name;
    this.renderMyActivities();
  },

  clearCreatorFilter() {
    const input = document.getElementById('my-activity-creator-input');
    if (input) input.value = '';
    this._myActivityCreatorFilter = '';
    this.renderMyActivities();
  },

  // ── 刪除活動 ──
  async deleteMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!(await this.appConfirm('確定要刪除此活動？刪除後無法恢復。'))) return;
    ApiService.deleteEvent(id);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

});
