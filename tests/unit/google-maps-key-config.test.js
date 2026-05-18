const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('Google Maps browser key config', () => {
  test('does not commit a hard-coded Maps browser key', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
    const match = source.match(/const\s+GOOGLE_MAPS_BROWSER_API_KEY\s*=\s*['"]([^'"]*)['"]/);

    expect(match).not.toBeNull();
    expect(match[1]).toBe('');
    expect(source).not.toMatch(/GOOGLE_MAPS_BROWSER_API_KEY\s*=\s*['"]AIza[0-9A-Za-z_-]{20,}/);
  });

  test('uses a runtime config endpoint instead of committing the key', () => {
    const config = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
    const geo = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-map-geo.js'), 'utf8');
    const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
    const functionsIndex = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

    expect(config).toContain("runtimeConfigUrl: '/runtime-config.json'");
    expect(geo).toContain("root.fetch(runtimeConfigUrl");
    expect(worker).toContain('const RUNTIME_CONFIG_PATH = "/runtime-config.json"');
    expect(functionsIndex).toContain('const GOOGLE_MAPS_BROWSER_API_KEY = defineSecret("GOOGLE_MAPS_BROWSER_API_KEY")');
  });

  test('does not contain a committed Google API key in map runtime files', () => {
    [
      'js/config.js',
      'js/modules/event/event-map-geo.js',
      'js/modules/event/event-map.js',
      'js/modules/event/event-location-picker.js',
      '_worker.js',
      'functions/index.js',
      'sw.js',
    ].forEach(file => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    });
  });
});
