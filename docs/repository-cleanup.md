# Repository cleanup — September 2026

The supported player remains v2 terrain + Ghibli styling. This cleanup removes
unused runtime declarations, unreachable ocean fallback code, obsolete fallback
confirmation methods, and the unused Puttom opt-in helper. Source-ocean failures
still abort boot. The source-ocean diagnostic reports no DTM classification
tolerance because it uses source polygons. The continuous-ocean algorithm and
its independent tests remain available.

The retired procedural BARK generator was removed in PR #75. Its old browser
check could no longer run; that check, the bark-material and procedural-trunk
helpers, and their tests are now removed together. No player or working study
imports them. They remain recoverable at commit
`fa2c8a967b529ce640cde4547fe463cfb987b088`. The active bloom and water checks use
the app's pinned Three version; the water fixture reads today's painted shader.

## Generated output

Five compiled snapshots under `output/` are removed and ignored:

- `tree-commit-build-932e9715`
- `tree-study-build`
- `visby-pine-build`
- `visby-pine-cache-build`
- `witness-palette-build`

Rebuild the current application plus both tree comparison entries with:

```sh
pnpm install --frozen-lockfile
node tools/blender-tree-study/build_preview.mjs output/tree-study-build
```

That tool intentionally leaves course/public assets on the local course server.
To reproduce an old compiled snapshot exactly, use its original source revision;
the removed bytes also remain in Git at the commit above.

Rejected atelier GLBs are removed too. Their manifest and recovery instructions
remain in `output/tree-atelier-rejected-2026-09-13/`. Screenshots, reports,
reference captures, Blender sources and source/licence records are retained.
Together the five builds and 60 rejected GLBs remove 500 files / 358,611,811 bytes.
Removing current files does not rewrite Git history or shrink existing clones.

## Production packaging

`tools/production-public-assets.mjs` removes only `models/trees/refined/` and
`models/trees/foliage-study/` from a built application's output, before PWA cache
generation. Their public source directories and dev-server URLs stay available
to existing study pages, export scripts and checks. Explicit `--mode study`
builds retain them; the study build helper selects this mode.

Approved fluffy/Visby trees, course graphs, GPK1 compatibility data and other
player assets retain their existing paths. This reduces deployed files; it
does not represent an FPS gain or an equivalent reduction in player downloads,
because study models were never fetched by the player.

The seven published standalone pages still have bookmark and course-pack
verification contracts. They remain in this change; retiring their deployment
requires preserving those links and migrating the remaining validators.

## Verification

- 969 app/packaging tests passed across the main run and the source-fixture rerun;
  the initial sparse checkout lacked the retained Lidingö GeoJSON.
- 23 coastal/source-ocean tests passed; app lint and syntax checks passed.
- Production and tree-study builds passed, plus validation of all 13 published
  graphs and their cache policy.
- 12,406 retained public files were present in the production build. All 97
  retained tree files matched their sources byte-for-byte. The two excluded
  study directories contain 57 files / 89,308,775 bytes and remain in source.
- The bloom check passed its three captures; the water check passed all 24 cases
  against the live painted shader using Three r186 and SwiftShader WebGL2.
  These are isolated correctness checks, not hardware performance evidence.
