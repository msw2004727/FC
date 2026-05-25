const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/event/event-create-view-model.js'),
  'utf8'
);

function loadContract() {
  const app = {};
  vm.runInNewContext(source, { App: app, document: {}, String, Array, Object, RegExp, console });
  return app;
}

describe('event create UI contract', () => {
  test('reports missing required ce-* DOM ids', () => {
    const app = loadContract();
    const present = new Set(['create-event-modal', 'ce-title']);
    const contract = app._getCreateEventDomContract({
      getElementById: (id) => present.has(id) ? { id } : null,
    });

    expect(contract.ok).toBe(false);
    expect(contract.ids).toContain('ce-submit-btn');
    expect(contract.missing).toContain('ce-submit-btn');
    expect(contract.missing).not.toContain('ce-title');
  });

  test('keeps the expected create/edit payload keys centralized', () => {
    const app = loadContract();
    const keys = app._getCreateEventPayloadContractKeys();

    expect(keys).toContain('teamOnly');
    expect(keys).toContain('creatorTeamIds');
    expect(keys).toContain('delegateUids');
    expect(keys).toContain('teamSplit');
    expect(keys).toContain('imageVariants');
  });

  test('renders image tags only for safe image URLs', () => {
    const app = loadContract();

    expect(app._renderSafeImageTag('javascript:alert(1)')).toBe('');
    expect(app._renderSafeImageTag('https://example.com/a.png', {
      className: 'preview',
      alt: '<bad>',
    })).toContain('src="https://example.com/a.png"');
    expect(app._renderSafeImageTag('https://example.com/a.png', {
      className: 'preview',
      alt: '<bad>',
    })).toContain('alt="&lt;bad&gt;"');
  });

  test('picks only payload contract keys from a source object', () => {
    const app = loadContract();
    const payload = app._pickCreateEventPayload({
      title: 'Match',
      teamOnly: true,
      unexpected: 'drop',
    });

    expect(payload).toEqual({ title: 'Match', teamOnly: true });
  });
});
