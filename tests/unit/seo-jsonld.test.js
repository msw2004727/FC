const fs = require('fs');
const path = require('path');

function readRel(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

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

function parseJsonLdBlocks(source) {
  return [...source.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((block) => JSON.parse(block[1].trim()));
}

function asArray(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}

function rootJsonLdNodes(block) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block['@graph'])) return block['@graph'];
  return [block];
}

function rootJsonLdTypes(blocks) {
  return blocks.flatMap((block) => rootJsonLdNodes(block))
    .flatMap((node) => asArray(node['@type']));
}

function rootNodeOfType(blocks, type) {
  return blocks.flatMap((block) => rootJsonLdNodes(block))
    .find((node) => asArray(node['@type']).includes(type));
}

describe('SEO JSON-LD markup', () => {
  const root = path.resolve(__dirname, '..', '..');
  const htmlFiles = walkHtmlFiles(root).filter((file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    return rel === 'index.html'
      || rel === 'privacy.html'
      || rel === 'terms.html'
      || rel.startsWith('blog/')
      || rel.startsWith('roles/')
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

  test.each([
    {
      rel: 'blog/community/index.html',
      requiredTypes: ['BreadcrumbList', 'CollectionPage'],
      forbiddenRootTypes: ['Article'],
    },
    {
      rel: 'blog/adult-football-beginner-guide.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'blog/taichung-badminton-pickup-guide.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'blog/taichung-basketball-pickup-guide.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'blog/taichung-pickleball-pickup-guide.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'blog/taichung-football-field-rental-guide.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'blog/football-rules.html',
      requiredTypes: ['BreadcrumbList', 'Article', 'FAQPage'],
      dateModified: '2026-06-27',
    },
    {
      rel: 'seo/taichung-football-community.html',
      requiredTypes: ['BreadcrumbList', 'WebPage', 'ItemList', 'FAQPage'],
    },
  ])('$rel keeps expected root JSON-LD types and modified date', ({ rel, requiredTypes, forbiddenRootTypes = [], dateModified }) => {
    const blocks = parseJsonLdBlocks(readRel(root, rel));
    const types = rootJsonLdTypes(blocks);

    expect(types).toEqual(expect.arrayContaining(requiredTypes));
    for (const type of forbiddenRootTypes) {
      expect(types).not.toContain(type);
    }

    if (dateModified) {
      const article = rootNodeOfType(blocks, 'Article');
      expect(article).toBeTruthy();
      expect(article.dateModified).toBe(dateModified);
      expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.dateModified >= article.datePublished).toBe(true);
    }
  });
});
