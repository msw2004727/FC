// 驗收預覽頁：file:// 開啟，檢查 console error、失效請求、破圖、水平捲動，並存總覽截圖。
// 用法：node verify.mjs <預覽資料夾>
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire('D:/Users/msw74/Documents/github/FC-B/package.json');
const { chromium } = require('@playwright/test');
const dir = path.resolve(process.argv[2]);
const url = pathToFileURL(path.join(dir, 'index.html')).href;
const browser = await chromium.launch();
let failed = false;
for (const [w, h, scheme, name] of [[1280, 900, 'light', 'overview-desktop.png'], [390, 844, 'dark', 'overview-mobile-dark.png']]) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('requestfailed', (r) => errs.push('fail ' + r.url()));
  await p.goto(url);
  // 捲到底觸發 lazy 圖片
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(800);
  const st = await p.evaluate(() => {
    const vis = [...document.images].filter((i) => i.offsetParent !== null);
    return {
      visibleImgs: vis.length,
      broken: vis.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  await p.screenshot({ path: path.join(dir, name) });
  if (errs.length || st.broken.length || st.hscroll) failed = true;
  console.log(name, JSON.stringify(st), 'errors', errs);
}
await browser.close();
process.exitCode = failed ? 1 : 0;
