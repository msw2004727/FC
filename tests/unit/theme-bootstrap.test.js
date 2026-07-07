const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('Theme bootstrap', () => {
  test('index.html sets data-theme before render-blocking styles using the persisted key', () => {
    const index = readProjectFile('index.html');
    const bootstrap = index.match(/<script>\s*\(function\(\)\{[\s\S]+?document\.documentElement\.dataset\.theme = theme \|\| 'light';[\s\S]+?\}\)\(\);\s*<\/script>/);

    expect(bootstrap).toBeTruthy();
    expect(bootstrap[0]).toContain("localStorage.getItem('sporthub_theme')");
    expect(bootstrap[0]).toContain("saved === 'dark' || saved === 'light'");
    expect(bootstrap[0]).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  test('runtime bindTheme uses the same key and safe fallbacks', () => {
    const themeSource = readProjectFile('js/core/theme.js');

    expect(themeSource).toContain("localStorage.getItem('sporthub_theme')");
    expect(themeSource).toContain("raw === 'dark' || raw === 'light'");
    expect(themeSource).toContain("window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches");
    expect(themeSource).toContain("const themeToggle = document.getElementById('theme-toggle')");
    expect(themeSource).toContain('if (!themeToggle) return');
    expect(themeSource).toContain("localStorage.setItem('sporthub_theme', html.dataset.theme)");
  });
  test('top bar logo uses one data-theme switched image', () => {
    const index = readProjectFile('index.html');
    const themeSource = readProjectFile('js/core/theme.js');

    expect((index.match(/class="logo-img/g) || []).length).toBe(1);
    expect(index).toContain('id="top-logo-img"');
    expect(index).toContain('data-logo-light-webp="assets/logo-black.webp"');
    expect(index).toContain('data-logo-dark-webp="assets/logo-white.webp"');
    expect(index).not.toContain('logo-img--light');
    expect(index).not.toContain('logo-img--dark');
    expect(themeSource).toContain('_syncTopLogoForTheme()');
    expect(themeSource).toContain("document.getElementById('top-logo-img')");
    expect(themeSource).toContain('this._syncTopLogoForTheme();');
  });

});
