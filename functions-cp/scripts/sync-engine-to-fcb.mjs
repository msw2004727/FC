/**
 * 把本包 src/engine 的 .ts 同步到另一個 repo 的賽事引擎資料夾。
 * 只刪「目的地 manifest 列過、來源已不存在」的檔，而且路徑必須留在目的地引擎資料夾內。
 * node scripts/sync-engine-to-fcb.mjs --dest <repo 根> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, renderManifest } from './engine-manifest.mjs';

const DEST_ROOT_FIELD = 'src/features/competitions/engine';
const SOURCE_ROOT_FIELD = 'src/engine';

function parseArgs(argv) {
  const out = { dest: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--dest') out.dest = argv[++i];
    else {
      console.error(`未知參數 ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function reject(message) {
  console.error(message);
  process.exit(1);
}

/** 相對路徑必須是引擎資料夾裡的 .ts，不能是空字串、.、資料夾本身、絕對路徑或含 ..。 */
function pathProblem(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return '拒絕路徑：空字串';
  if (rel === '.' || rel === './' || rel === '.\\') return '拒絕路徑：.';
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    return `拒絕絕對路徑：${rel}`;
  }
  const parts = rel.split(/[\\/]/);
  if (parts.some(part => part === '..')) return `拒絕含 .. 的路徑：${rel}`;
  if (parts.some(part => part === '' || part === '.')) return `拒絕路徑：${rel}`;
  if (path.posix.extname(rel.replace(/\\/g, '/')) !== '.ts') return `拒絕非 .ts 檔：${rel}`;
  return null;
}

function inside(root, rel) {
  const problem = pathProblem(rel);
  if (problem) reject(problem);
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  if (abs === rootAbs) reject(`拒絕引擎資料夾本身：${rel}`);
  const back = path.relative(rootAbs, abs);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
    reject(`拒絕碰引擎資料夾以外的路徑：${rel}`);
  }
  return abs;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.dest) {
    console.error('需要 --dest <FC-B repo 根>');
    process.exit(1);
  }
  const destRoot = path.resolve(process.cwd(), args.dest);
  if (!fs.existsSync(path.join(destRoot, 'package.json'))) {
    console.error('拒絕執行：目的地沒有 package.json');
    process.exit(1);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const sourceDir = path.resolve(scriptDir, '../src/engine');
  const sourceManifest = path.resolve(scriptDir, '../engine.manifest.json');
  const destDir = path.join(destRoot, 'src', 'features', 'competitions', 'engine');
  const destManifest = path.join(destRoot, 'engine.manifest.json');

  const sourceFiles = collectFiles(sourceDir);
  let listed = {};
  if (fs.existsSync(destManifest)) {
    const prev = JSON.parse(fs.readFileSync(destManifest, 'utf8'));
    listed = prev.files || {};
  }

  const stale = Object.keys(listed).filter(rel => !(rel in sourceFiles)).sort();
  // 先檢查全部路徑。任一筆不合法就整次中止，不能先刪到一半。
  const staleTargets = stale.map(rel => ({ rel, abs: inside(destDir, rel) }));
  const copyTargets = Object.keys(sourceFiles).sort().map(rel => ({
    rel,
    from: path.join(sourceDir, rel),
    to: inside(destDir, rel)
  }));

  for (const item of staleTargets) {
    console.log(`${args.dryRun ? 'dry-run ' : ''}delete ${item.rel}`);
    if (!args.dryRun && fs.existsSync(item.abs)) fs.rmSync(item.abs);
  }

  for (const item of copyTargets) {
    console.log(`${args.dryRun ? 'dry-run ' : ''}copy ${item.rel}`);
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(item.to), { recursive: true });
      fs.copyFileSync(item.from, item.to);
    }
  }

  console.log(`${args.dryRun ? 'dry-run ' : ''}write ${DEST_ROOT_FIELD} manifest`);
  if (!args.dryRun) {
    const copied = collectFiles(destDir);
    fs.writeFileSync(destManifest, renderManifest(DEST_ROOT_FIELD, copied));
  }

  console.log(`${args.dryRun ? 'dry-run ' : ''}write source manifest`);
  if (!args.dryRun) {
    fs.writeFileSync(sourceManifest, renderManifest(SOURCE_ROOT_FIELD, sourceFiles));
  }
}

main();
