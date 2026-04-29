const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFirebaseCrudHelpers() {
  const apiState = { teams: [], adminUsers: [] };
  const context = {
    FirebaseService: {},
    App: {
      _getUserTeamIds(user) {
        return Array.isArray(user?.teamIds) ? user.teamIds : (user?.teamId ? [user.teamId] : []);
      },
    },
    ApiService: {
      getAdminUsers: () => apiState.adminUsers,
      getTeams: () => apiState.teams,
    },
    console,
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/firebase-crud.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'js/firebase-crud.js' });
  context.FirebaseService.__testApiState = apiState;
  return context.FirebaseService;
}

describe('team reservation occupancy helpers', () => {
  let service;

  beforeEach(() => {
    service = loadFirebaseCrudHelpers();
  });

  test('reserved empty seats count toward current but not realCurrent', () => {
    const occupancy = service._rebuildOccupancy(
      {
        max: 5,
        status: 'open',
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 3 }],
      },
      [
        { id: 'r1', userId: 'u1', userName: 'A', participantType: 'self', status: 'confirmed', teamReservationTeamId: 'teamA' },
        { id: 'r2', userId: 'u2', userName: 'B', participantType: 'self', status: 'confirmed' },
      ],
    );

    expect(occupancy.realCurrent).toBe(2);
    expect(occupancy.current).toBe(4);
    expect(occupancy.teamReservationSummaries[0]).toMatchObject({
      teamId: 'teamA',
      usedSlots: 1,
      remainingSlots: 2,
    });
  });

  test('same-team signup consumes a reserved placeholder even when current is full', () => {
    const registration = { id: 'r3', userId: 'u3', userName: 'C', participantType: 'self' };
    const decision = service._decideRegistrationSeat(
      {
        max: 3,
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 2 }],
      },
      [
        { id: 'r1', userId: 'u1', userName: 'A', participantType: 'self', status: 'confirmed' },
      ],
      registration,
      { uid: 'u3', teamIds: ['teamA'] },
    );

    expect(decision.status).toBe('confirmed');
    expect(registration.status).toBe('confirmed');
    expect(registration.teamReservationTeamId).toBe('teamA');
    expect(registration.teamSeatSource).toBe('reserved');
  });

  test('multi-club signup consumes the explicitly selected club reservation', () => {
    const registration = { id: 'r3', userId: 'u3', userName: 'C', participantType: 'self' };
    const decision = service._decideRegistrationSeat(
      {
        max: 4,
        teamReservationSummaries: [
          { teamId: 'teamA', teamName: 'Team A', reservedSlots: 2 },
          { teamId: 'teamB', teamName: 'Team B', reservedSlots: 2 },
        ],
      },
      [],
      registration,
      { uid: 'u3', teamIds: ['teamA', 'teamB'], preferredTeamReservationTeamId: 'teamB' },
    );

    expect(decision.status).toBe('confirmed');
    expect(registration.status).toBe('confirmed');
    expect(registration.teamReservationTeamId).toBe('teamB');
    expect(registration.teamReservationTeamName).toBe('Team B');
    expect(registration.teamSeatSource).toBe('reserved');
  });

  test('explicit club reservation choice must belong to the user', () => {
    const registration = { id: 'r3', userId: 'u3', userName: 'C', participantType: 'self' };
    expect(() => service._decideRegistrationSeat(
      {
        max: 4,
        teamReservationSummaries: [{ teamId: 'teamB', teamName: 'Team B', reservedSlots: 2 }],
      },
      [],
      registration,
      { uid: 'u3', teamIds: ['teamA'], preferredTeamReservationTeamId: 'teamB' },
    )).toThrow('TEAM_RESERVATION_TEAM_DENIED');
  });

  test('team officer signup consumes a reserved placeholder even without member teamIds', () => {
    service.__testApiState.teams = [
      { id: 'teamA', name: 'Team A', captainUid: 'staff_uid' },
    ];
    const registration = { id: 'r3', userId: 'staff_uid', userName: 'Staff', participantType: 'self' };
    const decision = service._decideRegistrationSeat(
      {
        max: 3,
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 2 }],
      },
      [
        { id: 'r1', userId: 'u1', userName: 'A', participantType: 'self', status: 'confirmed' },
      ],
      registration,
      { uid: 'staff_uid' },
    );

    expect(decision.status).toBe('confirmed');
    expect(registration.status).toBe('confirmed');
    expect(registration.teamReservationTeamId).toBe('teamA');
    expect(registration.teamSeatSource).toBe('reserved');
  });

  test('waitlist promotion fills same-team reserved seats before general seats', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'A', participantType: 'self', status: 'confirmed' },
      { id: 'r2', userId: 'u2', userName: 'B', participantType: 'self', status: 'waitlisted', registeredAt: '2026-01-01T00:00:00.000Z', teamReservationTeamId: 'teamA' },
      { id: 'r3', userId: 'u3', userName: 'C', participantType: 'self', status: 'waitlisted', registeredAt: '2026-01-01T00:01:00.000Z' },
    ];

    const promoted = service._promoteWaitlistForAvailableSeats(
      {
        max: 3,
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 2 }],
      },
      regs,
    );

    expect(promoted.map(r => r.id)).toEqual(['r2']);
    expect(regs.find(r => r.id === 'r2').status).toBe('confirmed');
    expect(regs.find(r => r.id === 'r2').teamSeatSource).toBe('reserved');
    expect(regs.find(r => r.id === 'r3').status).toBe('waitlisted');
  });
});
