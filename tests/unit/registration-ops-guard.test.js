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

  test('registration ops guard script passes', () => {
    const output = execFileSync(process.execPath, ['scripts/check-registration-ops-guard.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toContain('registration ops guard: OK');
  });
});
