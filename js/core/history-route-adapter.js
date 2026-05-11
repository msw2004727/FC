/* ToosterX History API route parser.
 * Pure adapter only: no DOM rendering and no Firestore access.
 */
(function(root) {
  'use strict';

  var SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]{3,80}$/;
  var USER_UID_RE = /^U[a-fA-F0-9]{32}$/;

  var LIST_ROUTES = {
    activities: { kind: 'page', pageId: 'page-activities', legacyEquivalent: '#page-activities' },
    teams: { kind: 'page', pageId: 'page-teams', legacyEquivalent: '#page-teams' },
    tournaments: { kind: 'page', pageId: 'page-tournaments', legacyEquivalent: '#page-tournaments' },
    profile: { kind: 'page', pageId: 'page-profile', legacyEquivalent: '#page-profile' }
  };

  var DETAIL_ROUTES = {
    events: { kind: 'eventDetail', pageId: 'page-activity-detail', queryKey: 'event' },
    teams: { kind: 'teamDetail', pageId: 'page-team-detail', queryKey: 'team' },
    tournaments: { kind: 'tournamentDetail', pageId: 'page-tournament-detail', queryKey: 'tournament' }
  };

  function normalizePathname(pathname) {
    var path = String(pathname || '/').trim() || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    path = path.replace(/\/+$/, '') || '/';
    return path;
  }

  function hasUnsafeEncodedSlash(value) {
    return /%2f|%5c/i.test(String(value || ''));
  }

  function decodeSegment(segment) {
    if (!segment || hasUnsafeEncodedSlash(segment)) return '';
    try {
      return decodeURIComponent(segment);
    } catch (_) {
      return '';
    }
  }

  function isSafeSegment(segment) {
    if (!segment || segment === '.' || segment === '..') return false;
    if (segment.indexOf('/') !== -1 || segment.indexOf('\\') !== -1) return false;
    return SAFE_SEGMENT_RE.test(segment);
  }

  function routeResult(base, id) {
    var out = {
      source: 'history',
      kind: base.kind,
      pageId: base.pageId,
      legacyEquivalent: base.legacyEquivalent
    };
    if (id) {
      out.id = id;
      out.legacyEquivalent = '?' + base.queryKey + '=' + encodeURIComponent(id);
    }
    return out;
  }

  function parseHistoryRoute(pathname, options) {
    var opts = options || {};
    var path = normalizePathname(pathname);
    if (path === '/') {
      return { source: 'history', kind: 'page', pageId: 'page-home', legacyEquivalent: '#page-home' };
    }

    var rawSegments = path.split('/').filter(Boolean);
    if (rawSegments.length < 1 || rawSegments.length > 2) return null;
    if (rawSegments.some(hasUnsafeEncodedSlash)) return null;

    var first = decodeSegment(rawSegments[0]);
    if (!first) return null;

    if (rawSegments.length === 1) {
      var list = LIST_ROUTES[first];
      return list ? routeResult(list) : null;
    }

    var rawId = rawSegments[1];
    var id = decodeSegment(rawId);
    if (!id) return null;

    if (first === 'users') {
      if (!opts.usersPathEnabled || !USER_UID_RE.test(id)) return null;
      return {
        source: 'history',
        kind: 'userCard',
        pageId: 'page-user-card',
        id: id,
        legacyEquivalent: '?profile=' + encodeURIComponent(id)
      };
    }

    var detail = DETAIL_ROUTES[first];
    if (!detail || !isSafeSegment(id)) return null;
    return routeResult(detail, id);
  }

  function parseCurrentLocation(locationLike, options) {
    var loc = locationLike || root.location || {};
    return parseHistoryRoute(loc.pathname || '/', options);
  }

  var api = {
    parseHistoryRoute: parseHistoryRoute,
    parseCurrentLocation: parseCurrentLocation,
    isSafeRouteSegment: isSafeSegment
  };

  root.HistoryRouteAdapter = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
