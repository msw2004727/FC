'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// §3.1 whitelist lines (1-9, 200-224) — skipped in --compare
const WHITELIST_SET = new Set();
for (let i = 1; i <= 9; i++) WHITELIST_SET.add(i);
for (let i = 200; i <= 224; i++) WHITELIST_SET.add(i);

// §3.2 C5 heading prefix → target file
const C5_MAP = {
  '## 0.': 'CLAUDE.md', '### 0.1': 'CLAUDE.md', '### 0.2': 'CLAUDE.md', '### 0.3': 'CLAUDE.md',
  '## 1.': 'CLAUDE.md', '### 1.1': 'CLAUDE.md', '### 1.2': 'CLAUDE.md',
  '## 2.': 'CLAUDE.md', '### 2.1': 'CLAUDE.md', '### 2.2': 'CLAUDE.md',
  '## 3.': 'CLAUDE.md', '### 3.1': 'CLAUDE.md', '### 3.2': 'CLAUDE.md', '### 3.3': 'CLAUDE.md', '### 3.4': 'CLAUDE.md',
  '## 4.': 'CLAUDE.md', '### 4.3': 'CLAUDE.md', '## 5.': 'CLAUDE.md', '## 8.': 'CLAUDE.md',
  '## 15.': 'CLAUDE.md', '### 15.1': 'CLAUDE.md', '## 16.': 'CLAUDE.md', '## 18.': 'CLAUDE.md',
  '### 4.1': 'architecture-tunables.md', '### 4.2': 'architecture-tunables.md',
  '## 6.': 'release-sw.md', '### 6.1': 'release-sw.md', '### 6.2': 'release-sw.md',
  '## 7.': 'testing-review.md', '### 7.1': 'testing-review.md', '### 7.2': 'testing-review.md',
  '## 9.': 'id-permissions.md', '### 9.1': 'id-permissions.md', '### 9.2': 'id-permissions.md', '### 9.3': 'id-permissions.md',
  '## 10.': 'events-registration-stats.md', '### 10.1': 'events-registration-stats.md', '### 10.2': 'events-registration-stats.md', '### 10.3': 'events-registration-stats.md', '### 10.4': 'events-registration-stats.md',
  '## 11.': 'firestore-functions.md', '### 11.1': 'firestore-functions.md', '### 11.2': 'firestore-functions.md',
  '## 12.': 'navigation-history.md', '### 12.1': 'navigation-history.md', '### 12.2': 'navigation-history.md',
  '## 13.': 'share.md',
  '## 14.': 'ui.md', '### 14.1': 'ui.md', '### 14.2': 'ui.md',
  '### 15.2': 'seo.md',
  '## 17.': 'governance-migration.md',
};

const matchGlob = (f, g) => (path.posix.matchesGlob || path.matchesGlob)(f, g);
const splitLines = t => { const a = t.split(/\r?\n/); if (a.length && a[a.length - 1] === '') a.pop(); return a; };
const readText = f => fs.readFileSync(f, 'utf-8');

function normalizeLine(line) {
  const t = line.trimEnd();
  if (t.trim() === '' || /^\|[\s:|-]+\|$/.test(t)) return null;
  return t;
}

function walkDir(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, base, out);
    else if (e.isFile() && e.name.endsWith('.md')) {
      out.push({ rel: path.relative(base, full).split(path.sep).join('/'), abs: full, isRule: true, basename: e.name });
    }
  }
}

function loadRuleSet(root) {
  const files = [];
  const claude = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claude)) files.push({ rel: 'CLAUDE.md', abs: claude, isRule: false, basename: 'CLAUDE.md' });
  const rulesDir = path.join(root, '.claude', 'rules');
  if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) walkDir(rulesDir, root, files);
  return files;
}

