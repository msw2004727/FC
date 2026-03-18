/* ================================================
   SportHub — Tournament Share (LINE Flex Message + Action Sheet)
   依賴：config.js, api-service.js, line-auth.js, event-share.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildTournamentLiffUrl(tournamentId) {
    return 'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?tournament=' + encodeURIComponent(String(tournamentId || ''));
  },

  // ══════════════════════════════════
  //  Plain-text Alt Text (max 400 chars)
  // ══════════════════════════════════

  _buildTournamentShareAltText(tournament, liffUrl) {
    var lines = [
      '\u8CFD\u4E8B\uFF1A' + (tournament.name || ''),
    ];
    var modeLabel = (typeof App._getTournamentModeLabel === 'function')
      ? App._getTournamentModeLabel(tournament) : '';
    if (modeLabel) lines.push('\u985E\u578B\uFF1A' + modeLabel);
    var organizer = (typeof App._getTournamentOrganizerDisplayText === 'function')
      ? App._getTournamentOrganizerDisplayText(tournament)
      : (tournament.organizer || '');
    if (organizer) lines.push('\u4E3B\u8FA6\uFF1A' + organizer);
    if (tournament.region) lines.push('\u5730\u5340\uFF1A' + tournament.region);
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

  _buildTournamentFlexMessage(tournament, liffUrl) {
    var accentColor = '#0d9488';
    var bodyContents = [];

    // Type capsule
    var modeLabel = (typeof App._getTournamentModeLabel === 'function')
      ? App._getTournamentModeLabel(tournament) : '\u53CB\u8ABC\u8CFD';
    bodyContents.push({
      type: 'box', layout: 'horizontal', contents: [
        {
          type: 'text', text: '\uD83C\uDFC6 ' + (modeLabel || '\u53CB\u8ABC\u8CFD'),
          size: 'xs', color: '#ffffff', weight: 'bold',
          align: 'center', gravity: 'center',
        },
      ],
      backgroundColor: accentColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: '100px',
    });

    // Tournament name
    bodyContents.push({
      type: 'text', text: tournament.name || '\u8CFD\u4E8B',
      weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md',
    });

    // Info rows
    var infoContents = [];
    var organizer = (typeof App._getTournamentOrganizerDisplayText === 'function')
      ? App._getTournamentOrganizerDisplayText(tournament)
      : (tournament.organizer || '');
    if (organizer) {
      infoContents.push(this._buildFlexInfoRow('\u4E3B\u8FA6', organizer));
    }
    if (tournament.region) {
      infoContents.push(this._buildFlexInfoRow('\u5730\u5340', tournament.region));
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
          type: 'button', style: 'primary', color: accentColor,
          action: { type: 'uri', label: '\u67E5\u770B\u8CFD\u4E8B', uri: liffUrl },
          height: 'sm',
        },
      ],
      paddingAll: '12px',
    };

    return { type: 'bubble', size: 'mega', body: body, footer: footer };
  },

  // ══════════════════════════════════
  //  Main Entry — shareTournament (overrides old version)
  // ══════════════════════════════════

  async shareTournament(tournamentId) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareTournament(tournamentId);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareTournament(tournamentId) {
    var tournament = ApiService.getFriendlyTournamentRecord
      ? ApiService.getFriendlyTournamentRecord(tournamentId)
      : null;
    if (!tournament) tournament = ApiService.getTournament ? ApiService.getTournament(tournamentId) : null;
    if (!tournament) return;

    var liffUrl = this._buildTournamentLiffUrl(tournamentId);
    var shareUrl = this._buildShareUrl('tournament', tournamentId);
    var altText = this._buildTournamentShareAltText(tournament, shareUrl);
    var canPicker = await this._canUseShareTargetPicker();

    if (canPicker || LineAuth.isLoggedIn()) {
      var choice = await this._showShareActionSheet(canPicker, '\u5206\u4EAB\u8CFD\u4E8B');

      if (choice === 'line') {
        if (!canPicker) {
          this.showToast('\u8ACB\u5728 LINE \u4E2D\u958B\u555F\u4EE5\u4F7F\u7528\u6B64\u529F\u80FD');
          return;
        }
        try {
          var flexMsg = this._buildTournamentFlexMessage(tournament, liffUrl);
          var res = await liff.shareTargetPicker([
            { type: 'flex', altText: altText, contents: flexMsg },
          ]);
          if (res) {
            this.showToast('\u8CFD\u4E8B\u5DF2\u5206\u4EAB\u5230 LINE');
          } else {
            this.showToast('\u5206\u4EAB\u5DF2\u5B8C\u6210');
          }
        } catch (err) {
          console.warn('[TournamentShare] shareTargetPicker failed:', err);
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
        await navigator.share({ text: altText });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    var copyOk = await this._copyToClipboard(altText);
    this.showToast(copyOk
      ? '\u8CFD\u4E8B\u5206\u4EAB\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

});
