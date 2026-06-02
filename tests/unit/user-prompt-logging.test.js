const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('user prompt logging wiring', () => {
  test('App.showToast classifies and records re-login related prompts', () => {
    const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    [appSource, indexSource].forEach(source => {
      expect(source).toContain('_getTrackableUserPromptInfo(message, options = {})');
      expect(source).toContain("err.code = 'user-prompt';");
      expect(source).toContain("logType: 'user_prompt'");
      expect(source).toContain("this.logUserPrompt?.(msg, { source: 'toast' });");
    });
  });

  test('re-login modal logs the exact session-expired prompt as a user prompt event', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/modules/profile/profile-form.js'), 'utf8');

    expect(source).toContain("fn: '_showReLoginPrompt'");
    expect(source).toContain("surface: 'relogin_modal'");
    expect(source).toContain("promptKey: reason || 'session_expired'");
    expect(source).toContain('\u60a8\u7684\u767b\u5165 session \u5df2\u904e\u671f\u6216\u4e0d\u540c\u6b65');
  });
});
