const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity create button', () => {
  test('activity page uses the same plus icon treatment as the home create button', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const homeHtml = readProjectFile('pages/home.html');
    const activityCss = readProjectFile('css/activity.css');

    expect(activityHtml).toContain('id="activity-create-btn"');
    expect(activityHtml).toContain('aria-label="＋我要開團"');
    expect(activityHtml).toContain('<path d="M12 5v14"></path>');
    expect(activityHtml).toContain('<path d="M5 12h14"></path>');
    expect(homeHtml).toContain('<path d="M12 5v14"></path>');
    expect(homeHtml).toContain('<path d="M5 12h14"></path>');
    expect(activityCss).toContain('#activity-create-btn svg');
    expect(activityCss).toContain('display: inline-flex');
    expect(activityCss).toContain('gap: .35rem');
  });
});
