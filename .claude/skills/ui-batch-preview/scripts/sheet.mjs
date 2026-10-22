// PM 驗收用縮圖總表：每個情境 A、B 並排縮成 195px 寬，一張圖看 6 個情境，省去逐張開圖。
// 用法：node sheet.mjs <outDir> <light|dark> <情境1,情境2,...> <輸出.png>
// 圖片用 data URI 內嵌：setContent 的頁面是 about:blank，載不到 file:// 圖（2026-10-22 T-017 新增）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join('D:/Users/msw74/Documents/github/FC-B', 'package.json'));
const { chromium } = require('@playwright/test');
const [outDir, theme, list, out] = process.argv.slice(2);
const cells = list.split(',').map((n) => ['A', 'B'].map((s) => {
  const f = path.join(outDir, 'shots', `${n}-${s}-${theme}.png`);
  return fs.existsSync(f)
    ? `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${n} ${s}</figcaption></figure>`
    : `<figure>缺 ${n}-${s}</figure>`;
}).join('')).join('');
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await p.setContent(`<meta charset="utf-8"><style>body{margin:0;display:grid;grid-template-columns:repeat(6,195px);gap:4px;font:11px sans-serif}img{width:195px;display:block}figure{margin:0}</style>${cells}`);
await p.waitForTimeout(500);
await p.screenshot({ path: out, fullPage: true });
await browser.close();
