#!/usr/bin/env node
// build-index.mjs —— 讀取 <預覽資料夾>/items.json，產生單檔、可離線開啟的 index.html
// 用法：node build-index.mjs <預覽資料夾>（省略時用本檔所在資料夾）；標題取 items.json 的 title
// 只用 Node 內建模組，無第三方套件。

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || here;
const inPath = join(dir, 'items.json');
const outPath = join(dir, 'index.html');

// ---- 讀資料 ----
const data = JSON.parse(readFileSync(inPath, 'utf8'));
const items = Array.isArray(data.items) ? data.items : [];
const generated = data.generated || '';
const ruleText = data.rule || '';

// ---- HTML escape ----
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v == null ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

// ---- 統計與分區 ----
const totalCount = items.length;
const ownerItems = items.filter((it) => it.needs_owner_decision === true);
const highItems = items.filter((it) => it.priority === '高' && it.needs_owner_decision !== true);
const midItems = items.filter((it) => it.priority === '中' && it.needs_owner_decision !== true);
const lowItems = items.filter((it) => it.priority === '低' && it.needs_owner_decision !== true);
const statHigh = items.filter((it) => it.priority === '高').length;
const statMissing = items.filter((it) => it.b_missing === true).length;

// ---- PM 建議色塊 ----
const VERDICT_CLASS = { '照舊版': 'verdict-green', '採優化': 'verdict-blue', '建議略過': 'verdict-gray' };
const verdictClass = (v) => VERDICT_CLASS[v] || 'verdict-purple';

// ---- 截圖連結 ----
function renderShotLink(href, alt, cls) {
  if (!href) return '';
  const h = esc(href);
  return `<a class="shot-link ${cls}" href="${h}" target="_blank" rel="noopener"><img src="${h}" alt="${esc(alt)}" loading="lazy"></a>`;
}

// ---- 單一卡片 ----
function renderCard(item) {
  const id = esc(item.id);
  const title = esc(item.title);
  const area = esc(item.area);

  const tags = [];
  if (item.priority) tags.push(`<span class="tag tag-priority">優先：${esc(item.priority)}</span>`);
  if (item.effort) tags.push(`<span class="tag">工作量：${esc(item.effort)}</span>`);
  if (item.needs_backend === true) tags.push(`<span class="tag tag-backend">需後端</span>`);
  if (item.owner_directive === true) tags.push(`<span class="tag tag-owner">站長指示</span>`);
  if (item.b_missing === true) tags.push(`<span class="tag tag-missing">B 尚未實作</span>`);

  const shots = item.shots || {};
  const base = item.title || item.id || '';
  const aLight = renderShotLink(shots.a_light, `舊版 A 截圖：${base}`, 'shot-light');
  const aDark = renderShotLink(shots.a_dark, `舊版 A（深色）截圖：${base}`, 'shot-dark');
  const bLight = renderShotLink(shots.b_light, `新版 B 截圖：${base}`, 'shot-light');
  const bDark = renderShotLink(shots.b_dark, `新版 B（深色）截圖：${base}`, 'shot-dark');

  const out = [];
  out.push(`<article class="card" id="${id}">`);
  out.push(`  <div class="card-head">`);
  out.push(`    <span class="id-badge">${id}</span>`);
  out.push(`    <h3 class="card-title">${title}</h3>`);
  out.push(`    <span class="area-badge">${area}</span>`);
  out.push(`  </div>`);
  if (tags.length) out.push(`  <div class="tags">${tags.join('')}</div>`);

  out.push(`  <div class="shots">`);
  out.push(`    <div class="shot-col">`);
  out.push(`      <div class="shot-label">舊版 A</div>`);
  out.push(aLight);
  out.push(aDark);
  if (item.a_note) out.push(`      <p class="note">${esc(item.a_note)}</p>`);
  out.push(`    </div>`);
  out.push(`    <div class="shot-col">`);
  out.push(`      <div class="shot-label">新版 B 現況</div>`);
  if (item.b_missing === true) out.push(`      <div class="red-banner">B 尚未實作（截圖為目前畫面）</div>`);
  out.push(bLight);
  out.push(bDark);
  out.push(`    </div>`);
  out.push(`  </div>`);

  if (item.summary) {
    out.push(`  <div class="block">`);
    out.push(`    <div class="block-label">差異</div>`);
    out.push(`    <p>${esc(item.summary)}</p>`);
    out.push(`  </div>`);
  }

  out.push(`  <div class="block block-suggest">`);
  out.push(`    <div class="block-label">改後會長這樣</div>`);
  out.push(`    <p>${esc(item.suggestion)}</p>`);
  if (item.user_feel) out.push(`    <p class="feel">${esc(item.user_feel)}</p>`);
  out.push(`  </div>`);

  out.push(`  <div class="block">`);
  out.push(`    <div class="block-label">PM 建議</div>`);
  out.push(`    <p><span class="verdict ${verdictClass(item.pm_verdict)}">${esc(item.pm_verdict)}</span> ${esc(item.pm_reason)}</p>`);
  out.push(`  </div>`);

  if (item.risk) {
    out.push(`  <p class="risk"><span class="risk-label">風險：</span>${esc(item.risk)}</p>`);
  }

  out.push(`  <details class="refs">`);
  out.push(`    <summary>程式位置（工程用）</summary>`);
  out.push(`    <div class="ref-item"><span class="ref-label">a_ref：</span><code>${esc(item.a_ref)}</code></div>`);
  out.push(`    <div class="ref-item"><span class="ref-label">b_ref：</span><code>${esc(item.b_ref)}</code></div>`);
  out.push(`  </details>`);
  out.push(`</article>`);

  return out.join('\n');
}

