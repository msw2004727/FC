/* ================================================
   SportHub — Team Share: Pure Builders (URL / AltText / Flex)
   純 JSON/URL 建構，無 DOM 操作、無平台互動。
   從 team-share.js 抽出。
   依賴：config.js
   ================================================ */

Object.assign(App, {

  _buildTeamLiffUrl(teamId) {
    return MINI_APP_BASE_URL + '?team=' + encodeURIComponent(String(teamId || ''));
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?team=' + encodeURIComponent(String(teamId || ''));
  },

  _buildTeamShareAltText(team, liffUrl) {
    var lines = [
      '\u300C' + (team.name || '') + '\u300D\u7403\u968A',
      '\u8A98\u60A8\u52A0\u5165\u7403\u968A\uFF0C\u8DDF\u6211\u5011\u4E00\u8D77\u4EAB\u53D7\u904B\u52D5\uFF01',
    ];
    if (team.region) lines.push('\u5730\u5340\uFF1A' + team.region);
    var members = typeof team.members === 'number' ? team.members : (Array.isArray(team.members) ? team.members.length : 0);
    if (members > 0) lines.push('\u6210\u54E1\uFF1A' + members + ' \u4EBA');
    lines.push(liffUrl);
    var text = lines.join('\n');
    if (text.length > 400) {
      text = Array.from(text).slice(0, 397).join('') + '...';
    }
    return text;
  },

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
    var members = typeof team.members === 'number' ? team.members : (Array.isArray(team.members) ? team.members.length : 0);
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

});
