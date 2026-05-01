const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEventNoshowModule({ event, registrations }) {
  const state = {
    event,
    registrations,
    adminUsers: [],
  };
  const context = {
    App: {},
    ApiService: {
      getEvent: id => (id === event.id ? state.event : null),
      getRegistrationsByEvent: id => (id === event.id ? state.registrations : []),
      getAdminUsers: () => state.adminUsers,
      getUserCorrection: () => null,
    },
    FirebaseService: {
      _normalizeTeamReservationSummaries: e => e.teamReservationSummaries || [],
    },
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
      current: 2,
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
});
