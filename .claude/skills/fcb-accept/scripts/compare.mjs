#!/usr/bin/env node
// 新舊版同頁並排比對：舊版 A（正式站，訪客只讀）vs 新版 B（本機 dev server 5181，連 emulator）。
// ⚠️ B 不可指向本機的 vite build／preview：任何 build 都是 PROD，會忽略 emulator 旗標
//    （2026-10-19 事故；FC-B 4201c25 起本機網址連正式資料庫會被 assertFirebaseTargetAllowed 擋下）。
// 用法：node compare.mjs <輸出目錄> <B 的 base URL> <路徑1> [路徑2 ...]
//   路徑可寫 "A路徑|B路徑"，兩邊不同時用（例如 "/events/@first|/events/ce_xxx"）。
//   A 路徑 "/events/@first"、"/teams/@first" 會自動換成舊版列表的第一個活動／俱樂部。
// 產出：每頁手機首屏截圖（A、B、並排合成圖）＋ report.json（冷啟動／二次開啟的 FCP、LCP、
//       請求數、傳輸量、JS／CSS 位元組）。
// 注意：B 連本機 emulator，資料比正式站少、網路比正式站快；速度只能看相對趨勢與資源量。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const FCB = process.env.FCB_DIR || 'D:/Users/msw74/Documents/github/FC-B';
const require = createRequire(path.join(FCB, 'package.json'));
const { chromium } = require('@playwright/test');

const A_BASE = process.env.A_BASE || 'https://toosterx.com';
const [OUT, B_BASE, ...PAGES] = process.argv.slice(2);
if (!OUT || !B_BASE || PAGES.length === 0) {
  console.error('用法：node compare.mjs <輸出目錄> <B base URL> <路徑...>');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const SETTLE_MS = 5000;

const browser = await chromium.launch();

async function measure(context, url) {
  const page = await context.newPage();
  let requests = 0;
  let bytes = 0;
  const byType = { script: 0, stylesheet: 0, image: 0, other: 0 };
  page.on('response', async (res) => {
    requests += 1;
    // content-length 在壓縮傳輸時常缺，改用實際傳輸量。
    const sizes = await res.request().sizes().catch(() => null);
    const len = sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
    bytes += len;
    const type = res.request().resourceType();
    const k = type in byType ? type : 'other';
    byType[k] += len;
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const domMs = Date.now() - t0;
  await page.waitForTimeout(SETTLE_MS);
  const perf = await page.evaluate(() => new Promise((resolve) => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    let lcp = null;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        lcp = entries[entries.length - 1]?.startTime ?? lcp;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) { /* 不支援時略過 */ }
    setTimeout(() => resolve({ fcp, lcp }), 200);
  }));
  return { page, metrics: { domMs, fcp: perf.fcp && Math.round(perf.fcp), lcp: perf.lcp && Math.round(perf.lcp), requests, kb: Math.round(bytes / 1024), jsKb: Math.round(byType.script / 1024), cssKb: Math.round(byType.stylesheet / 1024), imgKb: Math.round(byType.image / 1024) } };
}

async function firstAEventPath() {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${A_BASE}/activities`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  // A 的 ApiService 是頁面內 const，不在 window 上；改讀時間軸卡片的 data-event-id（優先非已結束）。
  const id = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.tl-event-row[data-event-id]'));
    const open = rows.find((r) => !r.classList.contains('tl-past')) || rows[0];
    return open ? open.getAttribute('data-event-id') || '' : '';
  });
  await context.close();
  return id ? `/events/${id}` : '/activities';
}

// 舊版第一個俱樂部：讀俱樂部列表卡片的 data-team-id（優先置頂卡以外的第一張也無妨，取第一張）。
async function firstATeamPath() {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${A_BASE}/teams`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const id = await page.evaluate(() => document.querySelector('.tc-card[data-team-id]')?.getAttribute('data-team-id') || '');
  await context.close();
  return id ? `/teams/${id}` : '/teams';
}

const report = [];
for (const spec of PAGES) {
  let [aPath, bPath] = spec.includes('|') ? spec.split('|') : [spec, spec];
  if (aPath === '/events/@first') aPath = await firstAEventPath();
  if (aPath === '/teams/@first') aPath = await firstATeamPath();
  const name = bPath.replace(/\//g, '_').replace(/^_/, '') || 'home';
  const row = { page: name, aPath, bPath };
  for (const [side, base, p] of [['A', A_BASE, aPath], ['B', B_BASE, bPath]]) {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
    const cold = await measure(context, `${base}${p}`);
    await cold.page.screenshot({ path: path.join(OUT, `${name}-${side}.png`) });
    await cold.page.close();
    const warm = await measure(context, `${base}${p}`);
    await warm.page.close();
    await context.close();
    row[side] = { cold: cold.metrics, warm: warm.metrics };
  }
  // 並排合成
  const ctx = await browser.newContext({ viewport: { width: 820, height: 900 } });
  const pg = await ctx.newPage();
  const img = (side) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, `${name}-${side}.png`)).toString('base64')}`;
  await pg.setContent(`<body style="margin:0;font:14px sans-serif;display:flex;gap:16px;padding:8px;background:#ddd">
    <div><div style="font-weight:700;margin-bottom:4px">舊版 A ${row.aPath}</div><img src="${img('A')}" width="390"></div>
    <div><div style="font-weight:700;margin-bottom:4px">新版 B ${row.bPath}</div><img src="${img('B')}" width="390"></div></body>`);
  await pg.screenshot({ path: path.join(OUT, `${name}-side.png`), fullPage: true });
  await ctx.close();
  report.push(row);
  console.log(name, JSON.stringify({ A: row.A, B: row.B }));
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
