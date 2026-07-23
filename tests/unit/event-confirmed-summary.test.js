const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEventNoshowModule({
  event,
  registrations,
  noShowFeatureEnabled = true,
  hasRealtimeState = false,
  serverSnapshot = false,
  eventFetchServer = false,
}) {
  const state = {
    event,
    registrations,
    adminUsers: [],
  };
  const context = {
    App: {},
    ApiService: {
      _fetchedRegistrationServerIds: eventFetchServer ? new Set([event.id]) : new Set(),
      getEvent: id => (id === event.id ? state.event : null),
      getRegistrationsByEvent: id => (id === event.id ? state.registrations : []),
      getAdminUsers: () => state.adminUsers,
      getUserCorrection: () => null,
    },
    FirebaseService: {
      _normalizeTeamReservationSummaries: e => e.teamReservationSummaries || [],
      ...(hasRealtimeState ? {
        _realtimeListenerStarted: { registrations: true },
        _registrationListenerKey: 'all',
        _registrationsServerSnapshotReceived: serverSnapshot,
      } : {}),
    },
    isNoShowFeatureEnabled: () => noShowFeatureEnabled,
    console,
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../js/modules/event/event-manage-noshow.js'),
    'utf8',
  );
  vm.runInNewContext(source, context, { filename: 'js/modules/event/event-manage-noshow.js' });
  return context.App;
}

