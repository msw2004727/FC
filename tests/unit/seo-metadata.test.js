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

  function readRel(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  }

  test.each(htmlFiles)('%s has complete indexable metadata', (file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    const title = source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = metaName(source, 'description');
    const canonical = linkRel(source, 'canonical');
    const ogUrl = metaProperty(source, 'og:url');

    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(canonical).toMatch(/^https:\/\/toosterx\.com\//);
    expect(normalizeUrl(ogUrl)).toBe(normalizeUrl(canonical));
    expect(normalizeUrl(alternateHref(source, 'zh-TW'))).toBe(normalizeUrl(canonical));
    expect(normalizeUrl(alternateHref(source, 'x-default'))).toBe(normalizeUrl(canonical));

    if (rel.startsWith('seo/') || rel.startsWith('blog/') || rel === 'privacy.html' || rel === 'terms.html') {
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

  test('homepage exposes the Taichung football community SEO entrance to no-JS crawlers', () => {
    expect(readRel('index.html')).toContain('href="/seo/taichung-football-community"');
  });

  test.each([
    'seo/football.html',
    'seo/football-taichung.html',
    'blog/taichung-football-field-rental-guide.html',
    'blog/adult-football-beginner-guide.html',
    'blog/football-rules.html',
  ])('%s links to the Taichung football community page', (rel) => {
    expect(readRel(rel)).toContain('href="/seo/taichung-football-community"');
  });

  test('Taichung football community page links back to the field rental guide', () => {
    expect(readRel('seo/taichung-football-community.html')).toContain('href="/blog/taichung-football-field-rental-guide"');
  });

  test.each([
    'blog/community/index.html',
    'blog/taichung-pickleball-pickup-guide.html',
    'blog/adult-football-beginner-guide.html',
    'blog/taichung-badminton-pickup-guide.html',
    'blog/taichung-basketball-pickup-guide.html',
  ])('%s has a visible optimized article image', (rel) => {
    const source = readRel(rel);
    const figure = source.match(/<figure\s+class=["']article-hero-image["'][\s\S]*?<\/figure>/i)?.[0];
    expect(figure).toBeTruthy();

    const imgTag = firstTag(figure, /<img\s+[^>]*>/i);
    const src = attrFromTag(imgTag, 'src');
    const alt = attrFromTag(imgTag, 'alt');
    const width = Number(attrFromTag(imgTag, 'width'));
    const height = Number(attrFromTag(imgTag, 'height'));

    expect(src).toMatch(/^\/img\/seo\/[^"']+\.jpg$/);
    expect(fs.existsSync(path.join(root, src.replace(/^\//, '')))).toBe(true);
    expect(alt).toMatch(/\S{6,}/);
    expect(width).toBeGreaterThanOrEqual(600);
    expect(height).toBeGreaterThanOrEqual(300);
    expect(attrFromTag(imgTag, 'loading')).toBe('lazy');
    expect(attrFromTag(imgTag, 'decoding')).toBe('async');
  });
});
