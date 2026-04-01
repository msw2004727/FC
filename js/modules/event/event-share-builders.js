/* === SportHub — Event Share: Message Builders ===
   Pure utility functions for building share content.
   依賴：config.js (LINE_CONFIG, SPORT_ICON_EMOJI)
   ================================================= */

Object.assign(App, {

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildEventLiffUrl(eventId) {
    return MINI_APP_BASE_URL + '?event=' + encodeURIComponent(String(eventId || '').trim());
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?event=' + encodeURIComponent(String(eventId || '').trim());
  },

  /** 通用社群分享用 URL（Mini App URL，team/tournament/profile 使用） */
  _buildShareUrl(paramKey, paramValue) {
    return MINI_APP_BASE_URL + '?' + paramKey + '=' + encodeURIComponent(String(paramValue || '').trim());
  },

  /** 活動專用社群分享 URL（經由 OG 中繼頁，讓連結預覽顯示活動封面圖） */
  _buildEventShareOgUrl(eventId) {
    return 'https://toosterx.com/event-share/' + encodeURIComponent(String(eventId || '').trim());
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
    const _heat = this._calcHeatPrediction?.(event);
    if (_heat) {
      const _heatLabels = { hot: '極熱門 — 預計快速額滿', warm: '熱門 — 報名踴躍', normal: '一般 — 正常報名中', cold: '冷門 — 名額充裕' };
      lines.push('熱度：' + (_heatLabels[_heat] || ''));
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
    const _flexHeat = this._calcHeatPrediction?.(event);
    if (_flexHeat) {
      const _flexHeatLabels = { hot: '極熱門 — 預計快速額滿', warm: '熱門 — 報名踴躍', normal: '一般 — 正常報名中', cold: '冷門 — 名額充裕' };
      infoContents.push(this._buildFlexInfoRow('熱度', _flexHeatLabels[_flexHeat] || ''));
    }
    if (event.feeEnabled && event.fee > 0) {
      infoContents.push(this._buildFlexInfoRow('\u8CBB\u7528', '$' + event.fee));
    }
    // team-split: 隊伍組成
    if (event.teamSplit?.enabled && Array.isArray(event.teamSplit.teams)) {
      const _tsRegs = ApiService.getRegistrationsByEvent?.(event.id) || [];
      const _tsValidKeys = new Set(event.teamSplit.teams.map(t => t.key));
      const _tsCounts = {};
      event.teamSplit.teams.forEach(t => { _tsCounts[t.key] = 0; });
      _tsRegs.filter(r => r.status === 'confirmed' && r.teamKey && _tsValidKeys.has(r.teamKey))
        .forEach(r => { _tsCounts[r.teamKey]++; });
      const _tsStr = event.teamSplit.teams.map(t => `${t.name || t.key} ${_tsCounts[t.key] || 0}`).join(' vs ');
      infoContents.push(this._buildFlexInfoRow('\u5206\u968A', _tsStr));
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
  //  External Event: Alt Text Builder
  // ══════════════════════════════════

  _buildExternalEventShareAltText(event) {
    var lines = [
      '\uFF1C' + (event.title || '') + '\uFF1E',
      '\u65E5\u671F\uFF1A' + (event.date || ''),
    ];
    if (event.location) {
      lines.push('\u5730\u9EDE\uFF1A' + event.location);
    }
    var shareUrl = event.id ? (MINI_APP_BASE_URL + '?event=' + event.id) : (event.externalUrl || '');
    lines.push('\u9023\u7D50\uFF1A' + shareUrl);
    var text = lines.join('\n');
    if (text.length > 400) {
      text = Array.from(text).slice(0, 397).join('') + '...';
    }
    return text;
  },

  // ══════════════════════════════════
  //  External Event: Flex Message Builder
  // ══════════════════════════════════

  _buildExternalEventFlexMessage(event) {
    var sportEmoji = (typeof SPORT_ICON_EMOJI !== 'undefined' && SPORT_ICON_EMOJI[event.sportTag]) || '\u26BD';
    var typeColor = '#6b7280';

    var bodyContents = [];

    // Type capsule
    bodyContents.push({
      type: 'box', layout: 'horizontal', contents: [
        {
          type: 'text', text: sportEmoji + ' \u5916\u90E8\u6D3B\u52D5',
          size: 'xs', color: '#ffffff', weight: 'bold',
          align: 'center', gravity: 'center',
        },
      ],
      backgroundColor: typeColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: '110px',
    });

    // Title
    bodyContents.push({
      type: 'text', text: event.title || '\u6D3B\u52D5',
      weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md',
    });

    // Info rows
    var infoContents = [];
    if (event.date) {
      infoContents.push(this._buildFlexInfoRow('\u65E5\u671F', event.date));
    }
    if (event.location) {
      infoContents.push(this._buildFlexInfoRow('\u5730\u9EDE', event.location));
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

    // Footer — 連結導回 Mini App（用戶先看中繼卡片，再決定是否跳外部）
    var miniAppUrl = event.id ? (MINI_APP_BASE_URL + '?event=' + event.id) : (event.externalUrl || 'https://example.com');
    var footer = {
      type: 'box', layout: 'vertical', contents: [
        {
          type: 'button', style: 'primary', color: typeColor,
          action: { type: 'uri', label: '\u67E5\u770B\u6D3B\u52D5', uri: miniAppUrl },
          height: 'sm',
        },
      ],
      paddingAll: '12px',
    };

    var bubble = {
      type: 'bubble', size: 'mega',
      body: body,
      footer: footer,
    };

    if (event.image) {
      bubble.hero = {
        type: 'image', url: event.image,
        size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
      };
    }

    return bubble;
  },

  // ══════════════════════════════════
  //  LIFF Share Capability Check
  // ══════════════════════════════════

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

});
