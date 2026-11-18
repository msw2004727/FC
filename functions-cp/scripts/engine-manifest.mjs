/**
 * 引擎檔清單。SHA-256 用檔案原始位元組，不轉換換行。
 * node scripts/engine-manifest.mjs --write|--check [--root dir] [--manifest file]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const out = { write: false, check: false, root: null, manifest: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--check') out.check = true;
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--manifest') out.manifest = argv[++i];
    else {
      console.error(`未知參數 ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function walkTs(dir, base, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(abs, base, acc);
    else if (ent.isFile() && ent.name.endsWith('.ts')) {
      acc.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
}

export function collectFiles(rootDir) {
  const rels = [];
  walkTs(rootDir, rootDir, rels);
  rels.sort();
  const files = {};
  for (const rel of rels) {
    const buf = fs.readFileSync(path.join(rootDir, rel));
    files[rel] = crypto.createHash('sha256').update(buf).digest('hex');
  }
  return files;
}

export function renderManifest(rootField, files) {
  const ordered = {};
  for (const key of Object.keys(files).sort()) ordered[key] = files[key];
  return JSON.stringify({ version: 1, root: rootField, files: ordered }, null, 2) + '\n';
}

export function diffManifest(expected, actual) {
  const problems = [];
  const exp = expected || {};
  const act = actual || {};
  for (const rel of Object.keys(act).sort()) {
    if (!(rel in exp)) problems.push(`多檔 ${rel}`);
    else if (exp[rel] !== act[rel]) problems.push(`雜湊不同 ${rel}`);
  }
  for (const rel of Object.keys(exp).sort()) {
    if (!(rel in act)) problems.push(`少檔 ${rel}`);
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.write && !args.check) {
    console.error('需要 --write 或 --check');
    process.exit(1);
  }
  const rootArg = args.root || 'src/engine';
  const rootDir = path.resolve(process.cwd(), rootArg);
  const manifestPath = path.resolve(process.cwd(), args.manifest || 'engine.manifest.json');
  const rootField = rootArg.split(path.sep).join('/');
  const files = collectFiles(rootDir);

  if (args.write) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, renderManifest(rootField, files));
  }

  if (args.check) {
    if (!fs.existsSync(manifestPath)) {
      console.log('少檔 engine.manifest.json');
      process.exit(1);
    }
    const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const problems = diffManifest(prev.files || {}, files);
    if (problems.length) {
      for (const line of problems) console.log(line);
      process.exit(1);
    }
    console.log(`engine manifest OK (${Object.keys(files).length} files)`);
  }
}

const self = path.normalize(fileURLToPath(import.meta.url)).toLowerCase();
const invoked = process.argv[1] ? path.normalize(path.resolve(process.argv[1])).toLowerCase() : '';
if (self === invoked) main();
