/* ================================================
   SportHub — Team: Detail View, Feed, Reactions
   依賴：team-list.js, config.js, api-service.js, i18n.js
   ================================================ */

Object.assign(App, {

  _teamDetailId: null,
  _teamFeedPage: {},
  _FEED_PAGE_SIZE: 20,
  _MAX_PINNED: 5,

  _teamLeaderTag(name) {
    return `<span class="user-capsule uc-team-leader" onclick="App.showUserProfile('${escapeHTML(name)}')" title="球隊領隊">${escapeHTML(name)}</span>`;
  },

  _isTeamMember(teamId) {
    if (ModeManager.isDemo()) return this._userTeam === teamId;
    const user = ApiService.getCurrentUser();
    if (user && user.teamId === teamId) return true;
    // 也檢查是否為該隊球隊經理、領隊或教練
    const team = ApiService.getTeam(teamId);
    if (!team || !user) return false;
    if (team.captainUid && team.captainUid === user.uid) return true;
    if (team.captain && team.captain === user.displayName) return true;
    if ((team.coaches || []).includes(user.displayName)) return true;
    const leaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    if (leaderUids.includes(user.uid)) return true;
    return false;
  },

  _refreshTeamDetailEditButton(team) {
    const btn = document.getElementById('team-detail-edit-btn');
    if (!btn) return;
    btn.style.display = this._canEditTeamByRoleOrCaptain?.(team) ? '' : 'none';
  },

  openTeamDetailEdit() {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('您沒有編輯此球隊的權限');
      return;
    }
    this.showTeamForm(team.id);
  },

  showTeamDetail(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    this._teamDetailId = id;
    this._refreshTeamDetailEditButton(t);
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';

    const imgEl = document.getElementById('team-detail-img');
    const detailRank = this._getTeamRank(t.teamExp);
    imgEl.style.position = 'relative';
    if (t.image) {
      imgEl.innerHTML = `<img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    } else {
      imgEl.innerHTML = `球隊封面 800 × 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:${detailRank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${detailRank.rank}</span>`;
    }

    const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
    const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.info')}</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">球隊經理</span><span class="td-card-value">${t.captain ? this._userTag(t.captain, 'captain') : I18N.t('teamDetail.notSet')}</span></div>
          <div class="td-card-item"><span class="td-card-label">領隊</span><span class="td-card-value">${(() => { const lNames = t.leaders || (t.leader ? [t.leader] : []); return lNames.length ? lNames.map(n => this._teamLeaderTag(n)).join(' ') : I18N.t('teamDetail.notSet'); })()}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.coach')}</span><span class="td-card-value">${(t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : I18N.t('teamDetail.none')}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.memberCount')}</span><span class="td-card-value">${t.members} ${I18N.t('teamDetail.personUnit')}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.region')}</span><span class="td-card-value">${escapeHTML(t.region)}</span></div>
          ${t.nationality ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.nationality')}</span><span class="td-card-value">${escapeHTML(t.nationality)}</span></div>` : ''}
          ${t.founded ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.founded')}</span><span class="td-card-value">${escapeHTML(t.founded)}</span></div>` : ''}
          ${t.contact ? `<div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.contact')}</span><span class="td-card-value">${escapeHTML(t.contact)}</span></div>` : ''}
        </div>
      </div>
      ${t.bio ? `<div class="td-card">
        <div class="td-card-title" style="text-align:center">${I18N.t('teamDetail.bio')}</div>
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(t.bio)}</div>
      </div>` : ''}
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.record')}</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.wins')}</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.draws')}</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses || 0}</span><span class="td-stat-label">${I18N.t('teamDetail.losses')}</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">${I18N.t('teamDetail.winRate')}</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalsFor')}</span><span class="td-card-value">${t.gf || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalsAgainst')}</span><span class="td-card-value">${t.ga || 0}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.goalDiff')}</span><span class="td-card-value">${(t.gf || 0) - (t.ga || 0) > 0 ? '+' : ''}${(t.gf || 0) - (t.ga || 0)}</span></div>
          <div class="td-card-item"><span class="td-card-label">${I18N.t('teamDetail.totalGames')}</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title profile-collapse-toggle" onclick="App.toggleProfileSection(this,'teamMatch')">
          <span>${I18N.t('teamDetail.matchHistory')}</span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        <div class="profile-collapse-content" style="display:none">
          ${(t.history || []).map(h => `
            <div class="td-history-row">
              <span class="td-history-name">${escapeHTML(h.name)}</span>
              <span class="td-history-result">${escapeHTML(h.result)}</span>
            </div>
          `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">' + I18N.t('teamDetail.noHistory') + '</div>'}
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title profile-collapse-toggle" onclick="App.toggleProfileSection(this,'teamMembers')">
          <span>${I18N.t('teamDetail.memberList')}</span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        <div class="profile-collapse-content td-member-tags" style="display:none">
          ${(() => {
            const allUsers = ApiService.getAdminUsers() || [];
            const teamMembers = allUsers.filter(u => u.teamId === t.id);
            const leaderNames = t.leaders || (t.leader ? [t.leader] : []);
            const staffNames = new Set([t.captain, ...leaderNames, ...(t.coaches || [])].filter(Boolean));
            const regularMembers = teamMembers.filter(u => !staffNames.has(u.name));
            if (!regularMembers.length) return `<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">${I18N.t('teamDetail.none')}</div>`;
            return regularMembers.map(u =>
              `<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(u.name)}')">${escapeHTML(u.name)}</span>`
            ).join('');
          })()}
        </div>
      </div>
      ${this._renderTeamEvents(t.id)}
      <div id="team-feed-section">${this._renderTeamFeed(t.id)}</div>
      ${(() => {
        const u = ApiService.getCurrentUser?.();
        const n = u?.displayName || '';
        const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
        const memberCanInvite = t.allowMemberInvite !== false;
        const canInvite = isCaptainCoach || (this._isTeamMember(t.id) && memberCanInvite);
        const isMember = this._isTeamMember(t.id);
        let html = '';
        // 上方區塊：邀請 QR Code + 隊員可邀請
        if (canInvite || isCaptainCoach) {
          html += `<div class="td-card" style="padding:.6rem .8rem">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">`;
          if (canInvite) html += `<button class="outline-btn" onclick="App.showTeamInviteQR('${t.id}')">${I18N.t('teamDetail.inviteQR')}</button>`;
          if (isCaptainCoach) html += `<div style="display:inline-flex;align-items:center;gap:.35rem"><span style="font-size:.72rem;color:var(--text-muted)">${I18N.t('teamDetail.memberCanInvite')}</span><label class="toggle-switch" style="margin:0;transform:scale(.8)"><input type="checkbox" ${memberCanInvite ? 'checked' : ''} onchange="App.toggleMemberInvite('${t.id}',this.checked)"><span class="toggle-slider"></span></label></div>`;
          html += `</div></div>`;
        }
        // 下方區塊：退出球隊 / 聯繫領隊（或申請加入）
        html += `<div class="td-card" style="padding:.6rem .8rem">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">`;
        if (isMember) {
          html += `<button style="background:var(--danger);color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;font-weight:600;cursor:pointer" onclick="App.handleLeaveTeam('${t.id}')">${I18N.t('teamDetail.leaveTeam')}</button>`;
        } else {
          html += `<button class="primary-btn" onclick="App.handleJoinTeam('${t.id}')">${I18N.t('teamDetail.applyJoin')}</button>`;
        }
        if (t.captain) html += `<button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(t.captain)}')">${I18N.t('teamDetail.contactCaptain')}</button>`;
        html += `</div></div>`;
        return html;
      })()}
    `;
    this.showPage('page-team-detail');
  },

  // ══════════════════════════════════
  //  Team Events（球隊限定活動）
  // ══════════════════════════════════

  _renderTeamEvents(teamId) {
    const allEvents = ApiService.getEvents() || [];
    const teamEvents = allEvents.filter(e =>
      e.teamOnly && e.creatorTeamId === teamId &&
      e.status !== 'ended' && e.status !== 'cancelled'
    ).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!teamEvents.length) return '';

    const TYPE_COLOR = { play: '#3b82f6', friendly: '#10b981', coaching: '#f59e0b', watch: '#8b5cf6' };
    const STATUS_LABEL = { open: '報名中', full: '已額滿', upcoming: '即將開始' };

    const rows = teamEvents.map(e => {
      const datePart = (e.date || '').split(' ')[0];
      const timePart = (e.date || '').split(' ')[1] || '';
      const color = TYPE_COLOR[e.type] || '#6b7280';
      const statusLabel = STATUS_LABEL[e.status] || e.status;
      const spotsHtml = e.max > 0
        ? `<span style="font-size:.62rem;color:${e.current >= e.max ? 'var(--danger)' : 'var(--text-muted)'}">${e.current}/${e.max}</span>`
        : '';
      return `<div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.showEventDetail('${e.id}')">
        <div style="width:3px;align-self:stretch;border-radius:2px;background:${color};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(e.title)}</div>
          <div style="font-size:.68rem;color:var(--text-muted)">${escapeHTML(datePart)}${timePart ? ' ' + escapeHTML(timePart) : ''}${e.location ? ' · ' + escapeHTML(e.location) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.25rem;flex-shrink:0">
          ${spotsHtml}
          <span style="font-size:.6rem;padding:.08rem .3rem;border-radius:999px;background:${color}22;color:${color};font-weight:600">${escapeHTML(statusLabel)}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="td-card">
      <div class="td-card-title">球隊活動 <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${teamEvents.length})</span></div>
      ${rows}
    </div>`;
  },

  // ══════════════════════════════════
  //  Team Feed (動態牆)
  // ══════════════════════════════════

  _renderTeamFeed(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return '';
    const feed = t.feed || [];
    const isMember = this._isTeamMember(teamId);
    const user = ApiService.getCurrentUser?.();
    const myUid = user?.uid || '';
    const myName = user?.displayName || '';
    const isCaptainOrCoach = (t.captain === myName) || (t.coaches || []).includes(myName);

    // Sort: pinned first, then by time descending
    const sorted = [...feed].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.time || '').localeCompare(a.time || '');
    });

    // Pagination
    const currentPage = this._teamFeedPage[teamId] || 1;
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._FEED_PAGE_SIZE));
    const startIdx = (currentPage - 1) * this._FEED_PAGE_SIZE;
    const pageItems = sorted.slice(startIdx, startIdx + this._FEED_PAGE_SIZE);

    // Post form: textarea on top, button row below with public toggle on right
    const postFormHtml = isMember ? `
      <div style="margin-bottom:.5rem">
        <textarea id="team-feed-input" rows="2" maxlength="200" placeholder="${I18N.t('teamDetail.postPlaceholder')}" style="width:100%;font-size:.82rem;padding:.4rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.3rem">
          <button class="primary-btn small" onclick="App.submitTeamPost('${teamId}')">${I18N.t('teamDetail.publish')}</button>
          <div style="display:flex;align-items:center;gap:.3rem">
            <span id="team-feed-public-label" style="font-size:.72rem;color:var(--text-muted)">${I18N.t('teamDetail.public')}</span>
            <label class="toggle-switch" style="margin:0;transform:scale(.8)">
              <input type="checkbox" id="team-feed-public" checked>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>` : '';

    const postsHtml = pageItems.length > 0 ? pageItems.map(post => {
      const isAuthor = post.uid === myUid;
      const canDelete = isAuthor || isCaptainOrCoach;
      const canPin = isCaptainOrCoach;
      const publicTag = post.isPublic === false
        ? `<span style="font-size:.58rem;padding:.08rem .25rem;border-radius:3px;background:var(--bg-elevated);color:var(--text-muted);font-weight:600">${I18N.t('teamDetail.privateOnly')}</span>`
        : '';
      return `
        <div style="padding:.5rem 0;border-bottom:1px solid var(--border)${post.pinned ? ';background:var(--accent-bg);margin:0 -.5rem;padding-left:.5rem;padding-right:.5rem;border-radius:var(--radius-sm)' : ''}">
          <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
            ${this._userTag(post.name)}
            ${post.pinned ? '<span style="font-size:.6rem;padding:.1rem .3rem;border-radius:3px;background:#f59e0b;color:#fff;font-weight:700">' + I18N.t('teamDetail.pinned') + '</span>' : ''}
            ${publicTag}
            <span style="margin-left:auto;font-size:.68rem;color:var(--text-muted)">${escapeHTML(post.time)}</span>
          </div>
          <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(post.content)}</div>
          ${this._renderFeedReactions(teamId, post, myUid)}
          ${this._renderFeedComments(teamId, post, myUid, isMember)}
          <div style="display:flex;gap:.3rem;margin-top:.25rem">
            ${canPin ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-muted);cursor:pointer" onclick="App.pinTeamPost('${teamId}','${post.id}')">${post.pinned ? I18N.t('teamDetail.unpinPost') : I18N.t('teamDetail.pinPost')}</button>` : ''}
            ${canDelete ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--danger);cursor:pointer" onclick="App.deleteTeamPost('${teamId}','${post.id}')">${I18N.t('teamDetail.delete')}</button>` : ''}
          </div>
        </div>`;
    }).join('') : '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">' + I18N.t('teamDetail.noFeed') + '</div>';

    // Pagination controls
    let paginationHtml = '';
    if (totalPages > 1) {
      const prevDisabled = currentPage <= 1 ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      const nextDisabled = currentPage >= totalPages ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      paginationHtml = `
        <div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.5rem 0;font-size:.75rem">
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${prevDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage - 1})">${I18N.t('teamDetail.prevPage')}</button>
          <span style="color:var(--text-muted)">${currentPage} / ${totalPages}</span>
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${nextDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage + 1})">${I18N.t('teamDetail.nextPage')}</button>
        </div>`;
    }

    return `
      <div class="td-card">
        <div class="td-card-title">${I18N.t('teamDetail.feed')} <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${feed.length})</span></div>
        ${postFormHtml}
        ${postsHtml}
        ${paginationHtml}
      </div>`;
  },

  /** Re-render only the feed section without scrolling to top */
  _refreshTeamDetailFeed(teamId) {
    const section = document.getElementById('team-feed-section');
    if (section) {
      section.innerHTML = this._renderTeamFeed(teamId);
    } else {
      this.showTeamDetail(teamId);
    }
  },

  goTeamFeedPage(teamId, page) {
    this._teamFeedPage[teamId] = Math.max(1, page);
    this.showTeamDetail(teamId);
  },

  submitTeamPost(teamId) {
    const input = document.getElementById('team-feed-input');
    const content = (input?.value || '').trim();
    if (!content) { this.showToast('請輸入內容'); return; }
    if (content.length > 200) { this.showToast('內容不可超過 200 字'); return; }
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!t.feed) t.feed = [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const isPublic = document.getElementById('team-feed-public')?.checked !== false;
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    t.feed.push({ id: 'f_' + Date.now(), uid, name, content, time: timeStr, pinned: false, isPublic });
    this._teamFeedPage[teamId] = 1; // 發佈後跳回第一頁
    if (uid) this._grantAutoExp(uid, 'post_team_feed', content.slice(0, 20));
    this.showToast('動態已發佈');
    this._refreshTeamDetailFeed(teamId);
  },

  deleteTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    t.feed = t.feed.filter(p => p.id !== postId);
    this.showToast('動態已刪除');
    this.showTeamDetail(teamId);
  },

  pinTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.pinned) {
      // 檢查已置頂數量上限
      const pinnedCount = t.feed.filter(p => p.pinned).length;
      if (pinnedCount >= this._MAX_PINNED) {
        this.showToast(`最多只能置頂 ${this._MAX_PINNED} 則`);
        return;
      }
    }
    post.pinned = !post.pinned;
    this.showToast(post.pinned ? '已置頂' : '已取消置頂');
    this.showTeamDetail(teamId);
  },

  // ══════════════════════════════════
  //  Feed Reactions & Comments
  // ══════════════════════════════════

  _renderFeedReactions(teamId, post, myUid) {
    if (!post.reactions) post.reactions = { like: [], heart: [], cheer: [] };
    const r = post.reactions;
    const keys = [
      { key: 'like', emoji: '\u{1F44D}' },
      { key: 'heart', emoji: '\u2764\uFE0F' },
      { key: 'cheer', emoji: '\u{1F4AA}' },
    ];
    return `<div style="display:flex;gap:.4rem;margin-top:.3rem">${keys.map(k => {
      const arr = r[k.key] || [];
      const active = arr.includes(myUid);
      const bg = active ? 'var(--accent-bg, #ede9fe)' : 'var(--bg-elevated)';
      const border = active ? 'var(--primary)' : 'var(--border)';
      return `<button style="display:flex;align-items:center;gap:.2rem;padding:.15rem .4rem;border:1px solid ${border};border-radius:var(--radius-full);background:${bg};font-size:.72rem;cursor:pointer;line-height:1" onclick="event.stopPropagation();App.toggleFeedReaction('${teamId}','${post.id}','${k.key}')">${k.emoji}<span style="font-size:.68rem;color:var(--text-secondary)">${arr.length || ''}</span></button>`;
    }).join('')}</div>`;
  },

  toggleFeedReaction(teamId, postId, key) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.reactions) post.reactions = { like: [], heart: [], cheer: [] };
    const arr = post.reactions[key] || [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    if (!uid) return;
    const idx = arr.indexOf(uid);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(uid);
    post.reactions[key] = arr;
    this._refreshTeamDetailFeed(teamId);
  },

  _renderFeedComments(teamId, post, myUid, isMember) {
    const comments = post.comments || [];
    let html = '';
    if (comments.length > 0) {
      html += `<div style="margin-top:.3rem;padding-left:.5rem;border-left:2px solid var(--border)">`;
      comments.forEach(c => {
        const canDel = c.uid === myUid;
        html += `<div style="font-size:.75rem;margin-bottom:.25rem;display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap">
          <span style="font-weight:600;color:var(--text-primary)">${escapeHTML(c.name)}</span>
          <span style="color:var(--text-secondary);word-break:break-word">${escapeHTML(c.text)}</span>
          <span style="font-size:.62rem;color:var(--text-muted);margin-left:auto;flex-shrink:0">${escapeHTML(c.time)}${canDel ? ` <span style="color:var(--danger);cursor:pointer" onclick="event.stopPropagation();App.deleteFeedComment('${teamId}','${post.id}','${c.id}')">✕</span>` : ''}</span>
        </div>`;
      });
      html += `</div>`;
    }
    if (isMember) {
      html += `<div style="display:flex;gap:.3rem;margin-top:.25rem">
        <input type="text" id="fc-${post.id}" maxlength="100" placeholder="${I18N.t('teamDetail.commentPlaceholder')}" style="flex:1;font-size:.75rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);min-width:0">
        <button style="font-size:.68rem;padding:.2rem .45rem;border:1px solid var(--primary);border-radius:var(--radius-sm);background:var(--primary);color:#fff;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation();App.submitFeedComment('${teamId}','${post.id}')">${I18N.t('teamDetail.commentSubmit')}</button>
      </div>`;
    }
    return html;
  },

  submitFeedComment(teamId, postId) {
    const input = document.getElementById('fc-' + postId);
    const text = (input?.value || '').trim();
    if (!text) return;
    if (text.length > 100) { this.showToast('留言不可超過 100 字'); return; }
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.comments) post.comments = [];
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    post.comments.push({ id: 'c_' + Date.now(), uid, name, text, time: timeStr });
    this._refreshTeamDetailFeed(teamId);
  },

  deleteFeedComment(teamId, postId, commentId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post || !post.comments) return;
    post.comments = post.comments.filter(c => c.id !== commentId);
    this._refreshTeamDetailFeed(teamId);
  },

  toggleMemberInvite(teamId, allowed) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    t.allowMemberInvite = allowed;
    ApiService.updateTeam(teamId, { allowMemberInvite: allowed });
    this.showToast(allowed ? '已開放隊員邀請' : '已關閉隊員邀請');
  },

  // ══════════════════════════════════
  //  Team Invite QR Code
  // ══════════════════════════════════

  showTeamInviteQR(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    const url = `${location.origin}${location.pathname}?team=${teamId}`;
    // Remove existing overlay if any
    const existing = document.getElementById('qr-invite-overlay');
    if (existing) existing.remove();
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'qr-invite-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card,#fff);border-radius:14px;padding:1.2rem;text-align:center;max-width:320px;width:88%';
    card.innerHTML = `
      <div style="font-size:.95rem;font-weight:700;margin-bottom:.5rem">${escapeHTML(t.name)} — 邀請加入</div>
      <div id="qr-invite-target" style="display:flex;justify-content:center;margin:.5rem 0"></div>
      <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:.5rem;word-break:break-all;user-select:all">${escapeHTML(url)}</div>
      <div style="display:flex;gap:.5rem;justify-content:center;margin-top:.6rem">
        <button id="qr-copy-btn" style="padding:.4rem 1rem;border:1px solid var(--primary,#3b82f6);border-radius:8px;background:transparent;color:var(--primary,#3b82f6);font-size:.82rem;cursor:pointer">複製連結</button>
        <button style="padding:.4rem 1rem;border:none;border-radius:8px;background:var(--primary,#3b82f6);color:#fff;font-size:.82rem;cursor:pointer" onclick="document.getElementById('qr-invite-overlay').remove()">關閉</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    // Copy button
    document.getElementById('qr-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => { App.showToast('邀請連結已複製'); }).catch(() => { App.showToast('複製失敗'); });
    });
    // Generate QR code (client-side → API fallback)
    const target = document.getElementById('qr-invite-target');
    if (target) {
      const apiFallback = () => {
        target.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=${encodeURIComponent(url)}" style="width:200px;height:200px;display:block" alt="QR Code" onerror="this.parentElement.innerHTML='<div style=\\'font-size:.78rem;color:var(--danger)\\'>QR Code 產生失敗</div>'">`;
      };
      if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
        QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
          .then(dataUrl => { target.innerHTML = `<img src="${dataUrl}" style="width:200px;height:200px;display:block" alt="QR Code">`; })
          .catch(() => apiFallback());
      } else {
        // 動態載入 QR Code 產生器
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
        s.onload = () => {
          if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
            QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
              .then(dataUrl => { target.innerHTML = `<img src="${dataUrl}" style="width:200px;height:200px;display:block" alt="QR Code">`; })
              .catch(() => apiFallback());
          } else { apiFallback(); }
        };
        s.onerror = () => apiFallback();
        document.head.appendChild(s);
      }
    }
  },

});
