/* ================================================
   SportHub — Team Share (LINE Flex Message + Action Sheet)
   Builder 純函式已抽至 team-share-builders.js。
   本檔只留 UI 操作（分享流程）。
   依賴：team-share-builders.js, config.js, api-service.js,
         line-auth.js, event-share.js
   ================================================ */

Object.assign(App, {

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
