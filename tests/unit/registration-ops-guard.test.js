const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('registration ops guard', () => {
  test('Cloud Functions contain proactive registration health monitoring', () => {
    const source = read('functions/index.js');

    expect(source).toContain('REGISTRATION_CALLABLE_NAMES');
    expect(source).toContain('"registerForEvent", "cancelRegistration"');
    expect(source).toContain('REGISTRATION_ERROR_LOG_CONTEXTS');
    expect(source).toContain('"handleSignup"');
    expect(source).toContain('"_confirmCompanionRegister"');
    expect(source).toContain('"_confirmCompanionCancel"');
    expect(source).toContain('findRegistrationErrorLogs');
    expect(source).toContain('notifyOpsRecipients');
    expect(source).toContain('exports.watchRegistrationCallableHealth');
    expect(source).toContain('schedule: "*/15 * * * *"');
  });

  test('Cloud Functions contain read-only synthetic registration smoke checks', () => {
    const source = read('functions/index.js');

    expect(source).toContain('REGISTRATION_SYNTHETIC_SMOKE_DOC_ID');
    expect(source).toContain('executeRegistrationSyntheticSmoke');
    expect(source).toContain('config.mode !== "dry_run"');
    expect(source).toContain('getEventDocByPublicId(config.eventId)');
    expect(source).toContain('eventDoc.ref.collection("registrations").limit(25).get()');
    expect(source).toContain('findUserDocByUidOrLineUserId(config.smokeUid)');
    expect(source).toContain('SMOKE_USER_NOT_FOUND');
    expect(source).toContain('SMOKE_PROFILE_INCOMPLETE');
    expect(source).toContain('SMOKE_REG_NOT_OPEN');
    expect(source).toContain('exports.registrationSyntheticSmoke');
    expect(source).toContain('exports.runRegistrationSyntheticSmoke');
    expect(source).toContain('if (!access.isSuperAdmin)');
  });

  test('deployment sync guard is wired into CI and functions deployment', () => {
    expect(read('package.json')).toContain('"check:registration-ops"');
    expect(read('.github/workflows/test.yml')).toContain('npm run check:registration-ops');

    const deployWorkflow = read('.github/workflows/deploy-functions.yml');
    expect(deployWorkflow).toContain('functions/**');
    expect(deployWorkflow).toContain('npm run check:registration-ops');
    expect(deployWorkflow).toContain('npm run test:functions');
    expect(deployWorkflow).toContain('firebase deploy --only functions --project fc-football-6c8dc');
    expect(deployWorkflow).toContain('GCP_SERVICE_ACCOUNT_JSON');
  });

  test('course lesson conversion phase 1 guards are wired', () => {
    const source = read('functions/index.js');

    expect(source).toContain('const COURSE_LINK_SOURCE_EDU_LESSON = "eduCourseLesson";');
    expect(source).toContain('COURSE_LINK_STATE_CREATED_BY_COURSE');
    expect(source).toContain('COURSE_LINK_STATE_PRIORITY_OVERLAY');
    expect(source).toContain('exports.createEventFromCourseLesson');
    expect(source).toContain('exports.syncCourseLessonRosterToEvent');
    expect(source).toContain('async function syncCourseAttendanceToLinkedEvent');
    expect(source).toContain('eventRef.collection("management").doc(COURSE_LINK_MANAGEMENT_DOC_ID)');
    expect(source).toContain('const linkRef = planRef.collection("sessionEventLinks").doc(sessionId);');
    expect(source).toContain('minAge: 0');
    expect(source).toContain('image: null');
    expect(source).toContain('genderRestrictionEnabled: false');
    expect(source).toContain('gpsEnabled: false');
    expect(source).toContain('privateEvent: true');
    expect(source).toContain('assertOrdinaryEventRegistrationAllowed(ed);');
    expect(source).toContain('assertCourseLinkedRegistrationNotManagedByCourse(permissionCheckRegs);');
    expect(source).toContain('COURSE_LINKED_EVENT_PRIVATE_REGISTRATION');
    expect(source).toContain('COURSE_LINKED_REGISTRATION_MANAGED_BY_COURSE');
    expect(source).toContain('source: "saveEduCourseSelfAttendance"');
    expect(source).toContain('source: "saveEduCourseSelfLeave"');
    expect(source).toContain('phase: "phase2_roster_sync"');
    expect(source).toContain('findLatestDisplaceableConfirmedRegistration');
    expect(source).toContain('courseLinkedRegistrationDocId');
    expect(source).toContain('getCourseLinkedRegistrationKey(reg)');
    expect(source).not.toContain('reason: "phase1_skeleton"');

    const crudSource = read('js/firebase-crud.js');
    expect(crudSource).toContain('_isCourseLinkedRegistrationData');
    expect(crudSource).toContain('return `course_student_${courseStudentId}`');
    expect(crudSource).toContain('return `course_${encode(courseStudentId)}`');
    expect(crudSource).toContain('excludeCourseLinkedCandidates: this._isCourseLinkedEventData(event)');
    expect(crudSource).toContain('!excludeCourseLinkedCandidates || !this._isCourseLinkedRegistrationData(r)');
    expect(crudSource).toContain('_hasCourseLinkedActivityRecordData');
    expect(crudSource).toContain('_findActivityRecordsForRegistration');
    expect(crudSource).toContain("this._findActivityRecordsForRegistration(eventActivityRecords, candidate, 'waitlisted')");
    expect(crudSource).toContain("this._findActivityRecordsForRegistration(ars, candidate, 'waitlisted')");
    expect(crudSource).toContain("this._findActivityRecordsForRegistration(eventActivityRecords, item, 'waitlisted')[0]");
    expect(crudSource).toContain('const selfRegistrationKey = this._getRegistrationUniqueKey({');
    expect(crudSource).toContain('selfEntryKeys.has(this._getRegistrationUniqueKey(r))');
    expect(crudSource).not.toContain('r => r.eventId === eventId && r.userId === userId');
    expect(crudSource).not.toContain('r.userId === mainUserId');
    expect(crudSource).not.toContain("a.uid === candidate.userId && a.status === 'waitlisted'");
    expect(crudSource).not.toContain("a.eventId === eventId && a.uid === item.userId && a.status === 'waitlisted'");

    const rulesSource = read('firestore.rules');
    expect(rulesSource).toContain('!isPrivateCourseLinkedEventData(resource.data)');
    expect(rulesSource).toContain('&& isSignupFieldsOnly()');
  });
  test('registration ops guard script passes', () => {
    const output = execFileSync(process.execPath, ['scripts/check-registration-ops-guard.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toContain('registration ops guard: OK');
  });
});
