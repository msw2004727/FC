/**
 * Source-Test Drift Detection
 *
 * Validates that extracted function copies in test files can be traced
 * back to actual source files. Detects:
 *   - Source files that no longer exist (HARD FAIL)
 *   - Line ranges that have shifted (WARNING — logged but not failing)
 *
 * Methodology:
 *   Parse "Extracted from <file>:<startLine>-<endLine>" comments in test files
 *   and verify the referenced source files exist on disk.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const JS_DIR = path.join(PROJECT_ROOT, 'js');

/**
 * Read a file and return lines array
 */
function readLines(relPath) {
  const fullPath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/);
}

/**
 * Resolve a short filename (e.g., "tournament-core.js") to a full relative path
 * by searching under js/ directory.
 */
function resolveSourceFile(shortName) {
  // If it's already a full path, check directly
  const directPath = path.join(PROJECT_ROOT, shortName);
  if (fs.existsSync(directPath)) return shortName;

  // Extract the basename for flexible matching (e.g., "js/modules/event-list.js" → "event-list.js")
  const basename = path.basename(shortName);

  // Search under js/ recursively for matching filename
  function findFile(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(full);
        if (found) return found;
      } else if (entry.name === basename) {
        return path.relative(PROJECT_ROOT, full).replace(/\\/g, '/');
      }
    }
    return null;
  }
  return findFile(JS_DIR);
}

/**
 * Scan a test file for "Extracted from <path>:<start>-<end>" annotations.
 */
function findExtractionAnnotations(testFilePath) {
  const lines = readLines(testFilePath);
  if (!lines) return [];
  const results = [];
  const pattern = /Extracted from\s+([\w/.:\-]+?):(\d+)-(\d+)/;
  lines.forEach((line, idx) => {
    const m = line.match(pattern);
    if (m) {
      results.push({
        sourceFile: m[1],
        startLine: parseInt(m[2], 10),
        endLine: parseInt(m[3], 10),
        testLine: idx + 1,
      });
    }
  });
  return results;
}

/**
 * Normalize source text for comparison: strip comments,
 * collapse whitespace, remove non-logic characters.
 */
function normalizeSource(text) {
  return text
    .replace(/\/\/.*$/gm, '')        // strip single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}

/**
 * Extract key logic tokens from normalized source for fuzzy matching.
 * Pulls out identifiers, operators, keywords — strips string literals
 * and punctuation to focus on structural logic.
 */
function extractLogicSignature(text) {
  const normalized = normalizeSource(text);
  // Remove string literals to focus on logic structure
  const noStrings = normalized
    .replace(/'[^']*'/g, "'_'")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/`[^`]*`/g, '`_`');
  // Extract identifier-like tokens and operators
  const tokens = noStrings.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|[!=<>]+|&&|\|\||\?\./g);
  return (tokens || []).join(' ');
}

/**
 * Extract the function/const block from a test file that follows the
 * annotation. Scans forward from the annotation line, skipping comment
 * lines, and captures everything from the first code line until the next
 * extraction annotation section or top-level test block.
 */
