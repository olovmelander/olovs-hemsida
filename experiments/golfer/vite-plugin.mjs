import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assets = new URL('./assets/', import.meta.url);
const files = ['golfer.json', 'golfer-male.json', 'banvy-golfer.glb', 'banvy-golfer-male.glb'];
// Revision 3 (7 November) is served by default. The dev server serves the
// September golfers (assets/v1) to a page opened with ?golferset=v1.
const before = new URL('./assets/v1/', import.meta.url);

/** The character assets live with the lab, never in the app's public directory.
    Since Spela (apps/golf/src/play) every build serves and publishes the models;
    a player downloads one only when they play, and the service worker never
    precaches them. The character studio itself stays a lab page. */
export function golferLabPlugin(enabled) {
  let base = '/';
  return {
    name: 'banvy-golfer-lab',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const path = base !== '/' && pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
        const model = path.startsWith('/models/golfer/');
        // The golfer runtime (engine/golfer.mjs) is Spela's too; only the lab's own pages stay closed.
        const studio = path === '/golfer-study.html' || path === '/src/golfer-study.mjs' || path === '/src/engine/golfer-course.mjs';
        if (!model && !studio) return next();
        if (!enabled && !model) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end('The golfer is a separate development lab. Start it with npm run dev:golfer.');
          return;
        }
        if (!model) return next();
        const name = path.slice('/models/golfer/'.length);
        if (!files.includes(name)) { response.statusCode = 404; response.end(); return; }
        try {
          const page = request.headers.referer ? new URL(request.headers.referer).searchParams : new URLSearchParams();
          const data = readFileSync(new URL(name, page.get('golferset') === 'v1' ? before : assets));
          response.setHeader('Content-Type', name.endsWith('.glb') ? 'model/gltf-binary' : 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Length', data.length);
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch (error) { next(error); }
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `models/golfer/${name}`, source: readFileSync(fileURLToPath(new URL(name, assets))) });
      }
    },
  };
}
