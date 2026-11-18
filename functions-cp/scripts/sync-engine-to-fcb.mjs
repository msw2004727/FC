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

function inside(root, rel) {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`拒絕碰引擎資料夾以外的路徑：${rel}`);
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
  for (const rel of stale) {
    const abs = inside(destDir, rel);
    console.log(`${args.dryRun ? 'dry-run ' : ''}delete ${rel}`);
    if (!args.dryRun && fs.existsSync(abs)) fs.rmSync(abs);
  }

  for (const rel of Object.keys(sourceFiles).sort()) {
    const from = path.join(sourceDir, rel);
    const to = inside(destDir, rel);
    console.log(`${args.dryRun ? 'dry-run ' : ''}copy ${rel}`);
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
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
