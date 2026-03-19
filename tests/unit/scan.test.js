/**
 * Scan module unit tests — extracted pure functions.
 *
 * Sources:
 *   js/modules/scan/scan-process.js
 *   js/modules/scan/scan-ui.js
 *   js/modules/scan/scan-family.js
 *
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 */

// ===========================================================================
// Extracted from js/modules/scan/scan-process.js:15-26
// Pure function: finds user by UID from user lists
// Adapted: accepts adminUsers + currentUser as explicit deps
// ===========================================================================
function _findUserByUid(uid, { adminUsers, currentUser }) {
  const found = adminUsers.find(u => u.uid === uid);
  if (found) return found;
  if (currentUser && (currentUser.uid === uid || currentUser.lineUserId === uid)) {
    return { name: currentUser.displayName || currentUser.name, uid: currentUser.uid };
  }
  return null;
}

// ===========================================================================
// Extracted from js/modules/scan/scan-process.js:219-220
// Pure function: maps result class to icon
// ===========================================================================
function _getScanResultIcon(cls) {
  const icons = { success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C' };
  return icons[cls] || '';
}

// ===========================================================================
// Extracted from js/modules/scan/scan-process.js:81-205
// Pure function: determines attendance processing outcome
// Adapted: accepts all inputs explicitly, returns { resultClass, resultMsg, recordsToAdd }
// No side effects (no DOM, no API calls)
// ===========================================================================
function _determineAttendanceOutcome({ isRegistered, mode, userCheckin, userCheckout, hasUnregRecord, userName }) {
  const recordsToAdd = [];
  let resultClass = '';
  let resultMsg = '';

  if (!isRegistered) {
    if (!hasUnregRecord) {
      recordsToAdd.push({ type: 'unreg' });
    }
    if (mode === 'checkin') {
      if (userCheckin) {
        resultClass = 'warning';
        resultMsg = `${userName} \u672A\u5831\u540D\uFF0C\u5DF2\u5B8C\u6210\u7C3D\u5230`;
      } else {
        recordsToAdd.push({ type: 'checkin' });
        resultClass = 'warning';
        resultMsg = `${userName} \u672A\u5831\u540D\uFF0C\u7C3D\u5230\u6210\u529F`;
      }
    } else {
      if (userCheckout) {
        resultClass = 'warning';
        resultMsg = `${userName} \u672A\u5831\u540D\uFF0C\u5DF2\u5B8C\u6210\u7C3D\u9000`;
      } else if (!userCheckin) {
        recordsToAdd.push({ type: 'checkin' });
        recordsToAdd.push({ type: 'checkout' });
        resultClass = 'warning';
        resultMsg = `${userName} \u672A\u5831\u540D\uFF0C\u5DF2\u81EA\u52D5\u5B8C\u6210\u7C3D\u5230\u8207\u7C3D\u9000`;
      } else {
        recordsToAdd.push({ type: 'checkout' });
        resultClass = 'warning';
        resultMsg = `${userName} \u672A\u5831\u540D\uFF0C\u7C3D\u9000\u6210\u529F`;
      }
    }
  } else if (mode === 'checkin') {
    if (userCheckin) {
      resultClass = 'warning';
      resultMsg = `${userName} \u5DF2\u5B8C\u6210\u7C3D\u5230`;
    } else {
      recordsToAdd.push({ type: 'checkin' });
      resultClass = 'success';
      resultMsg = `${userName} \u7C3D\u5230\u6210\u529F`;
    }
  } else {
    // checkout
    if (userCheckout) {
      resultClass = 'warning';
      resultMsg = `${userName} \u5DF2\u5B8C\u6210\u7C3D\u9000`;
    } else if (!userCheckin) {
      recordsToAdd.push({ type: 'checkin' });
      recordsToAdd.push({ type: 'checkout' });
      resultClass = 'success';
      resultMsg = `${userName} \u672A\u7C3D\u5230\uFF0C\u5DF2\u81EA\u52D5\u5B8C\u6210\u7C3D\u5230\u8207\u7C3D\u9000`;
    } else {
      recordsToAdd.push({ type: 'checkout' });
      resultClass = 'success';
      resultMsg = `${userName} \u7C3D\u9000\u6210\u529F`;
    }
  }

  return { resultClass, resultMsg, recordsToAdd };
}

// ===========================================================================
// Extracted from js/modules/scan/scan-ui.js:13-17
// Pure function: gets event type label prefix
// Adapted: accepts typeConfig map explicitly
// ===========================================================================
function _getScanEventTypeLabel(e, typeConfig) {
  if (!e || !e.type) return '';
  const cfg = typeConfig ? typeConfig[e.type] : null;
  return cfg ? `[${cfg.label}] ` : '';
}

// ===========================================================================
// Extracted from js/modules/scan/scan-ui.js:20-47
// Pure function: categorizes events into today/past/future buckets
// Adapted: accepts parseDate function + now date explicitly
// ===========================================================================
function _categorizeScanEvents(events, { now, parseDate }) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const buckets = { today: [], past: [], future: [] };
  events.forEach(e => {
    const parsed = parseDate ? parseDate(e.date) : null;
    if (!parsed) { buckets.past.push(e); return; }
    const eventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (eventDay >= todayStart && eventDay < tomorrowStart) {
      buckets.today.push(e);
    } else if (eventDay < todayStart) {
      buckets.past.push(e);
    } else {
      buckets.future.push(e);
    }
  });

  const cmpAsc = (a, b) => (a.date || '').localeCompare(b.date || '');
  const cmpDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
  buckets.today.sort(cmpAsc);
  buckets.past.sort(cmpDesc);
  buckets.future.sort(cmpAsc);

  return buckets;
}

