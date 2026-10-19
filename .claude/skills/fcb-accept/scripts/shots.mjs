#!/usr/bin/env node
// FC-B 瀏覽器驗收截圖（Playwright headless，連本機 dev server＋emulator）。
// 用法：node shots.mjs <輸出目錄> <uid 或 guest> <路徑1> [路徑2 ...]
// 例：node shots.mjs out U0000000000000000000000000000002 /teams /teams/tm_seed_team_a
// 產出：每個路徑 × 手機 390／桌機 1280 × 亮／暗 的整頁截圖，與 report.json（console error、水平溢出、頁面前段文字）。
// 前置：FC-B dev server 跑在 5181（VITE_FIREBASE_EMULATOR=1），emulator 已 seed（npm run seed:emulator）。
// 注意：Firestore 長連線會讓 networkidle 等不到，所以只等 3 秒上限。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const FCB = process.env.FCB_DIR || 'D:/Users/msw74/Documents/github/FC-B';
const require = createRequire(path.join(FCB, 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.FCB_BASE || 'http://localhost:5181';
const [OUT, who, ...PAGES] = process.argv.slice(2);
if (!OUT || !who || PAGES.length === 0) {
  console.error('用法：node shots.mjs <輸出目錄> <uid|guest> <路徑...>');
  process.exit(2);
}
const UID = who === 'guest' ? '' : who;
const tag = who === 'guest' ? 'guest' : who.slice(-4);
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

const browser = await chromium.launch();
const report = [];
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((th) => { try { localStorage.setItem('toosterx:theme', th); } catch (_) {} }, theme);
    if (UID) await page.evaluate(async (u) => { const m = await import('/src/data/auth.ts'); await m.devSignIn(u); }, UID);
    await page.waitForTimeout(600);
    for (const p of PAGES) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const name = `${tag}-${p.replace(/\//g, '_').replace(/^_/, '') || 'root'}-${vp}-${theme}`;
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      const info = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return {
          pageScrollsSideways: document.documentElement.scrollWidth > vw + 1,
          overflowing: [...document.querySelectorAll('main *')]
            .filter((el) => el.getBoundingClientRect().right > vw + 1)
            .slice(0, 5).map((el) => `${el.tagName}.${el.className}`),
          text: (document.querySelector('main')?.innerText || '').slice(0, 160).replace(/\s+/g, ' '),
        };
      });
      report.push({ shot: name, ...info });
    }
    report.push({ vp, theme, errors });
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, `report-${tag}.json`), JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.pageScrollsSideways || (r.errors && r.errors.length));
console.log(bad.length ? `⚠ ${bad.length} 筆需看：${JSON.stringify(bad).slice(0, 600)}` : '無 console error、頁面無水平捲動');
console.log(`截圖在 ${OUT}（只有 overflowing 但頁面不捲動多半是被容器裁切的裝飾，看圖確認）`);
