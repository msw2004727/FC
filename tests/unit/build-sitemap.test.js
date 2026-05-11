const {
  buildEventEntries,
  buildTeamEntries,
  buildTournamentEntries,
  buildSitemapXml,
  isIndexableEvent,
  isIndexableTeam,
  isIndexableTournament,
  isSafeRouteSegment,
  pickLastMod,
  parseDateMs,
} = require('../../scripts/build-sitemap');

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-05-11T00:00:00Z').getTime();

describe('scripts/build-sitemap.js — indexability filters', () => {
  test('isIndexableEvent skips ended / private / hidden / draft', () => {
    expect(isIndexableEvent({ id: 'ce_1', status: 'ended', date: '2026/05/01' }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', status: 'cancelled', date: '2026/05/01' }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', privateEvent: true, date: '2026/06/01' }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', teamOnly: true, date: '2026/06/01' }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', isHidden: true, date: '2026/06/01' }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', isDraft: true, date: '2026/06/01' }, FIXED_NOW)).toBe(false);
  });

  test('isIndexableEvent skips events older than 30 days', () => {
    const oldMs = FIXED_NOW - 31 * DAY_MS;
    expect(isIndexableEvent({ id: 'ce_1', date: new Date(oldMs).toISOString() }, FIXED_NOW)).toBe(false);
    expect(isIndexableEvent({ id: 'ce_1', date: '2026/05/05' }, FIXED_NOW)).toBe(true);
  });

  test('isIndexableEvent keeps events without a date (TBD)', () => {
    expect(isIndexableEvent({ id: 'ce_1' }, FIXED_NOW)).toBe(true);
  });

  test('isIndexableTeam respects active and status flags', () => {
    expect(isIndexableTeam({ id: 'tm_1' })).toBe(true);
    expect(isIndexableTeam({ id: 'tm_1', active: false })).toBe(false);
    expect(isIndexableTeam({ id: 'tm_1', status: 'deleted' })).toBe(false);
    expect(isIndexableTeam({ id: 'tm_1', isHidden: true })).toBe(false);
  });

  test('isIndexableTournament skips ended / past', () => {
    expect(isIndexableTournament({ id: 'ct_1', matchDates: ['2026/06/01'] }, FIXED_NOW)).toBe(true);
    expect(isIndexableTournament({ id: 'ct_1', ended: true, matchDates: ['2026/06/01'] }, FIXED_NOW)).toBe(false);
    expect(isIndexableTournament({ id: 'ct_1', status: 'archived' }, FIXED_NOW)).toBe(false);
    expect(isIndexableTournament({ id: 'ct_1', matchDates: ['2026/01/01'] }, FIXED_NOW)).toBe(false);
  });

  test('isSafeRouteSegment rejects ids that would break clean URLs', () => {
    expect(isSafeRouteSegment('ce_1777808740886_nafqd5')).toBe(true);
    expect(isSafeRouteSegment('tm_test_123')).toBe(true);
    expect(isSafeRouteSegment('../etc')).toBe(false);
    expect(isSafeRouteSegment('foo/bar')).toBe(false);
    expect(isSafeRouteSegment('ab')).toBe(false);
    expect(isSafeRouteSegment('')).toBe(false);
  });
});

describe('scripts/build-sitemap.js — entry builders', () => {
  test('buildEventEntries emits absolute /events/{id} URLs with lastmod and de-dups', () => {
    const events = [
      { id: 'ce_1777808740886_aaaaaa', date: '2026/06/01', updatedAt: '2026-05-10T12:00:00Z' },
      { id: 'ce_1777808740886_aaaaaa', date: '2026/06/01' }, // duplicate
      { id: 'ce_old', status: 'ended', date: '2026/04/01' }, // filtered
      { id: 'a/b', date: '2026/06/01' },                     // unsafe id
    ];
    const out = buildEventEntries(events, FIXED_NOW);
    expect(out).toHaveLength(1);
    expect(out[0].loc).toBe('https://toosterx.com/events/ce_1777808740886_aaaaaa');
    expect(out[0].lastmod).toBe('2026-05-10');
    expect(out[0].changefreq).toBe('daily');
    expect(out[0].priority).toBe('0.7');
  });

  test('buildTeamEntries and buildTournamentEntries produce the expected loc shape', () => {
    const teamOut = buildTeamEntries([{ id: 'tm_demo_123' }, { id: 'tm_deleted', active: false }]);
    expect(teamOut).toHaveLength(1);
    expect(teamOut[0].loc).toBe('https://toosterx.com/teams/tm_demo_123');

    const tournamentOut = buildTournamentEntries(
      [{ id: 'ct_demo_456', matchDates: ['2026/07/01'] }],
      FIXED_NOW
    );
    expect(tournamentOut).toHaveLength(1);
    expect(tournamentOut[0].loc).toBe('https://toosterx.com/tournaments/ct_demo_456');
  });

  test('buildSitemapXml produces a well-formed urlset string', () => {
    const xml = buildSitemapXml([
      { loc: 'https://toosterx.com/events/ce_x', lastmod: '2026-05-11', changefreq: 'daily', priority: '0.7' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://toosterx.com/events/ce_x</loc>');
    expect(xml).toContain('<lastmod>2026-05-11</lastmod>');
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });

  test('pickLastMod prefers updatedAt then falls back to date', () => {
    expect(pickLastMod({ updatedAt: '2026-05-10T12:00:00Z' })).toBe('2026-05-10');
    // 2026/06/01 parses as local midnight; the date string is timezone-sensitive,
    // so just assert pickLastMod yields a YYYY-MM-DD string in the right ballpark.
    expect(pickLastMod({ date: '2026/06/01' })).toMatch(/^2026-0[56]-(0[1-9]|[12]\d|3[01])$/);
  });

  test('parseDateMs handles ISO and slash-separated dates', () => {
    expect(parseDateMs('2026-05-11T00:00:00Z')).toBe(new Date('2026-05-11T00:00:00Z').getTime());
    expect(parseDateMs('2026/06/01 12:00')).toBeGreaterThan(0);
    expect(parseDateMs(undefined)).toBe(0);
  });
});
