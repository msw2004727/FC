// A 正式站（訪客、只讀）與 B 本機 dev（emulator）截圖：390×844，深淺色各一。
// 用法：node shots.mjs <scenes.mjs> <輸出 shots 資料夾> [只跑某情境]
// scenes.mjs 預設匯出 (h) => [{ name, A?: { path, run? }, B?: { path, uid?, run? } }]，h 是下方 helpers。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const FCB = 'D:/Users/msw74/Documents/github/FC-B';
const require = createRequire(path.join(FCB, 'package.json'));
const { chromium } = require('@playwright/test');
const A_BASE = 'https://toosterx.com';
const B_BASE = 'http://localhost:5181';

const [scenesFile, OUT, ONLY] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const helpers = {
  // A 正式站會跳「有新版本可用」浮層，先按「稍後」
  dismissA: async (p) => { try { await p.getByRole('button', { name: '稍後' }).first().click({ timeout: 1500 }); } catch (_) {} },
  // 捲到第一個看得見、符合文字的元素（getByText 會撈到隱藏頁的同名元素，所以要 visible）
  scrollToText: async (p, re) => {
    await p.getByText(re).filter({ visible: true }).last().scrollIntoViewIfNeeded({ timeout: 5000 });
    await p.evaluate(() => window.scrollBy(0, -80));
    await p.waitForTimeout(600);
  },
  // 按鈕名稱預設是子字串比對；名稱互相包含時（「管理名單」vs「管理名單 / 出席紀錄」）要 exact
  clickButton: async (p, name, exact = false) => {
    await p.getByRole('button', { name, exact }).first().click({ timeout: 5000 });
    await p.waitForTimeout(1200);
  },
  // A 的內頁在內層容器捲動，scrollIntoView 不一定有效，改用滑鼠滾輪
  wheel: async (p, dy) => { await p.mouse.move(195, 500); await p.mouse.wheel(0, dy); await p.waitForTimeout(1000); },
};

const scenes = (await import(pathToFileURL(path.resolve(scenesFile)).href)).default(helpers)
  .filter((s) => !ONLY || s.name === ONLY);
const browser = await chromium.launch();
const report = [];
for (const theme of ['light', 'dark']) for (const sc of scenes) for (const side of ['A', 'B']) {
  const cfg = sc[side];
  if (!cfg) continue;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const base = side === 'A' ? A_BASE : B_BASE;
  await p.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.evaluate((th) => { try { localStorage.setItem('sporthub_theme', th); } catch (_) {} }, theme);
  if (side === 'B' && cfg.uid) {
    await p.evaluate(async (u) => { const m = await import('/src/data/auth.ts'); await m.devSignIn(u); }, cfg.uid);
  }
  await p.goto(base + cfg.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(side === 'A' ? 7000 : 3500);
  if (side === 'A') await helpers.dismissA(p);
  try { if (cfg.run) await cfg.run(p); } catch (e) { errors.push('run: ' + String(e).split('\n')[0].slice(0, 160)); }
  const file = `${sc.name}-${side}-${theme}.png`;
  await p.screenshot({ path: path.join(OUT, file) });
  report.push({ scene: sc.name, side, theme, file, errors });
  console.log(file, errors.length ? errors : 'ok');
  await ctx.close();
}
if (!ONLY) fs.writeFileSync(path.join(OUT, '..', 'shots-report.json'), JSON.stringify(report, null, 1) + '\n');
await browser.close();