// ===========================================================================
// Extracted from js/modules/scan/scan-ui.js:65-91
// Pure function: determines selected event after populating scan select
// Adapted: returns { selectedEventId } instead of DOM manipulation
// ===========================================================================
function _resolveScanSelection(list, previousSelectedId) {
  if (previousSelectedId && list.some(e => e.id === previousSelectedId)) {
    return { selectedEventId: previousSelectedId };
  }
  if (list.length === 1) {
    return { selectedEventId: list[0].id };
  }
  return { selectedEventId: null };
}

// ===========================================================================
// Extracted from js/modules/scan/scan-ui.js:156-170
// Pure function: classifies attendance records for scan result rendering
// Adapted: returns array of { cls, msg } objects instead of HTML
// ===========================================================================
function _classifyScanResults(records) {
  const sorted = [...records].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return sorted.map(r => {
    const name = r.companionName || r.userName || r.uid;
    if (r.type === 'checkin')  return { cls: 'success', msg: `${name} \u7C3D\u5230\u6210\u529F` };
    if (r.type === 'checkout') return { cls: 'success', msg: `${name} \u7C3D\u9000\u6210\u529F` };
    return { cls: 'error', msg: `${name} \u672A\u5831\u540D\u6B64\u6D3B\u52D5` };
  });
}

