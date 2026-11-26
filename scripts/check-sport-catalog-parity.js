"use strict";
/**
 * 手動對照 FC-B sports.ts 與 functions/sport-catalog.js。
 * 用法：node scripts/check-sport-catalog-parity.js <FC-B repo 根目錄>
 */
const fs = require("fs");
const path = require("path");
const catalog = require("../functions/sport-catalog");

const SPORTS_TS_RE = /key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*sportTag:\s*'([^']+)'/g;

function usage() {
  console.error("用法：node scripts/check-sport-catalog-parity.js <FC-B repo 根目錄>");
  process.exit(2);
}

function main() {
  const root = process.argv[2];
  if (!root) usage();
  const file = path.join(root, "src", "features", "events", "data", "sports.ts");
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`讀不到檔案：${file}`);
    process.exit(1);
  }
  const parsed = [];
  let match;
  while ((match = SPORTS_TS_RE.exec(source)) !== null) {
    const [, key, label, sportTag] = match;
    if (key !== sportTag) {
      console.error(`key 與 sportTag 不一致：key=${key}, sportTag=${sportTag}`);
      process.exit(1);
    }
    parsed.push({ tag: sportTag, label });
  }
  if (parsed.length === 0) {
    console.error("在 sports.ts 找不到任何項目");
    process.exit(1);
  }
  const expected = catalog.SPORT_CATALOG.map((s) => ({ tag: s.tag, label: s.label }));
  if (parsed.length !== expected.length) {
    console.error(`數量不同：FC-B ${parsed.length} 項，server ${expected.length} 項`);
    process.exit(1);
  }
  let ok = true;
  for (let i = 0; i < expected.length; i += 1) {
    const a = parsed[i];
    const b = expected[i];
    if (a.tag !== b.tag || a.label !== b.label) {
      console.error(`第 ${i + 1} 項不同：FC-B {${a.tag}, ${a.label}}，server {${b.tag}, ${b.label}}`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(`OK ${expected.length} 項`);
}

main();
