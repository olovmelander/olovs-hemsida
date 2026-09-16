import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assets = new URL('./assets/', import.meta.url);
const files = ['golfer.json', 'golfer-male.json', 'banvy-golfer.glb', 'banvy-golfer-male.glb'];

/** The character assets belong to the lab, never the app's public directory. */
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
        const studio = path === '/golfer-study.html' || path === '/src/golfer-study.mjs' || /^\/src\/engine\/golfer(?:-course)?\.mjs$/.test(path);
        if (!model && !studio) return next();
        if (!enabled) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end('The golfer is a separate development lab. Start it with npm run dev:golfer.');
          return;
        }
        if (!model) return next();
        const name = path.slice('/models/golfer/'.length);
        if (!files.includes(name)) { response.statusCode = 404; response.end(); return; }
        try {
          const data = readFileSync(new URL(name, assets));
          response.setHeader('Content-Type', name.endsWith('.glb') ? 'model/gltf-binary' : 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Length', data.length);
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch (error) { next(error); }
      });
    },
    generateBundle() {
      if (!enabled) return;
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `models/golfer/${name}`, source: readFileSync(fileURLToPath(new URL(name, assets))) });
      }
    },
  };
}