// ===========================================================================
// Extracted from js/modules/scan/scan-ui.js:200-280
// Pure function: builds attendance statistics from records + registrations
// Adapted: accepts data explicitly, returns stats object
// ===========================================================================
function _buildAttendanceStats(records, confirmedRegs, eventParticipants) {
  const confirmedCountByUid = new Map();
  confirmedRegs.forEach(r => {
    confirmedCountByUid.set(r.userId, (confirmedCountByUid.get(r.userId) || 0) + 1);
  });

  // Build per-person state
  const personMap = new Map();
  records.forEach(r => {
    const key = r.companionId ? `${r.uid}_${r.companionId}` : r.uid;
    if (!personMap.has(key)) {
      personMap.set(key, {
        name: r.companionId ? (r.companionName || r.userName) : r.userName,
        uid: r.uid, companionId: r.companionId || null,
        checkin: false, checkout: false, unreg: false,
      });
    }
    const p = personMap.get(key);
    if (r.type === 'checkin') p.checkin = true;
    if (r.type === 'checkout') p.checkout = true;
    if (r.type === 'unreg') p.unreg = true;
  });

  // Split: registered vs unregistered
  const regPersons = [];
  const unregPersons = [];
  personMap.forEach(p => {
    if (p.unreg) unregPersons.push(p);
    else regPersons.push(p);
  });

  // Group registered by primary uid, merge flags
  const regByUid = new Map();
  regPersons.forEach(p => {
    if (!regByUid.has(p.uid)) {
      regByUid.set(p.uid, { ...p });
    } else {
      const ex = regByUid.get(p.uid);
      if (p.checkin) ex.checkin = true;
      if (p.checkout) ex.checkout = true;
    }
  });

  // Stats (only registered persons)
  const regCheckinCount = [...personMap.values()].filter(p => p.checkin && !p.unreg).length;
  const regCheckoutCount = [...personMap.values()].filter(p => p.checkout && !p.unreg).length;
  const totalConfirmed = confirmedRegs.length > 0 ? confirmedRegs.length : (eventParticipants || []).length;
  const completionRate = totalConfirmed > 0 ? Math.round(regCheckinCount / totalConfirmed * 100) : 0;

  return {
    personMap,
    regPersons,
    unregPersons,
    regByUid,
    regCheckinCount,
    regCheckoutCount,
    unregCount: unregPersons.length,
    totalConfirmed,
    completionRate,
    confirmedCountByUid,
  };
}

// ===========================================================================
// Extracted from js/modules/scan/scan-family.js:30-42
// Pure function: determines family checkin status for each registration
// Adapted: accepts records explicitly, returns array of status objects
// ===========================================================================
function _getFamilyCheckinStatus(regs, records, uid, mode) {
  return regs.map(r => {
    const cId = r.companionId || null;
    const displayName = r.companionName || r.userName;
    const hasCheckin = records.some(a => a.uid === uid && a.type === 'checkin' && (a.companionId || null) === cId);
    const hasCheckout = records.some(a => a.uid === uid && a.type === 'checkout' && (a.companionId || null) === cId);
    const disabled = (mode === 'checkin' && hasCheckin) || (mode === 'checkout' && hasCheckout);
    return { displayName, companionId: cId, hasCheckin, hasCheckout, disabled };
  });
}

// ===========================================================================
// Extracted from js/modules/scan/scan-family.js:83-84
// Pure function: checks if a record already exists for uid + companionId + type
// ===========================================================================
function _hasDuplicateRecord(records, uid, companionId, type) {
  return records.some(r => r.uid === uid && r.type === type && (r.companionId || null) === (companionId || null));
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_findUserByUid (scan-process.js:15-26)', () => {
  const alice = { uid: 'U1', name: 'Alice' };
  const bob = { uid: 'U2', name: 'Bob' };

  test('finds user in adminUsers', () => {
    const result = _findUserByUid('U1', { adminUsers: [alice, bob], currentUser: null });
    expect(result.name).toBe('Alice');
  });

  test('falls back to currentUser by uid', () => {
    const cur = { uid: 'U3', displayName: 'Charlie' };
    const result = _findUserByUid('U3', { adminUsers: [alice], currentUser: cur });
    expect(result.name).toBe('Charlie');
  });

  test('falls back to currentUser by lineUserId', () => {
    const cur = { uid: 'U3', lineUserId: 'LINE1', name: 'Dave' };
    const result = _findUserByUid('LINE1', { adminUsers: [], currentUser: cur });
    expect(result.name).toBe('Dave');
  });

  test('returns null if not found', () => {
    const result = _findUserByUid('U99', { adminUsers: [alice], currentUser: null });
    expect(result).toBeNull();
  });

  test('prefers adminUsers over currentUser', () => {
    const cur = { uid: 'U1', displayName: 'CurAlice' };
    const result = _findUserByUid('U1', { adminUsers: [alice], currentUser: cur });
    expect(result.name).toBe('Alice');
  });
});

