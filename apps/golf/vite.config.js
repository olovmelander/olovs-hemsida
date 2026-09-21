/* Banvy's app/PWA build, with explicit modes for development studies.
   The app has no aliases, polyfills or special resolution: three.js is a normal
   dependency and the engine is plain modules.

   WHY A SERVICE WORKER AT ALL. A course is a 400 KB pack plus a 1.4 MB engine,
   and the brief names Android and iOS before desktop. Installed, Banvy opens a
   course it has already seen with no network at all -- which is the difference
   between "a website about golf courses" and something you can open standing on
   the 1st tee with one bar of signal.

   THE CACHING RULES MIRROR public/_headers ON PURPOSE. The CDN and the service
   worker are two caches in front of the same files; if they disagree about which
   ones are immutable, the bug only appears for people who installed the app,
   which is the worst possible place to find it. Read the two together. */
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { courseSourceRevision } from '../../tools/course-source-revision.mjs';
import { golferLabPlugin } from '../../experiments/golfer/vite-plugin.mjs';
import { productionPublicAssetsPlugin } from '../../tools/production-public-assets.mjs';

/* Cloudflare would serve this at a domain root; GitHub Pages serves it under the
   repository name. Vite rewrites the tags in index.html and every asset URL it
   processes, but it cannot touch three things, and all three are below: the web
   app manifest's own fields, the service worker's route patterns, and any URL
   the app builds at runtime (those read import.meta.env.BASE_URL instead). */
const BASE = process.env.BANVY_BASE || '/';
const COURSE_SLUGS = JSON.parse(readFileSync(new URL('./public/courses/index.json', import.meta.url), 'utf8')).courses.map(course => course.slug);
const SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_REVISION = courseSourceRevision(SOURCE_ROOT);

