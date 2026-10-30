/**
 * 活動管理列表：外部活動卡的連結處理（只接受安全字元的 http(s) 連結）。
 */
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../../js/modules/event/event-manage.js');

describe('event-manage external activity link', () => {
  beforeEach(() => {
    global.escapeJsAttr = require('../helpers/event-binding').escapeJsAttr;
    global.escapeHTML = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    global.App = {};
    require(path.resolve(__dirname, '../../js/modules/ad-manage/banner.js'));
    require(SOURCE_PATH);
  });

  afterEach(() => {
    jest.resetModules();
    delete global.App;
    delete global.escapeJsAttr;
    delete global.escapeHTML;
  });

  test('plain https link is kept and html-escaped', () => {
    expect(App._eventExternalInlineUrl('https://example.test/a?x=1&y=2')).toBe('https://example.test/a?x=1&amp;y=2');
    expect(App._eventExternalInlineUrl('http://example.test/')).toBe('http://example.test/');
  });

  test.each([
    ['single quote', "https://example.test/x'),alert(1),('"],
    ['double quote', 'https://example.test/x"y'],
    ['backslash', 'https://example.test/x' + String.fromCharCode(92) + 'y'],
    ['whitespace', 'https://example.test/x y'],
    ['leading whitespace', ' https://example.test/x'],
    ['angle bracket', 'https://example.test/<b>'],
    ['backtick', 'https://example.test/x`y'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<b>x</b>'],
    ['upper-case scheme', 'HTTPS://example.test/'],
    ['empty', ''],
    ['not a string', null],
  ])('link with %s is treated as no link', (_label, url) => {
    expect(App._eventExternalInlineUrl(url)).toBe('');
  });

  test('事件繫結強化：外部活動共用連結檢查', () => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    expect(source.includes("window.open('${escapeHTML(e.externalUrl")).toBe(false);
    expect(source.includes('App._eventExternalInlineUrl(e.externalUrl)')).toBe(true);
  });
});
