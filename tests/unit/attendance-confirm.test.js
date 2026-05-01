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
      const mainUid = regs[0].userId;

      if (selfReg) {
        const mainName = selfReg.userName;
        people.push({ name: mainName, uid: mainUid, isCompanion: false });
        addedNames.add(mainName);
      }

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
function isCompanionPseudoUid(value) {
  return String(value || '').trim().startsWith('comp_');
}

function findCompanionRegistrationForAttendance(person, allActiveRegs) {
  const safeUid = String(person?.uid || '').trim();
  const safeName = String(person?.name || '').trim();
  const companionRegs = (allActiveRegs || []).filter(r =>
    r && r.status !== 'cancelled' && r.status !== 'removed' && (r.participantType === 'companion' || r.companionId)
  );
  return companionRegs.find(r => String(r.companionId || '').trim() === safeUid)
    || (!isCompanionPseudoUid(safeUid)
      ? companionRegs.find(r => String(r.companionName || r.userName || '').trim() === safeName)
      : null)
    || null;
}

function buildBaseRecord(person, allActiveRegs, eventId) {
  const safeUid = String(person?.uid || '').trim();
  const safeName = String(person?.name || '').trim();
  const mustBeCompanion = !!person?.isCompanion || isCompanionPseudoUid(safeUid);

  if (mustBeCompanion) {
    const cReg = findCompanionRegistrationForAttendance(person, allActiveRegs);
    if (!cReg || !cReg.userId || isCompanionPseudoUid(cReg.userId)) {
      return { ok: false, reason: 'companion_registration_missing' };
    }
    return {
      ok: true,
      record: {
        eventId,
        uid: cReg.userId,
        userName: cReg.userName,
        participantType: 'companion',
        companionId: cReg.companionId || safeUid,
        companionName: cReg.companionName || safeName,
      },
    };
  }

  if (!safeUid || isCompanionPseudoUid(safeUid)) {
    return { ok: false, reason: 'invalid_self_uid' };
  }

  return {
    ok: true,
    record: { eventId, uid: safeUid, userName: safeName, participantType: 'self', companionId: null, companionName: null },
  };
}

function collectAttendanceOpsGuard(baseRecord) {
  if (isCompanionPseudoUid(baseRecord?.uid)) {
    return { adds: [], removes: [], grantExp: false, blocked: true, reason: 'companion_pseudo_uid_as_attendance_uid' };
  }
  return { adds: [{ ...baseRecord, type: 'checkin' }], removes: [], grantExp: false };
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

    test('group without self reg only includes companion seats', () => {
      // Edge case: all regs for a user are companions (owner did not sign up)
      const regs = [
        { userId: 'u1', userName: 'AliceMain', participantType: 'companion', companionId: 'c1', companionName: 'Bob', status: 'confirmed' },
      ];
      const people = buildPeopleList(regs, [], []);
      expect(people).toHaveLength(1);
      expect(people[0]).toEqual({ name: 'Bob', uid: 'c1', isCompanion: true });
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
      const resolved = buildBaseRecord(person, [], 'evt1');
      expect(resolved.ok).toBe(true);
      const record = resolved.record;
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
      const resolved = buildBaseRecord(person, allRegs, 'evt1');
      expect(resolved.ok).toBe(true);
      const record = resolved.record;
      expect(record.uid).toBe('u1');           // parent userId
      expect(record.userName).toBe('Alice');    // parent userName
      expect(record.companionId).toBe('comp1');
      expect(record.companionName).toBe('Bob');
      expect(record.participantType).toBe('companion');
    });

    test('companion without matching registration is blocked', () => {
      const person = { name: 'Orphan', uid: 'orphan_uid', isCompanion: true };
      const resolved = buildBaseRecord(person, [], 'evt1');
      expect(resolved.ok).toBe(false);
      expect(resolved.reason).toBe('companion_registration_missing');
    });

    test('comp_ pseudo uid resolves as companion even when stale map marks self', () => {
      const person = { name: 'Guest', uid: 'comp_1776681312140', isCompanion: false };
      const allRegs = [
        { userId: 'U1234567890abcdef1234567890abcdef', userName: 'Owner', companionId: 'comp_1776681312140', companionName: 'Guest', participantType: 'companion', status: 'confirmed' },
      ];
      const resolved = buildBaseRecord(person, allRegs, 'evt1');
      expect(resolved.ok).toBe(true);
      expect(resolved.record.uid).toBe('U1234567890abcdef1234567890abcdef');
      expect(resolved.record.participantType).toBe('companion');
      expect(resolved.record.companionId).toBe('comp_1776681312140');
    });

    test('comp_ pseudo uid without registration is blocked instead of self attendance', () => {
      const person = { name: 'Ghost', uid: 'comp_1776681312140', isCompanion: false };
      const resolved = buildBaseRecord(person, [], 'evt1');
      expect(resolved.ok).toBe(false);
      expect(resolved.reason).toBe('companion_registration_missing');
    });

    test('collect guard refuses comp_ as attendance uid', () => {
      const ops = collectAttendanceOpsGuard({
        eventId: 'evt1',
        uid: 'comp_1776681312140',
        userName: 'Guest',
        participantType: 'self',
      });
      expect(ops.blocked).toBe(true);
      expect(ops.adds).toHaveLength(0);
    });

    test('eventId is passed through to baseRecord', () => {
      const person = { name: 'Alice', uid: 'u1', isCompanion: false };
      const record = buildBaseRecord(person, [], 'event_abc').record;
      expect(record.eventId).toBe('event_abc');
    });
  });
});