describe('_getScanResultIcon (scan-process.js:219-220)', () => {
  test('success \u2192 \u2705', () => {
    expect(_getScanResultIcon('success')).toBe('\u2705');
  });

  test('warning \u2192 \u26A0\uFE0F', () => {
    expect(_getScanResultIcon('warning')).toBe('\u26A0\uFE0F');
  });

  test('error \u2192 \u274C', () => {
    expect(_getScanResultIcon('error')).toBe('\u274C');
  });

  test('unknown \u2192 empty string', () => {
    expect(_getScanResultIcon('other')).toBe('');
  });
});

describe('_determineAttendanceOutcome (scan-process.js:81-205)', () => {
  const base = { userName: 'Alice' };

  // --- Registered + Checkin ---
  test('registered + checkin + no prior \u2192 success', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: true, mode: 'checkin',
      userCheckin: null, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('success');
    expect(r.resultMsg).toContain('\u7C3D\u5230\u6210\u529F');
    expect(r.recordsToAdd).toEqual([{ type: 'checkin' }]);
  });

  test('registered + checkin + already checked in \u2192 warning', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: true, mode: 'checkin',
      userCheckin: { type: 'checkin' }, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u5DF2\u5B8C\u6210\u7C3D\u5230');
    expect(r.recordsToAdd).toEqual([]);
  });

  // --- Registered + Checkout ---
  test('registered + checkout + has checkin \u2192 success', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: true, mode: 'checkout',
      userCheckin: { type: 'checkin' }, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('success');
    expect(r.resultMsg).toContain('\u7C3D\u9000\u6210\u529F');
    expect(r.recordsToAdd).toEqual([{ type: 'checkout' }]);
  });

  test('registered + checkout + already checked out \u2192 warning', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: true, mode: 'checkout',
      userCheckin: { type: 'checkin' }, userCheckout: { type: 'checkout' }, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u5DF2\u5B8C\u6210\u7C3D\u9000');
    expect(r.recordsToAdd).toEqual([]);
  });

  test('registered + checkout + no checkin \u2192 auto checkin+checkout', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: true, mode: 'checkout',
      userCheckin: null, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('success');
    expect(r.resultMsg).toContain('\u81EA\u52D5\u5B8C\u6210\u7C3D\u5230\u8207\u7C3D\u9000');
    expect(r.recordsToAdd).toEqual([{ type: 'checkin' }, { type: 'checkout' }]);
  });

  // --- Not registered + Checkin ---
  test('not registered + checkin + no prior \u2192 warning + unreg + checkin', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: false, mode: 'checkin',
      userCheckin: null, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u672A\u5831\u540D');
    expect(r.resultMsg).toContain('\u7C3D\u5230\u6210\u529F');
    expect(r.recordsToAdd).toEqual([{ type: 'unreg' }, { type: 'checkin' }]);
  });

  test('not registered + checkin + already checked in \u2192 warning, no new records', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: false, mode: 'checkin',
      userCheckin: { type: 'checkin' }, userCheckout: null, hasUnregRecord: true,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u5DF2\u5B8C\u6210\u7C3D\u5230');
    expect(r.recordsToAdd).toEqual([]);
  });

  // --- Not registered + Checkout ---
  test('not registered + checkout + no checkin \u2192 warning + unreg + checkin + checkout', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: false, mode: 'checkout',
      userCheckin: null, userCheckout: null, hasUnregRecord: false,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u81EA\u52D5\u5B8C\u6210\u7C3D\u5230\u8207\u7C3D\u9000');
    expect(r.recordsToAdd).toEqual([{ type: 'unreg' }, { type: 'checkin' }, { type: 'checkout' }]);
  });

  test('not registered + checkout + has checkin \u2192 warning + checkout', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: false, mode: 'checkout',
      userCheckin: { type: 'checkin' }, userCheckout: null, hasUnregRecord: true,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u7C3D\u9000\u6210\u529F');
    expect(r.recordsToAdd).toEqual([{ type: 'checkout' }]);
  });

  test('not registered + checkout + already checked out \u2192 warning', () => {
    const r = _determineAttendanceOutcome({
      ...base, isRegistered: false, mode: 'checkout',
      userCheckin: { type: 'checkin' }, userCheckout: { type: 'checkout' }, hasUnregRecord: true,
    });
    expect(r.resultClass).toBe('warning');
    expect(r.resultMsg).toContain('\u5DF2\u5B8C\u6210\u7C3D\u9000');
    expect(r.recordsToAdd).toEqual([]);
  });
});

