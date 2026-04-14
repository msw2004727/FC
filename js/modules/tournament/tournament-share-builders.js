/* ================================================
   SportHub — Tournament Share Builders (Pure)
   從 tournament-share.js 抽出的純建構函式。
   只做 URL/JSON/文字建構，無 DOM 操作。
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  LIFF URL Builder
  // ══════════════════════════════════

  _buildTournamentLiffUrl(tournamentId) {
    return MINI_APP_BASE_URL + '?tournament=' + encodeURIComponent(String(tournamentId || ''));
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?tournament=' + encodeURIComponent(String(tournamentId || ''));
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

});