const renderCardList = (list) => list.map(renderCard).join('\n');

// ---- 目錄 ----
function renderToc(list) {
  const lis = list.map((it) => {
    const parts = [`<span class="toc-id">${esc(it.id)}</span> ${esc(it.title)}`];
    if (it.pm_verdict) parts.push(`<span class="toc-verdict">— ${esc(it.pm_verdict)}</span>`);
    return `<li><a href="#${esc(it.id)}">${parts.join(' ')}</a></li>`;
  });
  return [
    `<nav class="toc" aria-label="目錄">`,
    `  <h2>目錄</h2>`,
    `  <ol class="toc-list">`,
    ...lis.map((l) => `    ${l}`),
    `  </ol>`,
    `</nav>`,
  ].join('\n');
}

// ---- 分區 ----
const sections = [];

if (ownerItems.length) {
  sections.push([
    `<section class="group group-owner">`,
    `  <h2 class="group-title">需站長決定<span class="count">（${ownerItems.length}）</span></h2>`,
    `  <p class="group-hint">請站長回覆：同意 PM 建議／改成其他做法</p>`,
    renderCardList(ownerItems),
    `</section>`,
  ].join('\n'));
}

if (highItems.length) {
  sections.push([
    `<section class="group">`,
    `  <h2 class="group-title">高優先<span class="count">（${highItems.length}）</span></h2>`,
    renderCardList(highItems),
    `</section>`,
  ].join('\n'));
}

if (midItems.length) {
  sections.push([
    `<details class="group" open>`,
    `  <summary class="group-title">中優先<span class="count">（${midItems.length}）</span></summary>`,
    renderCardList(midItems),
    `</details>`,
  ].join('\n'));
}

if (lowItems.length) {
  sections.push([
    `<details class="group" open>`,
    `  <summary class="group-title">低優先<span class="count">（${lowItems.length}）</span></summary>`,
    renderCardList(lowItems),
    `</details>`,
  ].join('\n'));
}

// ---- CSS ----
const CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  --bg: #f4f6fa;
  --fg: #1b2333;
  --muted: #5a6678;
  --card-bg: #ffffff;
  --card-border: #e3e8ef;
  --badge-bg: #eef2f7;
  --badge-fg: #334155;
  --link: #2563eb;
  --accent: #2563eb;
  --accent-fg: #ffffff;
  --suggest-bg: rgba(59, 130, 246, 0.07);
  --amber-bg: #fff7e6;
  --amber-border: #f0a020;
  --red-bg: #dc2626;
  --red-fg: #ffffff;
  --red-badge-bg: #fee2e2;
  --red-badge-fg: #991b1b;
  --green-bg: #dcfce7;
  --green-fg: #14532d;
  --blue-bg: #dbeafe;
  --blue-fg: #1e3a8a;
  --gray-bg: #e5e7eb;
  --gray-fg: #374151;
  --purple-bg: #ede9fe;
  --purple-fg: #5b21b6;
  --risk-fg: #b91c1c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #e2e8f0;
    --muted: #94a3b8;
    --card-bg: #1e293b;
    --card-border: #334155;
    --badge-bg: #334155;
    --badge-fg: #cbd5e1;
    --link: #7dd3fc;
    --accent: #60a5fa;
    --accent-fg: #0b1220;
    --suggest-bg: rgba(96, 165, 250, 0.12);
    --amber-bg: #2c2011;
    --amber-border: #d97706;
    --red-bg: #dc2626;
    --red-fg: #ffffff;
    --red-badge-bg: #7f1d1d;
    --red-badge-fg: #fecaca;
    --green-bg: #14532d;
    --green-fg: #bbf7d0;
    --blue-bg: #1e3a8a;
    --blue-fg: #bfdbfe;
    --gray-bg: #374151;
    --gray-fg: #d1d5db;
    --purple-bg: #4c1d95;
    --purple-fg: #ddd6fe;
    --risk-fg: #fca5a5;
  }
}

