/* ================================================
   SportHub — Message: Admin Compose & Send
   Split from message-admin.js — pure move, no logic changes
   Security: all user content passes through escapeHTML() before DOM insertion
   ================================================ */

Object.assign(App, {

  // ── 撰寫信件 ──
  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (!el) return;
    document.getElementById('msg-category').value = 'system';
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    document.getElementById('msg-schedule').value = '';
    document.getElementById('msg-target').value = 'all';
    document.getElementById('msg-individual-row').style.display = 'none';
    document.getElementById('msg-individual-target').value = '';
    document.getElementById('msg-target-result').textContent = '';
    const userDd = document.getElementById('msg-user-dropdown');
    if (userDd) userDd.classList.remove('open');
    const teamRow = document.getElementById('msg-team-row');
    if (teamRow) teamRow.style.display = 'none';
    const teamInput = document.getElementById('msg-team-target');
    if (teamInput) teamInput.value = '';
    const teamResult = document.getElementById('msg-team-result');
    if (teamResult) teamResult.textContent = '';
    const teamDd = document.getElementById('msg-team-dropdown');
    if (teamDd) teamDd.classList.remove('open');
    this._msgMatchedUser = null;
    this._msgMatchedTeam = null;
    el.style.display = 'flex';
  },

  hideMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (el) el.style.display = 'none';
  },

  // ── 發送對象切換 ──
  onMsgTargetChange() {
    const val = document.getElementById('msg-target').value;
    const indRow = document.getElementById('msg-individual-row');
    const teamRow = document.getElementById('msg-team-row');
    if (indRow) indRow.style.display = val === 'individual' ? '' : 'none';
    if (teamRow) teamRow.style.display = val === 'team' ? '' : 'none';
  },

  // ── 搜尋用戶 (UID/暱稱) ── 模糊搜尋 + 下拉選單
  _msgMatchedUser: null,
  _msgMatchedTeam: null,

  searchMsgTarget() {
    const input = document.getElementById('msg-individual-target').value.trim();
    const dropdown = document.getElementById('msg-user-dropdown');
    const result = document.getElementById('msg-target-result');
    if (!result) return;
    if (!input) {
      result.textContent = '';
      this._msgMatchedUser = null;
      if (dropdown) dropdown.classList.remove('open');
      return;
    }
    const q = input.toLowerCase();
    const users = ApiService.getAdminUsers();
    const matches = users.filter(u =>
      (u.name && u.name.toLowerCase().includes(q)) || (u.uid && u.uid.toLowerCase().includes(q))
    ).slice(0, 8);

    if (dropdown) {
      if (matches.length) {
        const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
        dropdown.innerHTML = matches.map(u => {
          const roleLabel = roleLabels[u.role]?.label || u.role || '';
          return `<div class="ce-delegate-item" data-uid="${u.uid}" data-name="${escapeHTML(u.name)}">
            <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
            <span class="ce-delegate-item-meta">${escapeHTML(u.uid)} · ${escapeHTML(roleLabel)}</span>
          </div>`;
        }).join('');
        dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
          item.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            this._selectMsgUser(item.dataset.uid);
          });
        });
        dropdown.classList.add('open');
      } else {
        dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
        dropdown.classList.add('open');
      }
    }
    // 即時精準匹配提示
    const exact = users.find(u => u.uid === input || u.name === input);
    if (exact) {
      this._msgMatchedUser = exact;
      result.innerHTML = `<span style="color:var(--success)">&#10003; 找到：${escapeHTML(exact.name)}（${escapeHTML(exact.uid)}）・ ${escapeHTML(exact.role)}</span>`;
    } else {
      this._msgMatchedUser = null;
      result.textContent = '';
    }
  },

  _selectMsgUser(uid) {
    const users = ApiService.getAdminUsers();
    const match = users.find(u => u.uid === uid);
    if (!match) return;
    this._msgMatchedUser = match;
    const input = document.getElementById('msg-individual-target');
    if (input) input.value = match.name;
    const dropdown = document.getElementById('msg-user-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    const result = document.getElementById('msg-target-result');
    if (result) result.innerHTML = `<span style="color:var(--success)">&#10003; 已選取：${escapeHTML(match.name)}（${escapeHTML(match.uid)}）・ ${escapeHTML(match.role)}</span>`;
  },

  // ── 搜尋球隊（模糊搜尋 + 下拉選單）──
  searchMsgTeam() {
    const input = document.getElementById('msg-team-target').value.trim();
    const dropdown = document.getElementById('msg-team-dropdown');
    const result = document.getElementById('msg-team-result');
    if (!result) return;
    if (!input) {
      result.textContent = '';
      this._msgMatchedTeam = null;
      if (dropdown) dropdown.classList.remove('open');
      return;
    }
    const q = input.toLowerCase();
    const teams = ApiService.getTeams?.() || [];
    const matches = teams.filter(t =>
      t.active !== false && t.name && t.name.toLowerCase().includes(q)
    ).slice(0, 8);

    if (dropdown) {
      if (matches.length) {
        dropdown.innerHTML = matches.map(t =>
          `<div class="ce-delegate-item" data-tid="${t.id}" data-tname="${escapeHTML(t.name)}">
            <span class="ce-delegate-item-name">${escapeHTML(t.name)}</span>
            <span class="ce-delegate-item-meta">${t.members || 0}人 · ${escapeHTML(t.region || '')}</span>
          </div>`
        ).join('');
        dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
          item.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            this._selectMsgTeam(item.dataset.tid, item.dataset.tname);
          });
        });
        dropdown.classList.add('open');
      } else {
        dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的球隊</div>';
        dropdown.classList.add('open');
      }
    }
  },

  _selectMsgTeam(teamId, teamName) {
    this._msgMatchedTeam = { id: teamId, name: teamName };
    const input = document.getElementById('msg-team-target');
    if (input) input.value = teamName;
    const dropdown = document.getElementById('msg-team-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    const result = document.getElementById('msg-team-result');
    if (result) result.innerHTML = `<span style="color:var(--success)">&#10003; 已選取：${escapeHTML(teamName)}</span>`;
  },

  // ── 發送信件（實裝） ──
  sendMessage() {
    const title = document.getElementById('msg-title')?.value.trim();
    if (!title) { this.showToast('請輸入信件標題'); return; }
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const body = document.getElementById('msg-body')?.value.trim();
    if (!body) { this.showToast('請輸入信件內容'); return; }
    if (body.length > 300) { this.showToast('內容不可超過 300 字'); return; }
    const category = document.getElementById('msg-category')?.value || 'system';
    const catNames = { system: '系統', activity: '活動', private: '私訊' };
    const targetType = document.getElementById('msg-target')?.value || 'all';
    const schedule = document.getElementById('msg-schedule')?.value;

    // targetType → label / role 映射
    const targetLabelMap = {
      all: '全體用戶', coach_up: '教練以上', admin: '管理員',
      coach: '全體教練', captain: '全體領隊', venue_owner: '全體場主',
    };
    const roleTargetMap = {
      coach: ['coach', 'admin', 'super_admin'],
      captain: ['captain', 'admin', 'super_admin'],
      venue_owner: ['venue_owner', 'admin', 'super_admin'],
      coach_up: ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'],
      admin: ['admin', 'super_admin'],
    };

    // 解析對象
    let targetLabel = targetLabelMap[targetType] || '全體用戶';
    let targetUid = null;
    let targetName = null;
    let targetTeamId = null;
    let targetRoles = roleTargetMap[targetType] || null;

    if (targetType === 'team') {
      if (!this._msgMatchedTeam) {
        this.showToast('請先搜尋並選取目標球隊');
        return;
      }
      targetLabel = this._msgMatchedTeam.name;
      targetTeamId = this._msgMatchedTeam.id;
    } else if (targetType === 'individual') {
      if (!this._msgMatchedUser) {
        this.showToast('請先搜尋並確認目標用戶');
        return;
      }
      targetLabel = this._msgMatchedUser.name;
      targetUid = this._msgMatchedUser.uid;
      targetName = this._msgMatchedUser.name;
    }

    // 發送人：LINE 暱稱優先
    const senderName = this._getMsgSenderName();

    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const isScheduled = !!schedule;

    // 建立 admin 記錄
    const adminMsg = {
      id: 'mg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title,
      category,
      categoryName: catNames[category] || '系統',
      target: targetLabel,
      targetUid: targetUid || null,
      targetName: targetName || null,
      targetTeamId: targetTeamId || null,
      targetRoles: targetRoles || null,
      targetType,
      senderName,
      readRate: '-',
      time: timeStr,
      status: isScheduled ? 'scheduled' : 'sent',
      body,
      scheduledAt: isScheduled ? schedule : null,
    };
    ApiService.createAdminMessage(adminMsg);

    // 立即發送 → 同時投遞到用戶收件箱
    if (!isScheduled) {
      const extra = { adminMsgId: adminMsg.id, targetType };
      if (targetTeamId) extra.targetTeamId = targetTeamId;
      if (targetRoles) extra.targetRoles = targetRoles;
      this._deliverMessageToInbox(title, body, category, catNames[category], targetUid, senderName, extra);
      // LINE 推播：依對象類型篩選目標用戶
      this._queueLinePushByTarget(targetType, targetUid, category, title, body, targetTeamId);
    }

    // 重置表單
    this.hideMsgCompose();
    this._msgMatchedUser = null;
    this._msgMatchedTeam = null;
    this.renderMsgManage(isScheduled ? 'scheduled' : 'sent');
    // 切換 tab
    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.querySelector(`[data-mfilter="${isScheduled ? 'scheduled' : 'sent'}"]`)?.classList.add('active');
    }
    this.showToast(isScheduled ? '信件已排程' : '信件已發送');
  },

});
