#!/usr/bin/env node
/**
 * bump-version.js — 一行指令同步更新全部 4 個版號位置
 *
 * 版號格式：0.YYYYMMDD{suffix}
 *   例：0.20260422 → 0.20260422a → 0.20260422b → ...
 *   跨日會自動重置為今天無後綴（0.新日期）
 *
 * 用法：
 *   node scripts/bump-version.js            → 自動遞增（跨日重置、同日遞增後綴）
 *   node scripts/bump-version.js 0.20260422a → 指定版號
 *
 * 更新位置：
 *   1. js/config.js        — CACHE_VERSION
 *   2. sw.js               — CACHE_NAME
 *   3. index.html          — var V='...'
 *   4. index.html          — 所有 ?v=... 參數
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

// 取得今天的台北日期（YYYYMMDD 格式）
function getTodayTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return y + m + d;
}

// 版號格式：0.YYYYMMDD{suffix}
//   例：0.20260422 → 0.20260422a → 0.20260422b → ... → 0.20260422z → 0.20260422za
// 規則：
//   1. 若 existing 非此格式（舊格式 YYYYMMDDx）→ 重置為今天無後綴（0.YYYYMMDD）
//   2. 若 existing 日期 < 今天 → 重置為今天無後綴
//   3. 若 existing 日期 == 今天 → 遞增後綴
function incrementVersion(ver) {
  const today = getTodayTaipei();
  const m = ver.match(/^0\.(\d{8})([a-z]*)$/);

  // 不符新格式 → 升級為新格式（重置為今天無後綴）
  if (!m) {
    console.log(`  ℹ 舊版號格式 "${ver}" 升級為新格式 0.YYYYMMDD`);
    return `0.${today}`;
  }

  const date = m[1];
  const suffix = m[2];

  // 今天 > existing 日期 → 重置為今天無後綴
  if (today > date) return `0.${today}`;
  if (today < date) {
    console.warn(`⚠ 今天 ${today} 比版號日期 ${date} 還舊（時區或系統時間異常？），沿用舊日期遞增`);
  }

  // 同天 → 遞增後綴
  if (!suffix) return `0.${date}a`;

  // 遞增：a→b, y→z, z→za, zz→zza（全 z 時延伸一位）
  const chars = suffix.split('');
  let i = chars.length - 1;
  while (i >= 0 && chars[i] === 'z') i--;

  if (i >= 0) {
    // 找到非 z 字元，遞增它，後面的 z 全變 a
    chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    for (let j = i + 1; j < chars.length; j++) chars[j] = 'a';
    return `0.${date}${chars.join('')}`;
  }
  // 全部是 z → 延伸一位：z→za, zz→zza
  return `0.${date}${suffix}a`;
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