body {
  margin: 0 auto;
  max-width: 1100px;
  padding: 24px 16px 64px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  overflow-x: hidden;
}

h1 { font-size: 1.45rem; line-height: 1.35; margin: 0 0 8px; }
h2 { font-size: 1.15rem; margin: 0 0 8px; }
a { color: var(--link); }
p { margin: 0 0 8px; }

/* 頁首 */
.lead { color: var(--muted); margin: 0 0 14px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
.stat {
  padding: 4px 14px;
  border-radius: 999px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  font-size: 0.9rem;
}
.stat b { font-size: 1rem; }
.stat-warn { border-color: var(--amber-border); }
.stat-danger b { color: var(--risk-fg); }
.meta { font-size: 0.9rem; color: var(--muted); margin: 0 0 6px; }
.rule {
  font-size: 0.82rem;
  color: var(--muted);
  background: var(--card-bg);
  border: 1px dashed var(--card-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0 0 14px;
}
.theme-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.theme-bar > span { font-size: 0.9rem; color: var(--muted); }
.theme-btn {
  font: inherit;
  font-size: 0.9rem;
  padding: 5px 16px;
  border-radius: 999px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--fg);
  cursor: pointer;
}
.theme-btn.active { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }

/* 目錄 */
.toc {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  padding: 16px 20px;
  margin: 20px 0 28px;
}
.toc h2 { margin: 0 0 8px; }
.toc-list { margin: 0; padding-left: 1.6em; }
.toc-list li { margin: 3px 0; }
.toc-list a { text-decoration: none; }
.toc-list a:hover { text-decoration: underline; }
.toc-id { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em; color: var(--muted); }
.toc-verdict { color: var(--muted); font-size: 0.9em; }

/* 分區 */
.group { margin: 0 0 28px; }
.group-title { font-size: 1.15rem; font-weight: 700; margin: 0 0 10px; }
.count { font-size: 0.9rem; color: var(--muted); font-weight: 400; margin-left: 4px; }
.group-hint { font-size: 0.9rem; color: var(--muted); margin: -4px 0 12px; }
.group-owner {
  background: var(--amber-bg);
  border: 2px solid var(--amber-border);
  border-radius: 14px;
  padding: 16px 16px 4px;
}
details.group > summary { cursor: pointer; list-style: none; }
details.group > summary::-webkit-details-marker { display: none; }
details.group > summary::before { content: "▶"; font-size: 0.7em; color: var(--muted); margin-right: 6px; }
details.group[open] > summary::before { content: "▼"; }

/* 卡片 */
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  padding: 16px 18px;
  margin: 0 0 16px;
  scroll-margin-top: 16px;
}
.group-owner .card { border-color: var(--amber-border); }
.card-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.id-badge {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  font-weight: 700;
  background: var(--badge-bg);
  color: var(--badge-fg);
  border-radius: 6px;
  padding: 2px 8px;
}
.card-title { font-size: 1.05rem; margin: 0; flex: 1 1 12em; min-width: 0; }
.area-badge {
  font-size: 0.78rem;
  color: var(--muted);
  background: var(--badge-bg);
  border-radius: 6px;
  padding: 2px 8px;
  white-space: nowrap;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.tag { font-size: 0.78rem; padding: 1px 10px; border-radius: 999px; background: var(--badge-bg); color: var(--badge-fg); }
.tag-missing { background: var(--red-badge-bg); color: var(--red-badge-fg); font-weight: 700; }

/* 截圖 */
.shots { display: grid; grid-template-columns: 1fr; gap: 16px; margin: 4px 0 14px; }
@media (min-width: 701px) { .shots { grid-template-columns: 1fr 1fr; } }
.shot-col { min-width: 0; }
.shot-label { font-size: 0.85rem; font-weight: 700; color: var(--muted); text-align: center; margin-bottom: 6px; }
.shot-link { display: block; max-width: 320px; margin: 0 auto; }
.shot-link img {
  display: block;
  width: 100%;
  max-width: 320px;
  height: auto;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: #fff;
}
body.theme-light .shot-dark { display: none; }
body.theme-dark .shot-light { display: none; }
.red-banner {
  max-width: 320px;
  margin: 0 auto 6px;
  background: var(--red-bg);
  color: var(--red-fg);
  text-align: center;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 6px;
}
.note { max-width: 320px; margin: 6px auto 0; font-size: 0.8rem; color: var(--muted); }

/* 段落 */
.block { margin-top: 12px; }
.block-label { font-size: 0.78rem; font-weight: 700; color: var(--muted); letter-spacing: 0.06em; margin-bottom: 3px; }
.block p { margin: 0; }
.block p + p { margin-top: 6px; }
.block-suggest { background: var(--suggest-bg); border-radius: 10px; padding: 10px 12px; }
.block-suggest .block-label { color: var(--link); }
.feel { font-size: 0.9rem; color: var(--muted); }
.verdict {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 1px 10px;
  border-radius: 999px;
  margin-right: 6px;
  vertical-align: 1px;
}
.verdict-green { background: var(--green-bg); color: var(--green-fg); }
.verdict-blue { background: var(--blue-bg); color: var(--blue-fg); }
.verdict-gray { background: var(--gray-bg); color: var(--gray-fg); }
.verdict-purple { background: var(--purple-bg); color: var(--purple-fg); }
.risk { font-size: 0.85rem; color: var(--risk-fg); margin: 12px 0 0; }
.risk-label { font-weight: 700; }

/* 工程參照 */
.refs { margin-top: 14px; font-size: 0.82rem; }
.refs > summary { cursor: pointer; color: var(--muted); }
.ref-item { display: flex; gap: 6px; margin-top: 5px; }
.ref-label { flex: 0 0 auto; color: var(--muted); }
.ref-item code { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }

/* 頁尾 */
footer {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--card-border);
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
}
`;

// ---- JS（只負責截圖深淺色切換） ----
const JS = `
(function () {
  var buttons = document.querySelectorAll('.theme-btn');
  function setTheme(name) {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add('theme-' + name);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-theme') === name);
    }
  }
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      setTheme(this.getAttribute('data-theme'));
    });
  }
})();
`;

// ---- 組頁面 ----
const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title || 'UI 預覽')}</title>
<style>${CSS}</style>
</head>
<body class="theme-light">

<header class="site-header">
  <h1>${esc(data.title || 'UI 預覽')}</h1>
  <p class="lead">左＝舊版 A（正式站），右＝新版 B（目前狀態）。下方「改後會長這樣」是預計改動。</p>

  <div class="stats">
    <span class="stat">總項數 <b>${totalCount}</b></span>
    <span class="stat stat-warn">需站長決定 <b>${ownerItems.length}</b></span>
    <span class="stat">高優先 <b>${statHigh}</b></span>
    <span class="stat stat-danger">B 尚未實作 <b>${statMissing}</b></span>
  </div>

  <p class="meta">資料產生日期：<b>${esc(generated)}</b></p>
  <p class="rule">選項規則：${esc(ruleText)}</p>

  <div class="theme-bar">
    <span>截圖：</span>
    <button class="theme-btn active" type="button" data-theme="light">淺色</button>
    <button class="theme-btn" type="button" data-theme="dark">深色</button>
  </div>
</header>

${renderToc(items)}

<main>
${sections.join('\n\n')}
</main>

<footer>本頁由 build-index.mjs 依 items.json 產生</footer>

<script>${JS}</script>
</body>
</html>
`;

// ---- 輸出（無 BOM、統一 LF） ----
const finalHtml = html.replace(/\r\n?/g, '\n');
writeFileSync(outPath, finalHtml, 'utf8');

const size = statSync(outPath).size;
console.log(`已產生 ${outPath}`);
console.log(`項目數：${items.length}，檔案大小：${size} bytes`);
