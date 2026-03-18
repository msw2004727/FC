/* ================================================
   SportHub — Team Detail: Member Management & Invite
   Split from team-detail.js — member management,
   invite QR code, share utilities.
   Dynamic HTML uses escapeHTML() per CLAUDE.md.
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Team Invite Share URL
  // ══════════════════════════════════

  _getTeamInviteShareUrl(teamId) {
    return this._buildTeamLiffUrl ? this._buildTeamLiffUrl(teamId)
      : 'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?team=' + encodeURIComponent(String(teamId || '').trim());
  },

  _buildTeamInviteShareText(teamName, shareUrl) {
    const cleanName = String(teamName || '').trim();
    const teamLabel = cleanName ? `\u300c${cleanName}\u300d\u7403\u968a` : '\u7403\u968a';
    return `\u9019\u662f\u5728ToosterX Hub\u4e0a\u5275\u7acb\u7684${teamLabel}\uff0c\u8aa0\u647d\u9080\u8acb\u60a8\u52a0\u5165\u7403\u968a\uff0c\u8ddf\u6211\u5011\u4e00\u8d77\u4eab\u53d7\u6d3b\u52d5~\n${shareUrl}`;
  },

  _copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(textarea);
    if (copied) {
      this.showToast('\u9080\u8acb\u5167\u5bb9\u5df2\u8907\u88fd');
    } else {
      this.showToast('\u8907\u88fd\u5931\u6557');
    }
  },

  async _shareOrCopyTeamInvite(shareText) {
    if (!shareText) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        this.showToast('\u9080\u8acb\u5167\u5bb9\u5df2\u8907\u88fd');
      }).catch(() => {
        this._copyTextFallback(shareText);
      });
      return;
    }
    this._copyTextFallback(shareText);
  },

  // ══════════════════════════════════
  //  Team Invite QR Code
  // ══════════════════════════════════

  showTeamInviteQR(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;

    const url = this._getTeamInviteShareUrl(teamId);
    const shareText = this._buildTeamInviteShareText(t.name, url);
    const sharePreview = escapeHTML(shareText).replace(/\n/g, '<br>');

    const existing = document.getElementById('qr-invite-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'qr-invite-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card,#fff);border-radius:14px;padding:1.2rem;text-align:center;max-width:340px;width:90%';
    card.innerHTML = [
      '<div style="font-size:.95rem;font-weight:700;margin-bottom:.5rem">' + escapeHTML(t.name) + ' \u9080\u8acb\u52a0\u5165</div>',
      '<div id="qr-invite-target" style="display:flex;justify-content:center;margin:.5rem 0"></div>',
      '<div style="font-size:.72rem;color:var(--text-muted,#6b7280);line-height:1.6;white-space:normal;word-break:break-word">' + sharePreview + '</div>',
      '<div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:.5rem;word-break:break-all;user-select:all">' + escapeHTML(url) + '</div>',
      '<div style="display:flex;gap:.5rem;justify-content:center;margin-top:.6rem">',
        '<button id="qr-copy-btn" style="padding:.4rem 1rem;border:1px solid var(--primary,#3b82f6);border-radius:8px;background:transparent;color:var(--primary,#3b82f6);font-size:.82rem;cursor:pointer">' + (navigator.share ? '\u5206\u4eab\u9080\u8acb' : '\u8907\u88fd\u9080\u8acb') + '</button>',
        '<button style="padding:.4rem 1rem;border:none;border-radius:8px;background:var(--primary,#3b82f6);color:#fff;font-size:.82rem;cursor:pointer" onclick="document.getElementById(\'qr-invite-overlay\').remove()">\u95dc\u9589</button>',
      '</div>',
    ].join('');

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('qr-copy-btn').addEventListener('click', () => {
      this._shareOrCopyTeamInvite(shareText);
    });

    const target = document.getElementById('qr-invite-target');
    if (target) {
      const apiFallback = () => {
        const img = document.createElement('img');
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=' + encodeURIComponent(url);
        img.style.cssText = 'width:200px;height:200px;display:block';
        img.alt = 'QR Code';
        img.onerror = () => { target.textContent = 'QR Code \u8f09\u5165\u5931\u6557'; };
        target.innerHTML = '';
        target.appendChild(img);
      };
      if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
        QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
          .then(dataUrl => {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.style.cssText = 'width:200px;height:200px;display:block';
            img.alt = 'QR Code';
            target.innerHTML = '';
            target.appendChild(img);
          })
          .catch(() => apiFallback());
      } else {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
        s.onload = () => {
          if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
            QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'M' })
              .then(dataUrl => {
                const img = document.createElement('img');
                img.src = dataUrl;
                img.style.cssText = 'width:200px;height:200px;display:block';
                img.alt = 'QR Code';
                target.innerHTML = '';
                target.appendChild(img);
              })
              .catch(() => apiFallback());
          } else {
            apiFallback();
          }
        };
        s.onerror = () => apiFallback();
        document.head.appendChild(s);
      }
    }
  },

  // ══════════════════════════════════
  //  Feed & Comment CRUD
  // ══════════════════════════════════

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
    if (!content) { this.showToast('\u8acb\u8f38\u5165\u5167\u5bb9'); return; }
    if (content.length > 200) { this.showToast('\u5167\u5bb9\u4e0d\u53ef\u8d85\u904e 200 \u5b57'); return; }
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
    this._teamFeedPage[teamId] = 1;
    ApiService.updateTeam(teamId, { feed: t.feed });
    if (uid) this._grantAutoExp?.(uid, 'post_team_feed', content.slice(0, 20));
    this.showToast('\u52d5\u614b\u5df2\u767c\u4f48');
    this._refreshTeamDetailFeed(teamId);
  },

  deleteTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    t.feed = t.feed.filter(p => p.id !== postId);
    ApiService.updateTeam(teamId, { feed: t.feed });
    this.showToast('\u52d5\u614b\u5df2\u522a\u9664');
    this.showTeamDetail(teamId);
  },

  pinTeamPost(teamId, postId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post) return;
    if (!post.pinned) {
      const pinnedCount = t.feed.filter(p => p.pinned).length;
      if (pinnedCount >= this._MAX_PINNED) {
        this.showToast('\u6700\u591a\u53ea\u80fd\u7f6e\u9802 ' + this._MAX_PINNED + ' \u5247');
        return;
      }
    }
    post.pinned = !post.pinned;
    ApiService.updateTeam(teamId, { feed: t.feed });
    this.showToast(post.pinned ? '\u5df2\u7f6e\u9802' : '\u5df2\u53d6\u6d88\u7f6e\u9802');
    this.showTeamDetail(teamId);
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
    ApiService.updateTeam(teamId, { feed: t.feed });
    this._refreshTeamDetailFeed(teamId);
  },

  submitFeedComment(teamId, postId) {
    const input = document.getElementById('fc-' + postId);
    const text = (input?.value || '').trim();
    if (!text) return;
    if (text.length > 100) { this.showToast('\u7559\u8a00\u4e0d\u53ef\u8d85\u904e 100 \u5b57'); return; }
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
    ApiService.updateTeam(teamId, { feed: t.feed });
    this._refreshTeamDetailFeed(teamId);
  },

  deleteFeedComment(teamId, postId, commentId) {
    const t = ApiService.getTeam(teamId);
    if (!t || !t.feed) return;
    const post = t.feed.find(p => p.id === postId);
    if (!post || !post.comments) return;
    post.comments = post.comments.filter(c => c.id !== commentId);
    ApiService.updateTeam(teamId, { feed: t.feed });
    this._refreshTeamDetailFeed(teamId);
  },

  toggleMemberInvite(teamId, allowed) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    t.allowMemberInvite = allowed;
    ApiService.updateTeam(teamId, { allowMemberInvite: allowed });
    this.showToast(allowed ? '\u5df2\u958b\u653e\u968a\u54e1\u9080\u8acb' : '\u5df2\u95dc\u9589\u968a\u54e1\u9080\u8acb');
  },

});
