/**
 * Phase 2 Unit Tests — Event Utility Functions
 *
 * Functions are COPIED from source as standalone (no ES modules).
 * The project uses Object.assign(App, {...}) pattern.
 */

// ============================================================
// Constants copied from js/config.js (lines 526-574)
// ============================================================

const EVENT_SPORT_OPTIONS = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '籃球' },
  { key: 'baseball_softball', label: '棒壘球' },
  { key: 'volleyball', label: '排球' },
  { key: 'table_tennis', label: '桌球' },
  { key: 'tennis', label: '網球' },
  { key: 'badminton', label: '羽球' },
  { key: 'hiking', label: '登山' },
  { key: 'running', label: '慢跑' },
  { key: 'cycling', label: '單車' },
  { key: 'motorcycle', label: '重機' },
  { key: 'skateboard', label: '滑板' },
  { key: 'dance', label: '舞蹈' },
  { key: 'yoga', label: '瑜伽' },
  { key: 'martial_arts', label: '武術' },
  { key: 'restaurant', label: '餐廳(觀賽)' },
  { key: 'pickleball', label: '匹克球' },
  { key: 'dodgeball', label: '美式躲避球' },
];

const EVENT_SPORT_MAP = EVENT_SPORT_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, Object.create(null));

// ============================================================
// Standalone function: getSportKeySafe
// Source: js/config.js lines 571-574
// ============================================================
function getSportKeySafe(key) {
  const raw = String(key || '').trim();
  return EVENT_SPORT_MAP[raw] ? raw : '';
}

// ============================================================
// Group 1: Gender Restriction Logic
// Source: js/modules/event-list.js lines 158-229
// ============================================================

function _normalizeBinaryGender(value) {
  return value === '男' || value === '女' ? value : '';
}

function _getEventAllowedGender(e) {
  if (!e?.genderRestrictionEnabled) return '';
  return _normalizeBinaryGender(e.allowedGender);
}

function _hasEventGenderRestriction(e) {
  return !!_getEventAllowedGender(e);
}

function _getEventGenderRibbonText(e) {
  const allowedGender = _getEventAllowedGender(e);
  if (!allowedGender) return '';
  return allowedGender === '男' ? '男生限定' : '女生限定';
}

function _getEventGenderTimelineRibbonText(e) {
  const allowedGender = _getEventAllowedGender(e);
  if (!allowedGender) return '';
  return allowedGender === '男' ? '限男生' : '限女生';
}

function _getEventGenderDetailText(e) {
  const allowedGender = _getEventAllowedGender(e);
  if (!allowedGender) return '';
  return allowedGender === '男' ? '限男性報名' : '限女性報名';
}

function _canEventGenderParticipantSignup(e, gender) {
  const allowedGender = _getEventAllowedGender(e);
  if (!allowedGender) return true;
  return _normalizeBinaryGender(gender) === allowedGender;
}

function _getEventGenderRestrictionMessage(e, reason = '') {
  const detailText = _getEventGenderDetailText(e);
  if (!detailText) return '';
  if (reason === 'missing_gender') {
    return `${detailText}，請先到個人資料填寫性別`;
  }
  return `${detailText}，目前無法報名`;
}

function _getCompanionGenderRestrictionMessage(e, companionName = '') {
  const allowedGender = _getEventAllowedGender(e);
  if (!allowedGender) return '';
  const label = allowedGender === '男' ? '男性限制' : '女性限制';
  return companionName
    ? `${companionName} 不符合此活動的${label}`
    : `所選同行者不符合此活動的${label}`;
}

// ============================================================
// Group 2: Event Team Logic
// Source: js/modules/event-list.js lines 135-148
// ============================================================

