#!/usr/bin/env node
'use strict';
/**
 * check-encoding.js — 檢查文字檔編碼與常見 mojibake。
 *
 * 用法：
 *   node .claude/skills/encoding-check/scripts/check-encoding.js [--json] <file...>
 *
 * 退出碼：0 通過、1 失敗、2 參數錯。只讀，不寫檔。
 */

const fs = require('fs');
const path = require('path');

const USAGE = '用法: node .claude/skills/encoding-check/scripts/check-encoding.js [--json] <file...>';
const CR_EXTS = new Set(['.md', '.js', '.css', '.html', '.json', '.rules', '.yml']);
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4']);
const TEXT_EXTS = new Set(['.md', '.js', '.css', '.html', '.htm', '.json', '.rules', '.yml', '.yaml', '.txt', '.xml', '.svg', '.py', '.sh', '.ps1', '.ts', '.tsx', '.jsx', '.toml', '.ini', '.env']);
const MOJI_RE = /[\uFFFD\uE000-\uF8FF]/;
const Q_RE = /\?{3,}/;
const DOUBLE_RE = /[Ãåæ][\u0080-\u00FF]/;

let json = false;
const files = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--json') json = true;
  else if (arg === '--help') { console.log(USAGE); process.exit(0); }
  else if (arg.startsWith('-')) { console.error(`未知參數: ${arg}`); console.error(USAGE); process.exit(2); }
  else files.push(arg);
}
if (!files.length) { console.error(USAGE); process.exit(2); }

function lineFromIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function isBinary(buf, ext) {
  if (BINARY_EXTS.has(ext)) return true;
  if (TEXT_EXTS.has(ext)) return false;
  const end = Math.min(buf.length, 8000);
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
  return false;
}

const pass = [];
const fail = [];
const manual = ['終端亂碼不等於檔案損壞（R-ENC-005）。'];
const results = [];

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    fail.push(`${file}:0: 無法讀取`);
    results.push({ path: file, ok: false, issues: [{ line: 0, reason: '無法讀取' }] });
    continue;
  }

  if (isBinary(buf, ext)) {
    pass.push(`${file}: 二進位檔，跳過`);
    results.push({ path: file, ok: true, binary: true, skipped: true, issues: [] });
    continue;
  }

  const issues = [];
  const add = (line, reason) => issues.push({ line, reason });

  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) add(1, 'BOM');

  let text = '';
  let utf8ok = true;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    utf8ok = false;
    add(1, '非合法 UTF-8');
    text = new TextDecoder('utf-8').decode(buf);
  }

  if (CR_EXTS.has(ext)) {
    const cr = text.indexOf('\r');
    // CR 只提醒：本機 checkout 可能因 core.autocrlf 而是 CRLF，commit 時會正規化為 LF；
    // 真正要擋的是 BOM／非 UTF-8／mojibake。
    if (cr !== -1) manual.push(`${file}:${lineFromIndex(text, cr)}: 包含 CR（CRLF），commit 前確認 git 會正規化為 LF`);
  }

  if (utf8ok) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const plain = lines[i].replace(/`[^`]*`/g, '');
      if (MOJI_RE.test(plain)) add(i + 1, 'mojibake 字元');
      if (Q_RE.test(plain)) add(i + 1, '連續 ???');
      if (DOUBLE_RE.test(plain)) add(i + 1, '典型雙重編碼模式');
    }
  }

  if (issues.length) {
    for (const issue of issues) fail.push(`${file}:${issue.line}: ${issue.reason}`);
    results.push({ path: file, ok: false, issues });
  } else {
    pass.push(`${file}: OK`);
    results.push({ path: file, ok: true, issues: [] });
  }
}

const ok = fail.length === 0;
const out = {
  ok,
  sections: { pass, fail, manual },
  results
};

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('通過');
  if (pass.length) for (const line of pass) console.log(`- ${line}`);
  else console.log('- 無');
  console.log('');
  console.log('失敗（列檔案:行號:原因）');
  if (fail.length) for (const line of fail) console.log(`- ${line}`);
  else console.log('- 無');
  console.log('');
  console.log('需人工（說明）');
  for (const line of manual) console.log(`- ${line}`);
}

process.exit(ok ? 0 : 1);
