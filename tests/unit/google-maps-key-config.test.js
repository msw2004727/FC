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
});
