#!/usr/bin/env node
'use strict';
/**
 * verify-bump.js — 驗證主站四處版號一致且 CACHE_NAME 含版號。
 *
 * 用法：
 *   node .claude/skills/release-bump/scripts/verify-bump.js [--json]
 *
 * 退出碼：0 通過、1 失敗、2 參數錯。只讀，不寫檔。
 */

const fs = require('fs');
const path = require('path');

const VERSION_RE = /^0\.\d{8}[a-z]*$/;
const USAGE = '用法: node .claude/skills/release-bump/scripts/verify-bump.js [--json]';

let json = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--json') json = true;
  else {
    console.error(USAGE);
    process.exit(2);
  }
}

function findRoot() {
  const starts = [process.cwd(), path.resolve(__dirname, '../../../..')];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'js/config.js')) &&
          fs.existsSync(path.join(dir, 'sw.js')) &&
          fs.existsSync(path.join(dir, 'index.html'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

const ROOT = findRoot();

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function lineOf(text, re) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

function lineFromIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

const failures = [];
const pass = [];
const manual = [];
const values = {
  configVersion: null,
  cacheName: null,
  cacheNameVersion: null,
  inlineV: null,
  assetQueries: []
};

let configText = '';
let swText = '';
let htmlText = '';
let configRead = false;
let swRead = false;
let htmlRead = false;

try { configText = readText('js/config.js'); configRead = true; }
catch (e) { failures.push('js/config.js:0: 無法讀取'); }
try { swText = readText('sw.js'); swRead = true; }
catch (e) { failures.push('sw.js:0: 無法讀取'); }
try { htmlText = readText('index.html'); htmlRead = true; }
catch (e) { failures.push('index.html:0: 無法讀取'); }

const configLine = lineOf(configText, /CACHE_VERSION/);
if (configRead) {
  const m = configText.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) failures.push(`js/config.js:${configLine || 0}: 找不到 CACHE_VERSION`);
  else values.configVersion = m[1];
}

const swLine = lineOf(swText, /CACHE_NAME/);
if (swRead) {
  const m = swText.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
  if (!m) failures.push(`sw.js:${swLine || 0}: 找不到 CACHE_NAME`);
  else {
    values.cacheName = m[1];
    const vm = m[1].match(/0\.\d{8}[a-z]*/);
    values.cacheNameVersion = vm ? vm[0] : null;
    if (!vm) failures.push(`sw.js:${swLine || 0}: CACHE_NAME 不含版號`);
  }
}

const inlineLine = lineOf(htmlText, /var\s+V\s*=/);
if (htmlRead) {
  const m = htmlText.match(/var\s+V\s*=\s*['"]([^'"]+)['"]/);
  if (!m) failures.push(`index.html:${inlineLine || 0}: 找不到 var V`);
  else values.inlineV = m[1];
}

const assetSeen = [];
let assetAny = false;
if (htmlRead) {
  // 與 scripts/bump-version.js 的 assetVersionPattern 一致：只認 app 版號格式的 ?v=，
  // 其他 query version（例如 og image 的 ?v=20260707）依 R-REL-003 不屬 bump 範圍，略過。
  const re = /\?v=(0\.\d{8}[a-z]*)/g;
  const htmlLines = htmlText.split('\n');
  let m;
  while ((m = re.exec(htmlText))) {
    assetAny = true;
    const value = m[1];
    const line = lineFromIndex(htmlText, m.index);
    const lineText = htmlLines[line - 1] || '';
    // CI 注入的 JSON 資料塊（<script type="application/json">）內的 URL 不是資產載入，只提醒不判失敗。
    if (/type="application\/json"/.test(lineText)) {
      const note = `index.html:${line}: JSON 資料塊內含 ?v=${value}（CI 注入資料，非資產載入，bump 時會一併改寫）`;
      if (!manual.includes(note)) manual.push(note);
      continue;
    }
    if (false) {
      manual.push(`index.html:${line}: JSON 資料塊內含 ?v=${value}（CI 注入資料，非資產載入，bump 時會一併改寫）`);
      continue;
    }
    if (!assetSeen.some(x => x.value === value)) assetSeen.push({ value, line });
  }
  if (!assetAny) failures.push('index.html:0: 找不到符合 app 版號格式的 ?v= asset query');
}
values.assetQueries = assetSeen.map(x => x.value);

function checkFormat(value, file, line, label) {
  if (value && !VERSION_RE.test(value)) failures.push(`${file}:${line || 0}: ${label} 格式不符: ${value}`);
}

checkFormat(values.configVersion, 'js/config.js', configLine, 'CACHE_VERSION');
checkFormat(values.cacheNameVersion, 'sw.js', swLine, 'CACHE_NAME 版號');
checkFormat(values.inlineV, 'index.html', inlineLine, 'var V');
for (const item of assetSeen) checkFormat(item.value, 'index.html', item.line, 'asset query');

const allVersions = [
  values.configVersion,
  values.cacheNameVersion,
  values.inlineV,
  ...values.assetQueries
].filter(Boolean);
const unique = [...new Set(allVersions)];
const present = Boolean(values.configVersion && values.cacheNameVersion && values.inlineV && values.assetQueries.length);
const consistent = present && allVersions.every(v => VERSION_RE.test(v)) && unique.length === 1;

if (values.configVersion) {
  if (values.cacheNameVersion && values.cacheNameVersion !== values.configVersion) {
    failures.push(`sw.js:${swLine || 0}: CACHE_NAME 版號 ${values.cacheNameVersion} 與 CACHE_VERSION ${values.configVersion} 不一致`);
  }
  if (values.inlineV && values.inlineV !== values.configVersion) {
    failures.push(`index.html:${inlineLine || 0}: var V ${values.inlineV} 與 CACHE_VERSION ${values.configVersion} 不一致`);
  }
  for (const item of assetSeen) {
    if (item.value !== values.configVersion) {
      failures.push(`index.html:${item.line}: asset query ${item.value} 與 CACHE_VERSION ${values.configVersion} 不一致`);
    }
  }
}

const expected = consistent ? unique[0] : values.configVersion;
const cacheNameHasVersion = Boolean(expected && values.cacheName && values.cacheName.includes(expected));

pass.push(`CACHE_VERSION=${values.configVersion || '(未取得)'}`);
pass.push(`CACHE_NAME=${values.cacheName || '(未取得)'}`);
pass.push(`CACHE_NAME 版號=${values.cacheNameVersion || '(未取得)'}`);
pass.push(`var V=${values.inlineV || '(未取得)'}`);
pass.push(`asset query=${values.assetQueries.length ? values.assetQueries.join(', ') : '(未取得)'}`);
pass.push(`四處一致=${consistent ? '是' : '否'}`);
pass.push(`CACHE_NAME 含版號=${cacheNameHasVersion ? '是' : '否'}`);

if (failures.length) {
  manual.push('先修正版號位置後重跑 verify-bump.js（R-REL-001～R-REL-009）。');
} else {
  pass.push('版號驗證通過。');
}
manual.push('push／deploy 仍需站長授權（R-SHIP-017）。');

const ok = failures.length === 0;
const out = {
  ok,
  values,
  consistent,
  cacheNameHasVersion,
  sections: { pass, fail: failures, manual }
};

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('通過');
  for (const line of pass) console.log(`- ${line}`);
  console.log('');
  console.log('失敗（列檔案:行號:原因）');
  if (failures.length) for (const line of failures) console.log(`- ${line}`);
  else console.log('- 無');
  console.log('');
  console.log('需人工（說明）');
  for (const line of manual) console.log(`- ${line}`);
}

process.exit(ok ? 0 : 1);
