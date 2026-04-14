/* ================================================
   SportHub — Team: Detail View Core
   Split into: team-detail-render.js, team-detail-invite.js
   This file: state, helpers, showTeamDetail, member ops.
   Dynamic HTML uses escapeHTML() per project rules.
   ================================================ */

Object.assign(App, {

  _teamDetailId: null,
  _teamDetailRequestSeq: 0,
  _teamFeedPage: {},
  _teamMemberEditModeByTeam: {},
  _FEED_PAGE_SIZE: 20,
  _MAX_PINNED: 5,

  _teamLeaderTag(name) {
    return '<span class="user-capsule uc-team-leader" data-no-translate onclick="App.showUserProfile(\'' + escapeHTML(name) + '\')" title="\u7403\u968a\u9818\u968a">' + escapeHTML(name) + '</span>';
  },

  _isTeamMember(teamId) {
    const user = ApiService.getCurrentUser();
    if (user && typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    if (user && user.teamId === teamId) return true;
    const team = ApiService.getTeam(teamId);
    if (!team || !user) return false;
    if (team.captainUid && team.captainUid === user.uid) return true;
    const myNames = new Set([user.name, user.displayName].filter(Boolean));
    if (team.captain && myNames.has(team.captain)) return true;
    if ((team.coaches || []).some(c => myNames.has(c))) return true;
    const leaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    if (leaderUids.includes(user.uid)) return true;
    return false;
  },

  _refreshTeamDetailEditButton(team) {
    const btn = document.getElementById('team-detail-edit-btn');
    if (!btn) return;
    btn.style.display = this._canEditTeamByRoleOrCaptain?.(team) ? '' : 'none';
  },

  // _canManageTeamMembers → 已搬至 team-list-helpers.js

  _getTeamStaffIdentity(team) {
    const users = ApiService.getAdminUsers() || [];
    const built = (typeof this._buildTeamStaffIdentity === 'function')
      ? this._buildTeamStaffIdentity(team, users)
      : { keys: new Set(), names: new Set() };
    return {
      keys: built.keys || new Set(),
      names: built.names || new Set(),
    };
  },

  _isRegularTeamMember(user, staffIdentity) {
    if (!user) return false;
    const key = (typeof this._getUserIdentityKey === 'function')
      ? this._getUserIdentityKey(user)
      : null;
    if (key && staffIdentity?.keys?.has(key)) return false;
    const names = [user.name, user.displayName]
      .map(name => String(name || '').trim().toLowerCase())
      .filter(Boolean);
    if (names.some(name => staffIdentity?.names?.has(name))) return false;
    return true;
  },

  _keepTeamMembersSectionOpen() {
    const toggle = document.getElementById('team-members-toggle');
    if (!toggle) return;
    const content = toggle.nextElementSibling;
    if (content && content.style.display === 'none') {
      this.toggleProfileSection(toggle, 'teamMembers');
    }
  },

  _getTeamDetailNodes() {
    const nodes = {
      title: document.getElementById('team-detail-title'),
      nameEn: document.getElementById('team-detail-name-en'),
      image: document.getElementById('team-detail-img'),
      body: document.getElementById('team-detail-body'),
      editButton: document.getElementById('team-detail-edit-btn'),
    };
    return Object.values(nodes).every(Boolean) ? nodes : null;
  },

  async _refreshTeamDetailMembers(teamId) {
    const result = await this.showTeamDetail(teamId);
    if (result?.ok) this._keepTeamMembersSectionOpen();
    return result;
  },

  openTeamDetailEdit() {
    const teamId = this._teamDetailId;
    const team = teamId ? ApiService.getTeam(teamId) : null;
    if (!team) return;
    if (!this._canEditTeamByRoleOrCaptain?.(team)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u6b64\u7403\u968a\u7684\u6b0a\u9650');
      return;
    }
    this.showTeamForm(team.id);
  },

  async showTeamDetail(id, options = {}) {
    if (!options.allowGuest && this._requireProtectedActionLogin({ type: 'showTeamDetail', teamId: id }, { suppressToast: true })) {
      return { ok: false, reason: 'auth' };
    }
    try {
      let t = ApiService.getTeam(id);
      if (!t) {
        // 快取 miss → 單筆查詢 Firestore（Phase 2A §7.4）
        t = await ApiService.getTeamAsync(id);
        if (!t) return { ok: false, reason: 'missing' };
      }
      const requestSeq = ++this._teamDetailRequestSeq;

      // ── 確保頁面 HTML + Script 已載入（不切換顯示），避免空白模板閃現 ──
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await PageLoader.ensurePage('page-team-detail');
      }
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage('page-team-detail');
      }
      if (requestSeq !== this._teamDetailRequestSeq) {
        return { ok: false, reason: 'stale' };
      }

      t = ApiService.getTeam(id);
      if (!t) return { ok: false, reason: 'missing' };

      const nodes = this._getTeamDetailNodes();
      if (!nodes) {
        console.warn('[TeamDetail] detail shell missing after navigation');
        this.showToast('\u7403\u968a\u8a73\u60c5\u9801\u9762\u8f09\u5165\u5931\u6557');
        return { ok: false, reason: 'page-not-ready' };
      }

      // ── 先渲染內容到隱藏 DOM ──
      this._teamDetailId = id;
      this._refreshTeamDetailEditButton(t);
      const canManageMembers = this._canManageTeamMembers(t);
      const memberEditMode = !!this._teamMemberEditModeByTeam[t.id];
      const staffIdentity = this._getTeamStaffIdentity(t);
      if (t.type === 'education') {
        nodes.title.innerHTML = '<span class="edu-type-badge" style="margin-right:.35rem;vertical-align:middle">教學</span>' + escapeHTML(t.name);
      } else {
        nodes.title.textContent = t.name;
      }
      nodes.nameEn.textContent = t.nameEn || '';

      const imgEl = nodes.image;
      const detailRank = this._getTeamRank(t.teamExp);
      const detailSportEmoji = t.sportTag && typeof SPORT_ICON_EMOJI !== 'undefined' ? (SPORT_ICON_EMOJI[t.sportTag] || '') : '';
      const detailSportBadge = detailSportEmoji ? '<span class="tc-sport-badge" style="top:8px;left:8px;padding:3px 9px;font-size:1.3rem">' + detailSportEmoji + '</span>' : '';
      imgEl.style.position = 'relative';
      if (t.image) {
        imgEl.innerHTML = detailSportBadge + '<img src="' + t.image + '" loading="lazy" style="width:100%;height:100%;object-fit:cover"><span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      } else {
        imgEl.innerHTML = detailSportBadge + '\u7403\u968a\u5c01\u9762 800 \u00d7 300<span class="tc-rank-badge tc-rank-badge-lg" style="color:' + detailRank.color + '"><span class="tc-rank-score">' + (t.teamExp || 0).toLocaleString() + '</span>' + detailRank.rank + '</span>';
      }

      const totalGames = (t.wins || 0) + (t.draws || 0) + (t.losses || 0);
      const winRate = totalGames > 0 ? Math.round((t.wins || 0) / totalGames * 100) : 0;

      // 教育型俱樂部委派 edu-detail-render.js 渲染
      if (t.type === 'education' && typeof this.renderEduClubDetail === 'function') {
        await this.renderEduClubDetail(id);
      } else {
        // 非教育型：載入 feed subcollection 資料
        if (typeof this._loadTeamFeed === 'function') {
          await this._loadTeamFeed(id);
        }
        nodes.body.innerHTML = this._buildTeamDetailBodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate);
      }

      // ── 內容已渲染就緒，切換顯示頁面（避免空白模板閃現）──
      await this.showPage('page-team-detail');
      if (requestSeq !== this._teamDetailRequestSeq || this.currentPage !== 'page-team-detail') {
        return { ok: false, reason: 'stale' };
      }
      this._markPageSnapshotReady?.('page-team-detail');
      return { ok: true, reason: 'ok' };
    } catch (err) {
      console.error('[TeamDetail] showTeamDetail failed:', err);
      this.showToast('\u7121\u6cd5\u958b\u555f\u7403\u968a\u8a73\u60c5');
      return { ok: false, reason: 'error' };
    }
  },

  async toggleTeamMemberEditMode(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u7de8\u8f2f\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    this._teamMemberEditModeByTeam[teamId] = !this._teamMemberEditModeByTeam[teamId];
    await this._refreshTeamDetailMembers(teamId);
  },

  async removeTeamMember(teamId, memberUid) {
    const t = ApiService.getTeam(teamId);
    if (!t || !memberUid) return;
    if (!this._canManageTeamMembers(t)) {
      this.showToast('\u60a8\u6c92\u6709\u79fb\u9664\u968a\u54e1\u7684\u6b0a\u9650');
      return;
    }
    const users = ApiService.getAdminUsers() || [];
    const member = users.find(u => u.uid === memberUid);
    const isInTeam = member && (
      (typeof this._isUserInTeam === 'function' ? this._isUserInTeam(member, teamId) : member.teamId === teamId)
    );
    if (!member || !isInTeam) {
      this.showToast('\u968a\u54e1\u8cc7\u6599\u4e0d\u5b58\u5728\u6216\u5df2\u4e0d\u5728\u7403\u968a\u4e2d');
      this.showTeamDetail(teamId);
      this._keepTeamMembersSectionOpen();
      return;
    }
    const staffIdentity = this._getTeamStaffIdentity(t);
    if (!this._isRegularTeamMember(member, staffIdentity)) {
      this.showToast('\u50c5\u53ef\u79fb\u9664\u4e00\u822c\u968a\u54e1');
      return;
    }

    const memberName = member.name || member.displayName || member.uid;
    if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u79fb\u9664\u968a\u54e1\u300c' + memberName + '\u300d\uff1f'))) return;

    const teamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(member)
      : (() => {
        const ids = [];
        if (Array.isArray(member.teamIds)) ids.push(...member.teamIds.map(v => String(v || '').trim()).filter(Boolean));
        if (member.teamId) ids.push(String(member.teamId));
        return Array.from(new Set(ids));
      })();
    const nextTeamIds = teamIds.filter(id => id !== String(teamId));
    const nextTeamNames = nextTeamIds.map(id => {
      const tm = ApiService.getTeam(id);
      return tm ? tm.name : id;
    });
    const updates = nextTeamIds.length > 0
      ? { teamId: nextTeamIds[0], teamName: nextTeamNames[0] || '', teamIds: nextTeamIds, teamNames: nextTeamNames }
      : { teamId: null, teamName: null, teamIds: [], teamNames: [] };

    if (member._docId) {
      try {
        if (typeof FirebaseService._ensureAuth === 'function') {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('\u767b\u5165\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u5f8c\u518d\u8a66');
            return;
          }
        }
        await FirebaseService.updateUser(member._docId, updates);
      } catch (err) {
        console.error('[removeTeamMember]', err);
        if (typeof ApiService._writeErrorLog === 'function') {
          ApiService._writeErrorLog(
            {
              fn: 'removeTeamMember',
              teamId,
              memberUid,
              docId: member._docId,
              authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : 'null',
            },
            err
          );
        }
        this.showToast('\u79fb\u9664\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
        return;
      }
    }

    Object.assign(member, updates);
    const currentUser = ApiService.getCurrentUser?.();
    if (currentUser && currentUser.uid === memberUid) {
      ApiService.updateCurrentUser(updates);
    }

    const memberCount = this._calcTeamMemberCount(teamId);
    ApiService.updateTeam(teamId, { members: memberCount });

    const actorName = currentUser?.displayName || currentUser?.name || '\u8077\u54e1';
    ApiService._writeOpLog('team_member_remove', '\u79fb\u9664\u968a\u54e1', actorName + ' \u5c07\u300c' + memberName + '\u300d\u79fb\u51fa\u300c' + t.name + '\u300d');
    this.showToast('\u5df2\u79fb\u9664\u968a\u54e1\u300c' + memberName + '\u300d');
    await this._refreshTeamDetailMembers(teamId);
  },

});
