const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('dashboard region distribution limit', () => {
  test('renders only the top regions first and expands in 5-item batches', () => {
    const source = readFile('js/modules/dashboard/dashboard.js');

    expect(source).toContain('_dashRegionVisibleLimit: 3');
    expect(source).toContain('rows.slice(0, visibleLimit)');
    expect(source).toContain('+ 5');
    expect(source).toContain('id="dash-region-list"');
    expect(source).toContain('dash-region-more-btn');
  });
});
