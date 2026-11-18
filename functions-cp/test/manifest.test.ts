import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestScript = path.join(pkg, 'scripts', 'engine-manifest.mjs');
const syncScript = path.join(pkg, 'scripts', 'sync-engine-to-fcb.mjs');
const sourceManifest = path.join(pkg, 'engine.manifest.json');

function run(script: string, args: string[], cwd = pkg): string {
  return execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

function fail(script: string, args: string[], cwd = pkg): string {
  try {
    execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    expect(e.status).toBe(1);
    return `${e.stdout || ''}\n${e.stderr || ''}`;
  }
  throw new Error('預期指令失敗');
}

describe('engine manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-engine-'));
  const engine = path.join(root, 'engine');
  const manifest = path.join(root, 'engine.manifest.json');

  function writeEngine(name: string, body: string) {
    fs.mkdirSync(engine, { recursive: true });
    fs.writeFileSync(path.join(engine, name), body);
  }

  test('write 之後 check 通過；改一個位元組、多檔、少檔都會失敗', () => {
    writeEngine('a.ts', 'export const a = 1;\n');
    writeEngine('b.ts', 'export const b = 2;\n');
    const ok = run(manifestScript, ['--write', '--check', '--root', engine, '--manifest', manifest]);
    expect(ok).toContain('engine manifest OK (2 files)');

    const target = path.join(engine, 'a.ts');
    const original = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from([0])]));
    expect(fail(manifestScript, ['--check', '--root', engine, '--manifest', manifest])).toContain('雜湊不同 a.ts');
    fs.writeFileSync(target, original);

    writeEngine('c.ts', 'export const c = 3;\n');
    expect(fail(manifestScript, ['--check', '--root', engine, '--manifest', manifest])).toContain('多檔 c.ts');
    fs.rmSync(path.join(engine, 'c.ts'));

    fs.rmSync(path.join(engine, 'b.ts'));
    expect(fail(manifestScript, ['--check', '--root', engine, '--manifest', manifest])).toContain('少檔 b.ts');
  });

  test('sync 到假目的地後 manifest 一致；dry-run 不寫檔', () => {
    const before = fs.existsSync(sourceManifest) ? fs.readFileSync(sourceManifest) : null;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-fcb-'));
    fs.writeFileSync(path.join(dest, 'package.json'), '{"name":"fake","private":true}\n');
    const destEngine = path.join(dest, 'src', 'features', 'competitions', 'engine');
    const destManifest = path.join(dest, 'engine.manifest.json');

    const dry = run(syncScript, ['--dest', dest, '--dry-run']);
    expect(dry).toContain('dry-run copy');
    expect(fs.existsSync(destEngine)).toBe(false);
    expect(fs.existsSync(destManifest)).toBe(false);
    const afterDry = fs.existsSync(sourceManifest) ? fs.readFileSync(sourceManifest) : null;
    expect(afterDry).toEqual(before);

    run(syncScript, ['--dest', dest]);
    expect(fs.existsSync(destManifest)).toBe(true);
    const listed = JSON.parse(fs.readFileSync(destManifest, 'utf8')) as { root: string; files: Record<string, string> };
    expect(listed.root).toBe('src/features/competitions/engine');
    const check = run(manifestScript, ['--check', '--root', destEngine, '--manifest', destManifest]);
    expect(check).toContain(`engine manifest OK (${Object.keys(listed.files).length} files)`);

    const staleName = 'stale-only.ts';
    const prev = JSON.parse(fs.readFileSync(destManifest, 'utf8')) as { version: number; root: string; files: Record<string, string> };
    prev.files[staleName] = 'abc';
    fs.writeFileSync(destManifest, JSON.stringify(prev, null, 2) + '\n');
    fs.writeFileSync(path.join(destEngine, staleName), 'export const stale = 1;\n');
    fs.writeFileSync(path.join(destEngine, 'keep-me.ts'), 'export const keep = 1;\n');
    run(syncScript, ['--dest', dest]);
    expect(fs.existsSync(path.join(destEngine, staleName))).toBe(false);
    expect(fs.existsSync(path.join(destEngine, 'keep-me.ts'))).toBe(true);

    expect(() => run(syncScript, ['--dest', root])).toThrow(/package\.json/);
  });

  test('目的地 manifest 含非法路徑時同步中止且不刪檔', () => {
    const beforeSource = fs.existsSync(sourceManifest) ? fs.readFileSync(sourceManifest) : null;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-fcb-guard-'));
    fs.writeFileSync(path.join(dest, 'package.json'), '{"name":"fake","private":true}\n');
    run(syncScript, ['--dest', dest]);
    const sourceAfterSync = fs.readFileSync(sourceManifest);
    const destEngine = path.join(dest, 'src', 'features', 'competitions', 'engine');
    const destManifest = path.join(dest, 'engine.manifest.json');
    const clean = fs.readFileSync(destManifest, 'utf8');
    const sentinel = path.join(destEngine, '..', 'sentinel.txt');
    fs.writeFileSync(sentinel, 'stay');
    fs.writeFileSync(path.join(destEngine, 'keep-me.ts'), 'export const keep = 1;\n');
    fs.writeFileSync(path.join(destEngine, 'stale-only.ts'), 'export const stale = 1;\n');

    function snapshot(dir: string): string[] {
      const out: string[] = [];
      const walk = (current: string) => {
        for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
          const abs = path.join(current, ent.name);
          if (ent.isDirectory()) walk(abs);
          else out.push(`${path.relative(dir, abs)}:${fs.statSync(abs).size}`);
        }
      };
      walk(dir);
      return out.sort();
    }

    const badPaths = [
      '',
      '.',
      destEngine,
      path.join(destEngine, 'escaped.ts'),
      '../sentinel.txt',
      'foo/../../sentinel.txt',
      '..\\sentinel.txt',
      'readme.md',
      'notes.json',
      'foo.tsx'
    ];
    for (const bad of badPaths) {
      const prev = JSON.parse(clean) as { files: Record<string, string> };
      prev.files[bad] = 'deadbeef';
      prev.files['stale-only.ts'] = 'abc';
      fs.writeFileSync(destManifest, JSON.stringify(prev, null, 2) + '\n');
      const filesBefore = snapshot(dest);
      const out = fail(syncScript, ['--dest', dest]);
      expect(out).toContain('拒絕');
      expect(snapshot(dest)).toEqual(filesBefore);
      expect(fs.existsSync(path.join(destEngine, 'stale-only.ts'))).toBe(true);
      expect(fs.existsSync(path.join(destEngine, 'keep-me.ts'))).toBe(true);
      expect(fs.existsSync(sentinel)).toBe(true);
      expect(fs.readFileSync(sourceManifest)).toEqual(sourceAfterSync);
    }
    expect(fs.readFileSync(sourceManifest)).toEqual(sourceAfterSync);
    if (beforeSource) expect(sourceAfterSync.length).toBeGreaterThan(0);
  });
});
