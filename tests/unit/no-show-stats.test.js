/**
 * No-show statistics — unit tests
 *
 * Extracted from js/modules/event/event-manage-noshow.js
 * Tests: _buildRawNoShowCountByUid, _buildNoShowCountByUid,
 *        _getNoShowDetailsByUid, nameToUid historical data fix
 *
 * These are LOCKED functions per CLAUDE.md — tests protect against regressions.
 */

// ---------------------------------------------------------------------------
// Extracted from event-manage-noshow.js:55-120
// Adapted: inject dependencies instead of ApiService globals
// Parameters:
//   registrations – all registrations
//   attendanceRecords – attendance records
//   adminUsers – user list for nameToUid mapping
//   getEvent – function(eventId) => event or null
//   today – ISO date string "YYYY-MM-DD"
// ---------------------------------------------------------------------------
function _buildRawNoShowCountByUid({ registrations, attendanceRecords, adminUsers, getEvent, today }) {
  const checkinKeys = new Set();
  const countByUid = new Map();
  const seenRegKeys = new Set();

  // Build nameToUid map for historical data correction
  const nameToUid = new Map();
  (adminUsers || []).forEach(u => {
    const resolvedId = String(u?.uid || u?.lineUserId || '').trim();
    if (!resolvedId) return;
    [u?.displayName, u?.name].forEach(n => {
      const name = String(n || '').trim();
      if (name && name !== resolvedId) nameToUid.set(name, resolvedId);
    });
  });

  // Step 1: Build checkin index
  (attendanceRecords || []).forEach(record => {
    const uid = String(record?.uid || '').trim();
    const eventId = String(record?.eventId || '').trim();
    const type = String(record?.type || '').trim();
    const status = String(record?.status || '').trim();
    if (!uid || !eventId) return;
    if (status === 'removed' || status === 'cancelled') return;
    if (type === 'checkin') {
      checkinKeys.add(`${uid}::${eventId}`);
      const realUid = nameToUid.get(uid);
      if (realUid) checkinKeys.add(`${realUid}::${eventId}`);
    }
  });

  // Step 2: Count no-shows
  (registrations || []).forEach(reg => {
    const uid = String(reg?.userId || '').trim();
    const eventId = String(reg?.eventId || '').trim();
    const status = String(reg?.status || '').trim();
    if (!uid || !eventId) return;
    if (status !== 'confirmed') return;
    if (reg.participantType === 'companion') return;

    const key = `${uid}::${eventId}`;
    if (seenRegKeys.has(key)) return;
    seenRegKeys.add(key);

    const event = getEvent(eventId);
    if (!event || event.status !== 'ended') return;
    const eventDate = String(event.date || '').split(' ')[0].replace(/\//g, '-');
    if (!eventDate || eventDate >= today) return;

    if (checkinKeys.has(key)) return;

    countByUid.set(uid, (countByUid.get(uid) || 0) + 1);
  });

  return countByUid;
}

// ---------------------------------------------------------------------------
// Extracted from event-manage-noshow.js:133-150
// Adapted: inject rawCountByUid + corrections instead of calling this.*
// ---------------------------------------------------------------------------
function _buildNoShowCountByUid(rawCountByUid, corrections) {
  const effectiveCountByUid = new Map(rawCountByUid);

  (corrections || []).forEach(doc => {
    const uid = String(doc?.uid || doc?._docId || '').trim();
    if (!uid) return;
    const adjustment = Number(doc?.noShow?.adjustment || 0);
    if (!Number.isFinite(adjustment) || adjustment === 0) return;
    const next = Math.max(0, (effectiveCountByUid.get(uid) || 0) + Math.trunc(adjustment));
    effectiveCountByUid.set(uid, next);
  });

  return effectiveCountByUid;
}

// ---------------------------------------------------------------------------
// Extracted from event-manage-noshow.js:164-227
// Adapted: inject dependencies
// ---------------------------------------------------------------------------
function _getNoShowDetailsByUid({ uid, registrations, attendanceRecords, adminUsers, getEvent, today }) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return [];

  const checkinKeys = new Set();
  const seenRegKeys = new Set();
  const details = [];

  const nameToUid = new Map();
  (adminUsers || []).forEach(u => {
    const resolvedId = String(u?.uid || u?.lineUserId || '').trim();
    if (!resolvedId) return;
    [u?.displayName, u?.name].forEach(n => {
      const name = String(n || '').trim();
      if (name && name !== resolvedId) nameToUid.set(name, resolvedId);
    });
  });

  (attendanceRecords || []).forEach(record => {
    const rUid = String(record?.uid || '').trim();
    const eventId = String(record?.eventId || '').trim();
    const type = String(record?.type || '').trim();
    const status = String(record?.status || '').trim();
    if (!rUid || !eventId) return;
    if (status === 'removed' || status === 'cancelled') return;
    if (type === 'checkin') {
      checkinKeys.add(`${rUid}::${eventId}`);
      const realUid = nameToUid.get(rUid);
      if (realUid) checkinKeys.add(`${realUid}::${eventId}`);
    }
  });

  (registrations || []).forEach(reg => {
    const regUid = String(reg?.userId || '').trim();
    const eventId = String(reg?.eventId || '').trim();
    const status = String(reg?.status || '').trim();
    if (regUid !== safeUid || !eventId) return;
    if (status !== 'confirmed') return;
    if (reg.participantType === 'companion') return;

    const key = `${regUid}::${eventId}`;
    if (seenRegKeys.has(key)) return;
    seenRegKeys.add(key);

    const event = getEvent(eventId);
    if (!event || event.status !== 'ended') return;
    const eventDate = String(event.date || '').split(' ')[0].replace(/\//g, '-');
    if (!eventDate || eventDate >= today) return;
    if (checkinKeys.has(key)) return;

    details.push({
      eventId,
      eventName: event.title || event.name || eventId,
      eventDate: eventDate.replace(/-/g, '/'),
    });
  });

  details.sort((a, b) => (b.eventDate > a.eventDate ? 1 : b.eventDate < a.eventDate ? -1 : 0));
  return details;
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

// Test fixture helpers
function mkEvent(id, status = 'ended', date = '2026/03/01') {
  return { id, status, date, title: `Event ${id}` };
}
function mkReg(userId, eventId, status = 'confirmed', extras = {}) {
  return { userId, eventId, status, ...extras };
}
function mkAtt(uid, eventId, type, extras = {}) {
  return { uid, eventId, type, ...extras };
}
function mkUser(uid, displayName, name) {
  return { uid, displayName, name: name || displayName };
}

const TODAY = '2026-03-15'; // fixed today for deterministic tests

describe('_buildRawNoShowCountByUid — basic counting', () => {
  test('returns empty map when no registrations', () => {
    const result = _buildRawNoShowCountByUid({
      registrations: [],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: () => null,
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });

  test('counts confirmed registration with no checkin as no-show', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(1);
  });

  test('does not count if user has checkin', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [mkAtt('u1', 'e1', 'checkin')],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.has('u1')).toBe(false);
  });

  test('does not count waitlisted registrations', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1', 'waitlisted')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });

  test('does not count companions', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1', 'confirmed', { participantType: 'companion' })],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });

  test('does not count non-ended events', () => {
    const events = { e1: mkEvent('e1', 'open', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });

  test('does not count events happening today (grace period)', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/15') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });

  test('counts multiple no-shows per user', () => {
    const events = {
      e1: mkEvent('e1', 'ended', '2026/03/01'),
      e2: mkEvent('e2', 'ended', '2026/03/05'),
    };
    const result = _buildRawNoShowCountByUid({
      registrations: [
        mkReg('u1', 'e1'),
        mkReg('u1', 'e2'),
      ],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(2);
  });

  test('deduplicates same user+event registration', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [
        mkReg('u1', 'e1'),
        mkReg('u1', 'e1'), // duplicate
      ],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(1);
  });
});

describe('_buildRawNoShowCountByUid — nameToUid historical fix', () => {
  test('matches checkin by displayName when uid stored as displayName', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    // Historical bug: attendance record has uid='小白' instead of real uid
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('U123', 'e1')],
      attendanceRecords: [mkAtt('小白', 'e1', 'checkin')],
      adminUsers: [mkUser('U123', '小白')],
      getEvent: id => events[id],
      today: TODAY,
    });
    // Should NOT count as no-show because checkin exists via nameToUid mapping
    expect(result.has('U123')).toBe(false);
  });

  test('ignores removed/cancelled attendance records', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [mkAtt('u1', 'e1', 'checkin', { status: 'removed' })],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(1); // removed checkin doesn't count
  });

  test('nameToUid does not map uid to itself', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    // Edge case: user displayName equals uid
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('U123', 'e1')],
      attendanceRecords: [],
      adminUsers: [mkUser('U123', 'U123')], // name same as uid
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('U123')).toBe(1);
  });
});

