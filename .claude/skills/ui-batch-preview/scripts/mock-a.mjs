// A 需登入、訪客截不到的畫面：用 A 原始碼的 DOM＋FC 本機 css 檔在 Playwright setContent 重現，390×844 深淺色各一。
// 用法：node mock-a.mjs <mocks.mjs> <輸出 shots 資料夾> [只跑某情境]
// mocks.mjs 預設匯出 { css: ['css/base.css', ...], scenes: [{ name, html }] }；html 放 <body> 內容，產出 <name>-A-<theme>.png。
// 2026-10-22 T-009 新增（取代第 3 批在情境裡各自手寫 setContent）：CSS 直接讀 FC repo，主題用 A 的 data-theme 屬性切換。
// 情境可選 bodyClass（body 的 class，例如 A 開表單時的 create-event-modal-open）與 scrollTo（CSS 選擇器，截圖前捲到該元素頂端；
// 長表單分段截圖用）。2026-10-22 T-012 新增。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const FC = 'D:/Users/msw74/Documents/github/FC';
const FCB = 'D:/Users/msw74/Documents/github/FC-B';
const require = createRequire(path.join(FCB, 'package.json'));
const { chromium } = require('@playwright/test');

const [mocksFile, OUT, ONLY] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const mod = (await import(pathToFileURL(path.resolve(mocksFile)).href)).default;
const css = mod.css.map((f) => fs.readFileSync(path.join(FC, f), 'utf8')).join('\n');
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) for (const sc of mod.scenes.filter((s) => !ONLY || s.name === ONLY)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await p.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body class="${sc.bodyClass || ''}">${sc.html}</body></html>`);
  await p.waitForTimeout(400);
  if (sc.scrollTo) {
    const found = await p.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'start' }); return !!el; }, sc.scrollTo);
    if (!found) errors.push(`scrollTo 找不到 ${sc.scrollTo}`);
    await p.waitForTimeout(300);
  }
  const file = `${sc.name}-A-${theme}.png`;
  await p.screenshot({ path: path.join(OUT, file) });
  console.log(file, errors.length ? errors : 'ok');
  await ctx.close();
}
await browser.close();
