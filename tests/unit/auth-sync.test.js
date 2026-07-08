/**
 * Auth sync source contract tests.
 *
 * These tests guard the LINE profile -> Firebase Auth -> users/{uid} sync path.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('LINE/Firebase Auth sync contract', () => {
  test('expected LINE uid sign-in failures are surfaced before user document sync', () => {
    const serviceSource = readProjectFile('js/firebase-service.js');
    const crudSource = readProjectFile('js/firebase-crud.js');

    expect(serviceSource).toContain('_createFirebaseAuthSyncError');
    expect(serviceSource).toContain("'missing-liff-session'");
    expect(serviceSource).toContain("'missing-line-access-token'");
    expect(serviceSource).toContain('_waitForFirebaseAuthUid(expectedUid, 3000)');

    expect(crudSource).toContain('this._lastEnsureAuthError = null;');
    expect(crudSource).toContain('if (!authed || !authUid)');
    expect(crudSource).toContain("code: authSyncError.code || 'unauthenticated'");
    expect(crudSource).toContain('Firebase Auth unavailable for LINE user sync');
  });

  test('profile login asks for relogin on unauthenticated auth sync failure', () => {
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');

    expect(profileFormSource).toContain("code === 'unauthenticated'");
    expect(profileFormSource).toContain("msg.includes('firebase auth is not available')");
    expect(profileFormSource).toContain("this._showReLoginPrompt('session_expired')");
  });

  test('stale LINE profile without LIFF session is not treated as logged in', () => {
    const lineAuthSource = readProjectFile('js/line-auth.js');

    expect(lineAuthSource).toContain('if (this._profile !== null) {');
    expect(lineAuthSource).toContain('if (this.hasLiffSession()) return true;');
    expect(lineAuthSource).toContain('if (this._matchesFirebaseUid(this._profile)) return true;');
    expect(lineAuthSource).toContain('return this._matchesFirebaseCurrentUserCache();');
  });
});