describe('_buildRawNoShowCountByUid — date format handling', () => {
  test('handles date with time component', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01 14:00') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(1);
  });

  test('handles YYYY-MM-DD format', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026-03-01') };
    const result = _buildRawNoShowCountByUid({
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.get('u1')).toBe(1);
  });
});

describe('_buildNoShowCountByUid — corrections', () => {
  test('applies negative adjustment', () => {
    const raw = new Map([['u1', 3]]);
    const corrections = [{ uid: 'u1', noShow: { adjustment: -1 } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(2);
  });

  test('applies positive adjustment', () => {
    const raw = new Map([['u1', 1]]);
    const corrections = [{ uid: 'u1', noShow: { adjustment: 2 } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(3);
  });

  test('clamps to minimum 0', () => {
    const raw = new Map([['u1', 1]]);
    const corrections = [{ uid: 'u1', noShow: { adjustment: -5 } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(0);
  });

  test('adds correction for user not in raw count', () => {
    const raw = new Map();
    const corrections = [{ uid: 'u1', noShow: { adjustment: 2 } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(2);
  });

  test('ignores non-finite adjustments', () => {
    const raw = new Map([['u1', 3]]);
    const corrections = [{ uid: 'u1', noShow: { adjustment: NaN } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(3);
  });

  test('uses _docId as fallback uid', () => {
    const raw = new Map([['u1', 2]]);
    const corrections = [{ _docId: 'u1', noShow: { adjustment: -1 } }];
    const result = _buildNoShowCountByUid(raw, corrections);
    expect(result.get('u1')).toBe(1);
  });

  test('does not modify original map', () => {
    const raw = new Map([['u1', 3]]);
    const corrections = [{ uid: 'u1', noShow: { adjustment: -1 } }];
    _buildNoShowCountByUid(raw, corrections);
    expect(raw.get('u1')).toBe(3); // original unchanged
  });
});

describe('_getNoShowDetailsByUid', () => {
  test('returns empty array for empty uid', () => {
    expect(_getNoShowDetailsByUid({
      uid: '',
      registrations: [],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: () => null,
      today: TODAY,
    })).toEqual([]);
  });

  test('returns details for no-show events', () => {
    const events = {
      e1: mkEvent('e1', 'ended', '2026/03/01'),
      e2: mkEvent('e2', 'ended', '2026/03/05'),
    };
    const result = _getNoShowDetailsByUid({
      uid: 'u1',
      registrations: [
        mkReg('u1', 'e1'),
        mkReg('u1', 'e2'),
      ],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe('e2'); // sorted desc by date
    expect(result[1].eventId).toBe('e1');
  });

  test('excludes events where user checked in', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _getNoShowDetailsByUid({
      uid: 'u1',
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [mkAtt('u1', 'e1', 'checkin')],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result).toHaveLength(0);
  });

  test('only returns details for the specified uid', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _getNoShowDetailsByUid({
      uid: 'u1',
      registrations: [
        mkReg('u1', 'e1'),
        mkReg('u2', 'e1'),
      ],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result).toHaveLength(1);
  });

  test('uses nameToUid mapping for historical checkin records', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _getNoShowDetailsByUid({
      uid: 'U123',
      registrations: [mkReg('U123', 'e1')],
      attendanceRecords: [mkAtt('小白', 'e1', 'checkin')],
      adminUsers: [mkUser('U123', '小白')],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result).toHaveLength(0); // checkin matched via nameToUid
  });

  test('formats eventDate correctly', () => {
    const events = { e1: mkEvent('e1', 'ended', '2026/03/01') };
    const result = _getNoShowDetailsByUid({
      uid: 'u1',
      registrations: [mkReg('u1', 'e1')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result[0].eventDate).toBe('2026/03/01');
  });

  test('sorts by eventDate descending', () => {
    const events = {
      e1: mkEvent('e1', 'ended', '2026/01/10'),
      e2: mkEvent('e2', 'ended', '2026/03/01'),
      e3: mkEvent('e3', 'ended', '2026/02/15'),
    };
    const result = _getNoShowDetailsByUid({
      uid: 'u1',
      registrations: [mkReg('u1', 'e1'), mkReg('u1', 'e2'), mkReg('u1', 'e3')],
      attendanceRecords: [],
      adminUsers: [],
      getEvent: id => events[id],
      today: TODAY,
    });
    expect(result.map(d => d.eventId)).toEqual(['e2', 'e3', 'e1']);
  });
});