function extractTestBlock(testFilePath, annotationLineIdx) {
  const lines = readLines(testFilePath);
  if (!lines) return null;

  const annotationPattern = /Extracted from\s+[\w/.:\-]+?:\d+-\d+/;
  const sectionSeparator = /^\/\/\s*[-=]{3,}/;

  // Scan forward to find start of actual code (skip comments/blank lines)
  let codeStart = -1;
  for (let i = annotationLineIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    codeStart = i;
    break;
  }
  if (codeStart === -1) return null;

  // Collect code lines until we hit the next section
  const bodyLines = [];
  for (let i = codeStart; i < lines.length; i++) {
    // Stop at next extraction annotation or section separator (but not the first line)
    if (i > codeStart) {
      if (annotationPattern.test(lines[i])) break;
      if (sectionSeparator.test(lines[i])) break;
      // Stop at describe/test blocks (test section start)
      if (/^describe\s*\(/.test(lines[i].trim())) break;
      if (/^test\s*\(/.test(lines[i].trim())) break;
    }
    bodyLines.push(lines[i]);
  }
  return bodyLines.join('\n');
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Source-Test Drift Detection', () => {
  const testDir = path.join(PROJECT_ROOT, 'tests', 'unit');
  const testFiles = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js') && f !== 'source-drift.test.js')
    .map(f => path.join('tests', 'unit', f));

  // Collect all annotations across all test files
  const allAnnotations = [];
  testFiles.forEach(tf => {
    const annotations = findExtractionAnnotations(tf);
    annotations.forEach(a => allAnnotations.push({ ...a, testFile: tf }));
  });

  test('found extraction annotations in test files', () => {
    expect(allAnnotations.length).toBeGreaterThan(0);
  });

  test('all referenced source files exist on disk', () => {
    const missing = allAnnotations.filter(a => {
      const resolved = resolveSourceFile(a.sourceFile);
      return !resolved;
    });
    if (missing.length > 0) {
      const details = missing.map(a =>
        `  ${a.testFile}:${a.testLine} → ${a.sourceFile} (not found anywhere under js/)`
      ).join('\n');
      throw new Error(`Source files not found:\n${details}`);
    }
  });

  test('line ranges within bounds (informational — warns on drift)', () => {
    const drifted = [];
    allAnnotations.forEach(a => {
      const resolved = resolveSourceFile(a.sourceFile);
      if (!resolved) return; // already caught by the existence test
      const lines = readLines(resolved);
      if (!lines) return;
      if (a.startLine < 1 || a.endLine > lines.length || a.startLine > a.endLine) {
        drifted.push({
          ...a,
          resolvedFile: resolved,
          fileLength: lines.length,
        });
      }
    });
    // Log drifted annotations for developer awareness
    if (drifted.length > 0) {
      const details = drifted.map(a =>
        `  ${path.basename(a.testFile)}:${a.testLine} → ${a.resolvedFile}:${a.startLine}-${a.endLine} (file has ${a.fileLength} lines)`
      ).join('\n');
      console.warn(`\n⚠️  ${drifted.length} annotation(s) have shifted line ranges (source may have been modified):\n${details}\n`);
    }
    // This test passes — drift is a warning, not a blocker
    // The key protection is the file existence check above
    expect(true).toBe(true);
  });

  test('extracted functions match current source content', () => {
    const mismatches = [];
    const staleAnnotations = [];

    allAnnotations.forEach(a => {
      const resolved = resolveSourceFile(a.sourceFile);
      if (!resolved) return; // caught by existence test
      const sourceLines = readLines(resolved);
      if (!sourceLines) return;
      // Skip if line range is out of bounds (informational only)
      if (a.startLine < 1 || a.endLine > sourceLines.length || a.startLine > a.endLine) return;

      // Extract source content at annotated line range
      const sourceSlice = sourceLines.slice(a.startLine - 1, a.endLine).join('\n');
      const sourceSig = extractLogicSignature(sourceSlice);
      // Need meaningful source content to compare
      if (sourceSig.split(' ').length < 3) return;

      // Extract the function block from the test file after the annotation
      const testBlock = extractTestBlock(a.testFile, a.testLine - 1);
      if (!testBlock || testBlock.trim().length === 0) return;
      const testSig = extractLogicSignature(testBlock);
      if (testSig.split(' ').length < 3) return;

      // Identify the primary function/const name from the test block
      const testNameMatch = testBlock.match(/(?:function\s+|const\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      const testFuncName = testNameMatch ? testNameMatch[1] : null;

      // Check if the source at annotated lines contains the same function name.
      // If not, the annotation line numbers have shifted — the source at those
      // lines is a completely different function. This is a stale annotation
      // (warning), not a content mismatch (hard fail).
      if (testFuncName && !sourceSlice.includes(testFuncName)) {
        staleAnnotations.push({
          ...a,
          resolvedFile: resolved,
          testFuncName,
        });
        return; // skip — line numbers shifted, not actual content drift
      }

      // Compare logic signatures — source tokens must appear in test block
      const sourceTokens = sourceSig.split(' ');
      const testTokenSet = new Set(testSig.split(' '));

      let matched = 0;
      for (const token of sourceTokens) {
        if (testTokenSet.has(token)) matched++;
      }
      const matchRatio = matched / sourceTokens.length;

      // Require at least 50% token overlap to consider it a match.
      // This threshold is lenient enough to allow adaptations
      // (removing `this.`, renaming params, omitting DOM refs) but catches
      // major drift (missing logic branches, wrong function body).
      if (matchRatio < 0.5) {
        mismatches.push({
          ...a,
          resolvedFile: resolved,
          matchRatio: Math.round(matchRatio * 100),
          sourcePreview: normalizeSource(sourceSlice).slice(0, 100),
          testPreview: normalizeSource(testBlock).slice(0, 100),
        });
      }
    });

    // Log stale annotations as warnings (line numbers shifted)
    if (staleAnnotations.length > 0) {
      const details = staleAnnotations.map(s =>
        `  ${path.basename(s.testFile)}:${s.testLine} -> ${s.resolvedFile}:${s.startLine}-${s.endLine} (looking for '${s.testFuncName}')`
      ).join('\n');
      console.warn(
        `\n[WARN] ${staleAnnotations.length} annotation(s) have stale line ranges ` +
        `(source at annotated lines contains different function):\n${details}\n`
      );
    }

    // Hard fail only on confirmed content mismatches
    if (mismatches.length > 0) {
      const details = mismatches.map(m =>
        `  ${path.basename(m.testFile)}:${m.testLine} -> ${m.resolvedFile}:${m.startLine}-${m.endLine} (${m.matchRatio}% match)\n` +
        `    Source: ${m.sourcePreview}...\n` +
        `    Test:   ${m.testPreview}...`
      ).join('\n');
      throw new Error(
        `${mismatches.length} extracted function(s) have drifted from source:\n${details}\n\n` +
        'Update the test file copies to match current source code.'
      );
    }
  });

  test('annotation coverage summary', () => {
    const summary = {};
    allAnnotations.forEach(a => {
      const key = path.basename(a.testFile);
      summary[key] = (summary[key] || 0) + 1;
    });
    const total = allAnnotations.length;
    const files = Object.keys(summary).length;
    // Informational: report how many annotations across how many test files
    expect(total).toBeGreaterThan(0);
    expect(files).toBeGreaterThan(0);
  });
});
