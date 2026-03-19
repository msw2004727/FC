/* ================================================
   SportHub — Profile Share (LINE Flex Message + Action Sheet)
   依賴：config.js, api-service.js, line-auth.js, event-share.js, profile-core.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildProfileLiffUrl(uid) {
    if (!uid) return MINI_APP_BASE_URL;
    return MINI_APP_BASE_URL + '?profile=' + encodeURIComponent(String(uid));
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?profile=' + encodeURIComponent(String(uid));
  },

  // ══════════════════════════════════
  //  Plain-text Alt Text (max 400 chars)
  // ══════════════════════════════════

  _buildProfileShareAltText(name, user, liffUrl) {
    var lines = [
      'SportHub \u7528\u6236\u540D\u7247\uFF1A' + (name || ''),
    ];
    if (user && user.region && user.region !== '-') lines.push('\u5730\u5340\uFF1A' + user.region);
    lines.push(liffUrl);
    var text = lines.join('\n');
    if (text.length > 400) {
      text = Array.from(text).slice(0, 397).join('') + '...';
    }
    return text;
  },

  // ══════════════════════════════════
  //  Flex Message Builder
  // ══════════════════════════════════

  _buildProfileFlexMessage(name, user, liffUrl) {
    var brandColor = '#6366f1';
    var bodyContents = [];

    // Role capsule
    var roleLabel = '\u7528\u6236';
    if (user && user.role && typeof ROLES !== 'undefined' && ROLES[user.role]) {
      roleLabel = ROLES[user.role].label || roleLabel;
    }
    bodyContents.push({
      type: 'box', layout: 'horizontal', contents: [
        {
          type: 'text', text: '\uD83D\uDC64 ' + roleLabel,
          size: 'xs', color: '#ffffff', weight: 'bold',
          align: 'center', gravity: 'center',
        },
      ],
      backgroundColor: brandColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: '90px',
    });

    // Name
    bodyContents.push({
      type: 'text', text: name || '\u7528\u6236',
      weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md',
    });

    // Info rows
    var infoContents = [];
    if (user && user.region && user.region !== '-') {
      infoContents.push(this._buildFlexInfoRow('\u5730\u5340', user.region));
    }
    if (user && user.sports && user.sports !== '-') {
      infoContents.push(this._buildFlexInfoRow('\u904B\u52D5', user.sports));
    }
    if (infoContents.length > 0) {
      bodyContents.push({
        type: 'box', layout: 'vertical', contents: infoContents,
        margin: 'lg', spacing: 'sm',
      });
    }

    var body = {
      type: 'box', layout: 'vertical', contents: bodyContents,
      paddingAll: '16px',
    };

    var footer = {
      type: 'box', layout: 'vertical', contents: [
        {
          type: 'button', style: 'primary', color: brandColor,
          action: { type: 'uri', label: '\u67E5\u770B\u540D\u7247', uri: liffUrl },
          height: 'sm',
        },
      ],
      paddingAll: '12px',
    };

    return { type: 'bubble', size: 'mega', body: body, footer: footer };
  },

  // ══════════════════════════════════
  //  Main Entry — _shareUserCard (overrides old version in profile-core.js)
  // ══════════════════════════════════

  async _shareUserCard(name) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareUserCard(name);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareUserCard(name) {
    // Resolve uid from name
    var user = this._findUserByName ? this._findUserByName(name) : null;
    var uid = (user && (user.uid || user.lineUserId)) || '';

    var liffUrl = this._buildProfileLiffUrl(uid);
    var shareUrl = this._buildShareUrl('profile', uid);
    var altText = this._buildProfileShareAltText(name, user, shareUrl);
    var canPicker = await this._canUseShareTargetPicker();

    if (canPicker || LineAuth.isLoggedIn()) {
      var choice = await this._showShareActionSheet(canPicker, '\u5206\u4EAB\u540D\u7247');

      if (choice === 'line') {
        if (!canPicker) {
          this.showToast('\u8ACB\u5728 LINE \u4E2D\u958B\u555F\u4EE5\u4F7F\u7528\u6B64\u529F\u80FD');
          return;
        }
        try {
          var flexMsg = this._buildProfileFlexMessage(name, user, liffUrl);
          var res = await liff.shareTargetPicker([
            { type: 'flex', altText: altText, contents: flexMsg },
          ]);
          if (res) {
            this.showToast('\u540D\u7247\u5DF2\u5206\u4EAB\u5230 LINE');
          } else {
            this.showToast('\u5206\u4EAB\u5DF2\u5B8C\u6210');
          }
        } catch (err) {
          console.warn('[ProfileShare] shareTargetPicker failed:', err);
          this.showToast('\u5206\u4EAB\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
        }
        return;
      }

      if (choice === 'line-share') {
        this._openLineRShare(altText);
        return;
      }

      if (choice === 'copy') {
        var ok = await this._copyToClipboard(altText);
        this.showToast(ok ? '\u9023\u7D50\u5DF2\u8907\u88FD' : '\u8907\u88FD\u5931\u6557');
        return;
      }

      return; // cancel
    }

    // fallback
    if (navigator.share) {
      try {
        await navigator.share({ title: name + ' \u7684 SportHub \u540D\u7247', text: altText });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    var copyOk = await this._copyToClipboard(altText);
    this.showToast(copyOk
      ? '\u540D\u7247\u9023\u7D50\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

});
