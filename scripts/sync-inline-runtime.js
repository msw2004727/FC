#!/usr/bin/env node
/**
 * Sync index.html inline runtime block from app.js.
 * Required after editing app.js to keep production inline fallback in sync.
 * Verified by tests/unit/history-worker-fallback.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8').trim();
const indexPath = path.join(root, 'index.html');
const indexSrc = fs.readFileSync(indexPath, 'utf8');

const re = /(<script id="app-inline-runtime">\r?\n)([\s\S]*?)(\r?\n\s*<\/script>)/;
const m = indexSrc.match(re);
if (!m) {
  console.error('ERROR: <script id="app-inline-runtime"> block not found in index.html');
  process.exit(1);
}

// Preserve original line ending style of indent + closing tag
const out = indexSrc.replace(re, `$1${appSrc}$3`);
fs.writeFileSync(indexPath, out);
console.log(`Inline runtime synced: ${appSrc.length} chars from app.js`);
