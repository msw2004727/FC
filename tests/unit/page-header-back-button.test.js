const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PAGES_DIR = path.join(ROOT, 'pages');

function readPage(file) {
  return fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
}

function extractSections(source) {
  return [...source.matchAll(/<section\b[^>]*id="([^"]+)"[\s\S]*?(?=<section\b|$)/g)]
    .map(match => ({ id: match[1], html: match[0] }));
}

function firstPageHeader(sectionHtml) {
  const match = sectionHtml.match(/<div class="page-header[^"]*"[\s\S]*?<\/div>/);
  return match ? match[0] : '';
}

describe('page header back buttons', () => {
  test('every static page header includes the shared circular back button', () => {
    const missing = [];
    const pageFiles = fs.readdirSync(PAGES_DIR).filter(file => file.endsWith('.html'));

    for (const file of pageFiles) {
      const sections = extractSections(readPage(file));
      for (const section of sections) {
        const header = firstPageHeader(section.html);
        if (!header) continue;
        if (!/class="[^"]*\bback-btn\b/.test(header)) {
          missing.push(`${file}#${section.id}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test('main navigation pages have a back button in their first visible header', () => {
    const expectedPages = [
      ['activity.html', 'page-activities'],
      ['team.html', 'page-teams'],
      ['tournament.html', 'page-tournaments'],
      ['message.html', 'page-messages'],
      ['profile.html', 'page-profile'],
    ];

    for (const [file, pageId] of expectedPages) {
      const section = extractSections(readPage(file)).find(item => item.id === pageId);
      expect(section).toBeTruthy();
      const header = firstPageHeader(section.html);
      expect(header).toContain('class="back-btn"');
      expect(header).toContain('onclick="App.goBack()"');
      expect(header).toContain('&#8249;');
    }
  });
});
