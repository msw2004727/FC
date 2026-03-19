/* ================================================
   SportHub — Team Share (LINE Flex Message + Action Sheet)
   依賴：config.js, api-service.js, line-auth.js, event-share.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildTeamLiffUrl(teamId) {
    return MINI_APP_BASE_URL + '?team=' + encodeURIComponent(String(teamId || ''));
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?team=' + encodeURIComponent(String(teamId || ''));
  },

  // ══════════════════════════════════
  //  Plain-text Alt Text (max 400 chars)
  // ══════════════════════════════════

  _buildTeamShareAltText(team, liffUrl) {
    var lines = [
      '\u300C' + (team.name || '') + '\u300D\u7403\u968A',
      '\u8A98\u60A8\u52A0\u5165\u7403\u968A\uFF0C\u8DDF\u6211\u5011\u4E00\u8D77\u4EAB\u53D7\u904B\u52D5\uFF01',
    ];
    if (team.region) lines.push('\u5730\u5340\uFF1A' + team.region);
    var members = Array.isArray(team.members) ? team.members.length : 0;
    if (members > 0) lines.push('\u6210\u54E1\uFF1A' + members + ' \u4EBA');
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

  _buildTeamFlexMessage(team, liffUrl) {
    var brandColor = '#3b82f6';
    var bodyContents = [];

    // Team badge capsule
    bodyContents.push({
      type: 'box', layout: 'horizontal', contents: [
        {
          type: 'text', text: '\u26BD \u7403\u968A\u9080\u8ACB',
          size: 'xs', color: '#ffffff', weight: 'bold',
          align: 'center', gravity: 'center',
        },
      ],
      backgroundColor: brandColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: '100px',
    });

    // Team name
    bodyContents.push({
      type: 'text', text: team.name || '\u7403\u968A',
      weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md',
    });

    // Info rows
    var infoContents = [];
    if (team.region) {
      infoContents.push(this._buildFlexInfoRow('\u5730\u5340', team.region));
    }
    var members = Array.isArray(team.members) ? team.members.length : 0;
    if (members > 0) {
      infoContents.push(this._buildFlexInfoRow('\u6210\u54E1', members + ' \u4EBA'));
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
          action: { type: 'uri', label: '\u67E5\u770B\u7403\u968A', uri: liffUrl },
          height: 'sm',
        },
      ],
      paddingAll: '12px',
    };

    var bubble = { type: 'bubble', size: 'mega', body: body, footer: footer };

    if (team.coverImage) {
      bubble.hero = {
        type: 'image', url: team.coverImage,
        size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
      };
    }

    return bubble;
  },

  // ══════════════════════════════════
  //  Main Entry — shareTeam
  // ══════════════════════════════════

  async shareTeam(teamId) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareTeam(teamId);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareTeam(teamId) {
    var t = ApiService.getTeam(teamId);
    if (!t) return;

    var liffUrl = this._buildTeamLiffUrl(teamId);
    var shareUrl = this._buildShareUrl('team', teamId);
    var altText = this._buildTeamShareAltText(t, shareUrl);
    var canPicker = await this._canUseShareTargetPicker();

    if (canPicker || LineAuth.isLoggedIn()) {
      var choice = await this._showShareActionSheet(canPicker, '\u5206\u4EAB\u7403\u968A');

      if (choice === 'line') {
        if (!canPicker) {
          this.showToast('\u8ACB\u5728 LINE \u4E2D\u958B\u555F\u4EE5\u4F7F\u7528\u6B64\u529F\u80FD');
          return;
        }
        try {
          var flexMsg = this._buildTeamFlexMessage(t, liffUrl);
          var res = await liff.shareTargetPicker([
            { type: 'flex', altText: altText, contents: flexMsg },
          ]);
          if (res) {
            this.showToast('\u7403\u968A\u5DF2\u5206\u4EAB\u5230 LINE');
          } else {
            this.showToast('\u5206\u4EAB\u5DF2\u5B8C\u6210');
          }
        } catch (err) {
          console.warn('[TeamShare] shareTargetPicker failed:', err);
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

    // 未登入 + LIFF 不可用：navigator.share / clipboard fallback
    if (navigator.share) {
      try {
        await navigator.share({ text: altText });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    var copyOk = await this._copyToClipboard(altText);
    this.showToast(copyOk
      ? '\u7403\u968A\u9080\u8ACB\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

});
