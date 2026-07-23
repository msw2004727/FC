const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFirebaseCrudContext() {
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
  return context;
}

function loadFirebaseCrudHelpers() {
  return loadFirebaseCrudContext().FirebaseService;
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

  test('general waitlist promotion leaves remaining reserved team slots occupied as placeholders', () => {
    const regs = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `team-${i}`,
        userId: `teamUser${i}`,
        userName: `Team ${i}`,
        participantType: 'self',
        status: 'confirmed',
        teamReservationTeamId: 'teamA',
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `general-${i}`,
        userId: `generalUser${i}`,
        userName: `General ${i}`,
        participantType: 'self',
        status: 'confirmed',
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `wait-${i}`,
        userId: `waitUser${i}`,
        userName: `Wait ${i}`,
        participantType: 'self',
        status: 'waitlisted',
        registeredAt: `2026-01-01T00:0${i}:00.000Z`,
      })),
    ];

    const promoted = service._promoteWaitlistForAvailableSeats(
      {
        max: 24,
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 9 }],
      },
      regs,
    );
    const occupancy = service._rebuildOccupancy(
      {
        max: 24,
        teamReservationSummaries: [{ teamId: 'teamA', teamName: 'Team A', reservedSlots: 9 }],
      },
      regs.filter(r => r.status === 'confirmed' || r.status === 'waitlisted'),
    );

    expect(promoted.map(r => r.id)).toEqual(['wait-0', 'wait-1', 'wait-2']);
    expect(occupancy.realCurrent).toBe(23);
    expect(occupancy.current).toBe(24);
    expect(occupancy.waitlist).toBe(0);
    expect(occupancy.teamReservationSummaries[0]).toMatchObject({
      usedSlots: 8,
      remainingSlots: 1,
    });
  });

  test('max=0 keeps occupancy open and confirms ordinary signups', () => {
    const registration = { id: 'r-unlimited', userId: 'u-unlimited', userName: 'Unlimited', participantType: 'self' };
    const decision = service._decideRegistrationSeat(
      { max: 0, status: 'open', teamReservationSummaries: [] },
      [],
      registration,
      { uid: 'u-unlimited' },
    );
    const occupancy = service._rebuildOccupancy(
      { max: 0, status: 'open', teamReservationSummaries: [] },
      [registration],
    );

    expect(decision.status).toBe('confirmed');
    expect(registration.status).toBe('confirmed');
    expect(occupancy).toMatchObject({ current: 1, realCurrent: 1, waitlist: 0, status: 'open' });
  });

  test('max=0 promotes every legacy waitlist row even when course candidates are normally excluded', () => {
    const regs = [
      { id: 'confirmed', userId: 'u1', userName: 'Confirmed', participantType: 'self', status: 'confirmed' },
      { id: 'ordinary', userId: 'u2', userName: 'Ordinary', participantType: 'self', status: 'waitlisted', registeredAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'course', userId: 'parent', userName: 'Course student', participantType: 'self',
        status: 'waitlisted', registeredAt: '2026-01-01T00:01:00.000Z',
        courseLinkSource: 'eduCourseLesson', courseLinkId: 'course-link', courseStudentId: 'student-1',
      },
    ];

    const promoted = service._promoteWaitlistForAvailableSeats(
      { max: 0, status: 'open', courseLinked: true, teamReservationSummaries: [] },
      regs,
      { excludeCourseLinkedCandidates: true },
    );
    const occupancy = service._rebuildOccupancy(
      { max: 0, status: 'open', teamReservationSummaries: [] },
      regs,
    );

    expect(promoted.map(reg => reg.id)).toEqual(['ordinary', 'course']);
    expect(regs.every(reg => reg.status === 'confirmed')).toBe(true);
    expect(occupancy).toMatchObject({ current: 3, waitlist: 0, status: 'open' });
  });

  test('max=0 waitlisted-only companion cancellation syncs promoted activity record', async () => {
    const context = loadFirebaseCrudContext();
    const firebaseService = context.FirebaseService;
    const event = { id: 'evt-unlimited-cancel', _docId: 'event-doc', max: 0, status: 'open', teamReservationSummaries: [] };
    const registrations = [
      {
        id: 'cancel-companion', _docId: 'cancel-doc', eventId: event.id, userId: 'owner-1',
        userName: 'Owner', participantType: 'companion', companionId: 'companion-1',
        companionName: 'Companion', status: 'waitlisted', registeredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'promote-self', _docId: 'promote-doc', eventId: event.id, userId: 'user-2',
        userName: 'Promoted user', participantType: 'self', status: 'waitlisted',
        registeredAt: '2026-01-01T00:01:00.000Z',
      },
    ];
    const activityRecords = [{
      id: 'ar-promote', _docId: 'ar-promote', eventId: event.id, uid: 'user-2', status: 'waitlisted',
    }];
    const collectionGetPaths = [];
    const batchUpdates = [];

    const snapshotDoc = (id, data, collectionPath) => ({
      id,
      ref: { path: `${collectionPath}/${id}` },
      data: () => ({ ...data }),
    });
    const registrationDocs = registrations.map(reg => snapshotDoc(reg._docId, reg, `events/${event._docId}/registrations`));
    const activityRecordDocs = activityRecords.map(record => snapshotDoc(record._docId, record, `events/${event._docId}/activityRecords`));
    const makeDocRef = refPath => ({
      path: refPath,
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      collection: name => makeCollectionRef(`${refPath}/${name}`),
    });
    const makeCollectionRef = refPath => ({
      path: refPath,
      doc: id => makeDocRef(`${refPath}/${id}`),
      get: jest.fn(async () => {
        collectionGetPaths.push(refPath);
        if (refPath.endsWith('/registrations')) return { docs: registrationDocs };
        if (refPath.endsWith('/activityRecords')) return { docs: activityRecordDocs };
        return { docs: [] };
      }),
    });
    const batch = {
      update: jest.fn((ref, data) => { batchUpdates.push({ path: ref.path, data }); }),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    context.db = {
      collection: name => makeCollectionRef(name),
      batch: jest.fn(() => batch),
    };
    context.auth = { currentUser: { uid: 'owner-1' } };
    context.firebase = { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } };
    context.ApiService._src = name => (name === "activityRecords" ? activityRecords : []);
    firebaseService.ensureAuthReadyForWrite = jest.fn().mockResolvedValue(true);
    firebaseService._cache = { events: [event], registrations, activityRecords };
    firebaseService._saveToLS = jest.fn();
    firebaseService._mapSubcollectionDoc = doc => ({ ...doc.data(), id: doc.data().id || doc.id, _docId: doc.id });

    const cancelled = await firebaseService.cancelCompanionRegistrations(['cancel-companion']);

    expect(collectionGetPaths).toContain(`events/${event._docId}/activityRecords`);
    expect(batchUpdates).toContainEqual({
      path: `events/${event._docId}/activityRecords/ar-promote`,
      data: { status: 'registered' },
    });
    expect(registrations.find(reg => reg.id === 'promote-self').status).toBe('confirmed');
    expect(activityRecords[0].status).toBe('registered');
    expect(cancelled[0]._promotedUserIds).toEqual(['user-2']);
  });
});