function _getEventLimitedTeamIds(e) {
  if (!e) return [];
  const ids = [];
  const seen = new Set();
  const pushId = (id) => {
    const v = String(id || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(e.creatorTeamIds)) e.creatorTeamIds.forEach(pushId);
  pushId(e.creatorTeamId);
  return ids;
}

// ============================================================
// Group 3: Event People Summary
// Source: js/modules/event-list.js lines 264-312
// Adapted: eventInput is always treated as the event object directly
//          (removed ApiService.getEvent lookup for testability)
// ============================================================

function _buildEventPeopleSummaryByStatus(eventInput, registrations, status, fallbackNames = []) {
  const event = eventInput; // In production: typeof eventInput === 'string' ? ApiService.getEvent(eventInput) : eventInput
  if (!event) return { people: [], count: 0, hasSource: false };

  const targetRegs = (Array.isArray(registrations) ? registrations : [])
    .filter(r => r?.status === status);
  const people = [];
  const addedNames = new Set();

  if (targetRegs.length > 0) {
    const groups = new Map();
    targetRegs.forEach(reg => {
      const groupKey = String(reg.userId || reg.userName || reg.id || '').trim() || `anon-${groups.size}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(reg);
    });

    groups.forEach(regs => {
      const selfReg = regs.find(reg => reg.participantType === 'self');
      const companions = regs.filter(reg => reg.participantType === 'companion');
      const mainName = String(selfReg?.userName || regs[0]?.userName || '').trim();

      if (mainName && !addedNames.has(mainName)) {
        people.push({ name: mainName, isCompanion: false });
        addedNames.add(mainName);
      }

      companions.forEach(companionReg => {
        const companionName = String(companionReg.companionName || companionReg.userName || '').trim();
        if (!companionName || addedNames.has(companionName)) return;
        people.push({ name: companionName, isCompanion: true });
        addedNames.add(companionName);
      });
    });
  }

  (Array.isArray(fallbackNames) ? fallbackNames : []).forEach(name => {
    const safeName = String(name || '').trim();
    if (!safeName || addedNames.has(safeName)) return;
    people.push({ name: safeName, isCompanion: false });
    addedNames.add(safeName);
  });

  return {
    people,
    count: people.length,
    hasSource: targetRegs.length > 0,
  };
}

// ============================================================
// Group 4: Event Capacity Badge
// Source: js/modules/event-list.js lines 366-370
// Adapted: stats parameter is required (no default calling this._getEventParticipantStats)
// ============================================================

function _renderEventCapacityBadge(event, stats) {
  if (stats.showFullBadge) return '<span class="tl-almost-full-badge">已額滿</span>';
  if (stats.showAlmostFullBadge) return '<span class="tl-almost-full-badge">即將額滿</span>';
  return '';
}

// ============================================================
// Event Sport Tag
// Source: js/modules/event-list.js lines 396-399
// ============================================================

function _getEventSportTag(event) {
  const key = getSportKeySafe(event?.sportTag);
  return key || 'football';
}

// ============================================================
// Navigation functions
// Source: js/core/navigation.js lines 9-31
// Adapted: removed this._routeCloudTimeoutMs / this._routeStepTimeoutMs references,
//          using configurable defaults for testability
// ============================================================

function _getRouteStepTimeoutMs(pageId, step = 'page', config = {}) {
  if (step === 'cloud') return Number(config.routeCloudTimeoutMs || 15000);
  return Number(config.routeStepTimeoutMs || 15000);
}

function _getRouteFailureToast(pageId, step = 'page', err = null) {
  const isTimeout = err?.code === 'route-step-timeout';
  if (isTimeout) {
    if (pageId === 'page-activities') return '網路較慢，活動頁暫時無法開啟，請稍後再試';
    return '網路較慢，頁面暫時無法開啟，請稍後再試';
  }
  if (step === 'cloud') return '雲端連線失敗，請稍後再試';
  return '頁面載入失敗，請稍後再試';
}

// ============================================================
// Firebase CRUD: Event Occupancy State
// Source: js/firebase-crud.js lines 481-517
// ============================================================

function _getEventOccupancyState(eventData = {}) {
  const fallbackCurrent = Math.max(0, Number(eventData.current || 0) || 0);
  const fallbackWaitlist = Math.max(0, Number(eventData.waitlist || 0) || 0);
  const hasParticipantArray = Array.isArray(eventData.participants);
  const hasWaitlistArray = Array.isArray(eventData.waitlistNames);
  const participantSet = new Set();
  const waitlistSet = new Set();
  const participants = [];
  const waitlistNames = [];

  if (hasParticipantArray) {
    eventData.participants.forEach(name => {
      const safeName = String(name || '').trim();
      if (!safeName || participantSet.has(safeName)) return;
      participantSet.add(safeName);
      participants.push(safeName);
    });
  }

  if (hasWaitlistArray) {
    eventData.waitlistNames.forEach(name => {
      const safeName = String(name || '').trim();
      if (!safeName || participantSet.has(safeName) || waitlistSet.has(safeName)) return;
      waitlistSet.add(safeName);
      waitlistNames.push(safeName);
    });
  }

  return {
    hasParticipantArray,
    hasWaitlistArray,
    participants,
    waitlistNames,
    current: hasParticipantArray ? participants.length : fallbackCurrent,
    waitlist: hasWaitlistArray ? waitlistNames.length : fallbackWaitlist,
  };
}

// ============================================================
// TESTS
// ============================================================

// ---- Group 1: Gender Restriction Logic ----

describe('_normalizeBinaryGender', () => {
  test('returns "男" for "男"', () => {
    expect(_normalizeBinaryGender('男')).toBe('男');
  });
  test('returns "女" for "女"', () => {
    expect(_normalizeBinaryGender('女')).toBe('女');
  });
  test('returns empty string for "male"', () => {
    expect(_normalizeBinaryGender('male')).toBe('');
  });
  test('returns empty string for "female"', () => {
    expect(_normalizeBinaryGender('female')).toBe('');
  });
  test('returns empty string for "other"', () => {
    expect(_normalizeBinaryGender('other')).toBe('');
  });
  test('returns empty string for empty string', () => {
    expect(_normalizeBinaryGender('')).toBe('');
  });
  test('returns empty string for null', () => {
    expect(_normalizeBinaryGender(null)).toBe('');
  });
  test('returns empty string for undefined', () => {
    expect(_normalizeBinaryGender(undefined)).toBe('');
  });
  test('returns empty string for number', () => {
    expect(_normalizeBinaryGender(0)).toBe('');
  });
});

describe('_getEventAllowedGender', () => {
  test('returns empty string when event is null', () => {
    expect(_getEventAllowedGender(null)).toBe('');
  });
  test('returns empty string when event is undefined', () => {
    expect(_getEventAllowedGender(undefined)).toBe('');
  });
  test('returns empty string when genderRestrictionEnabled is false', () => {
    expect(_getEventAllowedGender({ genderRestrictionEnabled: false, allowedGender: '男' })).toBe('');
  });
  test('returns empty string when genderRestrictionEnabled is missing', () => {
    expect(_getEventAllowedGender({ allowedGender: '男' })).toBe('');
  });
  test('returns "男" when enabled and allowedGender is "男"', () => {
    expect(_getEventAllowedGender({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe('男');
  });
  test('returns "女" when enabled and allowedGender is "女"', () => {
    expect(_getEventAllowedGender({ genderRestrictionEnabled: true, allowedGender: '女' })).toBe('女');
  });
  test('returns empty string when enabled but allowedGender is invalid', () => {
    expect(_getEventAllowedGender({ genderRestrictionEnabled: true, allowedGender: 'other' })).toBe('');
  });
  test('returns empty string when enabled but allowedGender is missing', () => {
    expect(_getEventAllowedGender({ genderRestrictionEnabled: true })).toBe('');
  });
});

describe('_hasEventGenderRestriction', () => {
  test('returns false for unrestricted event', () => {
    expect(_hasEventGenderRestriction({})).toBe(false);
  });
  test('returns false for null event', () => {
    expect(_hasEventGenderRestriction(null)).toBe(false);
  });
  test('returns true for male-restricted event', () => {
    expect(_hasEventGenderRestriction({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe(true);
  });
  test('returns true for female-restricted event', () => {
    expect(_hasEventGenderRestriction({ genderRestrictionEnabled: true, allowedGender: '女' })).toBe(true);
  });
  test('returns false when enabled but invalid gender', () => {
    expect(_hasEventGenderRestriction({ genderRestrictionEnabled: true, allowedGender: 'x' })).toBe(false);
  });
});

describe('_getEventGenderRibbonText', () => {
  test('returns empty string for unrestricted event', () => {
    expect(_getEventGenderRibbonText({})).toBe('');
  });
  test('returns "男生限定" for male-only event', () => {
    expect(_getEventGenderRibbonText({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe('男生限定');
  });
  test('returns "女生限定" for female-only event', () => {
    expect(_getEventGenderRibbonText({ genderRestrictionEnabled: true, allowedGender: '女' })).toBe('女生限定');
  });
  test('returns empty string for null event', () => {
    expect(_getEventGenderRibbonText(null)).toBe('');
  });
});

describe('_getEventGenderTimelineRibbonText', () => {
  test('returns empty string for unrestricted event', () => {
    expect(_getEventGenderTimelineRibbonText({})).toBe('');
  });
  test('returns "限男生" for male-only event', () => {
    expect(_getEventGenderTimelineRibbonText({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe('限男生');
  });
  test('returns "限女生" for female-only event', () => {
    expect(_getEventGenderTimelineRibbonText({ genderRestrictionEnabled: true, allowedGender: '女' })).toBe('限女生');
  });
});

describe('_getEventGenderDetailText', () => {
  test('returns empty string for unrestricted event', () => {
    expect(_getEventGenderDetailText({})).toBe('');
  });
  test('returns "限男性報名" for male-only event', () => {
    expect(_getEventGenderDetailText({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe('限男性報名');
  });
  test('returns "限女性報名" for female-only event', () => {
    expect(_getEventGenderDetailText({ genderRestrictionEnabled: true, allowedGender: '女' })).toBe('限女性報名');
  });
});

describe('_canEventGenderParticipantSignup', () => {
  const maleEvent = { genderRestrictionEnabled: true, allowedGender: '男' };
  const femaleEvent = { genderRestrictionEnabled: true, allowedGender: '女' };
  const openEvent = {};

  test('allows any gender for unrestricted event', () => {
    expect(_canEventGenderParticipantSignup(openEvent, '男')).toBe(true);
    expect(_canEventGenderParticipantSignup(openEvent, '女')).toBe(true);
    expect(_canEventGenderParticipantSignup(openEvent, '')).toBe(true);
    expect(_canEventGenderParticipantSignup(openEvent, null)).toBe(true);
  });
  test('allows male for male-only event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, '男')).toBe(true);
  });
  test('rejects female for male-only event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, '女')).toBe(false);
  });
  test('rejects empty gender for male-only event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, '')).toBe(false);
  });
  test('rejects null gender for male-only event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, null)).toBe(false);
  });
  test('rejects unrecognized gender string for male-only event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, 'male')).toBe(false);
  });
  test('allows female for female-only event', () => {
    expect(_canEventGenderParticipantSignup(femaleEvent, '女')).toBe(true);
  });
  test('rejects male for female-only event', () => {
    expect(_canEventGenderParticipantSignup(femaleEvent, '男')).toBe(false);
  });
  test('rejects undefined gender for restricted event', () => {
    expect(_canEventGenderParticipantSignup(maleEvent, undefined)).toBe(false);
  });
});

describe('_getEventGenderRestrictionMessage', () => {
  const maleEvent = { genderRestrictionEnabled: true, allowedGender: '男' };
  const femaleEvent = { genderRestrictionEnabled: true, allowedGender: '女' };
  const openEvent = {};

  test('returns empty string for unrestricted event', () => {
    expect(_getEventGenderRestrictionMessage(openEvent)).toBe('');
  });
  test('returns missing_gender message for male event', () => {
    expect(_getEventGenderRestrictionMessage(maleEvent, 'missing_gender'))
      .toBe('限男性報名，請先到個人資料填寫性別');
  });
  test('returns default restriction message for male event', () => {
    expect(_getEventGenderRestrictionMessage(maleEvent))
      .toBe('限男性報名，目前無法報名');
  });
  test('returns missing_gender message for female event', () => {
    expect(_getEventGenderRestrictionMessage(femaleEvent, 'missing_gender'))
      .toBe('限女性報名，請先到個人資料填寫性別');
  });
  test('returns default restriction message for female event', () => {
    expect(_getEventGenderRestrictionMessage(femaleEvent))
      .toBe('限女性報名，目前無法報名');
  });
  test('returns default message for unknown reason', () => {
    expect(_getEventGenderRestrictionMessage(maleEvent, 'gender_mismatch'))
      .toBe('限男性報名，目前無法報名');
  });
  test('returns empty string for null event', () => {
    expect(_getEventGenderRestrictionMessage(null)).toBe('');
  });
});

describe('_getCompanionGenderRestrictionMessage', () => {
  const maleEvent = { genderRestrictionEnabled: true, allowedGender: '男' };
  const femaleEvent = { genderRestrictionEnabled: true, allowedGender: '女' };
  const openEvent = {};

  test('returns empty string for unrestricted event', () => {
    expect(_getCompanionGenderRestrictionMessage(openEvent, '小明')).toBe('');
  });
  test('returns named message for male event', () => {
    expect(_getCompanionGenderRestrictionMessage(maleEvent, '小花'))
      .toBe('小花 不符合此活動的男性限制');
  });
  test('returns anonymous message for male event without name', () => {
    expect(_getCompanionGenderRestrictionMessage(maleEvent))
      .toBe('所選同行者不符合此活動的男性限制');
  });
  test('returns named message for female event', () => {
    expect(_getCompanionGenderRestrictionMessage(femaleEvent, '大明'))
      .toBe('大明 不符合此活動的女性限制');
  });
  test('returns anonymous message for female event', () => {
    expect(_getCompanionGenderRestrictionMessage(femaleEvent))
      .toBe('所選同行者不符合此活動的女性限制');
  });
  test('returns anonymous message for empty companion name', () => {
    expect(_getCompanionGenderRestrictionMessage(maleEvent, ''))
      .toBe('所選同行者不符合此活動的男性限制');
  });
  test('returns empty string for null event', () => {
    expect(_getCompanionGenderRestrictionMessage(null)).toBe('');
  });
});

// ---- Group 2: Event Team Logic ----

describe('_getEventLimitedTeamIds', () => {
  test('returns empty array for null event', () => {
    expect(_getEventLimitedTeamIds(null)).toEqual([]);
  });
  test('returns empty array for undefined event', () => {
    expect(_getEventLimitedTeamIds(undefined)).toEqual([]);
  });
  test('returns empty array for event with no team fields', () => {
    expect(_getEventLimitedTeamIds({})).toEqual([]);
  });
  test('returns single team from creatorTeamId', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamId: 'team1' })).toEqual(['team1']);
  });
  test('returns teams from creatorTeamIds array', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['teamA', 'teamB'] })).toEqual(['teamA', 'teamB']);
  });
  test('includes creatorTeamId after creatorTeamIds', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['teamA'], creatorTeamId: 'teamB' }))
      .toEqual(['teamA', 'teamB']);
  });
  test('deduplicates when creatorTeamId is in creatorTeamIds', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['teamA', 'teamB'], creatorTeamId: 'teamA' }))
      .toEqual(['teamA', 'teamB']);
  });
  test('deduplicates within creatorTeamIds', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['teamA', 'teamA', 'teamB'] }))
      .toEqual(['teamA', 'teamB']);
  });
  test('skips empty/null entries in creatorTeamIds', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['teamA', '', null, 'teamB'] }))
      .toEqual(['teamA', 'teamB']);
  });
  test('trims whitespace from IDs', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamIds: ['  teamA  ', 'teamB '] }))
      .toEqual(['teamA', 'teamB']);
  });
  test('skips empty creatorTeamId', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamId: '' })).toEqual([]);
  });
  test('skips null creatorTeamId', () => {
    expect(_getEventLimitedTeamIds({ creatorTeamId: null })).toEqual([]);
  });
});

// ---- Group 3: Event People Summary ----

describe('_buildEventPeopleSummaryByStatus', () => {
  const event = { id: 'evt1', title: 'Test Event' };

  test('returns empty result for null event', () => {
    expect(_buildEventPeopleSummaryByStatus(null, [], 'confirmed')).toEqual({
      people: [], count: 0, hasSource: false,
    });
  });

  test('returns empty result with no registrations', () => {
    const result = _buildEventPeopleSummaryByStatus(event, [], 'confirmed');
    expect(result.people).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.hasSource).toBe(false);
  });

  test('returns empty result when no registrations match status', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'waitlisted', participantType: 'self' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.hasSource).toBe(false);
  });

  test('returns confirmed participants only', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self' },
      { userId: 'u3', userName: 'Charlie', status: 'waitlisted', participantType: 'self' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'Bob', isCompanion: false },
    ]);
    expect(result.count).toBe(2);
    expect(result.hasSource).toBe(true);
  });

  test('handles companions correctly', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'companion', companionName: 'Dave' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'Dave', isCompanion: true },
    ]);
    expect(result.count).toBe(2);
  });

  test('deduplicates same-name participants', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u2', userName: 'Alice', status: 'confirmed', participantType: 'self' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
    ]);
    expect(result.count).toBe(1);
  });

  test('deduplicates companion with same name as main participant', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self' },
      { userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'companion', companionName: 'Alice' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'Bob', isCompanion: false },
    ]);
    expect(result.count).toBe(2);
  });

  test('uses fallback names when no registrations match', () => {
    const result = _buildEventPeopleSummaryByStatus(event, [], 'confirmed', ['Fallback1', 'Fallback2']);
    expect(result.people).toEqual([
      { name: 'Fallback1', isCompanion: false },
      { name: 'Fallback2', isCompanion: false },
    ]);
    expect(result.count).toBe(2);
    expect(result.hasSource).toBe(false);
  });

  test('fallback names do not duplicate registration names', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed', ['Alice', 'Bob']);
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'Bob', isCompanion: false },
    ]);
    expect(result.count).toBe(2);
    expect(result.hasSource).toBe(true);
  });

  test('fallback names skip empty/null entries', () => {
    const result = _buildEventPeopleSummaryByStatus(event, [], 'confirmed', ['', null, 'Valid']);
    expect(result.people).toEqual([
      { name: 'Valid', isCompanion: false },
    ]);
    expect(result.count).toBe(1);
  });

  test('fallback names deduplicate among themselves', () => {
    const result = _buildEventPeopleSummaryByStatus(event, [], 'confirmed', ['Alice', 'Alice', 'Bob']);
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'Bob', isCompanion: false },
    ]);
    expect(result.count).toBe(2);
  });

  test('handles non-array registrations gracefully', () => {
    const result = _buildEventPeopleSummaryByStatus(event, null, 'confirmed');
    expect(result.people).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.hasSource).toBe(false);
  });

  test('handles non-array fallbackNames gracefully', () => {
    const result = _buildEventPeopleSummaryByStatus(event, [], 'confirmed', 'not-array');
    expect(result.people).toEqual([]);
    expect(result.count).toBe(0);
  });

  test('groups by userId, self reg provides main name', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'companion', companionName: 'CompA' },
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'CompA', isCompanion: true },
    ]);
  });

  test('companion uses companionName over userName', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'companion', companionName: 'Dave' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    const companion = result.people.find(p => p.isCompanion);
    expect(companion.name).toBe('Dave');
  });

  test('companion falls back to userName when companionName is missing', () => {
    const regs = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
      { userId: 'u1', userName: 'CompBob', status: 'confirmed', participantType: 'companion' },
    ];
    const result = _buildEventPeopleSummaryByStatus(event, regs, 'confirmed');
    expect(result.people).toEqual([
      { name: 'Alice', isCompanion: false },
      { name: 'CompBob', isCompanion: true },
    ]);
  });
});

// ---- Group 4: Event Capacity Badge ----

describe('_renderEventCapacityBadge', () => {
  test('returns full badge HTML when showFullBadge is true', () => {
    const stats = { showFullBadge: true, showAlmostFullBadge: false };
    expect(_renderEventCapacityBadge({}, stats)).toBe('<span class="tl-almost-full-badge">已額滿</span>');
  });
  test('returns almost-full badge HTML when showAlmostFullBadge is true', () => {
    const stats = { showFullBadge: false, showAlmostFullBadge: true };
    expect(_renderEventCapacityBadge({}, stats)).toBe('<span class="tl-almost-full-badge">即將額滿</span>');
  });
  test('returns empty string when neither badge applies', () => {
    const stats = { showFullBadge: false, showAlmostFullBadge: false };
    expect(_renderEventCapacityBadge({}, stats)).toBe('');
  });
  test('full badge takes priority over almost-full badge', () => {
    const stats = { showFullBadge: true, showAlmostFullBadge: true };
    expect(_renderEventCapacityBadge({}, stats)).toBe('<span class="tl-almost-full-badge">已額滿</span>');
  });
});

// ---- Event Sport Tag ----

describe('_getEventSportTag', () => {
  test('returns "football" for event with no sportTag', () => {
    expect(_getEventSportTag({})).toBe('football');
  });
  test('returns "football" for null event', () => {
    expect(_getEventSportTag(null)).toBe('football');
  });
  test('returns "football" for undefined event', () => {
    expect(_getEventSportTag(undefined)).toBe('football');
  });
  test('returns valid sport key for known sportTag', () => {
    expect(_getEventSportTag({ sportTag: 'basketball' })).toBe('basketball');
  });
  test('returns "football" for unknown sportTag', () => {
    expect(_getEventSportTag({ sportTag: 'curling' })).toBe('football');
  });
  test('returns valid key for all EVENT_SPORT_OPTIONS', () => {
    EVENT_SPORT_OPTIONS.forEach(opt => {
      expect(_getEventSportTag({ sportTag: opt.key })).toBe(opt.key);
    });
  });
  test('trims whitespace in sportTag', () => {
    expect(_getEventSportTag({ sportTag: ' basketball ' })).toBe('basketball');
  });
});

// ---- Navigation functions ----

describe('_getRouteStepTimeoutMs', () => {
  test('returns 15000 by default for page step', () => {
    expect(_getRouteStepTimeoutMs('page-home')).toBe(15000);
  });
  test('returns 15000 by default for cloud step', () => {
    expect(_getRouteStepTimeoutMs('page-home', 'cloud')).toBe(15000);
  });
  test('returns custom timeout for page step', () => {
    expect(_getRouteStepTimeoutMs('page-home', 'page', { routeStepTimeoutMs: 5000 })).toBe(5000);
  });
  test('returns custom timeout for cloud step', () => {
    expect(_getRouteStepTimeoutMs('page-home', 'cloud', { routeCloudTimeoutMs: 8000 })).toBe(8000);
  });
  test('cloud step ignores routeStepTimeoutMs', () => {
    expect(_getRouteStepTimeoutMs('page-home', 'cloud', { routeStepTimeoutMs: 5000 })).toBe(15000);
  });
  test('page step ignores routeCloudTimeoutMs', () => {
    expect(_getRouteStepTimeoutMs('page-home', 'page', { routeCloudTimeoutMs: 8000 })).toBe(15000);
  });
});

describe('_getRouteFailureToast', () => {
  test('returns generic page failure for non-timeout error', () => {
    expect(_getRouteFailureToast('page-home')).toBe('頁面載入失敗，請稍後再試');
  });
  test('returns cloud failure message for cloud step', () => {
    expect(_getRouteFailureToast('page-home', 'cloud')).toBe('雲端連線失敗，請稍後再試');
  });
  test('returns activities-specific timeout message', () => {
    const err = { code: 'route-step-timeout' };
    expect(_getRouteFailureToast('page-activities', 'page', err))
      .toBe('網路較慢，活動頁暫時無法開啟，請稍後再試');
  });
  test('returns generic timeout message for other pages', () => {
    const err = { code: 'route-step-timeout' };
    expect(_getRouteFailureToast('page-home', 'page', err))
      .toBe('網路較慢，頁面暫時無法開啟，請稍後再試');
  });
  test('timeout takes priority over cloud step', () => {
    const err = { code: 'route-step-timeout' };
    expect(_getRouteFailureToast('page-home', 'cloud', err))
      .toBe('網路較慢，頁面暫時無法開啟，請稍後再試');
  });
  test('returns page failure for null error', () => {
    expect(_getRouteFailureToast('page-home', 'page', null))
      .toBe('頁面載入失敗，請稍後再試');
  });
  test('returns page failure for error without code', () => {
    expect(_getRouteFailureToast('page-home', 'page', { message: 'fail' }))
      .toBe('頁面載入失敗，請稍後再試');
  });
});

// ---- Firebase CRUD: Event Occupancy State ----

describe('_getEventOccupancyState', () => {
  test('returns defaults for empty/undefined input', () => {
    const result = _getEventOccupancyState();
    expect(result).toEqual({
      hasParticipantArray: false,
      hasWaitlistArray: false,
      participants: [],
      waitlistNames: [],
      current: 0,
      waitlist: 0,
    });
  });

  test('returns defaults for null-ish event data', () => {
    const result = _getEventOccupancyState({});
    expect(result.current).toBe(0);
    expect(result.waitlist).toBe(0);
    expect(result.hasParticipantArray).toBe(false);
    expect(result.hasWaitlistArray).toBe(false);
  });

  test('uses fallback current/waitlist counts when no arrays', () => {
    const result = _getEventOccupancyState({ current: 5, waitlist: 3 });
    expect(result.current).toBe(5);
    expect(result.waitlist).toBe(3);
    expect(result.hasParticipantArray).toBe(false);
    expect(result.hasWaitlistArray).toBe(false);
    expect(result.participants).toEqual([]);
    expect(result.waitlistNames).toEqual([]);
  });

  test('counts participants from array, ignoring fallback current', () => {
    const result = _getEventOccupancyState({
      participants: ['Alice', 'Bob'],
      current: 99,
    });
    expect(result.hasParticipantArray).toBe(true);
    expect(result.participants).toEqual(['Alice', 'Bob']);
    expect(result.current).toBe(2); // array length, not fallback 99
  });

  test('counts waitlist from array, ignoring fallback waitlist', () => {
    const result = _getEventOccupancyState({
      waitlistNames: ['Carol'],
      waitlist: 99,
    });
    expect(result.hasWaitlistArray).toBe(true);
    expect(result.waitlistNames).toEqual(['Carol']);
    expect(result.waitlist).toBe(1); // array length, not fallback 99
  });

  test('deduplicates participants', () => {
    const result = _getEventOccupancyState({
      participants: ['Alice', 'Bob', 'Alice'],
    });
    expect(result.participants).toEqual(['Alice', 'Bob']);
    expect(result.current).toBe(2);
  });

  test('deduplicates waitlist names', () => {
    const result = _getEventOccupancyState({
      waitlistNames: ['Carol', 'Carol', 'Dave'],
    });
    expect(result.waitlistNames).toEqual(['Carol', 'Dave']);
    expect(result.waitlist).toBe(2);
  });

  test('waitlist excludes names already in participants', () => {
    const result = _getEventOccupancyState({
      participants: ['Alice', 'Bob'],
      waitlistNames: ['Bob', 'Carol'],
    });
    expect(result.participants).toEqual(['Alice', 'Bob']);
    expect(result.waitlistNames).toEqual(['Carol']);
    expect(result.current).toBe(2);
    expect(result.waitlist).toBe(1);
  });

  test('trims and filters empty/null participant names', () => {
    const result = _getEventOccupancyState({
      participants: ['  Alice  ', '', null, ' Bob '],
    });
    expect(result.participants).toEqual(['Alice', 'Bob']);
    expect(result.current).toBe(2);
  });

  test('trims and filters empty/null waitlist names', () => {
    const result = _getEventOccupancyState({
      waitlistNames: ['', null, '  Carol  '],
    });
    expect(result.waitlistNames).toEqual(['Carol']);
    expect(result.waitlist).toBe(1);
  });

  test('handles negative fallback current gracefully (clamps to 0)', () => {
    const result = _getEventOccupancyState({ current: -5 });
    expect(result.current).toBe(0);
  });

  test('handles negative fallback waitlist gracefully (clamps to 0)', () => {
    const result = _getEventOccupancyState({ waitlist: -3 });
    expect(result.waitlist).toBe(0);
  });

  test('handles NaN fallback current (clamps to 0)', () => {
    const result = _getEventOccupancyState({ current: 'abc' });
    expect(result.current).toBe(0);
  });

  test('handles both arrays present', () => {
    const result = _getEventOccupancyState({
      participants: ['Alice', 'Bob'],
      waitlistNames: ['Carol', 'Dave'],
      current: 10,
      waitlist: 10,
    });
    expect(result.hasParticipantArray).toBe(true);
    expect(result.hasWaitlistArray).toBe(true);
    expect(result.participants).toEqual(['Alice', 'Bob']);
    expect(result.waitlistNames).toEqual(['Carol', 'Dave']);
    expect(result.current).toBe(2);
    expect(result.waitlist).toBe(2);
  });

  test('empty arrays result in zero counts', () => {
    const result = _getEventOccupancyState({
      participants: [],
      waitlistNames: [],
      current: 5,
      waitlist: 3,
    });
    expect(result.current).toBe(0);
    expect(result.waitlist).toBe(0);
  });
});
