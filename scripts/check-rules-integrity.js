#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./check-rules-integrity.lib.js');

const USAGE = 'Usage: node check-rules-integrity.js [--root <dir>] [--compare <backup.md>] [--nav] [--json]';

function parseArgs(argv) {
  const o = { root: null, compare: null, nav: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--compare') {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} requires a value`);
      if (a === '--root') o.root = v; else o.compare = v;
    } else if (a === '--nav') o.nav = true;
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

const mk = (id, level, title, summary, details) => ({ id, level, title, summary, details: details || [] });
const sum = d => `${d.length} issue(s)`;
const lv = d => (d.length ? 'FAIL' : 'PASS');

function runLint(workRoot, repoRoot, gitFiles) {
  const files = lib.loadRuleSet(workRoot);
  const checks = [];

  const { l1, l2 } = lib.checkL1L2(files);
  checks.push(mk('L1', lv(l1), 'Encoding', l1.length ? sum(l1) : `${files.length} files OK`, l1));
  checks.push(mk('L2', lv(l2), 'Mojibake', l2.length ? sum(l2) : 'none', l2));

  const l3 = lib.checkL3(files);
  checks.push(mk('L3', lv(l3.details), 'Rule ID definitions unique', l3.details.length ? sum(l3.details) : `${l3.defined.size} defined`, l3.details));

  const l4 = lib.checkL4(files, l3.defined);
  checks.push(mk('L4', lv(l4.details), 'Rule ID references', l4.details.length ? sum(l4.details) : 'all resolved', l4.details));

  const l5 = lib.checkL5(files);
  checks.push(mk('L5', lv(l5.details), 'Frontmatter valid', l5.details.length ? sum(l5.details) : 'all valid', l5.details));

  const l6 = lib.checkL6(files, repoRoot, workRoot, gitFiles, l5.results);
  checks.push(mk('L6', lv(l6.details), 'Globs match files', l6.details.length ? sum(l6.details) : 'all matched', l6.details));

  const l7 = lib.checkL7(files);
  checks.push(mk('L7', l7.level, 'CLAUDE.md length', l7.summary, l7.details));

  const l8 = lib.checkL8(files);
  checks.push(mk('L8', lv(l8.details), 'Rule file structure', l8.details.length ? sum(l8.details) : 'all OK', l8.details));

  const l9 = lib.checkL9(files);
  checks.push(mk('L9', lv(l9.details), 'Filename pattern', l9.details.length ? sum(l9.details) : 'all OK', l9.details));

  return { checks, files };
}

function runCompare(backupAbs, files) {
  const bl = lib.splitLines(fs.readFileSync(backupAbs, 'utf-8'));
  const idx = lib.buildNewIndex(files);
  const checks = [];

  const c1 = lib.checkC1(bl, idx);
  checks.push(mk('C1', lv(c1.details), 'Kept lines present', c1.details.length ? sum(c1.details) : 'all present', c1.details));

  const c2 = lib.checkC2(bl, idx);
  checks.push(mk('C2', lv(c2.details), 'Bullets/headings exactly once', c2.details.length ? sum(c2.details) : 'OK', c2.details));

  const c3 = lib.checkC3(bl, idx);
  checks.push(mk('C3', c3.level, 'New lines (manual review)', `${c3.count} new line(s)`, c3.details));

  const c4 = lib.checkC4(bl, idx);
  checks.push(mk('C4', lv(c4.details), 'Rule bullet count 278→279', c4.details.length ? sum(c4.details) : 'OK', c4.details));

  const c5 = lib.checkC5(bl, idx);
  checks.push(mk('C5', lv(c5.details), 'Headings map to files', c5.details.length ? sum(c5.details) : 'OK', c5.details));

  return checks;
}

function runNav(workRoot, repoRoot, gitFiles) {
  const navPath = path.join(workRoot, 'NAVIGATION.md');
  if (!fs.existsSync(navPath)) return { error: `NAVIGATION.md not found at ${navPath}` };
  const r = lib.checkNav(repoRoot, gitFiles, fs.readFileSync(navPath, 'utf-8'), workRoot);
  const details = r.details.map(d => `[${d.level}] ${d.text}`);
  return { checks: [mk('NAV', r.level, 'NAVIGATION.md paths', details.length ? sum(details) : 'all present', details)] };
}

function printHuman(checks) {
  let pass = 0, warn = 0, fail = 0;
  const out = [];
  for (const c of checks) {
    if (c.level === 'PASS') pass++; else if (c.level === 'WARN') warn++; else fail++;
    out.push(`[${c.level}] ${c.id} ${c.title} (${c.summary})`);
    // C3 is a manual-review list: always print it, even when PASS.
    if ((c.level !== 'PASS' || c.id === 'C3') && c.details.length) {
      const limit = c.id === 'C3' ? 150 : 50;
      for (const d of c.details.slice(0, limit)) out.push(`  - ${d}`);
      if (c.details.length > limit) out.push(`  ... (${c.details.length - limit} more)`);
    }
  }
  out.push(`SUMMARY: ${pass} pass, ${warn} warn, ${fail} fail`);
  console.log(out.join('\n'));
  return fail;
}

function printJson(checks) {
  let pass = 0, warn = 0, fail = 0;
  const arr = checks.map(c => {
    if (c.level === 'PASS') pass++; else if (c.level === 'WARN') warn++; else fail++;
    return { id: c.id, level: c.level, title: c.title, details: c.details };
  });
  console.log(JSON.stringify({ checks: arr, summary: { pass, warn, fail } }, null, 2));
  return fail;
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }

  const repoRoot = process.cwd();
  const workRoot = opts.root ? path.resolve(opts.root) : repoRoot;

  if (!fs.existsSync(path.join(workRoot, 'CLAUDE.md'))) {
    console.error(`Error: ${path.join(workRoot, 'CLAUDE.md')} not found`);
    console.error(USAGE);
    process.exit(2);
  }

  if (opts.compare && !fs.existsSync(path.resolve(opts.compare))) {
    console.error(`Error: backup not found: ${path.resolve(opts.compare)}`);
    process.exit(2);
  }

  const gitFiles = lib.getGitFiles(repoRoot);
  const lint = runLint(workRoot, repoRoot, gitFiles);
  let checks = lint.checks;

  if (opts.compare) checks = checks.concat(runCompare(path.resolve(opts.compare), lint.files));

  if (opts.nav) {
    const nav = runNav(workRoot, repoRoot, gitFiles);
    if (nav.error) { console.error(`Error: ${nav.error}`); process.exit(2); }
    checks = checks.concat(nav.checks);
  }

  const fail = opts.json ? printJson(checks) : printHuman(checks);
  process.exit(fail > 0 ? 1 : 0);
}

main();
