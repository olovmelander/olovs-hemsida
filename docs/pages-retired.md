# GitHub Pages retired

On 27 November 2026 the owner retired GitHub Pages: Banvy's one site is Cloudflare,
`https://banvy.olovmelander.workers.dev/`, with sign-in and sync. Pages no longer
serves the app. Its last publication moves visitors, and their data, to Cloudflare.

## What the old address serves

`.github/workflows/pages.yml` runs `tools/pages-moved-site.mjs` and publishes three
files under `/olovs-hemsida/`:

| File | Purpose |
|---|---|
| `index.html`, `404.html` | One page for every old address. It sends the visitor to the same page, query and hash on Cloudflare. A page is the root, one of the seven old bookmarks or a policy page (`MOVED_PAGES`); any other path goes to the start, since Cloudflare's 404 is blank. |
| `sw.js` | Stands at the old app's worker address. An installed old app updates to it. It deletes the old app's caches (its precache and `banvy-*`), unregisters, and reloads its windows, which then reach the page. |

The workflow needs no build and no dependencies. It runs only when those sources
change.

## A visitor's data

Stored data belongs to one site, so a returning visitor's rounds, shots, bag,
handicap and settings would otherwise stay behind on `olovmelander.github.io`. The
page reads the player's own keys by the backup's rules (`shell/backup-keys.mjs`).
Device-only state stays behind: the device id, GPS fixes, offline receipts and the
weather. It packs the keys as a backup (gzip, base64url) into the URL fragment:
`#flytt=<data>&h=<original hash>`. A browser never sends a fragment to a server.

On Cloudflare, `entry.js` runs `shell/move-in.mjs` first on every route:

1. The fragment leaves the address bar and history at once.
2. Data already read in or declined (`banvy_moved_in_v1`, a digest of the data, not
   of when it left) is dropped, and the visitor goes on to their bookmark.
3. Otherwise Inställningar, Konto och data, offers it through the backup's own
   confirmation. It says how many rounds and entries came, and how many would
   replace something already there. It keeps the live-round protection, sync marks
   and undo, then offers the way on to the bookmark. The data is held in memory
   only; a reload before answering drops it, and the next old bookmark brings it again.

`readMove` (in `settings-store.mjs`) keeps every entry a restore accepts and names
damaged ones, since nothing can be chosen again once the old app is gone. Past
500,000 characters of fragment (`MOVE_LIMIT`), the page offers the data as a backup
file to read in under Inställningar instead.

## Checks

```sh
pnpm exec vitest run apps/golf/src/shell/pages-move.test.mjs tools/pages-moved-site.test.mjs
# end to end: build the old app (BANVY_BASE=/olovs-hemsida/) and the new (BANVY_BASE=/)
node tools/check-pages-move.mjs --old <subpath dist> --new <root dist>
```

`check-pages-move.mjs` plays the whole move on two local origins:

1. The old app is installed with its worker, and a round is kept.
2. The old address is republished.
3. An old bookmark opened through the installed worker reaches Cloudflare. The data
   is offered once and read in, and the old worker and caches are gone.
4. A second bookmark goes straight to its course.
5. A visitor with nothing kept goes straight through.

On 27 November it passed, and a browser profile that had installed the live Pages
app before the redeploy moved the same way.

## What stays

The app still builds under a subpath, and `tools/check-basepath.mjs` still checks
that, but nothing deploys such a build. Switching Pages off entirely would break the
old links and strand any data not yet moved. That is the owner's call, best made
long after the old bookmarks and installed apps have had their chance to move.
