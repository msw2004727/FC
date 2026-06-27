const {
  URLS_TO_INSPECT,
  buildInspectionUrlList,
  collectSitemapPageUrls,
  extractSitemapIndexUrls,
  extractSitemapUrls,
  isToosterSitemapUrl,
  normalizeToosterUrl,
} = require('../../scripts/gsc-snapshot');

const ROOT_SITEMAP = 'https://toosterx.com/sitemap.xml';
const STATIC_SITEMAP = 'https://toosterx.com/sitemap-static.xml';
const EVENTS_SITEMAP = 'https://toosterx.com/sitemap-events.xml';

describe('scripts/gsc-snapshot.js URL inspection list helpers', () => {
  test('importing the script exposes helpers without running main', () => {
    expect(typeof buildInspectionUrlList).toBe('function');
    expect(typeof collectSitemapPageUrls).toBe('function');
  });

  test('inspection seeds use clean legal URLs', () => {
    expect(URLS_TO_INSPECT).toContain('https://toosterx.com/privacy');
    expect(URLS_TO_INSPECT).toContain('https://toosterx.com/terms');
    expect(URLS_TO_INSPECT).not.toContain('https://toosterx.com/privacy.html');
    expect(URLS_TO_INSPECT).not.toContain('https://toosterx.com/terms.html');
  });

  test('normalizeToosterUrl keeps Tooster pages, cleans .html, and rejects external URLs', () => {
    expect(normalizeToosterUrl('https://toosterx.com')).toBe('https://toosterx.com/');
    expect(normalizeToosterUrl('https://toosterx.com/index.html')).toBe('https://toosterx.com/');
    expect(normalizeToosterUrl('https://toosterx.com/privacy.html')).toBe('https://toosterx.com/privacy');
    expect(normalizeToosterUrl('https://toosterx.com/blog/post.html?utm=test#top')).toBe('https://toosterx.com/blog/post');
    expect(normalizeToosterUrl('https://example.com/blog/post')).toBeNull();
  });

  test('sitemap index parsing separates child sitemap XML from page URLs', () => {
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${STATIC_SITEMAP}</loc></sitemap>
        <sitemap><loc>${EVENTS_SITEMAP}</loc></sitemap>
      </sitemapindex>`;

    expect(extractSitemapUrls(sitemapIndex)).toEqual([]);
    expect(extractSitemapIndexUrls(sitemapIndex)).toEqual([STATIC_SITEMAP, EVENTS_SITEMAP]);
    expect(isToosterSitemapUrl(STATIC_SITEMAP)).toBe(true);
  });

  test('collectSitemapPageUrls recursively expands child sitemaps only through injected fetchText', async () => {
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${STATIC_SITEMAP}</loc></sitemap>
        <sitemap><loc>${EVENTS_SITEMAP}</loc></sitemap>
      </sitemapindex>`;
    const staticSitemap = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://toosterx.com/blog/adult-football-beginner-guide.html</loc></url>
        <url><loc>https://toosterx.com/sitemap-static.xml</loc></url>
      </urlset>`;
    const eventsSitemap = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://toosterx.com/events/ce_123456</loc></url>
        <url><loc>https://example.com/events/not-tooster</loc></url>
      </urlset>`;
    const fixtures = {
      [ROOT_SITEMAP]: sitemapIndex,
      [STATIC_SITEMAP]: staticSitemap,
      [EVENTS_SITEMAP]: eventsSitemap,
    };
    const fetchText = jest.fn(async (url) => fixtures[url]);

    await expect(collectSitemapPageUrls(ROOT_SITEMAP, fetchText)).resolves.toEqual([
      'https://toosterx.com/blog/adult-football-beginner-guide',
      'https://toosterx.com/events/ce_123456',
    ]);
    expect(fetchText).toHaveBeenCalledWith(ROOT_SITEMAP);
    expect(fetchText).toHaveBeenCalledWith(STATIC_SITEMAP);
    expect(fetchText).toHaveBeenCalledWith(EVENTS_SITEMAP);
  });

  test('buildInspectionUrlList excludes sitemap XML and respects the inspection limit', async () => {
    const fetchText = jest.fn(async () => `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://toosterx.com/blog/adult-football-beginner-guide.html</loc></url>
        <url><loc>${STATIC_SITEMAP}</loc></url>
      </urlset>`);

    const urls = await buildInspectionUrlList({
      sitemapUrl: STATIC_SITEMAP,
      fetchText,
      seedUrls: [
        'https://toosterx.com/privacy.html',
        'https://toosterx.com/terms.html',
        STATIC_SITEMAP,
      ],
      inspectionLimit: 3,
    });

    expect(urls).toEqual([
      'https://toosterx.com/privacy',
      'https://toosterx.com/terms',
      'https://toosterx.com/blog/adult-football-beginner-guide',
    ]);
    expect(urls).not.toContain(STATIC_SITEMAP);
  });
});