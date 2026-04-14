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
