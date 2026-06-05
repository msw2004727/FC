const {
  buildCourseEnrollmentPayload,
  dateStringInTimeZone,
  decideCoursePlanApproval,
  decideCoursePlanRegistration,
  getApprovedStudentIdSet,
} = require('../../functions/edu-course-enrollment-core');

const basePlan = {
  id: 'planA',
  active: true,
  allowSignup: true,
  visibleOnTeamPage: true,
  maxCapacity: 2,
  endDate: '2099-12-31',
};

const studentA = { id: 'stuA', name: 'Alice', selfUid: 'uidA', enrollStatus: 'pending', groupIds: [] };
const studentB = { id: 'stuB', name: 'Bob', parentUid: 'uidA', enrollStatus: 'pending', groupIds: [] };
const studentC = { id: 'stuC', name: 'Carol', selfUid: 'uidC', enrollStatus: 'pending', groupIds: [] };

function studentMap(students) {
  return new Map(students.map(student => [student.id, student]));
}

describe('edu course enrollment core decisions', () => {
  test('allows caller to register owned self and child students', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [],
      studentsById: studentMap([studentA, studentB]),
      requestedStudentIds: ['stuA', 'stuB'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(true);
    expect(result.acceptedStudentIds).toEqual(['stuA', 'stuB']);
  });

  test('rejects hidden course plan for non-staff registration', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, visibleOnTeamPage: false },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
      isStaff: false,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_HIDDEN');
  });

  test('allows staff to register against hidden course plan', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, visibleOnTeamPage: false },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'staffUid',
      isStaff: true,
    });

    expect(result.ok).toBe(true);
  });

  test('rejects inactive course plan registration', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, active: false },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_INACTIVE');
  });

  test('rejects closed signup registration', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, allowSignup: false },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('SIGNUP_CLOSED');
  });

  test('rejects ended course plan registration', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, endDate: '2026-01-01' },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
      now: new Date('2026-06-05T00:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_ENDED');
  });

  test('uses Taipei date when checking ended course plan registration', () => {
    expect(dateStringInTimeZone(new Date('2026-06-05T16:30:00.000Z'))).toBe('2026-06-06');
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, endDate: '2026-06-05' },
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
      now: new Date('2026-06-05T16:30:00.000Z'),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_ENDED');
  });

  test('rejects missing requested student', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['missingStudent'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('STUDENT_NOT_FOUND');
  });

  test('rejects non-owned student for regular user', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [],
      studentsById: studentMap([studentC]),
      requestedStudentIds: ['stuC'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('STUDENT_FORBIDDEN');
  });

  test('rejects inactive student registration', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [],
      studentsById: studentMap([{ ...studentA, enrollStatus: 'inactive' }]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('STUDENT_INACTIVE');
  });

  test('rejects duplicate active enrollment but ignores rejected enrollment', () => {
    const duplicate = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'pending' }],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
    });
    const rejected = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'rejected' }],
      studentsById: studentMap([studentA]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
    });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.code).toBe('ALREADY_ENROLLED');
    expect(rejected.ok).toBe(true);
  });

  test('rejects registration for virtual group-approved student before migration completes', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, groupId: 'groupA', maxCapacity: 3 },
      enrollments: [],
      studentsById: studentMap([{ ...studentA, enrollStatus: 'active', groupIds: ['groupA'] }]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
      migrationCompleted: false,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ALREADY_ENROLLED');
  });

  test('allows former group student to register after migration flag removes virtual enrollment', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, groupId: 'groupA', maxCapacity: 3 },
      enrollments: [],
      studentsById: studentMap([{ ...studentA, enrollStatus: 'active', groupIds: ['groupA'] }]),
      requestedStudentIds: ['stuA'],
      callerUid: 'uidA',
      migrationCompleted: true,
    });

    expect(result.ok).toBe(true);
  });

  test('registration rejects when approved capacity is already full', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [
        { id: 'enr1', studentId: 'stuA', status: 'approved' },
        { id: 'enr2', studentId: 'stuB', status: 'approved' },
      ],
      studentsById: studentMap([studentC]),
      requestedStudentIds: ['stuC'],
      callerUid: 'uidC',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COURSE_FULL');
  });

  test('registration rejects when batch would overflow remaining capacity', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'approved' }],
      studentsById: studentMap([studentB, studentC]),
      requestedStudentIds: ['stuB', 'stuC'],
      callerUid: 'staffUid',
      isStaff: true,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COURSE_FULL');
    expect(result.approvedCount).toBe(1);
  });

  test('registration allows exactly remaining capacity', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, maxCapacity: 3 },
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'approved' }],
      studentsById: studentMap([studentB, studentC]),
      requestedStudentIds: ['stuB', 'stuC'],
      callerUid: 'staffUid',
      isStaff: true,
    });

    expect(result.ok).toBe(true);
    expect(result.acceptedStudentIds).toEqual(['stuB', 'stuC']);
  });

  test('staff registration still respects capacity unless bypass is explicit', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'approved' }],
      studentsById: studentMap([studentB, studentC]),
      requestedStudentIds: ['stuB', 'stuC'],
      callerUid: 'staffUid',
      isStaff: true,
      bypassCapacity: false,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COURSE_FULL');
  });

  test('staff registration can explicitly bypass capacity', () => {
    const result = decideCoursePlanRegistration({
      plan: basePlan,
      enrollments: [{ id: 'enr1', studentId: 'stuA', status: 'approved' }],
      studentsById: studentMap([studentB, studentC]),
      requestedStudentIds: ['stuB', 'stuC'],
      callerUid: 'staffUid',
      isStaff: true,
      bypassCapacity: true,
    });

    expect(result.ok).toBe(true);
    expect(result.capacityBypassed).toBe(true);
  });

  test('zero capacity means unlimited registration', () => {
    const result = decideCoursePlanRegistration({
      plan: { ...basePlan, maxCapacity: 0 },
      enrollments: [
        { id: 'enr1', studentId: 'stuA', status: 'approved' },
        { id: 'enr2', studentId: 'stuB', status: 'approved' },
      ],
      studentsById: studentMap([studentC]),
      requestedStudentIds: ['stuC'],
      callerUid: 'uidC',
    });

    expect(result.ok).toBe(true);
  });

  test('approval rejects when capacity is full', () => {
    const result = decideCoursePlanApproval({
      plan: basePlan,
      enrollments: [
        { id: 'enrA', studentId: 'stuA', status: 'approved' },
        { id: 'enrB', studentId: 'stuB', status: 'approved' },
        { id: 'enrC', studentId: 'stuC', status: 'pending' },
      ],
      students: [studentA, studentB, studentC],
      enrollmentId: 'enrC',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COURSE_FULL');
  });

  test('approval returns alreadyApproved for approved enrollment', () => {
    const result = decideCoursePlanApproval({
      plan: basePlan,
      enrollments: [{ id: 'enrA', studentId: 'stuA', status: 'approved' }],
      students: [studentA],
      enrollmentId: 'enrA',
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyApproved).toBe(true);
  });

  test('approval rejects non-pending enrollment status', () => {
    const result = decideCoursePlanApproval({
      plan: basePlan,
      enrollments: [{ id: 'enrA', studentId: 'stuA', status: 'rejected' }],
      students: [studentA],
      enrollmentId: 'enrA',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ENROLLMENT_NOT_PENDING');
  });

  test('approval capacity count ignores target pending enrollment', () => {
    const result = decideCoursePlanApproval({
      plan: { ...basePlan, maxCapacity: 1 },
      enrollments: [{ id: 'enrA', studentId: 'stuA', status: 'pending' }],
      students: [studentA],
      enrollmentId: 'enrA',
    });

    expect(result.ok).toBe(true);
    expect(result.approvedCount).toBe(0);
  });

  test('group virtual approved count is included until migration flag is complete', () => {
    const plan = { ...basePlan, groupId: 'groupA', maxCapacity: 3 };
    const students = [
      { ...studentA, enrollStatus: 'active', groupIds: ['groupA'] },
      { ...studentB, enrollStatus: 'active', groupIds: ['groupA'] },
      { ...studentC, enrollStatus: 'active', groupIds: ['groupB'] },
    ];

    expect(getApprovedStudentIdSet({ plan, enrollments: [], students, migrationCompleted: false }).size).toBe(2);
    expect(getApprovedStudentIdSet({ plan, enrollments: [], students, migrationCompleted: true }).size).toBe(0);
  });

  test('group virtual approved count dedupes real enrollment', () => {
    const plan = { ...basePlan, groupId: 'groupA', maxCapacity: 3 };
    const students = [
      { ...studentA, enrollStatus: 'active', groupIds: ['groupA'] },
      { ...studentB, enrollStatus: 'active', groupIds: ['groupA'] },
    ];
    const enrollments = [{ id: 'enrA', studentId: 'stuA', status: 'approved' }];

    expect(getApprovedStudentIdSet({ plan, enrollments, students, migrationCompleted: false }).size).toBe(2);
  });

  test('group virtual approved count supports student doc id fallback', () => {
    const plan = { ...basePlan, groupId: 'groupA', maxCapacity: 3 };
    const students = [{ _docId: 'stuDocA', name: 'Doc Student', enrollStatus: 'active', groupIds: ['groupA'] }];

    expect(Array.from(getApprovedStudentIdSet({ plan, enrollments: [], students, migrationCompleted: false }))).toEqual(['stuDocA']);
  });

  test('buildCourseEnrollmentPayload keeps pending status and caller linkage', () => {
    const payload = buildCourseEnrollmentPayload({
      id: 'enrA',
      student: studentA,
      callerUid: 'uidA',
      nowIso: '2026-06-05T00:00:00.000Z',
    });

    expect(payload).toMatchObject({
      id: 'enrA',
      studentId: 'stuA',
      studentName: 'Alice',
      selfUid: 'uidA',
      status: 'pending',
      createdByUid: 'uidA',
    });
  });

  test('buildCourseEnrollmentPayload preserves parent-only child linkage', () => {
    const payload = buildCourseEnrollmentPayload({
      id: 'enrChild',
      student: studentB,
      callerUid: 'uidA',
      nowIso: '2026-06-05T00:00:00.000Z',
    });

    expect(payload).toMatchObject({
      studentId: 'stuB',
      selfUid: null,
      parentUid: 'uidA',
      createdByUid: 'uidA',
    });
  });

  test('buildCourseEnrollmentPayload falls back to student document id', () => {
    const payload = buildCourseEnrollmentPayload({
      id: 'enrDoc',
      student: { _docId: 'stuDocA', name: 'Doc Student', selfUid: 'uidDoc' },
      callerUid: 'uidDoc',
      nowIso: '2026-06-05T00:00:00.000Z',
    });

    expect(payload.studentId).toBe('stuDocA');
  });
});
