import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* The exact map entry served to this tab determines its offline package. Keep
   heavy player routes out of the map package and normal PWA installation. */
export function mapOfflineBuild() {
  let directory, manifest, paths;
  const plugin = {
    name: 'map-offline-assets',
    apply: 'build',
    // Vite can rehash a chunk during generateBundle after replacing preload
    // markers. Read the final written graph, before Workbox runs in closeBundle.
    writeBundle(options, bundle) {
      directory = options.dir;
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
      const session = chunks.find(chunk => chunk.name === 'map-session');
      if (!session) this.error('Missing mobile map session');
      const entry = chunks.find(chunk => chunk.isEntry && chunk.facadeModuleId?.endsWith('/index.html'));
      if (!entry) this.error('Missing mobile app shell');
      const shell = path.basename(entry.fileName, '.js');
      manifest = session.fileName.replace(/\.js$/, `.${shell}.offline.json`);
      paths = new Set(['index.html']);
      function include(file, dynamic = false) {
        if (paths.has(file)) return;
        paths.add(file);
        const chunk = bundle[file];
        if (chunk?.type !== 'chunk') return;
        for (const css of chunk.viteMetadata?.importedCss ?? []) paths.add(css);
        for (const dep of chunk.imports) include(dep);
        if (dynamic) for (const dep of chunk.dynamicImports) include(dep);
      }
      for (const chunk of chunks) {
        if (chunk.isEntry || ['map-app', 'hub', 'course-sheet'].includes(chunk.name) ||
            chunk.facadeModuleId?.endsWith('/shell/course-sheet.js')) include(chunk.fileName);
      }
      include(session.fileName, true);
      for (const file of Object.keys(bundle)) if (/\/map-guidance-worker-[^/]+\.js$/.test(file)) include(file);
    },
  };
  async function manifestTransform(entries) {
    const revisions = new Map(entries.map(entry => [entry.url, entry.revision]));
    for (const url of revisions.keys()) {
      if (/^(?:fonts\/|icons\/|favicon\.svg$|manifest\.webmanifest$|registerSW\.js$)/.test(url)) paths.add(url);
    }
    // Workers Static Assets redirects index.html to the scope root. A redirected
    // network response cannot satisfy a service-worker navigation on a cache miss.
    const deployedUrl = url => url === 'index.html' ? './' : url;
    const files = [...paths].sort().map(url => {
      const bytes = readFileSync(path.join(directory, url));
      return { url: deployedUrl(url), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(revisions.has(url) ? { precache: revisions.get(url) ?? null } : {}) };
    });
    writeFileSync(path.join(directory, manifest), JSON.stringify({ version: 2, files }));
    return { manifest: entries.map(entry => ({ ...entry, url: deployedUrl(entry.url) })), warnings: [] };
  }
  return { plugin, manifestTransform };
}
