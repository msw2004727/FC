/* ================================================
   Activity Map: Geo Helpers
   Loaded only through ScriptLoader.ensureGroup('activityMap').
   ================================================ */

(function(root) {
  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function normalizePoint(input) {
    if (!input || typeof input !== 'object') return null;
    const lat = toFiniteNumber(input.lat ?? input.latitude);
    const lng = toFiniteNumber(input.lng ?? input.lon ?? input.longitude);
    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function getEventPoint(event) {
    const point = normalizePoint(event);
    if (!point) return null;
    if (event.mapLocationConfirmed === false) return null;
    return point;
  }

  function distanceMeters(a, b) {
    const pa = normalizePoint(a);
    const pb = normalizePoint(b);
    if (!pa || !pb) return null;
    const earth = 6371008.8;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(pb.lat - pa.lat);
    const dLng = toRad(pb.lng - pa.lng);
    const lat1 = toRad(pa.lat);
    const lat2 = toRad(pb.lat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatDistance(meters) {
    const value = toFiniteNumber(meters);
    if (value === null) return '';
    if (value < 1000) return `${Math.max(1, Math.round(value))} m`;
    return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} km`;
  }

  function buildBounds(points) {
    const valid = (points || []).map(normalizePoint).filter(Boolean);
    if (!valid.length) return null;
    const lats = valid.map(p => p.lat);
    const lngs = valid.map(p => p.lng);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);
    if (minLat === maxLat) {
      minLat -= 0.01;
      maxLat += 0.01;
    }
    if (minLng === maxLng) {
      minLng -= 0.01;
      maxLng += 0.01;
    }
    const padLat = (maxLat - minLat) * 0.18;
    const padLng = (maxLng - minLng) * 0.18;
    return {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
    };
  }

  function projectPoint(point, bounds) {
    const p = normalizePoint(point);
    if (!p || !bounds) return null;
    const x = (p.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
    const y = 1 - ((p.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat));
    return {
      x: Math.max(0.04, Math.min(0.96, x)),
      y: Math.max(0.06, Math.min(0.94, y)),
    };
  }

  root.ActivityMapGeo = {
    toFiniteNumber,
    normalizePoint,
    getEventPoint,
    distanceMeters,
    formatDistance,
    buildBounds,
    projectPoint,
  };

  if (root.App) {
    Object.assign(root.App, {
      _activityMapNormalizePoint: normalizePoint,
      _activityMapGetEventPoint: getEventPoint,
      _activityMapDistanceMeters: distanceMeters,
      _activityMapFormatDistance: formatDistance,
      _activityMapBuildBounds: buildBounds,
      _activityMapProjectPoint: projectPoint,
    });
  }
})(window);
