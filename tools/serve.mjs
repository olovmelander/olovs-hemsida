/* The localhost static server the harnesses point Chromium at.

   usage: node tools/serve.mjs [root] [port]     (defaults: repo root, 8619)

   Plain http on 127.0.0.1, so the environment's TLS-intercepting proxy -- which
   Chromium cannot handshake through -- never enters the picture. No caching
   headers on purpose: every request reads the file as it is on disk right now,
   which is what a verification harness wants and a CDN would ruin.            */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = +(process.argv[3] || 8619);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const clean = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, clean === '/' ? 'index.html' : clean);
  /* a directory serves its index.html, the way every static host does -- without
     this the app is unreachable at a SUBPATH mount like /olovs-hemsida/, which
     is exactly where GitHub Pages serves it from */
  if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
  }
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    /* SPA fallback for .html paths: the app handles legacy page names itself
       (see src/shell/router.js), so the server's job is only to put the app in
       front of them -- which is exactly what the host will be configured to do.
       Anything else still 404s, so a missing pack stays a visible failure. */
    const idx = path.join(ROOT, 'index.html');
    if (/\.html$/.test(clean) && fs.existsSync(idx)) {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      fs.createReadStream(idx).pipe(res); return;
    }
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream',
                       'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
