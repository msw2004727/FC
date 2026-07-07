const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function readProjectBinary(file) {
  return fs.readFileSync(path.join(ROOT, file));
}

function getImageDimensions(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') === pngSignature) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
    let offset = 2;
    while (offset < buffer.length) {
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      const length = buffer.readUInt16BE(offset);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += length;
    }
  }
  throw new Error('Unsupported image format');
}

describe('event share OG assets', () => {
  test('share image assets are compressed and keep expected formats', () => {
    const maxOgBytes = 300 * 1024;
    const defaultOg = readProjectBinary('assets/og/default.png');
    expect(defaultOg.length).toBeLessThanOrEqual(maxOgBytes);
    expect(defaultOg.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(getImageDimensions(defaultOg)).toEqual({ width: 1200, height: 630 });

    for (const sport of ['football', 'basketball', 'pickleball', 'dodgeball']) {
      const image = readProjectBinary(`assets/og/sports/${sport}.jpg`);
      expect(image.length).toBeLessThanOrEqual(maxOgBytes);
      expect(image.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(image.subarray(0, 8).toString('hex')).not.toBe('89504e470d0a1a0a');
      expect(getImageDimensions(image)).toEqual({ width: 1200, height: 630 });
    }

    for (const logo of ['assets/logo-black.webp', 'assets/logo-white.webp']) {
      const image = readProjectBinary(logo);
      expect(image.length).toBeLessThanOrEqual(20 * 1024);
      expect(image.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(image.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });

  test('Cloud Function maps supported sports to versioned OG images', () => {
    const source = readProjectFile('functions/index.js');
    expect(source).toContain('const OG_ASSET_VERSION = "20260707"');
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

  test('event-share sends humans to the web event detail, not Mini App', () => {
    const source = readProjectFile('functions/index.js');
    expect(source).toContain('`${SHARE_SITE_ORIGIN}/events/${encodedEventId}`');
    expect(source).not.toContain('`https://miniapp.line.me/${MINI_APP_ID}?event=${encodedEventId}`');
    expect(source).not.toContain('Open ToosterX');
  });

  test('legacy root event query remains in the Mini App bridge', () => {
    const source = readProjectFile('index.html');
    expect(source).toContain("var keys=['event','team','tournament','profile']");
    expect(source).toContain("location.replace('https://miniapp.line.me/2009525300-AuPGQ0sh'+s)");
  });

  test('LINE Flex event cards use the same sport share images', () => {
    const source = readProjectFile('js/modules/event/event-share-builders.js');
    for (const sport of ['football', 'basketball', 'pickleball', 'dodgeball']) {
      expect(source).toContain(`https://toosterx.com/assets/og/sports/${sport}.jpg?v=`);
    }
    expect(source).toContain('_getEventShareImageUrl(event)');
    expect(source).toContain('_getEventShareVersion() {');
    expect(source).toContain("return '20260707';");
    expect(source).toContain("return 'https://toosterx.com/event-share/' + encodeURIComponent(String(eventId || '').trim()) + suffix");
    expect(source).toContain('const shareImageUrl = this._getEventShareImageUrl(event)');
    expect(source).toContain('var externalShareImageUrl = this._getEventShareImageUrl(event)');
    expect(source).toContain("course: '#0284c7'");
    expect(source).toContain("course: '\\u8AB2\\u7A0B'");
  });

  test('legacy root og.png is served from the organized asset path', () => {
    const source = readProjectFile('_worker.js');
    expect(source).toContain('const LEGACY_OG_IMAGE_PATH = "/og.png"');
    expect(source).toContain('const DEFAULT_OG_IMAGE_PATH = "/assets/og/default.png"');
    expect(source).toContain('function isLegacyOgImagePath(pathname)');
    expect(source).toContain('return handleLegacyOgImage(request, env)');
  });
});
