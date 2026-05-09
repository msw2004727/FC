const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('event create type sheet external link lock', () => {
  test('external activity link option stays visible but opens unavailable toast only', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');

    expect(source).toContain('id="cets-external" aria-disabled="true" data-feature-locked="true"');
    expect(source).toContain("externalBtn.style.display = 'flex'");
    expect(source).toContain("this.showToast('功能尚未開放')");
    expect(source).not.toContain('this.openCreateExternalEventModal();');
  });
});
