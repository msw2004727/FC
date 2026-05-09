const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEventListStatsModule({ event, registrations = [], hasCompleteRegs = true }) {
  const state = { registrations };
  const context = {
    App: {},
    ApiService: {
      getEvent: id => (id === event.id ? event : null),
      getRegistrationsByEvent: id => (id === event.id ? state.registrations : []),
    },
    FirebaseService: {
      _realtimeListenerStarted: { registrations: hasCompleteRegs },
      _registrationListenerKey: hasCompleteRegs ? 'all' : '',
    },
    console,
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../js/modules/event/event-list-stats.js'),
    'utf8',
  );
  vm.runInNewContext(source, context, { filename: 'js/modules/event/event-list-stats.js' });
  context.App.__testState = state;
  return context.App;
}

describe('_getEventParticipantStats', () => {
  test('does not count proxy-only owner when user only signs up companions', () => {
    const event = {
      id: 'evt1',
      current: 3,
      realCurrent: 2,
      waitlist: 0,
      max: 21,
      status: 'open',
      participants: ['Owner Only', 'Guest A', 'Guest B'],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'confirmed',
      },
      {
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'confirmed',
      },
    ];
    const app = loadEventListStatsModule({ event, registrations });

    const summary = app._buildEventPeopleSummaryByStatus(event, registrations, 'confirmed', event.participants);
    const stats = app._getEventParticipantStats(event);

    expect(summary.people.map(p => p.name)).toEqual(['Guest A', 'Guest B']);
    expect(summary.count).toBe(2);
    expect(stats.confirmedCount).toBe(2);
  });

  test('falls back to realCurrent when registration listener is not complete', () => {
    const event = {
      id: 'evt2',
      current: 3,
      realCurrent: 2,
      waitlist: 0,
      max: 21,
      status: 'open',
      teamReservationSummaries: [],
    };
    const app = loadEventListStatsModule({ event, hasCompleteRegs: false });

    expect(app._getEventParticipantStats(event).confirmedCount).toBe(2);
  });

  test('uses loaded event registrations even before the all-registration listener is complete', () => {
    const event = {
      id: 'evt2b',
      current: 3,
      waitlist: 0,
      max: 21,
      status: 'open',
      participants: ['Owner Only', 'Guest A', 'Guest B'],
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'confirmed',
      },
      {
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'confirmed',
      },
    ];
    const app = loadEventListStatsModule({ event, registrations, hasCompleteRegs: false });

    expect(app._getEventParticipantStats(event).confirmedCount).toBe(2);
  });

  test('refreshes cached projected count after registrations load', () => {
    const event = {
      id: 'evt2c',
      current: 3,
      waitlist: 0,
      max: 21,
      status: 'open',
      participants: ['Owner Only', 'Guest A', 'Guest B'],
      teamReservationSummaries: [],
    };
    const app = loadEventListStatsModule({ event, registrations: [], hasCompleteRegs: true });

    expect(app._getEventParticipantStats(event).confirmedCount).toBe(3);

    app.__testState.registrations = [
      {
        id: 'reg-a',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'confirmed',
      },
      {
        id: 'reg-b',
        userId: 'owner_uid',
        userName: 'Owner Only',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'confirmed',
      },
    ];

    expect(app._getEventParticipantStats(event).confirmedCount).toBe(2);
  });

  test('uses projected fallback names only when registrations are absent', () => {
    const event = {
      id: 'evt2d',
      current: 2,
      waitlist: 0,
      max: 21,
      status: 'open',
      participants: ['Guest A', 'Guest B'],
      teamReservationSummaries: [],
    };
    const app = loadEventListStatsModule({ event, registrations: [], hasCompleteRegs: true });
    const summary = app._buildEventPeopleSummaryByStatus(event, [], 'confirmed', event.participants);

    expect(summary.people.map(p => p.name)).toEqual(['Guest A', 'Guest B']);
    expect(summary.count).toBe(2);
    expect(summary.hasSource).toBe(false);
  });

  test('keeps team reservation empty seats in projected occupied count', () => {
    const event = {
      id: 'evt3',
      current: 4,
      realCurrent: 2,
      waitlist: 0,
      max: 5,
      status: 'open',
      teamReservationSummaries: [
        { teamId: 'teamA', reservedSlots: 3, usedSlots: 1, remainingSlots: 2 },
      ],
    };
    const app = loadEventListStatsModule({ event, hasCompleteRegs: false });

    expect(app._getEventParticipantStats(event).confirmedCount).toBe(4);
  });
});
