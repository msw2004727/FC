/**
 * Attendance Confirmation Logic — unit tests
 *
 * Tests the participant resolution logic from _confirmAllAttendance()
 * in event-manage-confirm.js without a live DOM or Firestore.
 *
 * The function builds a `people` array from two sources:
 *   1. confirmedRegs (grouped by userId → self + companions)
 *   2. event.participants fallback (name-based UID resolution from users)
 *
 * Covers:
 *   - All registered users get attendance records
 *   - UID resolution from registration data
 *   - Companion participants handled correctly (separate uid derivation)
 *   - Already-confirmed users not duplicated (addedNames Set)
 *   - Missing UID fallback behavior (skips participant)
 *   - Empty registration list
 */

// ===========================================================================
// Extracted: participant resolution logic from _confirmAllAttendance
// (event-manage-confirm.js:70-114)
//
// This function replicates the people-building logic:
//   1. Group confirmedRegs by userId
//   2. For each group, extract self reg → main person, then companions
//   3. Fall back to event.participants for names not yet in the list
//   4. UID resolution for fallback participants uses adminUsers lookup
// ===========================================================================
function buildPeopleList(confirmedRegs, eventParticipants, adminUsers) {
  const people = [];
  const addedNames = new Set();

  if (confirmedRegs.length > 0) {
    // Group by userId (line 81-85)
    const groups = new Map();
    confirmedRegs.forEach(r => {
      if (!groups.has(r.userId)) groups.set(r.userId, []);
      groups.get(r.userId).push(r);
    });

    // Process each group (line 86-99)
    groups.forEach(regs => {
      const selfReg = regs.find(r => r.participantType === 'self');
      const companions = regs.filter(r => r.participantType === 'companion');
      const mainName = selfReg ? selfReg.userName : regs[0].userName;
      const mainUid = regs[0].userId;

      people.push({ name: mainName, uid: mainUid, isCompanion: false });
      addedNames.add(mainName);

      companions.forEach(c => {
        const cName = c.companionName || c.userName;
        const cUid = c.companionId || (mainUid + '_' + c.companionName);
        people.push({ name: cName, uid: cUid, isCompanion: true });
        addedNames.add(cName);
      });
    });
  }

  // Fallback: event.participants not yet added (line 103-114)
  (eventParticipants || []).forEach(p => {
    if (!addedNames.has(p)) {
      const userDoc = (adminUsers || []).find(
        u => (u.displayName || u.name) === p
      );
      const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || null;
      if (!resolvedUid) {
        // Skipped — cannot resolve UID (line 107-109)
        return;
      }
      people.push({ name: p, uid: resolvedUid, isCompanion: false });
      addedNames.add(p);
    }
  });

  return people;
}

