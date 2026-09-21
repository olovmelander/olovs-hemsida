# Historical URLs enter the supported player

Vite now emits seven small HTML redirect documents into `apps/golf/dist`.
The Pages workflow publishes that directory without copying root HTML over it.
The same documents work at a domain root and a repository subpath, without
Cloudflare-specific rewrites. Vite's development server serves them too.

| Historical filename | App course |
|---|---|
| `veckefjarden3d.html` | `veckefjarden` |
| `norrfallsviken3d.html` | `norrfallsviken` |
| `puttom3d.html` | `puttom` |
| `angso3d.html` | `angso` |
| `upsala3d.html` | `upsala` |
| `johannesberg3d.html` | `johannesberg` |
| `veckefjardensgc.html` | `veckefjarden` (current championship course) |

The filename chooses the course even if a conflicting `bana` query is present.
Supported settings survive: `hal`, `vy`, `ljus`, `tee`, `skylt`, `ren`, `kiosk`,
`q`, `gl`, `hero` and `det`. Fragments survive too. Retired presentation flags
and unknown query keys are discarded. The 2023 viewer did not expose the newer
URL grammar; its bookmarks now use the same current course mapping.

`src/shell/legacy-links.mjs` owns the mapping and query policy. The app router
and `tools/legacy-page-redirects.mjs` share its function. Redirects use
`location.replace`, so Back does not get trapped at the old filename. They have
a visible course link as a fallback, and fetch no engine, CDN or model assets.

The updated service worker permits legacy navigations to use its offline app
shell. The shell's entry router performs the same redirect. This preserves
offline navigation once that worker is installed; opening the course offline
still requires its data to have been cached. An older installed worker adopts
this behavior after its normal update.

## Retained sources and validators

Root `*3d.html` files and `veckefjardensgc.html` are retained unchanged as
historical sources. Builders, standalone comparisons and
`packages/course-pack/check-pack.mjs` can still read their original embedded
data. They must read those repository sources, never the redirects in `dist`.
This change does not replace the independent data baselines with self-checks.

`tools/serve.mjs` serves real files without an HTML catch-all, matching the
Pages contract. An accidentally missing redirect or course asset is a 404.

## Checks

```sh
pnpm exec vitest run apps/golf/src/shell/router.test.mjs tools/legacy-page-redirects.test.mjs
pnpm --filter @banvy/golf build
node tools/check-legacy-links.mjs apps/golf/dist /
BANVY_BASE=/olovs-hemsida/ pnpm --filter @banvy/golf build
node tools/check-legacy-links.mjs apps/golf/dist /olovs-hemsida/
```

The focused browser check verifies all seven URLs before and after worker
installation, then stops its server and repeats offline. It verifies navigation
and query preservation without claiming full-course visual or offline readiness.
`tools/check-links.mjs` additionally checks the resulting player state;
`tools/check-basepath.mjs` checks course boot, fonts, manifests and data caching
under the deployment base.

## Implementation evidence

- All 42 navigation cases passed on the built root and `/olovs-hemsida/` apps:
  seven filenames before worker installation, after installation, and with the
  server stopped. Query settings and fragments reached the expected app URLs.
- App tests, focused router/build/dev-server tests, lint and syntax checks passed.
  Both deployment builds and validation of all 13 course graphs passed.
- The full subpath browser gate passed Veckefjärden boot, hole 14, fonts, PWA\n  scope and pack/manifest caching, then timed out during Puttom boot under\n  SwiftShader. Full Puttom browser acceptance remains unverified in this run.\n- The subpath build's seven redirect documents total 8,632 bytes, replacing
  5,541,115 bytes of published historical renderer HTML. Root source files are
  unchanged, and no course or model data is modified.
- Five retained HTML/pack comparisons pass. Puttom's vector comparison fails
  identically with the checker from unchanged main `ed41e81`; its height streams,
  metadata and 108 card values pass. That existing historical-source drift is
  recorded, not hidden by changing the checker or regenerating course data here.
- The former `CLAUDE.md` historical body is retained in full under
  `docs/archive/claude-history-2026-09.md`. Only its four relative Markdown links
  were adjusted; current guidance is 96 lines. All local links resolve.

Browser evidence uses SwiftShader and establishes navigation/behavior only.
No appearance or hardware performance change is claimed.
