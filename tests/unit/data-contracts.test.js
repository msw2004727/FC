/**
 * Firestore Data Contract Validation
 *
 * Defines expected document schemas for key Firestore collections
 * and validates sample documents against them.
 * Catches field naming mismatches (e.g., uid vs userId)
 * and missing required fields before they reach production.
 */

// ===========================================================================
// Schema definitions
// ===========================================================================

/**
 * Validate a document against a schema.
 * Schema format: { field: { type, required, enum, oneOf } }
 */
function validateDoc(doc, schema, collectionName = '') {
  const errors = [];

  // Check required fields
  for (const [field, rule] of Object.entries(schema)) {
    if (rule.required && !(field in doc)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check field types and constraints
  for (const [field, value] of Object.entries(doc)) {
    const rule = schema[field];
    if (!rule) continue; // Extra fields are allowed (Firestore is schemaless)

    if (value === null || value === undefined) {
      if (rule.required) errors.push(`${field}: required but null/undefined`);
      continue;
    }

    // Type check
    if (rule.type) {
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (!types.includes(actualType)) {
        errors.push(`${field}: expected ${types.join('|')}, got ${actualType}`);
      }
    }

    // Enum check
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`${field}: "${value}" not in allowed values [${rule.enum.join(', ')}]`);
    }
  }

  return { valid: errors.length === 0, errors, collection: collectionName };
}

// ===========================================================================
// Collection schemas
// ===========================================================================