export default defineConfig(({ mode }) => {
  const golferLab = mode === 'golfer';
  return {
  cacheDir: golferLab ? 'node_modules/.vite-golfer' : 'node_modules/.vite',
  define: { __COURSE_SOURCE_REVISION__: JSON.stringify(SOURCE_REVISION), __GOLFER_LAB__: JSON.stringify(golferLab) },
  server: { host: '0.0.0.0', port: golferLab ? 5180 : 5173, strictPort: true, allowedHosts: ['terminal.local'] },
  /* The v2 decode Worker is a module worker, so its bundle must be ESM: an
     IIFE build cannot carry the entry's own imports. */
  worker: { format: 'es' },

  /* Where this build will be served from. Cloudflare would serve it at a domain
     root ('/'); GitHub Pages serves it under the repository name
     ('/olovs-hemsida/'). One config, both hosts -- and nothing in the app may
     assume either, which is why the runtime reads import.meta.env.BASE_URL
     instead of writing a leading slash. Vite guarantees that value ends in '/'. */
  base: BASE,

  build: { rollupOptions: { input: {
    main: fileURLToPath(new URL('./index.html', import.meta.url)),
    ...(golferLab ? { golfer: fileURLToPath(new URL('./golfer-study.html', import.meta.url)) } : {}),
  } } },

  plugins: [
    golferLabPlugin(golferLab),
    productionPublicAssetsPlugin(),
    {
      name: 'course-source-revision',
      generateBundle() {
        if (courseSourceRevision(SOURCE_ROOT) !== SOURCE_REVISION) this.error('Course runtime changed during build; rebuild to get a coherent startup revision');
        this.emitFile({ type: 'asset', fileName: 'course-startup-build.json', source: JSON.stringify({ revision: SOURCE_REVISION }) + '\n' });
      },
    },
    !golferLab && VitePWA({
      /* The whole view lives in the URL -- bana, hal, vy, ljus, tee, skylt, ren,
         q, gl -- so a reload restores exactly the view that was on screen. That
         is what makes autoUpdate safe here: the update costs a scene rebuild,
         not your place in the round. */
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      /* The tab icon is the SVG; these are the installed-app icons, drawn by
         tools/make-icons.py from the same three shapes so they cannot drift. */
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Banvy — svenska golfbanor i 3D',
        short_name: 'Banvy',
        description: 'Svenska golfbanor i 3D, mätta mot klubbarnas egna kort och byggda ur verklig terräng.',
        lang: 'sv',
        theme_color: '#0b1a13',
        background_color: '#0b1a13',
        display: 'standalone',
        orientation: 'any',        /* a course reads well in both; do not force one */
        /* NOT '/': on a subpath host that is someone else's site.
           An installed app opening the wrong page is the worst kind of
           bug, because it only appears once the app is installed. */
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        /* Precache the shell only: markup, engine, styles, fonts, icons.
           Course data arrives on demand and stays available offline. */
        globPatterns: ['index.html', 'assets/*.{js,css}', 'favicon.svg', 'icons/*.png', 'fonts/**'],
        /* All courses use v2. Load terrain and its matching surface code when
           opening a course, then cache it through runtime-code below. */
        globIgnores: [
          // A selected course loads its own scenery through the runtime-code
          // cache below. Installing the shell must not download other courses.
          ...COURSE_SLUGS.map(slug => `assets/${slug}-*.js`),
          'assets/v2-terrain-*.js',
          'assets/v2-graph-terrain-*.js',
          'assets/prepared-water-*.js',
          'assets/v2-flat-water-*.js',
          'assets/v2-water-bed-*.js',
          'assets/v2-surface-preview-*.js',
          'assets/v2-graph-source-*.js',
          'assets/v2-stream-probe-*.js',
          'assets/chunk-worker-*.js',
          'assets/terrain-render-data-*.js',
          'assets/surface-grid-*.js',
          'assets/surface-sdf-grid-*.js',
          'assets/decode-web-*.js',
          /* the vegetation runtime and its stand-field codec are reachable
             only from a v2 visit whose graph publishes trees */
          'assets/v2-vegetation-*.js',
          'assets/stand-field-*.js',
          /* the supported Ghibli tree loader arrives when a course opens */
          'assets/ghibli-trees-*.js',
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,   /* three.tsl is ~1 MB */

        /* No path routes exist, so the only navigations are / and the six legacy
           page names; those must still open the app offline. Everything under
           /courses/ is data, never a navigation -- the denylist is what stops a
           missing pack being answered with the HTML shell, exactly as the absent
           /* rule in _redirects does on the host. */
        navigateFallback: 'index.html',
        /* not anchored with ^: under a subpath the pathname is
           /olovs-hemsida/courses/... and an anchored pattern silently
           never matches, which would quietly disable offline packs */
        navigateFallbackDenylist: [
          /\/courses\//,
          /\/v2\//,
          /* The published v2 graph puts ground assets outside /courses/, and a
             missing chunk must be an honest 404 rather than the app shell --
             which would fail later on its GPK1/BVCH magic instead. */
          /\/grounds\//,
          /* Authored facilities are data too; an absent model must preserve
             its generic building fallback instead of receiving HTML. */
          /\/models\//,
          /* The seven standalone pages are REAL FILES on GitHub Pages -- pages.yml
             copies them beside the app, because that host has no rewrite rules --
             and they sit inside this worker's scope. Without this the navigation
             fallback answers them with the app shell, and a bookmarked link
             silently stops being the page that was bookmarked. MEASURED: before
             the worker installs, /veckefjarden3d.html?hal=3 serves the real page;
             after it installs, the same URL landed on /?bana=veckefjarden&hal=3
             carrying the app's bundle. The old gate could not see it, because the
             app redirects to the same hole and wears the same title.

             Matched with (\?|$) because workbox tests pathname AND SEARCH, so a
             bare $ would miss every shared link carrying the view grammar --
             exactly the links worth protecting. Only on a subpath: at a domain
             root these names are _redirects rewrites INTO the app, no file
             exists, and denying them would only cost the offline shell. */
          ...(BASE !== '/' ? [/\/[a-z]+3d\.html(\?|$)/, /\/veckefjardensgc\.html(\?|$)/] : []),
        ],

        runtimeCaching: [
          {
            // These publications use stable filenames and verify each model
            // against its manifest. Revalidate online; preserve both offline.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/(veckefjarden|visby)\/facilities-v1\.(json|glb)$/.test(url.pathname),
            handler: 'NetworkFirst',
            // Do not race a large model against a short cache timeout: an old
            // model cannot satisfy a freshly fetched manifest's checksum.
            options: { cacheName: 'banvy-stable-facilities',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/models\/veckefjarden\/landmarks-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'banvy-veckefjarden-landmarks-manifest', networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/veckefjarden\/(sjalevads-kyrka|paradiskullen-k90)-v1\.glb$/.test(url.pathname) &&
              /^[a-f0-9]{16}$/.test(url.searchParams.get('v') || ''),
            handler: 'CacheFirst',
            options: { cacheName: 'banvy-veckefjarden-landmarks',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // Module workers and on-demand scenery must survive an offline
            // reopen too. They are deliberately absent from shell precache.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/[^/]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-runtime-code',
              expiration: { maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/models\/trees\/ghibli-(fluffy|visby)\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'banvy-ghibli-foliage-manifest', networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // The pin flag's baked cloth (tools/build-flag-cloth.mjs) is named
            // by its sha256 and verified against it, so a cached copy is never
            // the wrong one; every course shares the one file.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/models\/flag\/cloth-[a-f0-9]{64}\.bin$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'banvy-flag-cloth',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/models\/trees\/(ghibli-fluffy|visby-pine)\/[a-f0-9]{64}\.(glb|png)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'banvy-ghibli-foliage-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // The current Puttom receipt selects a checksum-specific query on
            // its stable GLB filename, just as pack.bin is versioned below.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/puttom\/facilities-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-puttom-facilities-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Workbox keeps the full query in its cache key. Only a receipt
            // hash qualifies; bare mutable GLB requests must revalidate.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/puttom\/facilities-v1\.glb$/.test(url.pathname) &&
              /^[a-f0-9]{64}$/.test(url.searchParams.get('sha256') || ''),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-puttom-facilities',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/lidingo\/facilities-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-lidingo-facilities-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/lidingo\/facilities-[a-f0-9]{64}\.glb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-lidingo-facilities',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/ribbingsfors\/facilities-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-ribbingsfors-facilities-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/ribbingsfors\/facilities-[a-f0-9]{64}\.glb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-ribbingsfors-facilities',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The live Ängsö receipt selects a new geometry URL after each
            // Blender publication; the last successful visit also works offline.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/angso\/facilities-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-angso-facilities-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/angso\/facilities-[a-f0-9]{64}\.glb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-angso-facilities',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /* One mutable manifest selects the hash-verified architecture for
               both Johannesberg courses. Keep the last visit usable offline. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/johannesberg\/facilities-v1\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-johannesberg-facilities-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /* Only full SHA-256 filenames are immutable. A revised building
               asset gets a new URL, and the loader verifies the bytes again. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/models\/johannesberg\/facilities-[a-f0-9]{64}\.glb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-johannesberg-facilities',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Intake previews are verified, content-addressed JSON just like
            // playable assets; a visited preview remains available offline.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/courses\/[^/]+\/intake-[a-f0-9]{64}\.json$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-course-intakes',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /* The descriptor is provisional and may be replaced after a newly
               reviewed terrain build, so revalidate it before using cache. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/v2\/[^/]+\/(?:surface-)?preview\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-v2-preview-manifests',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* BVCH names are full SHA-256 identities and are verified again by
               the runtime, making year-long cache-first safe and fast. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/v2\/[^/]+\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-v2-terrain',
              expiration: { maxEntries: 96, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* Surface tiles have the same content-addressed integrity contract
               as terrain but stay separately budgeted so a future surface
               migration cannot evict the height pilot behind its back. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /\/v2\/[^/]+\/grounds\/[^/]+\/surface\/[a-f0-9]{64}\.bvch$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-v2-surface',
              expiration: { maxEntries: 96, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* The v2 graph's root, and the only mutable file in it. Network
               first for the same reason the GPK1 manifest is: it names the
               hashes everything else is fetched and verified by, so a stale
               root would pair new terrain with an outdated course identity --
               which selection then refuses, turning a cache artefact into a
               course that will not open. check-app-build requires this exact
               strategy and cache name before a graph may be registered. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('/courses/v2-index.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-v2-index',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* Graph manifests and chunks carry their full SHA-256 in the name
               and are verified again after download, so cache-first is both
               safe and the whole point of content addressing. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              (/\/courses\/[^/]+\/course-v2-[a-f0-9]{64}\.json$/.test(url.pathname) ||
               /\/courses\/[^/]+\/environment-water-[a-f0-9]{64}\.geojson$/.test(url.pathname) ||
               /\/grounds\/[^/]+\/ground-v2-[a-f0-9]{64}\.json$/.test(url.pathname) ||
               /\/(?:courses|grounds)\/[^/]+\/(?:routing|terrain|surface|objects|stands)\/[a-f0-9]{64}\.bvch$/
                 .test(url.pathname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-v2-graph',
              expiration: { maxEntries: 256, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* The manifest is the one file that must be current: it says which
               pack bytes are correct. Network first, cache only as the offline
               fallback. Matches Cache-Control: no-cache in _headers. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('/courses/index.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            /* Packs are content-addressed -- loadCourse puts the sha256 prefix in
               the query -- so a cached response can never be the wrong bytes for
               its URL, and cache-first is both safe and the whole point. This is
               the rule that makes a course open offline. */
            /* ... and the land-cover record beside it, versioned the same way */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/courses\/[^/]+\/(pack\.bin|landcover\.json|mown-surface\.json|surroundings\.json)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-packs',
              /* pack, land cover, mowing and surroundings, for thirteen courses */
              expiration: { maxEntries: 52, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* Posters are decoration and are NOT content-addressed, so they get
               the same treatment as in _headers: serve what we have, refresh
               behind. A re-render reaches people without a cache-busting trick. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/courses\/[^/]+\/hero-1\.webp$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'banvy-posters',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
        /* OpenStreetMap's tiles are deliberately NOT cached here. They are
           someone else's donated infrastructure and their usage policy is not
           ours to stretch by shipping a service worker that hoards them; the map
           needs a provider of its own before this is public (see map.js). */
      },
    }),
  ],
};
});