// ===========================================================================
// Extracted: _collectAttendanceOps baseline record building
// (event-manage-confirm.js:144-153)
//
// For each person, the function builds a baseRecord and resolves
// companion-specific fields. This tests the UID/record mapping logic.
// ===========================================================================
function buildBaseRecord(person, allActiveRegs, eventId) {
  let recordUid = person.uid;
  let recordUserName = person.name;
  let companionId = null;
  let companionName = null;
  let participantType = 'self';

  if (person.isCompanion) {
    const cReg = allActiveRegs.find(r => r.companionId === person.uid);
    if (cReg) {
      recordUid = cReg.userId;
      recordUserName = cReg.userName;
      companionId = person.uid;
      companionName = person.name;
      participantType = 'companion';
    }
  }

  return { eventId, uid: recordUid, userName: recordUserName, participantType, companionId, companionName };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_confirmAllAttendance Participant Resolution', () => {

  describe('buildPeopleList', () => {

    test('all registered users appear in people list', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
        { userId: 'u2', userName: 'Bob', participantType: 'self', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people).toHaveLength(2);
      expect(people.map(p => p.name)).toEqual(['Alice', 'Bob']);
      expect(people.every(p => !p.isCompanion)).toBe(true);
    });

    test('UID comes from registration data (userId field)', () => {
      const regs = [
        { userId: 'line_uid_123', userName: 'Alice', participantType: 'self', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people[0].uid).toBe('line_uid_123');
    });

    test('companion participants get derived uid', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
        { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'comp1', companionName: 'Bob', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people).toHaveLength(2);

      const alice = people.find(p => p.name === 'Alice');
      expect(alice.uid).toBe('u1');
      expect(alice.isCompanion).toBe(false);

      const bob = people.find(p => p.name === 'Bob');
      expect(bob.uid).toBe('comp1');
      expect(bob.isCompanion).toBe(true);
    });

    test('companion without companionId gets derived uid from userId + companionName', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
        { userId: 'u1', userName: 'Alice', participantType: 'companion', companionName: 'Carol', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      const carol = people.find(p => p.name === 'Carol');
      expect(carol.uid).toBe('u1_Carol');
      expect(carol.isCompanion).toBe(true);
    });

    test('already-confirmed users not duplicated via participants fallback', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
      ];
      const eventParticipants = ['Alice', 'Bob'];
      const adminUsers = [
        { displayName: 'Bob', uid: 'u2' },
      ];
      const people = buildPeopleList(regs, eventParticipants, adminUsers);
      // Alice from regs, Bob from participants fallback — no duplicates
      expect(people).toHaveLength(2);
      const names = people.map(p => p.name);
      expect(names.filter(n => n === 'Alice')).toHaveLength(1);
    });

    test('missing UID in fallback skips participant', () => {
      const regs = [];
      const eventParticipants = ['Ghost', 'Known'];
      const adminUsers = [
        { displayName: 'Known', uid: 'u_known' },
        // Ghost has no entry in adminUsers
      ];
      const people = buildPeopleList(regs, eventParticipants, adminUsers);
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe('Known');
      expect(people[0].uid).toBe('u_known');
    });

    test('fallback uses lineUserId when uid is missing', () => {
      const regs = [];
      const eventParticipants = ['Legacy'];
      const adminUsers = [
        { displayName: 'Legacy', lineUserId: 'line_legacy' },
      ];
      const people = buildPeopleList(regs, eventParticipants, adminUsers);
      expect(people).toHaveLength(1);
      expect(people[0].uid).toBe('line_legacy');
    });

    test('fallback matches by name field when displayName absent', () => {
      const regs = [];
      const eventParticipants = ['OldUser'];
      const adminUsers = [
        { name: 'OldUser', uid: 'u_old' },
      ];
      const people = buildPeopleList(regs, eventParticipants, adminUsers);
      expect(people).toHaveLength(1);
      expect(people[0].uid).toBe('u_old');
    });

    test('empty registration list — only participants fallback used', () => {
      const eventParticipants = ['Alice'];
      const adminUsers = [
        { displayName: 'Alice', uid: 'u1' },
      ];
      const people = buildPeopleList([], eventParticipants, adminUsers);
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe('Alice');
      expect(people[0].uid).toBe('u1');
      expect(people[0].isCompanion).toBe(false);
    });

    test('empty registration list and empty participants → empty people', () => {
      const people = buildPeopleList([], [], []);
      expect(people).toHaveLength(0);
    });

    test('multiple companions from same user', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
        { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob', status: 'confirmed' },
        { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c2', companionName: 'Carol', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people).toHaveLength(3);
      expect(people[0]).toEqual({ name: 'Alice', uid: 'u1', isCompanion: false });
      expect(people[1]).toEqual({ name: 'Bob', uid: 'c1', isCompanion: true });
      expect(people[2]).toEqual({ name: 'Carol', uid: 'c2', isCompanion: true });
    });

    test('group without self reg uses first reg userName as mainName', () => {
      // Edge case: all regs for a user are companions (no self)
      const regs = [
        { userId: 'u1', userName: 'AliceMain', participantType: 'companion', companionId: 'c1', companionName: 'Bob', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      // selfReg is undefined → mainName falls back to regs[0].userName
      expect(people).toHaveLength(2);
      expect(people[0].name).toBe('AliceMain'); // main from regs[0].userName
      expect(people[1].name).toBe('Bob');        // companion
    });

    test('multiple users with companions are all resolved', () => {
      const regs = [
        { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed' },
        { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'AliceComp', status: 'confirmed' },
        { userId: 'u2', userName: 'Bob', participantType: 'self', status: 'confirmed' },
        { userId: 'u2', userName: 'Bob', participantType: 'companion', companionId: 'c2', companionName: 'BobComp', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people).toHaveLength(4);
      const names = people.map(p => p.name);
      expect(names).toContain('Alice');
      expect(names).toContain('AliceComp');
      expect(names).toContain('Bob');
      expect(names).toContain('BobComp');
    });
  });

  describe('buildBaseRecord', () => {

    test('non-companion person uses own uid and name', () => {
      const person = { name: 'Alice', uid: 'u1', isCompanion: false };
      const record = buildBaseRecord(person, [], 'evt1');
      expect(record.uid).toBe('u1');
      expect(record.userName).toBe('Alice');
      expect(record.participantType).toBe('self');
      expect(record.companionId).toBeNull();
      expect(record.companionName).toBeNull();
    });

    test('companion person resolves parent userId from registration', () => {
      const person = { name: 'Bob', uid: 'comp1', isCompanion: true };
      const allRegs = [
        { userId: 'u1', userName: 'Alice', companionId: 'comp1', participantType: 'companion', status: 'confirmed' },
      ];
      const record = buildBaseRecord(person, allRegs, 'evt1');
      expect(record.uid).toBe('u1');           // parent userId
      expect(record.userName).toBe('Alice');    // parent userName
      expect(record.companionId).toBe('comp1');
      expect(record.companionName).toBe('Bob');
      expect(record.participantType).toBe('companion');
    });

    test('companion without matching registration keeps own uid', () => {
      const person = { name: 'Orphan', uid: 'orphan_uid', isCompanion: true };
      const record = buildBaseRecord(person, [], 'evt1');
      // No matching cReg found → falls through, keeps person.uid
      expect(record.uid).toBe('orphan_uid');
      expect(record.userName).toBe('Orphan');
      expect(record.participantType).toBe('self'); // not overridden
    });

    test('eventId is passed through to baseRecord', () => {
      const person = { name: 'Alice', uid: 'u1', isCompanion: false };
      const record = buildBaseRecord(person, [], 'event_abc');
      expect(record.eventId).toBe('event_abc');
    });
  });
});
