/**
 * @jest-environment jsdom
 *
 * Phase 5.5 contract tests for App._updateRouteMetaTags + PAGE_META_MAP.
 *
 * The helper updates canonical / hreflang / og:url / og:type after a successful
 * render, so the SPA stops looking like a duplicate of `/` to Google.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function installApp() {
  const App = {
    _isSafeHistoryRouteSegment(id) {
      const value = String(id || '').trim();
      if (!value || value === '.' || value === '..') return false;
      if (value.indexOf('/') !== -1 || value.indexOf('\\') !== -1) return false;
      return /^[A-Za-z0-9_-]{3,80}$/.test(value);
    },
  };
  // Extract the two helpers verbatim from app.js so the contract is enforced
  // against the live source instead of a hand-maintained mirror.
  const appSource = readProjectFile('app.js');
  const pageMetaMatch = appSource.match(/_getPageMetaMap\([^)]*\)\s*\{[\s\S]*?\n\s{2}\},/);
  const updateMatch = appSource.match(/_updateRouteMetaTags\([^)]*\)\s*\{[\s\S]*?\n\s{2}\},/);
  if (!pageMetaMatch || !updateMatch) {
    throw new Error('Could not extract Phase 5.5 helpers from app.js');
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function('App', `
    Object.assign(App, {
      ${pageMetaMatch[0]}
      ${updateMatch[0]}
    });
    return App;
  `);
  return factory(App);
}

function setupHead() {
  document.head.innerHTML = `
    <link rel="canonical" href="https://toosterx.com/">
    <link rel="alternate" hreflang="zh-TW" href="https://toosterx.com/">
    <link rel="alternate" hreflang="x-default" href="https://toosterx.com/">
    <meta property="og:url" content="https://toosterx.com">
    <meta property="og:type" content="website">
  `;
}

function readHead() {
  return {
    canonical: document.querySelector('link[rel="canonical"]').getAttribute('href'),
    hreflangZh: document.querySelector('link[rel="alternate"][hreflang="zh-TW"]').getAttribute('href'),
    hreflangDefault: document.querySelector('link[rel="alternate"][hreflang="x-default"]').getAttribute('href'),
    ogUrl: document.querySelector('meta[property="og:url"]').getAttribute('content'),
    ogType: document.querySelector('meta[property="og:type"]').getAttribute('content'),
  };
}

describe('App._updateRouteMetaTags + PAGE_META_MAP (Phase 5.5)', () => {
  let App;
  beforeEach(() => {
    App = installApp();
    setupHead();
  });

  test('PAGE_META_MAP covers all clean-URL list + detail routes from §6', () => {
    const map = App._getPageMetaMap();
    expect(map['page-home']).toEqual({ path: '/', ogType: 'website' });
    expect(map['page-activities']).toEqual({ path: '/activities', ogType: 'website' });
    expect(map['page-teams']).toEqual({ path: '/teams', ogType: 'website' });
    expect(map['page-tournaments']).toEqual({ path: '/tournaments', ogType: 'website' });
    expect(map['page-profile']).toEqual({ path: '/profile', ogType: 'profile' });
    expect(map['page-activity-detail']).toEqual({ detailRoot: '/events', ogType: 'event' });
    expect(map['page-team-detail']).toEqual({ detailRoot: '/teams', ogType: 'website' });
    expect(map['page-tournament-detail']).toEqual({ detailRoot: '/tournaments', ogType: 'event' });
  });

  test('list pages write absolute canonical / hreflang / og:url + og:type', () => {
    const ok = App._updateRouteMetaTags('page-activities');
    expect(ok).toBe(true);
    const head = readHead();
    expect(head.canonical).toBe('https://toosterx.com/activities');
    expect(head.hreflangZh).toBe('https://toosterx.com/activities');
    expect(head.hreflangDefault).toBe('https://toosterx.com/activities');
    expect(head.ogUrl).toBe('https://toosterx.com/activities');
    expect(head.ogType).toBe('website');
  });

  test('home resets canonical back to root', () => {
    App._updateRouteMetaTags('page-activities');
    App._updateRouteMetaTags('page-home');
    const head = readHead();
    expect(head.canonical).toBe('https://toosterx.com/');
    expect(head.ogType).toBe('website');
  });

  test('detail pages require a safe id and produce /events/{id} URLs', () => {
    const ok = App._updateRouteMetaTags('page-activity-detail', { id: 'ce_1777808740886_nafqd5' });
    expect(ok).toBe(true);
    const head = readHead();
    expect(head.canonical).toBe('https://toosterx.com/events/ce_1777808740886_nafqd5');
    expect(head.ogUrl).toBe('https://toosterx.com/events/ce_1777808740886_nafqd5');
    expect(head.ogType).toBe('event');
  });

  test('detail pages refuse unsafe ids and leave the head untouched', () => {
    App._updateRouteMetaTags('page-activities');
    const before = readHead();
    expect(App._updateRouteMetaTags('page-activity-detail', { id: '../etc' })).toBe(false);
    expect(App._updateRouteMetaTags('page-activity-detail', { id: '' })).toBe(false);
    expect(App._updateRouteMetaTags('page-activity-detail')).toBe(false);
    expect(readHead()).toEqual(before);
  });

  test('tournament detail uses og:type=event, team detail uses og:type=website', () => {
    App._updateRouteMetaTags('page-tournament-detail', { id: 'ct_1777808740886_xy12ab' });
    expect(readHead().ogType).toBe('event');
    App._updateRouteMetaTags('page-team-detail', { id: 'tm_1777808740886_xy12ab' });
    expect(readHead().ogType).toBe('website');
  });

  test('unknown pageIds leave the head untouched', () => {
    App._updateRouteMetaTags('page-activities');
    const before = readHead();
    expect(App._updateRouteMetaTags('page-admin-banners')).toBe(false);
    expect(App._updateRouteMetaTags('')).toBe(false);
    expect(App._updateRouteMetaTags(null)).toBe(false);
    expect(readHead()).toEqual(before);
  });
});

describe('Phase 5.5 hook integration (source-level contract)', () => {
  test('_renderPageContent skips detail pages so detail handlers can set ids', () => {
    const navSource = readProjectFile('js/core/navigation.js');
    expect(navSource).toContain('this._updateRouteMetaTags(pageId)');
    expect(navSource).toMatch(/_updateRouteMetaTags[\s\S]{0,160}\/-detail\$\//);
  });

  test('detail handlers update meta tags after data is loaded', () => {
    const eventSource = readProjectFile('js/modules/event/event-detail.js');
    const teamSource = readProjectFile('js/modules/team/team-detail.js');
    const tournamentSource = readProjectFile('js/modules/tournament/tournament-detail.js');
    const friendlyTournamentSource = readProjectFile('js/modules/tournament/tournament-friendly-detail.js');

    expect(eventSource).toContain("this._updateRouteMetaTags?.('page-activity-detail', { id })");
    expect(teamSource).toContain("this._updateRouteMetaTags?.('page-team-detail', { id })");
    expect(tournamentSource).toContain("this._updateRouteMetaTags?.('page-tournament-detail', { id })");
    expect(friendlyTournamentSource).toContain("this._updateRouteMetaTags?.('page-tournament-detail', { id })");
  });

  test('Cloudflare worker no longer stamps detail SPA paths as noindex', () => {
    const workerSource = readProjectFile('_worker.js');
    const headers = readProjectFile('_headers');
    expect(workerSource).not.toContain('X-Robots-Tag", "noindex, nofollow"');
    expect(headers).not.toMatch(/\/(events|teams|tournaments)\/\*[\s\S]{0,80}X-Robots-Tag/);
  });

  test('sitemap.xml is a sitemapindex pointing at the four child sitemaps', () => {
    const sitemap = readProjectFile('sitemap.xml');
    expect(sitemap).toContain('<sitemapindex');
    expect(sitemap).toContain('sitemap-static.xml');
    expect(sitemap).toContain('sitemap-events.xml');
    expect(sitemap).toContain('sitemap-teams.xml');
    expect(sitemap).toContain('sitemap-tournaments.xml');
  });

  test('static sitemap uses clean canonical URLs for legal pages', () => {
    const sitemap = readProjectFile('sitemap-static.xml');
    expect(sitemap).toContain('<loc>https://toosterx.com/privacy</loc>');
    expect(sitemap).toContain('<loc>https://toosterx.com/terms</loc>');
    expect(sitemap).not.toContain('<loc>https://toosterx.com/privacy.html</loc>');
    expect(sitemap).not.toContain('<loc>https://toosterx.com/terms.html</loc>');
  });
});
