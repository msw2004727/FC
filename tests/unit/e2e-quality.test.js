/**
 * E2E test quality guard.
 *
 * This does not judge product behavior. It blocks common smoke-test patterns
 * that always pass and therefore create false confidence.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const E2E_DIR = path.join(PROJECT_ROOT, 'tests', 'e2e');

function listSpecFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSpecFiles(fullPath);
    if (!entry.name.endsWith('.spec.js')) return [];
    return [fullPath];
  });
}

function rel(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
}

describe('E2E quality guard', () => {
  const specFiles = listSpecFiles(E2E_DIR);

  test('E2E spec files exist', () => {
    expect(specFiles.length).toBeGreaterThan(0);
  });

  test('E2E specs do not use always-true boolean assertions', () => {
    const offenders = [];
    specFiles.forEach(filePath => {
      const source = fs.readFileSync(filePath, 'utf8');
      if (/expect\s*\(\s*typeof\s+[^)]*\)\s*\.toBe\s*\(\s*['"]boolean['"]\s*\)/.test(source)) {
        offenders.push(rel(filePath));
      }
    });
    expect(offenders).toEqual([]);
  });

  test('E2E specs do not assert non-negative counts as success', () => {
    const offenders = [];
    specFiles.forEach(filePath => {
      const source = fs.readFileSync(filePath, 'utf8');
      if (/\.toBeGreaterThanOrEqual\s*\(\s*0\s*\)/.test(source)) {
        offenders.push(rel(filePath));
      }
    });
    expect(offenders).toEqual([]);
  });

  test('E2E specs use the shared harness', () => {
    const offenders = [];
    specFiles.forEach(filePath => {
      const source = fs.readFileSync(filePath, 'utf8');
      if (!source.includes("require('./helpers/test-harness')")) {
        offenders.push(rel(filePath));
      }
    });
    expect(offenders).toEqual([]);
  });
});