describe('_buildConfirmedParticipantSummary', () => {
  test('shows proxy-only companion owner without counting them as a participant', () => {
    const event = {
      id: 'evt1',
      current: 3,
      realCurrent: 2,
      max: 10,
      participants: ['Guest A', 'Guest B'],
      participantsWithUid: [
        { uid: 'comp_a', name: 'Guest A' },
        { uid: 'comp_b', name: 'Guest B' },
      ],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        eventId: 'evt1',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'confirmed',
      },
      {
        eventId: 'evt1',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'confirmed',
      },
    ];
    const app = loadEventNoshowModule({ event, registrations });

    const summary = app._buildConfirmedParticipantSummary('evt1');

    expect(summary.realCount).toBe(2);
    expect(summary.count).toBe(2);
    expect(summary.people.map(p => p.name)).toEqual(['Owner Only', 'Guest A', 'Guest B']);
    const proxyOnlyRow = summary.people.find(p => p.name === 'Owner Only');
    expect(proxyOnlyRow).toMatchObject({
      uid: 'owner_uid',
      hasSelfReg: false,
      proxyOnly: true,
      isProxyOnly: true,
    });
    expect(summary.people.filter(p => !p.proxyOnly && !p.isProxyOnly).map(p => p.name)).toEqual(['Guest A', 'Guest B']);
  });

  test('keeps self registration plus companions when owner also signs up', () => {
    const event = {
      id: 'evt2',
      current: 2,
      realCurrent: 2,
      max: 10,
      participants: ['Owner', 'Guest'],
      participantsWithUid: [
        { uid: 'owner_uid', name: 'Owner' },
        { uid: 'comp_guest', name: 'Guest' },
      ],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        eventId: 'evt2',
        userId: 'owner_uid',
        userName: 'Owner',
        participantType: 'self',
        status: 'confirmed',
      },
      {
        eventId: 'evt2',
        userId: 'owner_uid',
        userName: 'Owner',
        participantType: 'companion',
        companionId: 'comp_guest',
        companionName: 'Guest',
        status: 'confirmed',
      },
    ];
    const app = loadEventNoshowModule({ event, registrations });

    const summary = app._buildConfirmedParticipantSummary('evt2');

    expect(summary.realCount).toBe(2);
    expect(summary.count).toBe(2);
    expect(summary.people.map(p => p.name)).toEqual(['Owner', 'Guest']);
  });

  test('does not let cache-only registration rows downgrade the detail count', () => {
    const event = {
      id: 'evt-stale',
      current: 21,
      realCurrent: 21,
      max: 21,
      participants: Array.from({ length: 20 }, (_, i) => `User ${i}`),
      participantsWithUid: Array.from({ length: 20 }, (_, i) => ({ uid: `uid-${i}`, name: `User ${i}` })),
      teamReservationSummaries: [],
    };
    const registrations = Array.from({ length: 20 }, (_, i) => ({
      eventId: 'evt-stale',
      userId: `uid-${i}`,
      userName: `User ${i}`,
      participantType: 'self',
      status: 'confirmed',
    }));
    const app = loadEventNoshowModule({
      event,
      registrations,
      hasRealtimeState: true,
      serverSnapshot: false,
      eventFetchServer: false,
    });

    const summary = app._buildConfirmedParticipantSummary('evt-stale');

    expect(summary.count).toBe(21);
  });

  test('does not treat the limited admin registration listener as a complete event list', () => {
    const event = {
      id: 'evt-admin-limited',
      current: 21,
      realCurrent: 21,
      max: 21,
      participants: Array.from({ length: 21 }, (_, i) => `User ${i}`),
      participantsWithUid: Array.from({ length: 21 }, (_, i) => ({ uid: `uid-${i}`, name: `User ${i}` })),
      teamReservationSummaries: [],
    };
    const registrations = Array.from({ length: 20 }, (_, i) => ({
      eventId: 'evt-admin-limited',
      userId: `uid-${i}`,
      userName: `User ${i}`,
      participantType: 'self',
      status: 'confirmed',
    }));
    const app = loadEventNoshowModule({
      event,
      registrations,
      hasRealtimeState: true,
      serverSnapshot: true,
      eventFetchServer: false,
    });

    const summary = app._buildConfirmedParticipantSummary('evt-admin-limited');

    expect(summary.count).toBe(21);
  });

  test('uses event-specific server-fetched registrations for detail counts', () => {
    const event = {
      id: 'evt-server-fetched',
      current: 3,
      max: 10,
      participants: ['Owner Only', 'Guest A', 'Guest B'],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        eventId: 'evt-server-fetched',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'confirmed',
      },
      {
        eventId: 'evt-server-fetched',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'confirmed',
      },
    ];
    const app = loadEventNoshowModule({
      event,
      registrations,
      hasRealtimeState: true,
      serverSnapshot: false,
      eventFetchServer: true,
    });

    const summary = app._buildConfirmedParticipantSummary('evt-server-fetched');

    expect(summary.count).toBe(2);
    expect(summary.people.map(p => p.name)).toEqual(['Owner Only', 'Guest A', 'Guest B']);
  });

  test('does not count remaining team reserved placeholders as real signups', () => {
    const event = {
      id: 'evt-team-reserved',
      current: 24,
      realCurrent: 23,
      max: 24,
      participants: Array.from({ length: 23 }, (_, i) => `User ${i}`),
      participantsWithUid: Array.from({ length: 23 }, (_, i) => ({ uid: `uid-${i}`, name: `User ${i}` })),
      teamReservationSummaries: [
        { teamId: 'teamA', teamName: 'Team A', reservedSlots: 9, usedSlots: 8, remainingSlots: 1 },
      ],
    };
    const app = loadEventNoshowModule({
      event,
      registrations: [],
      hasRealtimeState: true,
      serverSnapshot: false,
      eventFetchServer: false,
    });

    const summary = app._buildConfirmedParticipantSummary('evt-team-reserved');

    expect(summary.count).toBe(23);
    expect(summary.people.filter(p => p.isTeamPlaceholder)).toHaveLength(1);
  });

  test('backfills team split doc ids when projected fallback rows are used', () => {
    const event = {
      id: 'evt-team-split-fallback',
      current: 2,
      realCurrent: 2,
      max: 10,
      participants: ['Owner', 'Guest'],
      participantsWithUid: [
        { uid: 'owner_uid', name: 'Owner' },
        { uid: 'guest_uid', name: 'Guest' },
      ],
      teamSplit: {
        enabled: true,
        teams: [
          { key: 'A', name: 'A Team' },
          { key: 'B', name: 'B Team' },
        ],
      },
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        _docId: 'reg-owner-doc',
        eventId: 'evt-team-split-fallback',
        userId: 'owner_uid',
        userName: 'Owner',
        participantType: 'self',
        status: 'confirmed',
        teamKey: 'A',
      },
      {
        _docId: 'reg-guest-doc',
        eventId: 'evt-team-split-fallback',
        userId: 'owner_uid',
        userName: 'Owner',
        participantType: 'companion',
        companionId: 'guest_uid',
        companionName: 'Guest',
        status: 'confirmed',
        teamKey: 'B',
      },
    ];
    const app = loadEventNoshowModule({
      event,
      registrations,
      hasRealtimeState: true,
      serverSnapshot: true,
      eventFetchServer: false,
    });

    const summary = app._buildConfirmedParticipantSummary('evt-team-split-fallback');

    expect(summary.people.find(p => p.uid === 'owner_uid')).toMatchObject({
      regDocId: 'reg-owner-doc',
      teamKey: 'A',
    });
    expect(summary.people.find(p => p.uid === 'guest_uid')).toMatchObject({
      regDocId: 'reg-guest-doc',
      teamKey: 'B',
    });
  });

  test('keeps same-parent course students distinct while ordinary rows still group by uid', () => {
    const event = {
      id: 'evt-course-siblings',
      current: 3,
      realCurrent: 3,
      max: 10,
      participants: ['Student A', 'Student B', 'Parent ordinary'],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        _docId: 'course-reg-a', eventId: event.id, userId: 'same-parent', userName: 'Student A',
        participantType: 'self', status: 'confirmed', courseLinkSource: 'eduCourseLesson',
        courseLinkId: 'course-a', courseStudentId: 'student-a', registeredAt: '2026-01-01T00:00:00Z',
      },
      {
        _docId: 'course-reg-b', eventId: event.id, userId: 'same-parent', userName: 'Student B',
        participantType: 'self', status: 'confirmed', courseLinkSource: 'eduCourseLesson',
        courseLinkId: 'course-b', courseStudentId: 'student-b', registeredAt: '2026-01-01T00:01:00Z',
      },
      {
        _docId: 'ordinary-reg-first', eventId: event.id, userId: 'same-parent', userName: 'Parent ordinary',
        participantType: 'self', status: 'confirmed', registeredAt: '2026-01-01T00:02:00Z',
      },
      {
        _docId: 'ordinary-reg-duplicate', eventId: event.id, userId: 'same-parent', userName: 'Duplicate ordinary',
        participantType: 'self', status: 'confirmed', registeredAt: '2026-01-01T00:03:00Z',
      },
    ];
    const app = loadEventNoshowModule({ event, registrations });

    const summary = app._buildConfirmedParticipantSummary(event.id);
    const actionableRows = summary.people.filter(row => !row.proxyOnly && !row.isProxyOnly);

    expect(summary.count).toBe(3);
    expect(summary.realCount).toBe(3);
    expect(actionableRows.map(row => row.name)).toEqual(['Student A', 'Student B', 'Parent ordinary']);
    expect(actionableRows.map(row => row.regDocId)).toEqual([
      'course-reg-a', 'course-reg-b', 'ordinary-reg-first',
    ]);
    expect(actionableRows.slice(0, 2).map(row => row.courseStudentId)).toEqual(['student-a', 'student-b']);
    expect(actionableRows.slice(0, 2).every(row => row.courseLinkedRegistration === true)).toBe(true);
  });

  test('no-show helpers return empty values while feature flag is disabled', () => {
    const event = { id: 'evt3', current: 0, realCurrent: 0, max: 10, teamReservationSummaries: [] };
    const app = loadEventNoshowModule({ event, registrations: [], noShowFeatureEnabled: false });

    expect(app._buildRawNoShowCountByUid().size).toBe(0);
    expect(app._buildNoShowCountByUid().size).toBe(0);
    expect(app._getRawNoShowCount('uid1')).toBe(0);
    expect(app._getEffectiveNoShowCount('uid1')).toBe(0);
    expect(app._getNoShowDetailsByUid('uid1')).toEqual([]);
    expect(app._getParticipantNoShowCount({ uid: 'uid1' }, new Map([['uid1', 3]]))).toBeNull();
  });
});
