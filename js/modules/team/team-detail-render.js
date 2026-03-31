/* ================================================
   SportHub — Team Detail: Rendering
   Split from team-detail.js — team events, feed,
   reactions, comments rendering & CRUD.
   All dynamic HTML uses escapeHTML() for XSS
   safety per CLAUDE.md project convention.
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Team Events
  // ══════════════════════════════════

  _renderTeamEvents(teamId) {
    const allEvents = ApiService.getEvents() || [];
    const teamIdStr = String(teamId || '');
    const teamEvents = allEvents.filter(e =>
      e.teamOnly && ((Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.map(v => String(v)).includes(teamIdStr)) || String(e.creatorTeamId || '') === teamIdStr) &&
      e.status !== 'ended' && e.status !== 'cancelled'
    ).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!teamEvents.length) return '';

    const TYPE_COLOR = { play: '#3b82f6', friendly: '#10b981', coaching: '#f59e0b', watch: '#8b5cf6' };
    const STATUS_LABEL = { open: '\u5831\u540d\u4e2d', full: '\u5df2\u984d\u6eff', upcoming: '\u5373\u5c07\u958b\u59cb' };

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
          <div style="font-size:.68rem;color:var(--text-muted)">${escapeHTML(datePart)}${timePart ? ' ' + escapeHTML(timePart) : ''}${e.location ? ' \u00b7 ' + escapeHTML(e.location) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.25rem;flex-shrink:0">
          ${spotsHtml}
          <span style="font-size:.6rem;padding:.08rem .3rem;border-radius:999px;background:${color}22;color:${color};font-weight:600">${escapeHTML(statusLabel)}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="td-card">
      <div class="td-card-title">\u7403\u968a\u6d3b\u52d5 <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${teamEvents.length})</span></div>
      ${rows}
    </div>`;
  },

  // ══════════════════════════════════
  //  Team Feed
  // ══════════════════════════════════

  _renderTeamFeed(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return '';
    const feed = (typeof this.getTeamFeed === 'function') ? this.getTeamFeed(teamId) : (t.feed || []);
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

    // Post form
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

  // ══════════════════════════════════
  //  Team Detail Body HTML — Helpers
  // ══════════════════════════════════

  _buildTeamInfoCard(t) {
    return '<div class="td-card">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.info') + '</div>'
      + '<div class="td-card-grid">'
      + '<div class="td-card-item"><span class="td-card-label">\u7403\u968a\u7d93\u7406</span><span class="td-card-value">' + (t.captain ? this._userTag(t.captain, 'captain') : I18N.t('teamDetail.notSet')) + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">\u9818\u968a</span><span class="td-card-value">' + (() => { const lNames = t.leaders || (t.leader ? [t.leader] : []); return lNames.length ? lNames.map(n => this._teamLeaderTag(n)).join(' ') : I18N.t('teamDetail.notSet'); })() + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.coach') + '</span><span class="td-card-value">' + ((t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : I18N.t('teamDetail.none')) + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.memberCount') + '</span><span class="td-card-value">' + (typeof this._calcTeamMemberCount === 'function' ? this._calcTeamMemberCount(t.id) : (ApiService.getAdminUsers() || []).filter(u => u.teamId === t.id).length) + ' ' + I18N.t('teamDetail.personUnit') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.region') + '</span><span class="td-card-value">' + escapeHTML(t.region) + '</span></div>'
      + (t.nationality ? '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.nationality') + '</span><span class="td-card-value">' + escapeHTML(t.nationality) + '</span></div>' : '')
      + (t.founded ? '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.founded') + '</span><span class="td-card-value">' + escapeHTML(t.founded) + '</span></div>' : '')
      + (t.contact ? '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.contact') + '</span><span class="td-card-value">' + escapeHTML(t.contact) + '</span></div>' : '')
      + '</div></div>';
  },

  _buildTeamBioCard(t) {
    return t.bio ? '<div class="td-card"><div class="td-card-title" style="text-align:center">' + I18N.t('teamDetail.bio') + '</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(t.bio) + '</div></div>' : '';
  },

  _buildTeamRecordCard(t, totalGames, winRate) {
    return '<div class="td-card">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.record') + '</div>'
      + '<div class="td-stats-row">'
      + '<div class="td-stat"><span class="td-stat-num" style="color:var(--success)">' + (t.wins || 0) + '</span><span class="td-stat-label">' + I18N.t('teamDetail.wins') + '</span></div>'
      + '<div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">' + (t.draws || 0) + '</span><span class="td-stat-label">' + I18N.t('teamDetail.draws') + '</span></div>'
      + '<div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">' + (t.losses || 0) + '</span><span class="td-stat-label">' + I18N.t('teamDetail.losses') + '</span></div>'
      + '<div class="td-stat"><span class="td-stat-num">' + winRate + '%</span><span class="td-stat-label">' + I18N.t('teamDetail.winRate') + '</span></div>'
      + '</div>'
      + '<div class="td-card-grid" style="margin-top:.5rem">'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.goalsFor') + '</span><span class="td-card-value">' + (t.gf || 0) + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.goalsAgainst') + '</span><span class="td-card-value">' + (t.ga || 0) + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.goalDiff') + '</span><span class="td-card-value">' + ((t.gf || 0) - (t.ga || 0) > 0 ? '+' : '') + ((t.gf || 0) - (t.ga || 0)) + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">' + I18N.t('teamDetail.totalGames') + '</span><span class="td-card-value">' + totalGames + '</span></div>'
      + '</div></div>';
  },

  _buildTeamHistoryCard(t) {
    const historyRows = (t.history || []).map(h => '<div class="td-history-row"><span class="td-history-name">' + escapeHTML(h.name) + '</span><span class="td-history-result">' + escapeHTML(h.result) + '</span></div>').join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">' + I18N.t('teamDetail.noHistory') + '</div>';
    return '<div class="td-card"><div class="td-card-title profile-collapse-toggle" onclick="App.toggleProfileSection(this,\'teamMatch\')"><span>' + I18N.t('teamDetail.matchHistory') + '</span><span class="profile-collapse-arrow">\u25b6</span></div><div class="profile-collapse-content" style="display:none">' + historyRows + '</div></div>';
  },

  _buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) {
    const membersContent = (() => {
      const allUsers = ApiService.getAdminUsers() || [];
      const teamMembers = allUsers.filter(u => (typeof this._isUserInTeam === 'function') ? this._isUserInTeam(u, t.id) : u.teamId === t.id);
      const regularMembers = teamMembers.filter(u => this._isRegularTeamMember(u, staffIdentity));
      if (!regularMembers.length) return '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">' + I18N.t('teamDetail.none') + '</div>';
      return regularMembers.map(u => {
        const memberName = u.name || u.displayName || u.uid || '\u672a\u77e5';
        const removeBtn = (canManageMembers && memberEditMode && u.uid) ? '<button class="td-member-remove-btn" title="\u79fb\u9664\u968a\u54e1" onclick="event.stopPropagation();App.removeTeamMember(\'' + t.id + '\',\'' + u.uid + '\')">\u00d7</button>' : '';
        return '<span class="td-member-item-wrap"><span class="user-capsule uc-user" onclick="App.showUserProfile(\'' + escapeHTML(memberName) + '\')">' + escapeHTML(memberName) + '</span>' + removeBtn + '</span>';
      }).join('');
    })();
    const editBtn = canManageMembers ? '<button class="outline-btn td-member-edit-btn" onclick="event.stopPropagation();App.toggleTeamMemberEditMode(\'' + t.id + '\')">' + (memberEditMode ? '\u5b8c\u6210' : '\u7de8\u8f2f') + '</button>' : '';
    return '<div class="td-card"><div id="team-members-toggle" class="td-card-title td-card-title-row profile-collapse-toggle" onclick="App.toggleProfileSection(this,\'teamMembers\')"><span>' + I18N.t('teamDetail.memberList') + '</span><span class="td-card-title-right">' + editBtn + '<span class="profile-collapse-arrow">\u25b6</span></span></div><div class="profile-collapse-content td-member-tags" style="display:none">' + membersContent + '</div></div>';
  },

  // ══════════════════════════════════
  //  Team Detail Body HTML Builder
  // ══════════════════════════════════

  _buildTeamDetailBodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate) {
    const actionCards = (() => {
      const u = ApiService.getCurrentUser?.();
      const n = u?.displayName || '';
      const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
      const memberCanInvite = t.allowMemberInvite !== false;
      const canInvite = isCaptainCoach || (this._isTeamMember(t.id) && memberCanInvite);
      const isMember = this._isTeamMember(t.id);
      let html = '';
      if (canInvite || isCaptainCoach) {
        html += '<div class="td-card" style="padding:.6rem .8rem"><div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">';
        if (canInvite) html += '<button class="outline-btn" onclick="App.showTeamInviteQR(\'' + t.id + '\')">' + I18N.t('teamDetail.inviteQR') + '</button>';
        if (isCaptainCoach) html += '<div style="display:inline-flex;align-items:center;gap:.35rem"><span style="font-size:.72rem;color:var(--text-muted)">' + I18N.t('teamDetail.memberCanInvite') + '</span><label class="toggle-switch" style="margin:0;transform:scale(.8)"><input type="checkbox" ' + (memberCanInvite ? 'checked' : '') + ' onchange="App.toggleMemberInvite(\'' + t.id + '\',this.checked)"><span class="toggle-slider"></span></label></div>';
        html += '</div></div>';
      }
      html += '<div class="td-card" style="padding:.6rem .8rem"><div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">';
      if (isMember) {
        html += '<button style="background:var(--danger);color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;font-weight:600;cursor:pointer" onclick="App.handleLeaveTeam(\'' + t.id + '\')">' + I18N.t('teamDetail.leaveTeam') + '</button>';
      } else {
        html += '<button class="primary-btn" onclick="App.handleJoinTeam(\'' + t.id + '\')">' + I18N.t('teamDetail.applyJoin') + '</button>';
      }
      if (t.captain) html += '<button class="outline-btn" onclick="App.showUserProfile(\'' + escapeHTML(t.captain) + '\')">' + I18N.t('teamDetail.contactCaptain') + '</button>';
      html += '</div></div>';
      return html;
    })();
    return this._buildTeamInfoCard(t)
      + this._buildTeamBioCard(t)
      + this._buildTeamRecordCard(t, totalGames, winRate)
      + this._buildTeamHistoryCard(t)
      + this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity)
      + this._renderTeamEvents(t.id)
      + '<div id="team-feed-section">' + this._renderTeamFeed(t.id) + '</div>'
      + actionCards;
  },

  // ══════════════════════════════════
  //  Feed Reactions & Comments (render only)
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

  _renderFeedComments(teamId, post, myUid, isMember) {
    const comments = post.comments || [];
    let html = '';
    if (comments.length > 0) {
      html += `<div style="margin-top:.3rem;padding-left:.5rem;border-left:2px solid var(--border)">`;
      comments.forEach(c => {
        const canDel = c.uid === myUid;
        html += `<div style="font-size:.75rem;margin-bottom:.25rem;display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap">
          <span style="font-weight:600;color:var(--text-primary)" data-no-translate>${escapeHTML(c.name)}</span>
          <span style="color:var(--text-secondary);word-break:break-word">${escapeHTML(c.text)}</span>
          <span style="font-size:.62rem;color:var(--text-muted);margin-left:auto;flex-shrink:0">${escapeHTML(c.time)}${canDel ? ` <span style="color:var(--danger);cursor:pointer" onclick="event.stopPropagation();App.deleteFeedComment('${teamId}','${post.id}','${c.id}')">\u2715</span>` : ''}</span>
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

});
