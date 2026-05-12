const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('user profile card action buttons', () => {
  test('reserved actions show unavailable toast instead of being disabled', () => {
    const source = readProjectFile('js/modules/profile/profile-core.js');
    const actionPanel = source.slice(source.indexOf('_buildUserCardActionPanel'));

    expect(actionPanel).toContain("App.showToast('功能尚未開放')");
    expect(actionPanel).toContain('>加好友</button>');
    expect(actionPanel).toContain('>私訊</button>');
    expect(actionPanel).toContain('class="uc-action-btn uc-action-btn-pm"');
    expect(actionPanel).toContain('>關注</button>');
    expect(actionPanel).not.toContain('disabled>加好友');
    expect(actionPanel).not.toContain('disabled>私訊');
    expect(actionPanel).not.toContain('disabled>關注');
    expect(actionPanel).not.toContain('aria-hidden="true"');
  });
});
