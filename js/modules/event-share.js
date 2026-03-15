/* ================================================
   SportHub — Event Share (LINE Flex Message + Action Sheet)
   依賴：config.js, api-service.js, line-auth.js, event-list.js
   ================================================ */

Object.assign(App, {

  _shareInProgress: false,

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildEventLiffUrl(eventId) {
    return 'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?event=' + encodeURIComponent(String(eventId || '').trim());
  },

  // ══════════════════════════════════
  //  Plain-text Alt Text (max 400 chars for LINE altText limit)
  // ══════════════════════════════════

  _buildEventShareAltText(event, liffUrl) {
    const lines = [
      '\uFF1C' + (event.title || '') + '\uFF1E',
      '\u65E5\u671F\uFF1A' + (event.date || ''),
      '\u5730\u9EDE\uFF1A' + (event.location || ''),
    ];
    if (event.max) {
      lines.push('\u4EBA\u6578\uFF1A' + (event.current || 0) + '/' + event.max + ' \u4EBA');
    }
    lines.push(liffUrl);
    let text = lines.join('\n');
    if (text.length > 400) {
      // Use Array.from to avoid splitting surrogate pairs (emoji)
      text = Array.from(text).slice(0, 397).join('') + '...';
    }
    return text;
  },

  // ══════════════════════════════════
  //  Flex Message Builder
  // ══════════════════════════════════

  _buildEventFlexMessage(event, liffUrl) {
    const typeColors = {
      play: '#7c3aed',
      friendly: '#0d9488',
      camp: '#ec4899',
      watch: '#f59e0b',
    };
    const typeLabels = {
      play: 'PLAY',
      friendly: '\u53CB\u8ABC',
      camp: '\u6559\u5B78',
      watch: '\u89C0\u8CFD',
    };
    const sportEmoji = (SPORT_ICON_EMOJI && SPORT_ICON_EMOJI[event.sportTag]) || '\u26BD';
    const typeColor = typeColors[event.type] || '#7c3aed';
    const typeLabel = typeLabels[event.type] || 'PLAY';

    // Body contents
    const bodyContents = [];

    // Type capsule row
    bodyContents.push({
      type: 'box', layout: 'horizontal', contents: [
        {
          type: 'text', text: sportEmoji + ' ' + typeLabel,
          size: 'xs', color: '#ffffff', weight: 'bold',
          align: 'center', gravity: 'center',
        },
      ],
      backgroundColor: typeColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: '90px',
    });

    // Title (maxLines: 2 prevents excessively tall bubbles)
    bodyContents.push({
      type: 'text', text: event.title || '\u6D3B\u52D5',
      weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md',
    });

    // Info rows
    const infoContents = [];
    if (event.date) {
      infoContents.push(this._buildFlexInfoRow('\u65E5\u671F', event.date));
    }
    if (event.location) {
      infoContents.push(this._buildFlexInfoRow('\u5730\u9EDE', event.location));
    }
    if (event.max) {
      infoContents.push(this._buildFlexInfoRow('\u4EBA\u6578', (event.current || 0) + '/' + event.max + ' \u4EBA'));
    }
    if (event.feeEnabled && event.fee > 0) {
      infoContents.push(this._buildFlexInfoRow('\u8CBB\u7528', '$' + event.fee));
    }
    if (infoContents.length > 0) {
      bodyContents.push({
        type: 'box', layout: 'vertical', contents: infoContents,
        margin: 'lg', spacing: 'sm',
      });
    }

    // Build body
    const body = {
      type: 'box', layout: 'vertical', contents: bodyContents,
      paddingAll: '16px',
    };

    // Footer with CTA button
    const footer = {
      type: 'box', layout: 'vertical', contents: [
        {
          type: 'button', style: 'primary', color: typeColor,
          action: { type: 'uri', label: '\u7ACB\u5373\u5831\u540D', uri: liffUrl },
          height: 'sm',
        },
      ],
      paddingAll: '12px',
    };

    // Build bubble
    const bubble = {
      type: 'bubble', size: 'mega',
      body: body,
      footer: footer,
    };

    // Hero image (only if event has image)
    if (event.image) {
      bubble.hero = {
        type: 'image', url: event.image,
        size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
      };
    }

    return bubble;
  },

  _buildFlexInfoRow(label, value) {
    return {
      type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
        { type: 'text', text: value, size: 'sm', color: '#333333', flex: 5, wrap: true },
      ],
    };
  },

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
      // Overlay
      var overlay = document.createElement('div');
      overlay.className = 'share-action-sheet';

      // 按鈕組裝
      var buttons = '';

      if (canPicker) {
        // LIFF 有效：Flex Message（好友/群組）+ LINE 社群（R/share）+ 複製
        buttons +=
          '<button class="share-action-sheet-btn" data-choice="line">' +
            '<span style="margin-right:6px">\uD83D\uDC9A</span>' +
            '<span class="share-action-sheet-btn-inner">' +
              '\u5206\u4EAB\u5230 LINE' +
              '<span class="share-action-sheet-btn-sub">\u7CBE\u7F8E\u5361\u7247\u30FB\u597D\u53CB / \u7FA4\u7D44</span>' +
            '</span>' +
          '</button>' +
          '<button class="share-action-sheet-btn" data-choice="line-share">' +
            '<span style="margin-right:6px">\uD83D\uDCAC</span>' +
            '<span class="share-action-sheet-btn-inner">' +
              '\u5206\u4EAB\u5230 LINE \u793E\u7FA4' +
              '<span class="share-action-sheet-btn-sub">\u7D14\u6587\u5B57\u30FB\u652F\u63F4\u793E\u7FA4 / OpenChat</span>' +
            '</span>' +
          '</button>';
      } else {
        // 非 LIFF：只有 R/share + 複製
        buttons +=
          '<button class="share-action-sheet-btn" data-choice="line-share">' +
            '<span style="margin-right:6px">\uD83D\uDCAC</span>\u5206\u4EAB\u5230 LINE</button>';
      }

      buttons +=
        '<button class="share-action-sheet-btn" data-choice="copy">' +
          '<span style="margin-right:6px">\uD83D\uDCCB</span>\u8907\u88FD\u9023\u7D50</button>';

      var sheetTitle = title || '\u5206\u4EAB\u6D3B\u52D5';
      var panel = document.createElement('div');
      panel.className = 'share-action-sheet-panel';
      panel.innerHTML =
        '<div class="share-action-sheet-title">' + sheetTitle + '</div>' +
        buttons +
        '<button class="share-action-sheet-cancel" data-choice="cancel">\u53D6\u6D88</button>';

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // Trigger animation
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
        // Fallback removal
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 400);
        resolve(choice);
      }

      // Event delegation
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

  async _canUseShareTargetPicker() {
    // LIFF SDK 尚未載入：嘗試等待 cloud ready
    if (typeof liff === 'undefined' && typeof App.ensureCloudReady === 'function' && !App._cloudReady) {
      try { await App.ensureCloudReady({ reason: 'share-event' }); } catch (_) {}
    }
    if (typeof liff === 'undefined') return false;
    if (!LineAuth.hasLiffSession()) return false;
    if (!liff.isApiAvailable || !liff.isApiAvailable('shareTargetPicker')) return false;
    return true;
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
        const ok = await this._copyToClipboard(altText);
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

});
