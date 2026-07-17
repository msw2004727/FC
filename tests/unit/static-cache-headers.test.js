const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function listJavaScriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

describe('versioned static asset cache contract', () => {
  test.each(['/css/*', '/js/*', '/pages/*'])(
    '%s declares browser-immutable and Cloudflare edge no-store headers',
    route => {
      const source = read('_headers').replace(/\r\n/g, '\n');
      const routeStart = source.indexOf(`${route}\n`);
      const nextRoute = source.indexOf('\n/', routeStart + route.length);
      const block = source.slice(routeStart, nextRoute === -1 ? source.length : nextRoute);

      expect(routeStart).toBeGreaterThanOrEqual(0);
      expect(block).toContain('Cache-Control: public, max-age=31536000, immutable');
      expect(block).toContain('Cloudflare-CDN-Cache-Control: no-store');
    }
  );

  test('index exposes its canonical version before config and dynamic loaders run', () => {
    const source = read('index.html');
    const versionLine = source.indexOf("var V='");
    const exposureLine = source.indexOf('window.__SPORTHUB_INDEX_VERSION__=V;');
    const accessorLine = source.indexOf('window.getSportHubAssetVersion=function(){');
    const configScript = source.indexOf('js/config.js?v=');

    expect(versionLine).toBeGreaterThan(-1);
    expect(exposureLine).toBeGreaterThan(versionLine);
    expect(accessorLine).toBeGreaterThan(exposureLine);
    expect(accessorLine).toBeLessThan(configScript);
  });

  test('reviewed runtime version consumers recover through the canonical accessor', () => {
    const consumers = [
      'app.js',
      'js/core/page-loader.js',
      'js/core/script-loader.js',
      'js/modules/auto-exp.js',
      'js/modules/auto-exp-rules.js',
      'js/modules/kickball/kickball-game-page.js',
      'js/modules/shot-game/shot-game-page.js',
      'js/modules/team/team-list-helpers.js',
      'js/modules/user-admin/permission-audit/permission-audit.js',
    ];

    consumers.forEach(file => {
      expect(read(file)).toContain('getSportHubAssetVersion');
    });
    expect(read('index.html')).not.toContain('[VERSION MISMATCH]');
  });
});
