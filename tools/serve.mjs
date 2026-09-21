/* The localhost static server the harnesses point Chromium at.

   usage: node tools/serve.mjs [root] [port]     (defaults: repo root, 8619)

   Plain http on 127.0.0.1, so the environment's TLS-intercepting proxy -- which
   Chromium cannot handshake through -- never enters the picture. No caching
   headers on purpose: every request reads the file as it is on disk right now,
   which is what a verification harness wants and a CDN would ruin.            */
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
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
    // Generated legacy redirect pages are real files. No SPA fallback: missing
    // HTML and data must fail here just as they do on GitHub Pages.
    res.writeHead(404); res.end('not found'); return;
  }
  /* Answer the way a real static host answers, because the harnesses pointed
     at this server are supposed to be testing the real thing.

     It used to stream every file with neither Content-Length nor
     Content-Encoding, which is a shape almost no host produces, and that cost
     two live failures in one day. Absent Content-Length was read as a declared
     zero and refused every chunk. Then GitHub Pages turned out to GZIP .bvch --
     declaring the compressed length, 81628 against an expected 81751 -- and
     the v2 pilot failed closed on the published site while every gate here
     passed. Neither was findable against a server that sends neither header.

     So: always Content-Length, and gzip whenever the client asks for it, which
     is what Pages does. The absent-header case keeps its coverage in the
     loaders' own unit tests, where it belongs. */
  const body = fs.readFileSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (wantsGzip) {
    const packed = zlib.gzipSync(body);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store',
                         'content-encoding': 'gzip', 'content-length': String(packed.length) });
    res.end(packed); return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store',
                       'content-length': String(body.length) });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
