/* ================================================
   SportHub — Tournament Share (LINE Flex Message + Action Sheet)
   依賴：tournament-share-builders.js, config.js, api-service.js, line-auth.js, event-share.js
   Builder 函式已移至 tournament-share-builders.js：
     _buildTournamentLiffUrl / _buildTournamentShareAltText / _buildTournamentFlexMessage
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Main Entry — shareTournament (overrides old version)
  // ══════════════════════════════════

  async shareTournament(tournamentId, actionButton = null) {
    if (this._shareInProgress) {
      this.showToast?.('\u5206\u4EAB\u6E96\u5099\u4E2D\uFF0C\u8ACB\u7A0D\u5019');
      return false;
    }

    const runShare = async () => {
      this._shareInProgress = true;
      try {
        await this._doShareTournament(tournamentId);
        return true;
      } catch (err) {
        console.warn('[TournamentShare] share failed:', err);
        this.showToast?.('\u5206\u4EAB\u529F\u80FD\u66AB\u6642\u7121\u6CD5\u4F7F\u7528\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
        return false;
      } finally {
        this._shareInProgress = false;
      }
    };

    if (actionButton && typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(actionButton, '\u5206\u4EAB\u4E2D...', runShare);
    }

    return runShare();
  },

  async _doShareTournament(tournamentId) {
    var safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId) {
      this.showToast?.('\u627E\u4E0D\u5230\u8CFD\u4E8B\u8CC7\u6599\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66');
      return;
    }

    var tournament = ApiService.getFriendlyTournamentRecord
      ? ApiService.getFriendlyTournamentRecord(safeTournamentId)
      : null;
    if (!tournament) tournament = ApiService.getTournament ? ApiService.getTournament(safeTournamentId) : null;
    if (!tournament && ApiService.getTournamentAsync) {
      tournament = await ApiService.getTournamentAsync(safeTournamentId);
    }
    if (!tournament) {
      this.showToast?.('\u627E\u4E0D\u5230\u8CFD\u4E8B\u8CC7\u6599\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66');
      return;
    }

    if (typeof this._buildTournamentLiffUrl !== 'function'
        || typeof this._buildTournamentShareAltText !== 'function') {
      this.showToast?.('\u5206\u4EAB\u529F\u80FD\u8F09\u5165\u4E2D\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
      return;
    }

    var liffUrl = this._buildTournamentLiffUrl(safeTournamentId);
    var shareUrl = typeof this._buildShareUrl === 'function'
      ? this._buildShareUrl('tournament', safeTournamentId)
      : liffUrl;
    var altText = this._buildTournamentShareAltText(tournament, shareUrl);
    var canPicker = typeof this._canUseShareTargetPicker === 'function'
      ? await this._canUseShareTargetPicker()
      : false;
    var lineLoggedIn = typeof LineAuth !== 'undefined'
      && typeof LineAuth.isLoggedIn === 'function'
      && LineAuth.isLoggedIn();

    if ((canPicker || lineLoggedIn) && typeof this._showShareActionSheet === 'function') {
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
        if (typeof this._openLineRShare === 'function') {
          this._openLineRShare(altText);
        } else if (typeof window !== 'undefined' && window.open) {
          window.open('https://line.me/R/share?text=' + encodeURIComponent(altText), '_blank');
        }
        this.showToast?.('\u5DF2\u958B\u555F LINE \u5206\u4EAB');
        return;
      }

      if (choice === 'copy') {
        var ok = typeof this._copyToClipboard === 'function'
          ? await this._copyToClipboard(altText)
          : false;
        this.showToast(ok ? '\u9023\u7D50\u5DF2\u8907\u88FD' : '\u8907\u88FD\u5931\u6557');
        return;
      }

      return; // cancel
    }

    // fallback
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: altText });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    var copyOk = typeof this._copyToClipboard === 'function'
      ? await this._copyToClipboard(altText)
      : false;
    this.showToast(copyOk
      ? '\u8CFD\u4E8B\u5206\u4EAB\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F'
      : '\u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD');
  },

});
