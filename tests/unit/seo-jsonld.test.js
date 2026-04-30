const fs = require('fs');
const path = require('path');

function walkHtmlFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', '.claude', 'coverage', 'node_modules'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('SEO JSON-LD markup', () => {
  const root = path.resolve(__dirname, '..', '..');
  const htmlFiles = walkHtmlFiles(root).filter((file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    return rel === 'index.html'
      || rel === 'privacy.html'
      || rel === 'terms.html'
      || rel.startsWith('blog/')
      || rel.startsWith('seo/');
  });

  test.each(htmlFiles)('%s has parseable application/ld+json blocks', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const blocks = [...source.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

    for (const [index, block] of blocks.entries()) {
      expect(() => JSON.parse(block[1].trim())).not.toThrow(
        `${path.relative(root, file)} JSON-LD block ${index + 1} should be valid JSON`
      );
    }
  });
});
