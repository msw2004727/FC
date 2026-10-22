#!/usr/bin/env node
'use strict';
/**
 * select-tests.js — 依變更檔案選出去重後的測試／檢查命令。
 *
 * 用法：
 *   node .claude/skills/test-matrix/scripts/select-tests.js [--json] [files...]
 *   printf '%s\n' file1 file2 | node .../select-tests.js [--json]
 *
 * 退出碼：0 成功、1 失敗、2 參數錯。只讀，不寫檔。
 */

const fs = require('fs');
const USAGE = '用法: node .claude/skills/test-matrix/scripts/select-tests.js [--json] [files...]';

let json = false;
const files = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--json') json = true;
  else if (arg === '--help') { console.log(USAGE); process.exit(0); }
  else if (arg.startsWith('-')) { console.error(`未知參數: ${arg}`); console.error(USAGE); process.exit(2); }
  else files.push(arg);
}

if (!files.length && !process.stdin.isTTY) {
  const text = fs.readFileSync(0, 'utf8');
  for (const line of text.split(/\r?\n/)) if (line.trim()) files.push(line.trim());
}
if (!files.length) {
  console.error('需要檔案清單');
  console.error(USAGE);
  process.exit(2);
}

const norm = files.map(f => f.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean);
const some = (pred) => norm.some(pred);

// 2026-10-22 T-008：加入 Pages 託管檔與 bump 腳本（原本選不出任何測試，worker 封鎖／hosting／bump 測試都在 test:unit）
const hosting = some(f => f === '_worker.js' || f === '_routes.json' || f === '_headers' || f === '404.html' || f === 'scripts/bump-version.js');
const unit = hosting || some(f => f.startsWith('js/') || f.startsWith('css/') || f.startsWith('pages/') || f === 'index.html' || f === 'app.js' || f === 'sw.js');
const ui = some(f => f.startsWith('css/') || f.startsWith('pages/') || f === 'index.html');
const lockedSet = new Set([
  'js/firebase-crud.js',
  'js/firebase-service.js',
  'js/api-service.js',
  'js/modules/event/event-detail-signup.js',
  'js/modules/event/event-detail-companion.js',
  'js/modules/event/event-create-waitlist.js',
  'js/modules/event/event-manage-noshow.js',
  'js/modules/event/event-manage-confirm.js',
  'js/modules/achievement/stats.js',
  'js/modules/leaderboard.js',
  'js/modules/education/edu-course-enrollment.js',
  'functions/index.js',
  'functions/edu-course-enrollment-core.js'
]);
const locked = some(f => lockedSet.has(f));
const rules = some(f => f === 'firestore.rules' || f === 'storage.rules' || f.startsWith('tests/firestore-rules/'));
const functions = some(f => f.startsWith('functions/'));
const rulesDocs = some(f => f === 'CLAUDE.md' || f === 'AGENTS.md' || f === 'GEMINI.md' || f === 'NAVIGATION.md' || f.startsWith('.claude/rules/'));
const nav = some(f => f === 'NAVIGATION.md');
const seo = some(f => f.startsWith('seo/') || /^sitemap[^/]*\.xml$/.test(f) || f === 'robots.txt' || f === '_headers' || f.startsWith('blog/'));

const commands = [];
const add = (cmd) => { if (!commands.includes(cmd)) commands.push(cmd); };
if (unit || functions || seo) add('npm run test:unit');
if (locked) add('npm run check:registration-ops');
if (rules) add('npm run test:rules');
if (functions) add('npm run test:functions');
if (rulesDocs) add(nav ? 'node scripts/check-rules-integrity.js --nav' : 'node scripts/check-rules-integrity.js');

const notes = [];
if (ui) notes.push('需 UI 瀏覽器驗證（R-QA-010～013）');
if (locked) notes.push('鎖定檔（R-EXEC-016／R-STAT-001）');
if (rules) notes.push('tests/firestore-rules/tournament-match-rules.test.js 未被 aggregate 收錄（R-QA-008）');
if (functions) notes.push('test:functions 只跑 tests/unit/cloud-functions.test.js（R-QA-009）');

const pass = commands.length ? commands.map(cmd => `建議命令：${cmd}`) : ['無 runtime test'];
const fail = [];
const manual = notes.length ? notes : ['無'];

const out = {
  ok: true,
  commands,
  notes,
  sections: { pass, fail, manual },
  flags: { unit, ui, locked, rules, functions, rulesDocs, nav, seo },
  files: norm
};

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('通過');
  for (const line of pass) console.log(`- ${line}`);
  console.log('');
  console.log('失敗（列檔案:行號:原因）');
  console.log('- 無');
  console.log('');
  console.log('需人工（說明）');
  for (const line of manual) console.log(`- ${line}`);
}

process.exit(0);