describe('_getScanEventTypeLabel (scan-ui.js:13-17)', () => {
  const cfg = { play: { label: 'PLAY' }, friendly: { label: '\u53CB\u8ABC' } };

  test('known type \u2192 [label] prefix', () => {
    expect(_getScanEventTypeLabel({ type: 'play' }, cfg)).toBe('[PLAY] ');
  });

  test('unknown type \u2192 empty', () => {
    expect(_getScanEventTypeLabel({ type: 'unknown' }, cfg)).toBe('');
  });

  test('null event \u2192 empty', () => {
    expect(_getScanEventTypeLabel(null, cfg)).toBe('');
  });

  test('event without type \u2192 empty', () => {
    expect(_getScanEventTypeLabel({}, cfg)).toBe('');
  });
});

describe('_categorizeScanEvents (scan-ui.js:20-47)', () => {
  const now = new Date(2026, 2, 17, 12, 0, 0); // 2026-03-17 12:00
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr.replace(/\//g, '-'));
    return isNaN(d.getTime()) ? null : d;
  };

  test('categorizes today/past/future correctly', () => {
    const events = [
      { id: '1', date: '2026-03-17' },
      { id: '2', date: '2026-03-16' },
      { id: '3', date: '2026-03-18' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.today.map(e => e.id)).toEqual(['1']);
    expect(buckets.past.map(e => e.id)).toEqual(['2']);
    expect(buckets.future.map(e => e.id)).toEqual(['3']);
  });

  test('past events sorted descending', () => {
    const events = [
      { id: '1', date: '2026-03-14' },
      { id: '2', date: '2026-03-15' },
      { id: '3', date: '2026-03-13' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.past.map(e => e.id)).toEqual(['2', '1', '3']);
  });

  test('future events sorted ascending', () => {
    const events = [
      { id: '1', date: '2026-03-20' },
      { id: '2', date: '2026-03-18' },
      { id: '3', date: '2026-03-19' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.future.map(e => e.id)).toEqual(['2', '3', '1']);
  });

  test('invalid date \u2192 goes to past bucket', () => {
    const events = [{ id: '1', date: 'invalid' }];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.past).toHaveLength(1);
  });

  test('null date \u2192 goes to past bucket', () => {
    const events = [{ id: '1', date: null }];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.past).toHaveLength(1);
  });

  test('empty events \u2192 all empty buckets', () => {
    const buckets = _categorizeScanEvents([], { now, parseDate });
    expect(buckets.today).toEqual([]);
    expect(buckets.past).toEqual([]);
    expect(buckets.future).toEqual([]);
  });
});

describe('_resolveScanSelection (scan-ui.js:65-91)', () => {
  test('restores previous selection if in list', () => {
    const list = [{ id: 'e1' }, { id: 'e2' }];
    expect(_resolveScanSelection(list, 'e2').selectedEventId).toBe('e2');
  });

  test('auto-selects if only 1 event', () => {
    const list = [{ id: 'e1' }];
    expect(_resolveScanSelection(list, null).selectedEventId).toBe('e1');
  });

  test('returns null if multiple events and no previous', () => {
    const list = [{ id: 'e1' }, { id: 'e2' }];
    expect(_resolveScanSelection(list, null).selectedEventId).toBeNull();
  });

  test('returns null if previous not in list', () => {
    const list = [{ id: 'e1' }, { id: 'e2' }];
    expect(_resolveScanSelection(list, 'e99').selectedEventId).toBeNull();
  });

  test('returns null for empty list', () => {
    expect(_resolveScanSelection([], 'e1').selectedEventId).toBeNull();
  });
});

describe('_classifyScanResults (scan-ui.js:156-170)', () => {
  test('checkin \u2192 success', () => {
    const results = _classifyScanResults([{ type: 'checkin', userName: 'A', time: '10:00' }]);
    expect(results[0].cls).toBe('success');
    expect(results[0].msg).toContain('\u7C3D\u5230');
  });

  test('checkout \u2192 success', () => {
    const results = _classifyScanResults([{ type: 'checkout', userName: 'B', time: '11:00' }]);
    expect(results[0].cls).toBe('success');
    expect(results[0].msg).toContain('\u7C3D\u9000');
  });

  test('unreg \u2192 error', () => {
    const results = _classifyScanResults([{ type: 'unreg', userName: 'C', time: '12:00' }]);
    expect(results[0].cls).toBe('error');
    expect(results[0].msg).toContain('\u672A\u5831\u540D');
  });

  test('sorted descending by time', () => {
    const records = [
      { type: 'checkin', userName: 'A', time: '09:00' },
      { type: 'checkout', userName: 'B', time: '11:00' },
      { type: 'checkin', userName: 'C', time: '10:00' },
    ];
    const results = _classifyScanResults(records);
    expect(results[0].msg).toContain('B');
    expect(results[1].msg).toContain('C');
    expect(results[2].msg).toContain('A');
  });

  test('uses companionName if available', () => {
    const results = _classifyScanResults([{ type: 'checkin', companionName: 'Junior', userName: 'Dad', time: '10:00' }]);
    expect(results[0].msg).toContain('Junior');
  });

  test('falls back to uid if no name', () => {
    const results = _classifyScanResults([{ type: 'checkin', uid: 'U123', time: '10:00' }]);
    expect(results[0].msg).toContain('U123');
  });
});

describe('_buildAttendanceStats (scan-ui.js:200-280)', () => {
  test('basic checkin/checkout stats', () => {
    const records = [
      { uid: 'U1', type: 'checkin', userName: 'Alice' },
      { uid: 'U1', type: 'checkout', userName: 'Alice' },
      { uid: 'U2', type: 'checkin', userName: 'Bob' },
    ];
    const regs = [{ userId: 'U1', status: 'confirmed' }, { userId: 'U2', status: 'confirmed' }];
    const stats = _buildAttendanceStats(records, regs, []);
    expect(stats.regCheckinCount).toBe(2);
    expect(stats.regCheckoutCount).toBe(1);
    expect(stats.totalConfirmed).toBe(2);
    expect(stats.completionRate).toBe(100);
  });

  test('unregistered persons tracked separately', () => {
    const records = [
      { uid: 'U1', type: 'checkin', userName: 'Alice' },
      { uid: 'U1', type: 'unreg', userName: 'Alice' },
    ];
    const stats = _buildAttendanceStats(records, [], ['Bob']);
    expect(stats.unregCount).toBe(1);
    expect(stats.regCheckinCount).toBe(0); // unreg excluded
    expect(stats.totalConfirmed).toBe(1); // fallback to participants
  });

  test('companion grouped by uid_companionId key', () => {
    const records = [
      { uid: 'U1', type: 'checkin', userName: 'Dad', companionId: 'C1', companionName: 'Kid' },
      { uid: 'U1', type: 'checkin', userName: 'Dad' },
    ];
    const regs = [{ userId: 'U1', status: 'confirmed' }];
    const stats = _buildAttendanceStats(records, regs, []);
    expect(stats.personMap.size).toBe(2); // U1 + U1_C1
    expect(stats.regCheckinCount).toBe(2);
  });

  test('empty records \u2192 zero stats', () => {
    const stats = _buildAttendanceStats([], [], []);
    expect(stats.regCheckinCount).toBe(0);
    expect(stats.regCheckoutCount).toBe(0);
    expect(stats.unregCount).toBe(0);
    expect(stats.completionRate).toBe(0);
  });

  test('completion rate rounds correctly', () => {
    const records = [
      { uid: 'U1', type: 'checkin', userName: 'A' },
    ];
    const regs = [
      { userId: 'U1', status: 'confirmed' },
      { userId: 'U2', status: 'confirmed' },
      { userId: 'U3', status: 'confirmed' },
    ];
    const stats = _buildAttendanceStats(records, regs, []);
    expect(stats.completionRate).toBe(33); // 1/3 = 33.33 rounds to 33
  });

  test('regByUid merges companion flags into primary uid', () => {
    const records = [
      { uid: 'U1', type: 'checkin', userName: 'Dad' },
      { uid: 'U1', type: 'checkout', userName: 'Dad', companionId: 'C1', companionName: 'Kid' },
    ];
    const regs = [{ userId: 'U1', status: 'confirmed' }];
    const stats = _buildAttendanceStats(records, regs, []);
    const merged = stats.regByUid.get('U1');
    expect(merged.checkin).toBe(true);
    expect(merged.checkout).toBe(true);
  });

  test('confirmedCountByUid counts multiple registrations per uid', () => {
    const records = [{ uid: 'U1', type: 'checkin', userName: 'A' }];
    const regs = [
      { userId: 'U1', status: 'confirmed' },
      { userId: 'U1', status: 'confirmed' },
    ];
    const stats = _buildAttendanceStats(records, regs, []);
    expect(stats.confirmedCountByUid.get('U1')).toBe(2);
  });
});

describe('_getFamilyCheckinStatus (scan-family.js:30-42)', () => {
  test('self + companion status determined correctly', () => {
    const regs = [
      { userName: 'Dad', companionId: null },
      { userName: 'Dad', companionId: 'C1', companionName: 'Kid' },
    ];
    const records = [
      { uid: 'U1', type: 'checkin', companionId: null },
    ];
    const status = _getFamilyCheckinStatus(regs, records, 'U1', 'checkin');
    expect(status[0].hasCheckin).toBe(true);
    expect(status[0].disabled).toBe(true);  // already checked in
    expect(status[1].hasCheckin).toBe(false);
    expect(status[1].disabled).toBe(false);
  });

  test('checkout mode disables already checked-out members', () => {
    const regs = [{ userName: 'Dad', companionId: null }];
    const records = [
      { uid: 'U1', type: 'checkin', companionId: null },
      { uid: 'U1', type: 'checkout', companionId: null },
    ];
    const status = _getFamilyCheckinStatus(regs, records, 'U1', 'checkout');
    expect(status[0].hasCheckout).toBe(true);
    expect(status[0].disabled).toBe(true);
  });

  test('no records \u2192 all enabled', () => {
    const regs = [
      { userName: 'Dad', companionId: null },
      { userName: 'Dad', companionId: 'C1', companionName: 'Kid' },
    ];
    const status = _getFamilyCheckinStatus(regs, [], 'U1', 'checkin');
    expect(status[0].disabled).toBe(false);
    expect(status[1].disabled).toBe(false);
  });
});

describe('_hasDuplicateRecord (scan-family.js:83-84)', () => {
  const records = [
    { uid: 'U1', type: 'checkin', companionId: null },
    { uid: 'U1', type: 'checkin', companionId: 'C1' },
  ];

  test('finds matching self record', () => {
    expect(_hasDuplicateRecord(records, 'U1', null, 'checkin')).toBe(true);
  });

  test('finds matching companion record', () => {
    expect(_hasDuplicateRecord(records, 'U1', 'C1', 'checkin')).toBe(true);
  });

  test('no match for different type', () => {
    expect(_hasDuplicateRecord(records, 'U1', null, 'checkout')).toBe(false);
  });

  test('no match for different uid', () => {
    expect(_hasDuplicateRecord(records, 'U2', null, 'checkin')).toBe(false);
  });

  test('no match for different companionId', () => {
    expect(_hasDuplicateRecord(records, 'U1', 'C99', 'checkin')).toBe(false);
  });

  test('empty records \u2192 false', () => {
    expect(_hasDuplicateRecord([], 'U1', null, 'checkin')).toBe(false);
  });
});
