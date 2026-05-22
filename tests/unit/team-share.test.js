const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadTeamShareBuilders(app = {}) {
  const context = {
    App: app,
    MINI_APP_BASE_URL: 'https://miniapp.line.me/2009525300-AuPGQ0sh',
    console,
    Object,
    Array,
    String,
    Number,
    encodeURIComponent,
    escapeHTML: (value) => String(value ?? ''),
  };
  const source = fs.readFileSync(path.join(ROOT, 'js/modules/team/team-share-builders.js'), 'utf8');
  vm.runInNewContext(source, context);
  return app;
}

describe('team share builders', () => {
  test('plain text invite excludes region and member count', () => {
    const app = loadTeamShareBuilders();
    const text = app._buildTeamShareAltText(
      { id: 'tm_demo', name: '測試範本', region: '台中市', members: 12 },
      'https://miniapp.line.me/2009525300-AuPGQ0sh?team=tm_demo'
    );

    expect(text).toBe('「測試範本」球隊\n邀請您加入，跟我們一起享受運動！\n\nhttps://miniapp.line.me/2009525300-AuPGQ0sh?team=tm_demo');
    expect(text).not.toContain('地區');
    expect(text).not.toContain('成員');
  });

  test('copy link uses public web route while LINE uses Mini App URL', () => {
    const app = loadTeamShareBuilders();

    expect(app._buildTeamLiffUrl('tm_1774501575628_nox9py')).toBe('https://miniapp.line.me/2009525300-AuPGQ0sh?team=tm_1774501575628_nox9py');
    expect(app._buildTeamWebShareUrl('tm_1774501575628_nox9py')).toBe('https://toosterx.com/teams/tm_1774501575628_nox9py');

    const shareSource = fs.readFileSync(path.join(ROOT, 'js/modules/team/team-share.js'), 'utf8');
    expect(shareSource).toContain('var altText = this._buildTeamShareAltText(t, liffUrl)');
    expect(shareSource).toContain('var copyText = this._buildTeamShareAltText(t, webShareUrl)');
  });
});
