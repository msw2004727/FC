const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bannerSource = fs.readFileSync(path.join(root, 'js/modules/banner.js'), 'utf8');

describe('boot image loading', () => {
  test('boot inline data does not globally preload home-only images', () => {
    for (const source of [appSource, indexSource]) {
      expect(source).not.toContain('data-boot-banner-preload');
      expect(source).not.toContain('data-home-priority-image');
      expect(source).not.toContain('_preloadHomePriorityImages');
    }
  });

  test('home banner still prioritizes the visible first slide when rendered', () => {
    expect(bannerSource).toContain('data-banner-priority="${idx === 0 ? \'high\' : \'normal\'}"');
    expect(bannerSource).toContain("img.fetchPriority = priority === 'high' ? 'high' : 'low'");
  });
});
