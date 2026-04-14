/* ================================================
   SportHub — Team Feed: Subcollection CRUD
   Feed 留言板遷移到 teams/{teamId}/feed/{postId}
   subcollection。
   Dynamic HTML uses escapeHTML() per CLAUDE.md.
   ================================================ */

Object.assign(App, {

  _teamFeedCache: {},

  /* ── Load Feed ── */

  async _loadTeamFeed(teamId) {
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      var snapshot = await collRef.orderBy('createdAt', 'desc').get();
      this._teamFeedCache[teamId] = snapshot.docs.map(function (doc) {
        var data = doc.data();
        data._docId = doc.id;
        if (data.createdAt && typeof data.createdAt.toDate === 'function') {
          data.createdAt = data.createdAt.toDate().toISOString();
        }
        return data;
      });
    } catch (err) {
      console.error('[TeamFeed] _loadTeamFeed failed:', err);
      this._teamFeedCache[teamId] = [];
    }
  },

  getTeamFeed(teamId) {
    return this._teamFeedCache[teamId] || [];
  },

  /* ── Submit Post ── */

  async submitTeamPost(teamId) {
    var input = document.getElementById('team-feed-input');
    var content = (input ? input.value : '').trim();
    if (!content) { this.showToast('\u8acb\u8f38\u5165\u5167\u5bb9'); return; }
    if (content.length > 200) { this.showToast('\u5167\u5bb9\u4e0d\u53ef\u8d85\u904e 200 \u5b57'); return; }
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

    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      var payload = Object.assign({}, post);
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await collRef.doc(post.id).set(payload);
      await this._loadTeamFeed(teamId);
    } catch (err) {
      console.error('[TeamFeed] submitTeamPost failed:', err);
      this.showToast('\u767c\u4f48\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }
    this._teamFeedPage[teamId] = 1;
    if (uid) this._grantAutoExp?.(uid, 'post_team_feed', content.slice(0, 20));
    this.showToast('\u52d5\u614b\u5df2\u767c\u4f48');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ── Delete Post ── */

  async deleteTeamPost(teamId, postId) {
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      await collRef.doc(postId).delete();
      var cache = this._teamFeedCache[teamId] || [];
      this._teamFeedCache[teamId] = cache.filter(function (p) { return p.id !== postId; });
    } catch (err) {
      console.error('[TeamFeed] deleteTeamPost failed:', err);
      this.showToast('\u522a\u9664\u5931\u6557');
      return;
    }
    this.showToast('\u52d5\u614b\u5df2\u522a\u9664');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ── Pin / Unpin Post ── */

  async pinTeamPost(teamId, postId) {
    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function (p) { return p.id === postId; });
    if (!cached) return;
    var newPinned = !cached.pinned;
    if (newPinned) {
      var pinCount = cache.filter(function (p) { return p.pinned; }).length;
      if (pinCount >= this._MAX_PINNED) {
        this.showToast('\u6700\u591a\u53ea\u80fd\u7f6e\u9802 ' + this._MAX_PINNED + ' \u5247');
        return;
      }
    }
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      await collRef.doc(postId).update({ pinned: newPinned });
      cached.pinned = newPinned;
    } catch (err) {
      console.error('[TeamFeed] pinTeamPost failed:', err);
      this.showToast('\u64cd\u4f5c\u5931\u6557');
      return;
    }
    var isPinned = ((this._teamFeedCache[teamId] || []).find(function (p) { return p.id === postId; }) || {}).pinned;
    this.showToast(isPinned ? '\u5df2\u7f6e\u9802' : '\u5df2\u53d6\u6d88\u7f6e\u9802');
    this._refreshTeamDetailFeed(teamId);
  },

  /* ── Reactions ── */

  async toggleFeedReaction(teamId, postId, key) {
    var user = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
    var uid = (user && user.uid) ? user.uid : '';
    if (!uid) return;
    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function (p) { return p.id === postId; });
    if (!cached) return;
    if (!cached.reactions) cached.reactions = { like: [], heart: [], cheer: [] };
    var cArr = cached.reactions[key] || [];
    var cIdx = cArr.indexOf(uid);
    var adding = cIdx < 0;
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      var updateObj = {};
      updateObj['reactions.' + key] = adding
        ? firebase.firestore.FieldValue.arrayUnion(uid)
        : firebase.firestore.FieldValue.arrayRemove(uid);
      await collRef.doc(postId).update(updateObj);
      if (adding) cArr.push(uid); else cArr.splice(cIdx, 1);
      cached.reactions[key] = cArr;
    } catch (err) {
      console.error('[TeamFeed] toggleFeedReaction failed:', err);
    }
    this._refreshTeamDetailFeed(teamId);
  },

  /* ── Comments ── */

  async submitFeedComment(teamId, postId) {
    var input = document.getElementById('fc-' + postId);
    var text = (input ? input.value : '').trim();
    if (!text) return;
    if (text.length > 100) { this.showToast('\u7559\u8a00\u4e0d\u53ef\u8d85\u904e 100 \u5b57'); return; }
    var user = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
    var uid = (user && user.uid) ? user.uid : '';
    var name = (user && (user.displayName || user.name)) || '';
    var now = new Date();
    var timeStr = App._formatDateTime(now);
    var comment = { id: generateId('fc_'), uid: uid, name: name, text: text, time: timeStr };

    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function (p) { return p.id === postId; });
    if (!cached) return;
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      await collRef.doc(postId).update({
        comments: firebase.firestore.FieldValue.arrayUnion(comment)
      });
      await this._loadTeamFeed(teamId);
    } catch (err) {
      console.error('[TeamFeed] submitFeedComment failed:', err);
      this.showToast('\u7559\u8a00\u5931\u6557');
      return;
    }
    this._refreshTeamDetailFeed(teamId);
  },

  async deleteFeedComment(teamId, postId, commentId) {
    var cache = this._teamFeedCache[teamId] || [];
    var cached = cache.find(function (p) { return p.id === postId; });
    if (!cached || !cached.comments) return;
    try {
      var collRef = await FirebaseService._getTeamSubcollectionRef(teamId, 'feed');
      var docSnap = await collRef.doc(postId).get();
      if (!docSnap.exists) return;
      var filtered = (docSnap.data().comments || []).filter(function (c) { return c.id !== commentId; });
      await collRef.doc(postId).update({ comments: filtered });
      cached.comments = cached.comments.filter(function (c) { return c.id !== commentId; });
    } catch (err) {
      console.error('[TeamFeed] deleteFeedComment failed:', err);
      this.showToast('\u522a\u9664\u7559\u8a00\u5931\u6557');
      return;
    }
    this._refreshTeamDetailFeed(teamId);
  },

  /* ── Refresh & Pagination ── */

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
