const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('event share OG assets', () => {
  test('Cloud Function maps supported sports to versioned OG images', () => {
    const source = readProjectFile('functions/index.js');
    expect(source).toContain('const OG_ASSET_VERSION = "20260521"');
    expect(source).toContain('const EVENT_SHARE_URL_VERSION = OG_ASSET_VERSION');
    expect(source).toContain('DEFAULT_EVENT_SHARE_OG_IMAGE = DEFAULT_SHARE_OG_IMAGE');
    for (const sport of ['football', 'basketball', 'pickleball', 'dodgeball']) {
      expect(source).toContain(`${sport}: \`${'${SHARE_SITE_ORIGIN}'}/assets/og/sports/${sport}.jpg?v=${'${OG_ASSET_VERSION}'}\``);
    }
    expect(source).toContain('const sportImage = getEventSportShareOgImage(event?.sportTag || event?.sport)');
    expect(source).toContain('const ogImage = resolveEventShareOgImage(event)');
    expect(source).toContain('const eventShareUrl = buildEventShareUrl(eventId, req)');
  });

  test('event-share keeps OG crawlers on the preview page', () => {
    const source = readProjectFile('functions/index.js');
    expect(source).toContain('const OG_CRAWLER_USER_AGENT_RE =');
    expect(source).toContain('facebookexternalhit');
    expect(source).toContain('linespider');
    expect(source).toContain('function isOgCrawlerRequest(req)');
    expect(source).toContain('const shouldRedirect = !isOgCrawlerRequest(req)');
    expect(source).toContain('shouldRedirect = true');
    expect(source).toContain('<meta http-equiv="refresh"');
    expect(source).toContain('location.replace');
  });

  test('LINE Flex event cards use the same sport share images', () => {
    const source = readProjectFile('js/modules/event/event-share-builders.js');
    for (const sport of ['football', 'basketball', 'pickleball', 'dodgeball']) {
      expect(source).toContain(`https://toosterx.com/assets/og/sports/${sport}.jpg?v=`);
    }
    expect(source).toContain('_getEventShareImageUrl(event)');
    expect(source).toContain('_getEventShareVersion() {');
    expect(source).toContain("return '20260521';");
    expect(source).toContain("return 'https://toosterx.com/event-share/' + encodeURIComponent(String(eventId || '').trim()) + suffix");
    expect(source).toContain('const shareImageUrl = this._getEventShareImageUrl(event)');
    expect(source).toContain('var externalShareImageUrl = this._getEventShareImageUrl(event)');
  });

  test('legacy root og.png is served from the organized asset path', () => {
    const source = readProjectFile('_worker.js');
    expect(source).toContain('const LEGACY_OG_IMAGE_PATH = "/og.png"');
    expect(source).toContain('const DEFAULT_OG_IMAGE_PATH = "/assets/og/default.png"');
    expect(source).toContain('function isLegacyOgImagePath(pathname)');
    expect(source).toContain('return handleLegacyOgImage(request, env)');
  });
});
