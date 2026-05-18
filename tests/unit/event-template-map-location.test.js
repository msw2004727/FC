const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('event template map location integration', () => {
  test('normal event templates save and restore confirmed map coordinates', () => {
    const source = readProjectFile('js/modules/event/event-create-template.js');

    expect(source).toContain("const locationPayload = this._buildEventLocationTemplatePayload?.('ce', location, { gpsEnabled: !!gpsData.enabled }) || {};");
    expect(source).toContain('...locationPayload,');
    expect(source).toContain("this._restoreEventLocationTemplateDraft?.('ce', canUseAddons && templateGpsEnabled ? tpl : { location: tpl.location, mapLocationConfirmed: false });");
  });

  test('external event templates save and restore confirmed map coordinates', () => {
    const source = readProjectFile('js/modules/event/event-create-external.js');

    expect(source).toContain("const locationPayload = this._buildEventLocationTemplatePayload?.('cee', location) || {};");
    expect(source).toContain('...locationPayload,');
    expect(source).toContain("this._restoreEventLocationTemplateDraft?.('cee', tpl);");
  });
});
