/* ================================================
   SportHub — Team Feed: ApiService 封裝 + 權限守衛
   Phase 2B §8.4 + §12.4B：
   - 所有 CRUD 操作走 ApiService（不直接呼叫 Firebase）
   - per-team 角色 + 管理員 override 雙層權限守衛
   Dynamic HTML uses escapeHTML() per CLAUDE.md.
   ================================================ */

Object.assign(App, {

  _teamFeedCache: {},
  _MAX_PINNED: 3,

  /* ═══════════════════════════════
     §12.4B 權限守衛
     ═══════════════════════════════ */

  /** 是否能刪除動態牆貼文（自己的 or 幹部 or 管理員） */
  _canDeleteTeamFeedPost(team, post) {
    var myUid = (ApiService.getCurrentUser?.() || {}).uid;
    // 層 1：自己的貼文 → 任何成員可刪
    if (post.uid === myUid) return true;
    // 層 2：全域管理員 override
    if (this.hasPermission('team.manage_all')) return true;
    // 層 3：team-local 角色（幹部可刪）
    return this._canManageTeamMembers(team);
  },

  /** 是否能置頂貼文（幹部 or 管理員） */
  _canPinTeamFeedPost(team) {
    if (this.hasPermission('team.manage_all')) return true;
    return this._canManageTeamMembers(team);
  },

  /** 是否能發動態牆貼文（成員） */
  _canPostTeamFeed(teamId) {
    return this._isTeamMember(teamId);
  },

  /** 是否能刪除留言（留言作者 or 幹部 or 管理員） */
  _canDeleteTeamFeedComment(team, comment) {
    var myUid = (ApiService.getCurrentUser?.() || {}).uid;
    if (comment.uid === myUid) return true;
    if (this.hasPermission('team.manage_all')) return true;
    return this._canManageTeamMembers(team);
  },

  /* ═══════════════════════════════
     Load Feed
     ═══════════════════════════════ */

  async _loadTeamFeed(teamId) {
    try {
      this._teamFeedCache[teamId] = await ApiService.getTeamFeed(teamId);
    } catch (err) {
      console.error('[TeamFeed] _loadTeamFeed failed:', err);
      this._teamFeedCache[teamId] = [];
    }
  },

  getTeamFeed(teamId) {
    return this._teamFeedCache[teamId] || [];
  },

  /* ═══════════════════════════════
     Submit Post
     ═══════════════════════════════ */

  async submitTeamPost(teamId, buttonEl) {
    var submitButton = (buttonEl && typeof buttonEl === 'object') ? buttonEl : null;
    if (submitButton && submitButton.disabled) return;
    if (!this._canPostTeamFeed(teamId)) {
      this.showToast('僅俱樂部成員可發文');
      return;
    }
    var input = document.getElementById('team-feed-input');
    var content = (input ? input.value : '').trim();
    if (!content) { this.showToast('請輸入內容'); return; }
    if (content.length > 200) { this.showToast('內容不可超過 200 字'); return; }
    var t = ApiService.getTeam(teamId);
    if (!t) return;
    var user = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
    var uid = (user && user.uid) ? user.uid : '';
    var name = (user && (user.displayName || user.name)) || '';
    var isPublic = true;
    var pubEl = document.getElementById('team-feed-public');
    if (pubEl) isPublic = pubEl.checked !== false;
    var now = new Date();
    var timeStr = App._formatDateTime(now);
    var post = {
      id: generateId('fp_'), uid: uid, name: name, content: content,
      time: timeStr, pinned: false, isPublic: isPublic,
      reactions: { like: [], heart: [], cheer: [] },
      comments: [], createdAt: now.toISOString()
    };
    var originalButtonText = submitButton ? submitButton.textContent : '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = I18N.t('teamDetail.publishing');
    }

    try {
      await ApiService.createTeamFeedPost(teamId, post);
      await this._loadTeamFeed(teamId);
    } catch (err) {
      console.error('[TeamFeed] submitTeamPost failed:', err);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText || I18N.t('teamDetail.publish');
      }
      this.showToast('發佈失敗，請稍後再試');
      return;
    }
    this._teamFeedPage[teamId] = 1;
    if (uid) this._grantAutoExp?.(uid, 'post_team_feed', content.slice(0, 20));
    this.showToast('動態已發佈');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ═══════════════════════════════
     Delete Post
     ═══════════════════════════════ */

  async deleteTeamPost(teamId, postId) {
    var team = ApiService.getTeam(teamId);
    var post = (this._teamFeedCache[teamId] || []).find(function(p) { return p.id === postId; });
    if (!team || !post) return;
    if (!this._canDeleteTeamFeedPost(team, post)) {
      this.showToast('權限不足');
      return;
    }
    try {
      await ApiService.deleteTeamFeedPost(teamId, postId);
      var cache = this._teamFeedCache[teamId] || [];
      this._teamFeedCache[teamId] = cache.filter(function(p) { return p.id !== postId; });
    } catch (err) {
      console.error('[TeamFeed] deleteTeamPost failed:', err);
      this.showToast('刪除失敗');
      return;
    }
    this.showToast('動態已刪除');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ═══════════════════════════════
     Pin / Unpin Post
     ═══════════════════════════════ */

  async pinTeamPost(teamId, postId) {
    var team = ApiService.getTeam(teamId);
    if (!team || !this._canPinTeamFeedPost(team)) {
      this.showToast('權限不足');
      return;
    }
    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function(p) { return p.id === postId; });
    if (!cached) return;
    var newPinned = !cached.pinned;
    if (newPinned) {
      var pinCount = cache.filter(function(p) { return p.pinned; }).length;
      if (pinCount >= this._MAX_PINNED) {
        this.showToast('最多只能置頂 ' + this._MAX_PINNED + ' 則');
        return;
      }
    }
    try {
      await ApiService.pinTeamFeedPost(teamId, postId, newPinned);
      cached.pinned = newPinned;
    } catch (err) {
      console.error('[TeamFeed] pinTeamPost failed:', err);
      this.showToast('操作失敗');
      return;
    }
    this.showToast(newPinned ? '已置頂' : '已取消置頂');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ═══════════════════════════════
     Reactions
     ═══════════════════════════════ */

  async toggleFeedReaction(teamId, postId, key) {
    var user = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
    var uid = (user && user.uid) ? user.uid : '';
    if (!uid) return;
    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function(p) { return p.id === postId; });
    if (!cached) return;
    if (!cached.reactions) cached.reactions = { like: [], heart: [], cheer: [] };
    var cArr = cached.reactions[key] || [];
    var cIdx = cArr.indexOf(uid);
    var adding = cIdx < 0;
    try {
      await ApiService.toggleTeamFeedReaction(teamId, postId, key, uid, adding);
      if (adding) cArr.push(uid); else cArr.splice(cIdx, 1);
      cached.reactions[key] = cArr;
    } catch (err) {
      console.error('[TeamFeed] toggleFeedReaction failed:', err);
    }
    this._refreshTeamDetailFeed(teamId);
  },

  /* ═══════════════════════════════
     Comments
     ═══════════════════════════════ */

  async submitFeedComment(teamId, postId) {
    var input = document.getElementById('fc-' + postId);
    var text = (input ? input.value : '').trim();
    if (!text) return;
    if (text.length > 100) { this.showToast('留言不可超過 100 字'); return; }
    var user = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
    var uid = (user && user.uid) ? user.uid : '';
    var name = (user && (user.displayName || user.name)) || '';
    var now = new Date();
    var timeStr = App._formatDateTime(now);
    var comment = { id: generateId('fc_'), uid: uid, name: name, text: text, time: timeStr };

    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function(p) { return p.id === postId; });
    if (!cached) return;
    try {
      await ApiService.addTeamFeedComment(teamId, postId, comment);
      await this._loadTeamFeed(teamId);
    } catch (err) {
      console.error('[TeamFeed] submitFeedComment failed:', err);
      this.showToast('留言失敗');
      return;
    }
    this._refreshTeamDetailFeed(teamId);
  },

  async deleteFeedComment(teamId, postId, commentId) {
    var team = ApiService.getTeam(teamId);
    var post = (this._teamFeedCache[teamId] || []).find(function(p) { return p.id === postId; });
    var comment = post && post.comments ? post.comments.find(function(c) { return c.id === commentId; }) : null;
    if (!team || !post || !comment) return;
    if (!this._canDeleteTeamFeedComment(team, comment)) {
      this.showToast('權限不足');
      return;
    }
    try {
      await ApiService.deleteTeamFeedComment(teamId, postId, commentId);
      var cached = (this._teamFeedCache[teamId] || []).find(function(p) { return p.id === postId; });
      if (cached && cached.comments) {
        cached.comments = cached.comments.filter(function(c) { return c.id !== commentId; });
      }
    } catch (err) {
      console.error('[TeamFeed] deleteFeedComment failed:', err);
      this.showToast('刪除留言失敗');
      return;
    }
    this._refreshTeamDetailFeed(teamId);
  },

  /* ═══════════════════════════════
     Refresh & Pagination
     ═══════════════════════════════ */

  _refreshTeamDetailFeed(teamId) {
    var section = document.getElementById('team-feed-section');
    if (section) {
      section.innerHTML = this._renderTeamFeed(teamId);
    } else {
      this.showTeamDetail(teamId);
    }
  },

  goTeamFeedPage(teamId, page) {
    this._teamFeedPage[teamId] = Math.max(1, page);
    this._refreshTeamDetailFeed(teamId);
  },

});