const schemas = {
  registration: {
    id:               { type: 'string', required: true },
    eventId:          { type: 'string', required: true },
    userId:           { type: 'string', required: true },
    userName:         { type: 'string', required: true },
    status:           { type: 'string', required: true, enum: ['confirmed', 'waitlisted', 'cancelled', 'removed'] },
    participantType:  { type: 'string', required: true, enum: ['self', 'companion'] },
    registeredAt:     { type: 'string', required: true },
    promotionOrder:   { type: 'number', required: false },
  },

  event: {
    id:         { type: 'string', required: false },
    title:      { type: 'string', required: true },
    date:       { type: 'string', required: false },
    max:        { type: 'number', required: false },
    current:    { type: 'number', required: false },
    waitlist:   { type: 'number', required: false },
    status:     { type: 'string', required: false, enum: ['open', 'full', 'ended', 'cancelled', 'upcoming'] },
    creatorUid: { type: 'string', required: false },
  },

  user: {
    uid:          { type: 'string', required: true },
    displayName:  { type: 'string', required: true },
    role:         { type: 'string', required: false, enum: ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'] },
  },

  attendanceRecord: {
    uid:          { type: 'string', required: true },
    eventId:      { type: 'string', required: true },
    checkInTime:  { type: 'string', required: false },
    status:       { type: 'string', required: false, enum: ['checked_in', 'checked_out', 'removed'] },
  },

  activityRecord: {
    uid:      { type: 'string', required: true },
    eventId:  { type: 'string', required: true },
    status:   { type: 'string', required: false, enum: ['registered', 'waitlisted', 'completed', 'cancelled', 'no_show'] },
  },

  expLog: {
    uid:      { type: 'string', required: true },
    amount:   { type: 'number', required: true },
    reason:   { type: 'string', required: false },
    time:     { type: 'string', required: false },
  },

  team: {
    name:       { type: 'string', required: true },
    captainUid: { type: 'string', required: false },
    creatorUid: { type: 'string', required: false },
  },

  invProduct: {
    name:      { type: 'string', required: true },
    stock:     { type: 'number', required: true },
    price:     { type: 'number', required: false },
    costPrice: { type: 'number', required: false },
    barcode:   { type: 'string', required: false },
  },

  invTransaction: {
    type:        { type: 'string', required: true, enum: ['in', 'out', 'return', 'adjust', 'void', 'waste', 'gift'] },
    quantity:    { type: 'number', required: true },
    barcode:     { type: 'string', required: false },
    operatorUid: { type: 'string', required: true },
  },

  eduAttendance: {
    teamId:     { type: 'string', required: true },
    studentId:  { type: 'string', required: true },
    date:       { type: 'string', required: true },
  },
};

// ===========================================================================
// TESTS
// ===========================================================================

describe('Registration schema', () => {
  test('valid confirmed registration', () => {
    const doc = {
      id: 'reg_001', eventId: 'evt1', userId: 'uid1', userName: 'Alice',
      status: 'confirmed', participantType: 'self',
      registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0,
    };
    const result = validateDoc(doc, schemas.registration, 'registrations');
    expect(result.valid).toBe(true);
  });

  test('valid waitlisted registration', () => {
    const doc = {
      id: 'reg_002', eventId: 'evt1', userId: 'uid2', userName: 'Bob',
      status: 'waitlisted', participantType: 'self',
      registeredAt: '2026-03-10T09:00:00Z',
    };
    expect(validateDoc(doc, schemas.registration).valid).toBe(true);
  });

  test('missing required userId fails', () => {
    const doc = {
      id: 'reg_003', eventId: 'evt1', userName: 'Anon',
      status: 'confirmed', participantType: 'self',
      registeredAt: '2026-03-10T08:00:00Z',
    };
    const result = validateDoc(doc, schemas.registration);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: userId');
  });

  test('invalid status value fails', () => {
    const doc = {
      id: 'reg_004', eventId: 'evt1', userId: 'uid1', userName: 'Alice',
      status: 'pending', participantType: 'self',
      registeredAt: '2026-03-10T08:00:00Z',
    };
    const result = validateDoc(doc, schemas.registration);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not in allowed values');
  });

  test('wrong type for userId fails', () => {
    const doc = {
      id: 'reg_005', eventId: 'evt1', userId: 12345, userName: 'Num',
      status: 'confirmed', participantType: 'self',
      registeredAt: '2026-03-10T08:00:00Z',
    };
    const result = validateDoc(doc, schemas.registration);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected string, got number');
  });

  test('companion type is valid', () => {
    const doc = {
      id: 'reg_006', eventId: 'evt1', userId: 'uid1', userName: 'Kid',
      status: 'confirmed', participantType: 'companion',
      registeredAt: '2026-03-10T08:00:00Z',
    };
    expect(validateDoc(doc, schemas.registration).valid).toBe(true);
  });
});

describe('Event schema', () => {
  test('valid event', () => {
    const doc = { title: 'Football Match', max: 20, current: 5, status: 'open' };
    expect(validateDoc(doc, schemas.event).valid).toBe(true);
  });

  test('missing title fails', () => {
    const doc = { max: 20 };
    expect(validateDoc(doc, schemas.event).valid).toBe(false);
  });

  test('invalid status fails', () => {
    const doc = { title: 'X', status: 'archived' };
    const result = validateDoc(doc, schemas.event);
    expect(result.valid).toBe(false);
  });
});

describe('User schema', () => {
  test('valid user', () => {
    const doc = { uid: 'u1', displayName: 'Alice', role: 'user' };
    expect(validateDoc(doc, schemas.user).valid).toBe(true);
  });

  test('missing uid fails', () => {
    const doc = { displayName: 'Anon' };
    expect(validateDoc(doc, schemas.user).valid).toBe(false);
  });

  test('invalid role fails', () => {
    const doc = { uid: 'u1', displayName: 'Hacker', role: 'root' };
    expect(validateDoc(doc, schemas.user).valid).toBe(false);
  });
});

describe('AttendanceRecord schema', () => {
  test('valid record uses uid (not displayName)', () => {
    const doc = { uid: 'u1', eventId: 'evt1', checkInTime: '2026-03-10T08:00:00Z', status: 'checked_in' };
    expect(validateDoc(doc, schemas.attendanceRecord).valid).toBe(true);
  });

  test('missing uid fails — catches historical displayName-as-uid bug', () => {
    const doc = { eventId: 'evt1', checkInTime: '2026-03-10T08:00:00Z' };
    const result = validateDoc(doc, schemas.attendanceRecord);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: uid');
  });
});

describe('ActivityRecord schema', () => {
  test('valid record', () => {
    const doc = { uid: 'u1', eventId: 'evt1', status: 'completed' };
    expect(validateDoc(doc, schemas.activityRecord).valid).toBe(true);
  });

  test('missing uid fails', () => {
    expect(validateDoc({ eventId: 'evt1' }, schemas.activityRecord).valid).toBe(false);
  });
});

describe('Inventory schemas', () => {
  test('valid product', () => {
    const doc = { name: 'Ball', stock: 10, price: 500, barcode: '123456' };
    expect(validateDoc(doc, schemas.invProduct).valid).toBe(true);
  });

  test('product missing name fails', () => {
    expect(validateDoc({ stock: 5 }, schemas.invProduct).valid).toBe(false);
  });

  test('valid transaction', () => {
    const doc = { type: 'out', quantity: 2, barcode: '123', operatorUid: 'u1' };
    expect(validateDoc(doc, schemas.invTransaction).valid).toBe(true);
  });

  test('invalid transaction type fails', () => {
    const doc = { type: 'sell', quantity: 1, operatorUid: 'u1' };
    expect(validateDoc(doc, schemas.invTransaction).valid).toBe(false);
  });

  test('transaction missing operatorUid fails', () => {
    const doc = { type: 'in', quantity: 5 };
    expect(validateDoc(doc, schemas.invTransaction).valid).toBe(false);
  });
});

describe('EduAttendance schema', () => {
  test('valid record', () => {
    const doc = { teamId: 't1', studentId: 's1', date: '2026-03-30' };
    expect(validateDoc(doc, schemas.eduAttendance).valid).toBe(true);
  });

  test('missing studentId fails', () => {
    expect(validateDoc({ teamId: 't1', date: '2026-03-30' }, schemas.eduAttendance).valid).toBe(false);
  });
});

describe('Cross-collection UID consistency', () => {
  test('registrations use userId, not uid', () => {
    expect('userId' in schemas.registration).toBe(true);
  });

  test('attendanceRecords use uid, not userId', () => {
    expect('uid' in schemas.attendanceRecord).toBe(true);
    expect('userId' in schemas.attendanceRecord).toBe(false);
  });

  test('activityRecords use uid, not userId', () => {
    expect('uid' in schemas.activityRecord).toBe(true);
    expect('userId' in schemas.activityRecord).toBe(false);
  });

  test('users use uid, not userId', () => {
    expect('uid' in schemas.user).toBe(true);
    expect('userId' in schemas.user).toBe(false);
  });

  test('expLogs use uid', () => {
    expect('uid' in schemas.expLog).toBe(true);
  });

  test('invTransactions use operatorUid', () => {
    expect('operatorUid' in schemas.invTransaction).toBe(true);
  });
});

describe('validateDoc utility', () => {
  test('extra fields do not cause failure', () => {
    const doc = { uid: 'u1', displayName: 'A', extraField: 'ok' };
    expect(validateDoc(doc, schemas.user).valid).toBe(true);
  });

  test('null value on non-required field is ok', () => {
    const doc = { uid: 'u1', displayName: 'A', role: null };
    expect(validateDoc(doc, schemas.user).valid).toBe(true);
  });

  test('null value on required field fails', () => {
    const doc = { uid: null, displayName: 'A' };
    const result = validateDoc(doc, schemas.user);
    expect(result.valid).toBe(false);
  });

  test('empty errors array when valid', () => {
    const doc = { uid: 'u1', displayName: 'A' };
    expect(validateDoc(doc, schemas.user).errors).toEqual([]);
  });
});
