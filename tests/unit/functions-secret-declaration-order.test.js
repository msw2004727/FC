/**
 * Cloud Functions — Secret 宣告順序守門
 *
 * exports 的 options（例如 secrets: [X]）在模組載入時就會求值；若 `const X = defineSecret(...)`
 * 寫在使用處之後，Node 會丟 ReferenceError（TDZ），firebase deploy 在分析程式碼時直接失敗。
 * 2026-10-20 實際發生：DATA_SYNC_SETTINGS_PASSWORD 宣告在 index.js 後段，migrateUidFields 先用到它。
 * test:functions 只測抽出的純邏輯、不載入整個 index.js，所以需要這個靜態檢查。
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..', 'functions');

function functionSourceFiles() {
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(FUNCTIONS_DIR, name));
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function analyze(source) {
  const declarations = new Map();
  // 只看檔案最外層（行首、無縮排）的宣告；函式內的區域常數不受模組載入順序影響。
  for (const match of source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*defineSecret\(/gm)) {
    declarations.set(match[1], lineOf(source, match.index));
  }
  const problems = [];
  for (const [name, declLine] of declarations) {
    const usage = new RegExp(`\\b${name}\\b`, 'g');
    for (const match of source.matchAll(usage)) {
      const line = lineOf(source, match.index);
      if (line < declLine) problems.push(`${name} 在第 ${line} 行使用，但第 ${declLine} 行才宣告`);
    }
  }
  const localSecrets = new Set(
    [...source.matchAll(/^\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*defineSecret\(/gm)].map((m) => m[1]),
  );
  const undeclared = [];
  for (const match of source.matchAll(/secrets:\s*\[([^\]]*)\]/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim();
      if (name && /^[A-Z][A-Z0-9_]*$/.test(name) && !declarations.has(name) && !localSecrets.has(name)) {
        undeclared.push(`${name}（第 ${lineOf(source, match.index)} 行）`);
      }
    }
  }
  return { declarations, problems, undeclared };
}

describe('Cloud Functions Secret 宣告順序', () => {
  for (const file of functionSourceFiles()) {
    const rel = path.relative(path.join(__dirname, '..', '..'), file);
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('defineSecret(') && !/secrets:\s*\[/.test(source)) continue;

    test(`${rel}：defineSecret 常數都在第一次使用前宣告`, () => {
      expect(analyze(source).problems).toEqual([]);
    });

    test(`${rel}：secrets: [...] 用到的常數都在同檔宣告`, () => {
      expect(analyze(source).undeclared).toEqual([]);
    });
  }

  test('檢查本身能抓到「先使用後宣告」', () => {
    const bad = [
      'exports.a = onCall({ secrets: [LATE_SECRET] }, () => {});',
      'const LATE_SECRET = defineSecret("LATE_SECRET");',
    ].join('\n');
    expect(analyze(bad).problems).toEqual(['LATE_SECRET 在第 1 行使用，但第 2 行才宣告']);
  });
});