function getGitFiles(repoRoot) {
  try {
    return execSync('git ls-files', { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch (e) { console.error(`warning: git ls-files failed (${e.message.split('\n')[0]}); glob checks will rely on the working tree only`); return []; }
}

// L1 + L2
function checkL1L2(files) {
  const l1 = [], l2 = [];
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) l1.push(`${f.rel}: BOM at start`);
    try { dec.decode(buf); } catch (e) { l1.push(`${f.rel}: invalid UTF-8`); }
    if (buf.includes(0x0D)) l1.push(`${f.rel}: contains CR`);
    const lines = splitLines(readText(f.abs));
    for (let i = 0; i < lines.length; i++) {
      // Inline code spans may legitimately quote mojibake samples (e.g. R-ENC-004); skip them.
      const plain = lines[i].replace(/`[^`]*`/g, '');
      if (/[\uFFFD\uE000-\uF8FF]/.test(plain)) l2.push(`${f.rel}:${i + 1}: mojibake char`);
      if (/\?{3,}/.test(plain)) l2.push(`${f.rel}:${i + 1}: ??? sequence`);
    }
  }
  return { l1, l2 };
}

// L3
function extractDefinitions(text) {
  const out = [], lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \*\*(R-[A-Z]+-\d{3}) \[/);
    if (m) out.push({ id: m[1], line: i + 1 });
  }
  return out;
}

function checkL3(files) {
  const defined = new Map();
  for (const f of files) for (const d of extractDefinitions(readText(f.abs))) {
    if (!defined.has(d.id)) defined.set(d.id, []);
    defined.get(d.id).push({ file: f.rel, line: d.line });
  }
  const details = [];
  for (const [id, locs] of defined) if (locs.length > 1)
    details.push(`${id}: ${locs.length}x (${locs.map(l => `${l.file}:${l.line}`).join(', ')})`);
  return { details, defined };
}

// L4
// A range such as R-UI-001～025 means "the IDs defined within that interval" (CLAUDE.md §5 convention),
// so interior gaps are allowed: only the two endpoints must be defined. Single IDs must be defined.
function extractRefs(text) {
  const ids = new Set(), ranges = [], invalid = [];
  const rr = /(R-[A-Z]+)-(\d{3})[～~-](?:(R-[A-Z]+)-(\d{3})|(\d{1,4}))/g;
  const ir = /R-[A-Z]+-\d{3}/g;
  let m;
  const stripped = text.replace(rr, (full, p, s, p2, e2, e1) => {
    const start = parseInt(s, 10);
    const end = p2 ? (p2 === p ? parseInt(e2, 10) : NaN) : parseInt(e1, 10);
    if (!Number.isNaN(end) && end >= start && end - start <= 1000) {
      ranges.push({ a: `${p}-${String(start).padStart(3, '0')}`, b: `${p}-${String(end).padStart(3, '0')}`, text: full });
      return ' ';
    }
    invalid.push(full);
    return ' ';
  });
  while ((m = ir.exec(stripped))) ids.add(m[0]);
  return { ids, ranges, invalid };
}

function checkL4(files, defined) {
  const all = new Set(), details = [], seenRange = new Set();
  for (const f of files) {
    const { ids, ranges, invalid } = extractRefs(readText(f.abs));
    for (const id of ids) all.add(id);
    for (const bad of invalid) details.push(`${f.rel}: invalid range syntax "${bad}" (reversed or cross-prefix)`);
    for (const r of ranges) {
      if (seenRange.has(r.text)) continue;
      seenRange.add(r.text);
      if (!defined.has(r.a)) details.push(`${r.text}: range start ${r.a} not defined`);
      if (!defined.has(r.b)) details.push(`${r.text}: range end ${r.b} not defined`);
    }
  }
  for (const id of all) if (!defined.has(id)) details.push(`${id}: referenced but not defined`);
  return { details };
}

// L5
function parseFrontmatter(text) {
  const lines = splitLines(text);
  if (!lines.length || lines[0].trim() !== '---') return { ok: false, reason: 'no leading ---' };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { endIdx = i; break; }
  if (endIdx === -1) return { ok: false, reason: 'no closing ---' };
  let paths = null;
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^paths:\s*$/.test(line)) {
      if (paths !== null) return { ok: false, reason: 'duplicate paths key' };
      paths = []; continue;
    }
    if (paths !== null) {
      const m = line.match(/^\s+-\s+"([^"]*)"\s*$/);
      if (m) { paths.push(m[1]); continue; }
    }
    return { ok: false, reason: `unexpected line ${i + 1}: ${line}` };
  }
  if (!paths) return { ok: false, reason: 'missing paths key' };
  if (!paths.length) return { ok: false, reason: 'empty paths list' };
  if (paths.some(p => !p)) return { ok: false, reason: 'empty path item' };
  return { ok: true, paths };
}

function checkL5(files) {
  const details = [], results = new Map();
  for (const f of files) {
    if (!f.isRule) continue;
    const r = parseFrontmatter(readText(f.abs));
    results.set(f.rel, r);
    if (!r.ok) details.push(`${f.basename}: ${r.reason}`);
  }
  return { details, results };
}

// L6
function hasAnyMd(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) return true;
    if (e.isDirectory() && hasAnyMd(path.join(dir, e.name))) return true;
  }
  return false;
}

function checkL6(files, repoRoot, workRoot, gitFiles, fmResults) {
  const details = [];
  for (const f of files) {
    if (!f.isRule) continue;
    const fm = fmResults.get(f.rel);
    if (!fm || !fm.ok) continue;
    for (const glob of fm.paths) {
      let matched;
      if (glob === '.claude/rules/**') {
        matched = hasAnyMd(path.join(repoRoot, '.claude', 'rules'))
          || hasAnyMd(path.join(workRoot, '.claude', 'rules'))
          || gitFiles.some(g => matchGlob(g, glob));
      } else if (!/[*?[\]]/.test(glob)) {
        matched = fs.existsSync(path.join(repoRoot, glob)) || fs.existsSync(path.join(workRoot, glob));
      } else {
        matched = gitFiles.some(g => matchGlob(g, glob));
      }
      if (!matched) details.push(`${f.basename}: glob "${glob}" matched nothing`);
    }
  }
  return { details };
}

// L7
function checkL7(files) {
  const c = files.find(f => f.rel === 'CLAUDE.md');
  if (!c) return { details: [], level: 'PASS', summary: 'no CLAUDE.md' };
  const n = splitLines(readText(c.abs)).length;
  return {
    details: n > 270 ? [`CLAUDE.md has ${n} lines (> 270)`] : [],
    level: n > 270 ? 'WARN' : 'PASS',
    summary: `${n} lines`,
  };
}

// L8
function checkL8(files) {
  const details = [];
  for (const f of files) {
    if (!f.isRule) continue;
    const text = readText(f.abs), lines = splitLines(text);
    let start = 0;
    if (lines.length && lines[0].trim() === '---')
      for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { start = i + 1; break; }
    let first = -1;
    for (let i = start; i < lines.length; i++) if (lines[i].trim() !== '') { first = i; break; }
    if (first === -1) { details.push(`${f.basename}: empty content`); continue; }
    if (!/^# /.test(lines[first])) details.push(`${f.basename}:${first + 1}: first content not "# " heading`);
    const afterHeading = lines.slice(first + 1).join('\n');
    if (!afterHeading.includes('本檔是 `CLAUDE.md` 的領域規則檔')) details.push(`${f.basename}: missing standard intro sentence`);
  }
  return { details };
}

// L9
function checkL9(files) {
  const details = [];
  for (const f of files) if (f.isRule && !/^\.claude\/rules\/[a-z0-9-]+\.md$/.test(f.rel)) details.push(`${f.rel}: path not .claude/rules/[a-z0-9-]+.md (flat, lowercase)`);
  return { details };
}

// ── --compare helpers ─────────────────────────────────────────────────────
function buildNewIndex(files) {
  const idx = new Map();
  for (const f of files) {
    const lines = splitLines(readText(f.abs));
    let start = 0;
    if (f.isRule && lines.length && lines[0].trim() === '---')
      for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { start = i + 1; break; }
    for (let i = start; i < lines.length; i++) {
      const n = normalizeLine(lines[i]);
      if (n === null) continue;
      if (!idx.has(n)) idx.set(n, []);
      idx.get(n).push({ file: f.rel, line: i + 1 });
    }
  }
  return idx;
}

function keptSet(backupLines) {
  const s = new Set();
  for (let i = 0; i < backupLines.length; i++) {
    if (WHITELIST_SET.has(i + 1)) continue;
    const n = normalizeLine(backupLines[i]);
    if (n !== null) s.add(n);
  }
  return s;
}

function checkC1(backupLines, newIndex) {
  const details = [];
  for (let i = 0; i < backupLines.length; i++) {
    if (WHITELIST_SET.has(i + 1)) continue;
    const n = normalizeLine(backupLines[i]);
    if (n === null) continue;
    if (!newIndex.has(n)) details.push(`backup:${i + 1}: ${backupLines[i].slice(0, 60)}`);
  }
  return { details };
}

function checkC2(backupLines, newIndex) {
  const details = [];
  for (let i = 0; i < backupLines.length; i++) {
    if (WHITELIST_SET.has(i + 1)) continue;
    const n = normalizeLine(backupLines[i]);
    if (n === null) continue;
    if (!/^- \*\*R-/.test(n) && !/^#{2,3} /.test(n)) continue;
    const locs = newIndex.get(n);
    if (!locs || locs.length !== 1) details.push(`backup:${i + 1}: ${locs ? locs.length : 0} occurrences: ${n.slice(0, 50)}`);
  }
  return { details };
}

function checkC3(backupLines, newIndex) {
  const kept = keptSet(backupLines), added = [];
  for (const [text, locs] of newIndex) {
    if (!kept.has(text)) for (const l of locs) added.push(`${l.file}:${l.line}: ${text.slice(0, 80)}`);
  }
  return { details: added, level: added.length > 120 ? 'WARN' : 'PASS', count: added.length };
}

function checkC4(backupLines, newIndex) {
  const details = [];
  let bc = 0;
  for (const line of backupLines) { const n = normalizeLine(line); if (n && /^- \*\*R-/.test(n)) bc++; }
  if (bc !== 278) details.push(`backup rule bullets: ${bc} (expected 278)`);
  let nc = 0; const gov = [];
  for (const [text, locs] of newIndex) {
    if (/^- \*\*R-/.test(text)) nc += locs.length;
    if (/^- \*\*R-GOV-015 \[/.test(text)) gov.push(...locs);
  }
  if (nc !== 279) details.push(`new rule bullets: ${nc} (expected 279)`);
  if (gov.length !== 1) details.push(`R-GOV-015 occurrences: ${gov.length} (expected 1)`);
  else if (gov[0].file !== 'CLAUDE.md') details.push(`R-GOV-015 found in ${gov[0].file} (expected CLAUDE.md)`);
  return { details };
}

function checkC5(backupLines, newIndex) {
  const details = [];
  for (let i = 0; i < backupLines.length; i++) {
    if (WHITELIST_SET.has(i + 1)) continue;
    const m = backupLines[i].match(/^(## \d+\.|### \d+\.\d+)/);
    if (!m) continue;
    const n = normalizeLine(backupLines[i]);
    if (!n) continue;
    const locs = newIndex.get(n);
    if (!locs || locs.length === 0) { details.push(`backup:${i + 1}: heading missing: ${n.slice(0, 50)}`); continue; }
    const want = C5_MAP[m[1]];
    if (!want) { details.push(`backup:${i + 1}: no C5 mapping for "${m[1]}"`); continue; }
    for (const loc of locs) {
      const base = loc.file.split('/').pop();
      if (base !== want) details.push(`backup:${i + 1}: "${n.slice(0, 40)}" in ${loc.file} (expected ${want})`);
    }
  }
  return { details };
}

// ── --nav ────────────────────────────────────────────────────────────────
function isPathLike(s) { return s.includes('/') || /\.(js|md|html|css|json|xml|txt|rules|yml)$/.test(s); }

function listFilesUnder(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(full); }
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

function checkNav(repoRoot, gitFiles, navText, workRoot) {
  const details = [], lines = splitLines(navText);
  // Files only present in a staging --root (e.g. new rule files) count as existing too.
  const workFiles = workRoot && workRoot !== repoRoot ? listFilesUnder(workRoot) : [];
  for (let i = 0; i < lines.length; i++) {
    const br = /`([^`]+)`/g;
    let m;
    while ((m = br.exec(lines[i]))) {
      const raw = m[1].replace(/#.*$/, '').replace(/:\d+$/, '');
      const p = raw.replace(/\/$/, '');
      // Backticked shell commands (contain whitespace or pipes) are not paths.
      if (!p || /[\s|]/.test(p) || !isPathLike(raw)) continue;
      const excluded = p === 'docs' || p.startsWith('docs/') || p === 'tools' || p.startsWith('tools/');
      let exists;
      if (/[*?]/.test(p)) {
        // Untracked-but-present files (e.g. .claude/rules/ before its first commit) count too:
        // list the working tree under the glob's literal prefix and match against that.
        const base = p.split(/[*?]/)[0].replace(/\/[^/]*$/, '');
        const treeFiles = base ? listFilesUnder(path.join(repoRoot, base)).map(f => `${base}/${f}`) : [];
        exists = gitFiles.some(g => matchGlob(g, p)) || workFiles.some(g => matchGlob(g, p)) || treeFiles.some(g => matchGlob(g, p));
      }
      else exists = fs.existsSync(path.join(repoRoot, p)) || (workRoot && fs.existsSync(path.join(workRoot, p)));
      if (!exists) details.push({ level: excluded ? 'WARN' : 'FAIL', text: `NAVIGATION.md:${i + 1}: ${p}` });
    }
  }
  let level = 'PASS';
  if (details.some(d => d.level === 'FAIL')) level = 'FAIL';
  else if (details.length > 0) level = 'WARN';
  return { details, level };
}

module.exports = {
  WHITELIST_SET, C5_MAP, splitLines, normalizeLine, loadRuleSet, getGitFiles,
  checkL1L2, checkL3, checkL4, checkL5, checkL6, checkL7, checkL8, checkL9,
  buildNewIndex, keptSet, checkC1, checkC2, checkC3, checkC4, checkC5,
  checkNav, isPathLike, parseFrontmatter,
};
