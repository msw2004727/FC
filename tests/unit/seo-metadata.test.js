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

function attrFromTag(tag, attrName) {
  const match = tag && tag.match(new RegExp(`${attrName}=["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : null;
}

function firstTag(source, pattern) {
  const match = source.match(pattern);
  return match ? match[0] : null;
}

function metaName(source, name) {
  return attrFromTag(firstTag(source, new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, 'i')), 'content');
}

function metaProperty(source, property) {
  return attrFromTag(firstTag(source, new RegExp(`<meta\\s+property=["']${property}["'][^>]*>`, 'i')), 'content');
}

function linkRel(source, rel) {
  return attrFromTag(firstTag(source, new RegExp(`<link\\s+rel=["']${rel}["'][^>]*>`, 'i')), 'href');
}

function alternateHref(source, hreflang) {
  const tag = firstTag(source, new RegExp(`<link\\s+rel=["']alternate["'][^>]*hreflang=["']${hreflang}["'][^>]*>`, 'i'));
  return attrFromTag(tag, 'href');
}

function normalizeUrl(url) {
  return url === 'https://toosterx.com' ? 'https://toosterx.com/' : url;
}

describe('SEO metadata coverage', () => {
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

  test.each(htmlFiles)('%s has complete indexable metadata', (file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    const title = source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = metaName(source, 'description');
    const canonical = linkRel(source, 'canonical');
    const ogUrl = metaProperty(source, 'og:url');

    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
    expect(canonical).toMatch(/^https:\/\/toosterx\.com\//);
    expect(normalizeUrl(ogUrl)).toBe(normalizeUrl(canonical));
    expect(normalizeUrl(alternateHref(source, 'zh-TW'))).toBe(normalizeUrl(canonical));
    expect(normalizeUrl(alternateHref(source, 'x-default'))).toBe(normalizeUrl(canonical));

    if (rel.startsWith('seo/') || rel.startsWith('blog/')) {
      expect(canonical).not.toMatch(/\.html$/);
      expect(ogUrl).not.toMatch(/\.html$/);
    }

    for (const property of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:locale', 'og:site_name']) {
      expect(metaProperty(source, property)).toBeTruthy();
    }

    expect(metaName(source, 'twitter:card')).toBe('summary_large_image');
    for (const name of ['twitter:title', 'twitter:description', 'twitter:image']) {
      expect(metaName(source, name)).toBeTruthy();
    }

    const jsonLdBlocks = source.match(/<script\s+type=["']application\/ld\+json["'][^>]*>/gi) || [];
    expect(jsonLdBlocks.length).toBeGreaterThan(0);
  });
});
