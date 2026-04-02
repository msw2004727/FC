#!/usr/bin/env node
/**
 * bump-version.js — 一行指令同步更新全部 4 個版號位置
 *
 * 用法：
 *   node scripts/bump-version.js          → 自動遞增後綴 (a→b, z→za, zz→zza)
 *   node scripts/bump-version.js 20260403a → 指定版號
 *
 * 更新位置：
 *   1. js/config.js        — CACHE_VERSION
 *   2. sw.js               — CACHE_NAME
 *   3. index.html           — var V='...'
 *   4. index.html           — 所有 ?v=... 參數
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}
function writeFile(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf-8');
}

// 從 config.js 讀取當前版號
function getCurrentVersion() {
  const src = readFile('js/config.js');
  const m = src.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('CACHE_VERSION not found in js/config.js');
  return m[1];
}

// 遞增後綴：a→b, z→za, zz→zza, 無後綴→a
function incrementVersion(ver) {
  const m = ver.match(/^(\d{8})(.*)$/);
  if (!m) throw new Error('Invalid version format: ' + ver);
  const date = m[1];
  const suffix = m[2];

  if (!suffix) return date + 'a';

  // 遞增：a→b, y→z, z→za, zz→zza（全 z 時延伸一位）
  const chars = suffix.split('');
  let i = chars.length - 1;
  while (i >= 0 && chars[i] === 'z') i--;

  if (i >= 0) {
    // 找到非 z 字元，遞增它，後面的 z 全變 a
    chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    for (let j = i + 1; j < chars.length; j++) chars[j] = 'a';
    return date + chars.join('');
  }
  // 全部是 z → 延伸一位：z→za, zz→zza
  return date + suffix + 'a';
}

// 主流程
const oldVer = getCurrentVersion();
const newVer = process.argv[2] || incrementVersion(oldVer);

console.log(`Bumping version: ${oldVer} → ${newVer}`);

// 1. js/config.js
let config = readFile('js/config.js');
config = config.replace(
  /CACHE_VERSION\s*=\s*'[^']+'/,
  `CACHE_VERSION = '${newVer}'`
);
writeFile('js/config.js', config);

// 2. sw.js
let sw = readFile('sw.js');
sw = sw.replace(
  /CACHE_NAME\s*=\s*'sporthub-[^']+'/,
  `CACHE_NAME       = 'sporthub-${newVer}'`
);
writeFile('sw.js', sw);

// 3+4. index.html — var V + 所有 ?v=
let html = readFile('index.html');
html = html.replace(
  /var V='[^']+'/,
  `var V='${newVer}'`
);
const vCount = (html.match(new RegExp('\\?v=' + oldVer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
html = html.replace(
  new RegExp('\\?v=' + oldVer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
  '?v=' + newVer
);
writeFile('index.html', html);

console.log(`  config.js  ✓`);
console.log(`  sw.js      ✓`);
console.log(`  index.html ✓ (var V + ${vCount} ?v= params)`);
console.log(`Done.`);
