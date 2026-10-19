#!/usr/bin/env node
// FC-B 外包交件的機械檢查（只讀，不改任何檔案）。
// 用法：node check.mjs <stage 目錄（含 src/）> [FC-B 根目錄，預設 ../FC-B]
// 檢查：ASSUMPTION／TODO 清單、改到的既有檔（列出供人工看 diff）、7 語系既有 key 是否被改或刪、
//       CSS 變數是否都在 tokens.css 或本檔定義、硬編色碼、外部網址、`as never`、檔案編碼（BOM／CRLF／U+FFFD）。
import fs from 'node:fs';
import path from 'node:path';

const stage = path.resolve(process.argv[2] || '.');
const fcb = path.resolve(process.argv[3] || path.join(process.cwd(), '..', 'FC-B'));
const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'];
let problems = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => path.relative(stage, p).split(path.sep).join('/');
const files = walk(stage).filter((f) => /\.(ts|tsx|css|json|mjs|js|md)$/.test(f));
const flat = (o, p = '', r = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const kk = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, kk, r); else r[kk] = v;
  }
  return r;
};

console.log(`# 交件檢查：${stage}`);
console.log(`共 ${files.length} 個檔案`);

// 1. 改到的既有檔
const modified = files.filter((f) => fs.existsSync(path.join(fcb, rel(f))));
console.log(`\n## 改到既有檔（${modified.length}）— 逐一看 diff，確認沒有刪註解、沒有順手改無關邏輯`);
for (const f of modified) console.log(`- ${rel(f)}`);

// 2. ASSUMPTION / TODO
console.log('\n## ASSUMPTION／TODO — 逐條對照 A 原始碼核實，編造的常數或語意一律退回');
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/ASSUMPTION|TODO/.test(line)) console.log(`- ${rel(f)}:${i + 1} ${line.trim().slice(0, 140)}`);
  });
}

// 3. 語系
console.log('\n## 語系（既有 key 不得被改或刪）');
for (const f of files.filter((x) => /locales[\\/](zh-TW|zh-CN|en|ja|vi|th|ko)\.json$/.test(x))) {
  const orig = path.join(fcb, rel(f));
  const n = flat(JSON.parse(fs.readFileSync(f, 'utf8')));
  if (!fs.existsSync(orig)) { console.log(`- ${rel(f)}：新檔，${Object.keys(n).length} keys`); continue; }
  const o = flat(JSON.parse(fs.readFileSync(orig, 'utf8')));
  const changed = Object.keys(o).filter((k) => n[k] !== o[k]);
  if (changed.length) { problems += 1; console.log(`- ⚠ ${rel(f)} 改／刪既有 key：${changed.join(', ')}`); }
  else console.log(`- ${rel(f)}：既有 key 不變，新增 ${Object.keys(n).length - Object.keys(o).length}`);
}
const featureDirs = new Set(files.map((f) => rel(f).match(/^src\/features\/[^/]+\/locales\//)?.[0]).filter(Boolean));
for (const dir of featureDirs) {
  const have = LOCALES.filter((l) => fs.existsSync(path.join(stage, dir, `${l}.json`)));
  if (have.length !== LOCALES.length) { problems += 1; console.log(`- ⚠ ${dir} 只交了 ${have.join(',')}（7 語必須齊）`); }
}

// 4. CSS
const tokensPath = path.join(fcb, 'src/styles/tokens.css');
const tokens = new Set([...fs.readFileSync(tokensPath, 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
console.log('\n## CSS（變數必須在 tokens.css 或本檔定義；不得硬編色碼）');
for (const f of files.filter((x) => x.endsWith('.css'))) {
  const s = fs.readFileSync(f, 'utf8');
  const defs = new Set([...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const undef = [...new Set([...s.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !tokens.has(v) && !defs.has(v));
  const hex = s.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  if (undef.length || hex.length) problems += 1;
  console.log(`- ${rel(f)}：未定義 ${undef.join(' ') || '無'}；色碼 ${hex.length}`);
}

// 5. 其他紅旗
console.log('\n## 其他紅旗');
for (const f of files.filter((x) => /\.(ts|tsx)$/.test(x))) {
  const s = fs.readFileSync(f, 'utf8');
  const isTest = /\.test\.tsx?$/.test(f);
  if (!isTest && /as never/.test(s)) { problems += 1; console.log(`- ⚠ ${rel(f)} 用 as never 繞過型別（Callable request 要用契約型別）`); }
  if (!isTest && /https?:\/\/(?!localhost)/.test(s)) console.log(`- ${rel(f)} 含外部網址，確認不是 CDN 或第三方服務（R-SHARE-013）`);
  if (!isTest && /dangerouslySetInnerHTML/.test(s)) { problems += 1; console.log(`- ⚠ ${rel(f)} 使用 dangerouslySetInnerHTML`); }
}
for (const f of files) {
  const b = fs.readFileSync(f);
  const bad = [];
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bad.push('BOM');
  if (b.includes(0x0d)) bad.push('CRLF');
  if (b.toString('utf8').includes('�')) bad.push('U+FFFD');
  if (bad.length) { problems += 1; console.log(`- ⚠ ${rel(f)} 編碼：${bad.join(',')}`); }
}

console.log(`\n結果：${problems ? `${problems} 項需處理` : '機械檢查通過'}（語意仍要逐項對照 A）`);
process.exit(0);
