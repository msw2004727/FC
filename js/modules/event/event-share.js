/* ================================================
   SportHub — Event Share (LINE Flex Message + Action Sheet)
   依賴：config.js, api-service.js, line-auth.js, event-list.js,
         event-share-builders.js
   ================================================ */

Object.assign(App, {

  _shareInProgress: false,

  // ══════════════════════════════════
  //  LINE R/share helper
  // ══════════════════════════════════

  _openLineRShare(altText) {
    var url = 'https://line.me/R/share?text=' + encodeURIComponent(altText);
    window.open(url, '_blank');
  },

  // ══════════════════════════════════
  //  Bottom Action Sheet
  // ══════════════════════════════════

  _showShareActionSheet(canPicker, title) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'share-action-sheet';

      var buttons = '';

      if (canPicker) {
        buttons +=
          '<button class="share-action-sheet-btn" data-choice="line">' +
            '<span class="share-action-sheet-btn-icon">\uD83D\uDC9A</span>' +
            '<span class="share-action-sheet-btn-label">LINE \u597D\u53CB' +
              '<span class="share-action-sheet-btn-sub">\u7CBE\u7F8E\u5361\u7247\u30FB\u597D\u53CB / \u7FA4\u7D44</span>' +
            '</span>' +
          '</button>' +
          '<button class="share-action-sheet-btn" data-choice="line-share">' +
            '<span class="share-action-sheet-btn-icon">\uD83D\uDCAC</span>' +
            '<span class="share-action-sheet-btn-label">LINE \u793E\u7FA4' +
              '<span class="share-action-sheet-btn-sub">\u7D14\u6587\u5B57\u30FB\u652F\u63F4 OpenChat</span>' +
            '</span>' +
          '</button>';
      } else {
        buttons +=
          '<button class="share-action-sheet-btn" data-choice="line-share">' +
            '<span class="share-action-sheet-btn-icon">\uD83D\uDCAC</span>' +
            '<span class="share-action-sheet-btn-label">\u5206\u4EAB\u5230 LINE</span>' +
          '</button>';
      }

      buttons +=
        '<button class="share-action-sheet-btn" data-choice="copy">' +
          '<span class="share-action-sheet-btn-icon">\uD83D\uDCCB</span>' +
          '<span class="share-action-sheet-btn-label">\u8907\u88FD\u9023\u7D50' +
            '<span class="share-action-sheet-btn-sub">toosterx \u539F\u57DF\u540D\u30FB\u8CBC\u793E\u7FA4\u986F\u793A\u5C01\u9762</span>' +
          '</span>' +
        '</button>';

      var sheetTitle = title || '\u5206\u4EAB\u6D3B\u52D5';
      var panel = document.createElement('div');
      panel.className = 'share-action-sheet-panel';
      panel.innerHTML =
        '<div class="share-action-sheet-title">' + sheetTitle + '</div>' +
        '<div class="share-action-sheet-grid">' + buttons + '</div>' +
        '<button class="share-action-sheet-cancel" data-choice="cancel">\u53D6\u6D88</button>';

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      requestAnimationFrame(function () {
        overlay.classList.add('active');
      });

      var resolved = false;
      function cleanup(choice) {
        if (resolved) return;
        resolved = true;
        overlay.classList.remove('active');
        overlay.addEventListener('transitionend', function handler() {
          overlay.removeEventListener('transitionend', handler);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 400);
        resolve(choice);
      }

      panel.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-choice]');
        if (btn) cleanup(btn.dataset.choice);
      });
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay) cleanup('cancel');
      });
    });
  },

  // ══════════════════════════════════
  //  Main Entry — shareEvent
  // ══════════════════════════════════

  async shareEvent(eventId) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareEvent(eventId);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareEvent(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const liffUrl = this._buildEventLiffUrl(eventId);
    const altText = this._buildEventShareAltText(e, liffUrl);
    const canPicker = await this._canUseShareTargetPicker();

    // 已登入（任何 tier）：顯示底部選單
    if (canPicker || LineAuth.isLoggedIn()) {
      const choice = await this._showShareActionSheet(canPicker);

      if (choice === 'line') {
        if (!canPicker) {
          // 理論上不會到這（按鈕已隱藏），但防禦性處理
          this.showToast('\u8ACB\u5728 LINE \u4E2D\u958B\u555F\u4EE5\u4F7F\u7528\u6B64\u529F\u80FD');
          return;
        }
        try {
          const flexMsg = this._buildEventFlexMessage(e, liffUrl);
          const res = await liff.shareTargetPicker([
            { type: 'flex', altText: altText, contents: flexMsg },
          ]);
          // LIFF SDK < 2.19 returns undefined for both success & cancel
          if (res) {
            this.showToast('\u6D3B\u52D5\u5DF2\u5206\u4EAB\u5230 LINE');
          } else {
            this.showToast('\u5206\u4EAB\u5DF2\u5B8C\u6210');
          }
        } catch (err) {
          console.warn('[Share] shareTargetPicker failed:', err);
          this.showToast('\u5206\u4EAB\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
        }
        return;
      }

      if (choice === 'line-share') {
        this._openLineRShare(altText);
        return;
      }

      if (choice === 'copy') {
        // 複製連結走 toosterx.com OG 中繼頁（貼 FB / IG 顯示封面卡片），CF 再 redirect 到 Mini App
        const copyUrl = this._buildEventShareOgUrl(eventId);
        const copyText = this._buildEventShareAltText(e, copyUrl);
        const ok = await this._copyToClipboard(copyText);
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
    const copyOk = await this._copyToClipboard(altText);
    this.showToast(copyOk
      ? '\u5206\u4EAB\u5167\u5BB9\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

  // ══════════════════════════════════
  //  Post-create Share Prompt
  // ══════════════════════════════════

  async _promptShareAfterCreate(eventId) {
    // 只要用戶已登入（任何 tier）就提示分享
    if (!LineAuth.isLoggedIn()) return;
    const confirmed = await this.appConfirm('\u6D3B\u52D5\u5DF2\u5EFA\u7ACB\uFF01\u8981\u5206\u4EAB\u55CE\uFF1F');
    if (confirmed) {
      await this.shareEvent(eventId);
    }
  },

  // ══════════════════════════════════
  //  External Event Share
  // ══════════════════════════════════

  async shareExternalEvent(eventId) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareExternalEvent(eventId);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareExternalEvent(eventId) {
    var e = ApiService.getEvent(eventId);
    if (!e) return;

    var altText = this._buildExternalEventShareAltText(e);
    var canPicker = await this._canUseShareTargetPicker();

    if (canPicker || LineAuth.isLoggedIn()) {
      var choice = await this._showShareActionSheet(canPicker, '\u5206\u4EAB\u6D3B\u52D5\u9023\u7D50');

      if (choice === 'line') {
        if (!canPicker) {
          this.showToast('\u8ACB\u5728 LINE \u4E2D\u958B\u555F\u4EE5\u4F7F\u7528\u6B64\u529F\u80FD');
          return;
        }
        try {
          var flexMsg = this._buildExternalEventFlexMessage(e);
          var res = await liff.shareTargetPicker([
            { type: 'flex', altText: altText, contents: flexMsg },
          ]);
          this.showToast(res ? '\u6D3B\u52D5\u5DF2\u5206\u4EAB\u5230 LINE' : '\u5206\u4EAB\u5DF2\u5B8C\u6210');
        } catch (err) {
          console.warn('[ShareExternal] shareTargetPicker failed:', err);
          this.showToast('\u5206\u4EAB\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
        }
        return;
      }

      if (choice === 'line-share') {
        this._openLineRShare(altText);
        return;
      }

      if (choice === 'copy') {
        // 複製連結走 toosterx.com OG 中繼頁（貼 FB / IG 顯示封面卡片），CF 再 redirect 到 Mini App
        var copyUrl = this._buildEventShareOgUrl(eventId);
        var copyText = this._buildExternalEventShareAltText(e, copyUrl);
        var ok = await this._copyToClipboard(copyText);
        this.showToast(ok ? '\u9023\u7D50\u5DF2\u8907\u88FD' : '\u8907\u88FD\u5931\u6557');
        return;
      }

      return; // cancel
    }

    // 未登入 fallback
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
      ? '\u5206\u4EAB\u5167\u5BB9\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

});
