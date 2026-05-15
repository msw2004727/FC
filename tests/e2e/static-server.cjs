const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const root = process.cwd();
const port = Number(process.argv[2] || process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function resolvePath(requestUrl) {
  const parsed = new URL(requestUrl, `http://${host}:${port}`);
  const decoded = decodeURIComponent(parsed.pathname);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const requested = path.join(root, normalized || 'index.html');
  const relative = path.relative(root, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { status: 403 };
  }
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return { file: requested };
  }
  if (!path.extname(decoded)) {
    return { file: path.join(root, 'index.html') };
  }
  return { status: 404 };
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const resolved = resolvePath(req.url || '/');
  if (!resolved.file) {
    res.writeHead(resolved.status || 404);
    res.end(resolved.status === 403 ? 'Forbidden' : 'Not Found');
    return;
  }

  const ext = path.extname(resolved.file).toLowerCase();
  res.writeHead(200, {
    'content-type': types[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(resolved.file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`E2E static server listening at http://${host}:${port}`);
});
