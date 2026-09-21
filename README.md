# olovs-hemsida

**[Banvy — svenska golfbanor i 3D](https://olovmelander.github.io/olovs-hemsida/)**

Swedish golf courses rendered in real time from source terrain, mapped geometry,
club material and imagery. The current v2 catalogue has 13 layouts on 10 grounds
using the common 1 m terrain/ring contract; mapping and review maturity varies.
The app is
installable, and a course you have already opened works with no network at all.

**Adding or upgrading a course?** Start with the
[course production workflow](docs/course-production-workflow.md): `pnpm course
init`, staged builds, all-hole evidence and the release check. Use `pnpm course
audit --check` to inspect the current catalogue. The older standalone builders
below are historical implementations, not new-course templates.

## The app

<https://olovmelander.github.io/olovs-hemsida/>

Pick a course from the front door, or deep-link straight into one:

    ?bana=veckefjarden&hal=14&vy=green      the island 14th, from the approach
    ?bana=norrfallsviken&ljus=host          autumn light
    ?bana=upsala&tee=6                      the sixth tee on a six-tee card

The full grammar is `bana hal vy ljus tee skylt ren kiosk q gl`.

## Historical links

These seven URLs now open the corresponding course in the v2 + Ghibli app,
preserving hole, camera, lighting, tee, marker and quality/backend settings.
The original HTML sources remain in the repository for data validation and
historical comparisons; they are no longer published as separate renderers:

| | |
|---|---|
| [Veckefjärdens GC](https://olovmelander.github.io/olovs-hemsida/veckefjarden3d.html) | Mästerskapsbanan at the fjärd, and the island 14th |
| [Norrfällsvikens GK](https://olovmelander.github.io/olovs-hemsida/norrfallsviken3d.html) | seaside links character on the High Coast |
| [Puttom (Örnsköldsviks GK)](https://olovmelander.github.io/olovs-hemsida/puttom3d.html) | forest and parkland between two lakes |
| [Ängsö GK](https://olovmelander.github.io/olovs-hemsida/angso3d.html) | the Mälaren peninsula north of Ängsön |
| [Upsala GK](https://olovmelander.github.io/olovs-hemsida/upsala3d.html) | Håmö gård, west of Uppsala |
| [Johannesberg G&CC](https://olovmelander.github.io/olovs-hemsida/johannesberg3d.html) | the manor course at Gottröra |
| [Veckefjärdens GC (2023)](https://olovmelander.github.io/olovs-hemsida/veckefjardensgc.html) | opens the current Mästerskapsbanan |

## Building and checking

For local development, use the combined `olovs-hemsida` checkout:

```powershell
cd C:\Users\olov_\repos\olovs-hemsida
npm --prefix apps/golf install   # first time, or after dependencies change
npm run dev
```

Open <http://localhost:5173/>. This checkout includes Tortuna alongside the
other courses. Development uses port 5173 explicitly and reports an error if
that port is already occupied, so it cannot silently start a different copy
on port 5174. If this checkout is already running, use its existing server;
otherwise stop the old server before starting it here.

`npm --prefix apps/golf run build` packages the combined application in
`apps/golf/dist`. Source acquisition and course regeneration are separate from
serving the retained runtime assets.

The [combined local release record](docs/local-integration-2026-09-10.md)
lists the integrated course updates and verification results.

    pnpm install
    pnpm --filter @banvy/golf build          # the app
    node tools/check-app.mjs                 # every course, through the app
    node tools/check-legacy-links.mjs        # seven redirects, online/offline
    node tools/check-links.mjs               # resulting course/view state
    node tools/check-pwa.mjs                 # it really works offline
    node tools/check-basepath.mjs            # it really works under /<repo>/

[CLAUDE.md](CLAUDE.md) contains current development guidance. The complete dated
[development notebook](docs/archive/claude-history-2026-09.md) retains geometry
provenance, measurements and the lessons behind the checks.

## Measured course-v2 programme

The survey-grade terrain, surface and real-object rollout is tracked in
[`docs/course-digital-twin-implementation-plan.md`](docs/course-digital-twin-implementation-plan.md).
The repeatable, course-by-course production workflow is in
[`docs/course-production-workflow.md`](docs/course-production-workflow.md).
Per-ground source and rights records live in [`docs/courses/`](docs/courses/).
All 13 selectable layouts on 10 grounds require a published v2 graph and reviewed
adapter. The player uses v2 terrain + Ghibli styling on WebGPU and WebGL2;
the app pins Three.js in [`apps/golf/package.json`](apps/golf/package.json).
New course publications still require the workflow's source, licence, per-hole,
visual and reference-device gates. Historical terrain/material previews remain
development fixtures, not selectable player styles.

    pnpm check:geo-sources                 # source checksums and licences
    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen test-controls
    pnpm check:course-v2                   # synthetic content-addressed graph
    pnpm check:course-v2-app               # all selectable graphs and PWA policy
    pnpm check:course-workflow            # current catalogue and release configurations

Study models remain available to local authoring tools. Production builds omit
the refined-tree and foliage-study catalogues; see
[`docs/repository-cleanup.md`](docs/repository-cleanup.md) for rebuild commands
and the retained historical evidence.

Deployed by `.github/workflows/pages.yml` on every push to `main`.
