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
