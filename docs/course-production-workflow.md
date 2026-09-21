# Course production workflow

For executable Puttom/Johannesberg adapters, pinned inputs, pilot comparison and
actual rebuild/review commands, see the [production integration guide](course-production-integration.md).

Start here for every new ground and every course upgrade. The executable policy
is `banvy-course-production-v1` in
[`packages/course-workflow/standard.mjs`](../packages/course-workflow/standard.mjs).
It gives every course the same setup, ordered build stages, review inventory and
release checks. It does not acquire source data, invent geometry or turn an
experimental detector into an approved production method.

Use Node 22 or later. Commands below run from the repository root; `pnpm course`
is shorthand for `node packages/course-workflow/cli.mjs` and needs no additional
package installation. Keep geospatial tools pinned through the existing Pixi
toolchain and renderer dependencies through the lockfile.

## 1. Inspect or start a ground

```sh
pnpm course check
pnpm course audit --check --out output/course-production/audit.json --markdown output/course-production/audit.md

# Example identity and bounding box only; replace all values with the real site.
pnpm course init --ground example-ground --name "Example Golf Club" --courses example-main:18,example-nine:9 --bbox 16,59,16.1,59.1
pnpm course plan --ground example-ground
```

`init` creates `course-workflows/<ground>/workflow.json`, a planned source
manifest, an intake plan and a pending `review.json`. Every routing and hole gets
seven review categories. Existing directories and registered identities are
protected against accidental replacement. No runtime registration or geographic
asset is created by this command.

One physical ground owns its terrain and environment; multiple routings share
that ground. Add a new routing to the existing ground configuration and source
inventory, then regenerate a review template for all its routings. Do not create
a second terrain copy for the same property.

For a previously published ground without a workflow:

```sh
pnpm course adopt --ground existing-ground
```

All 10 existing grounds are already adopted in this change. Their 13 layouts and
198 holes have pending reviews and `releasePolicy: "advisory"`. This records the
backlog without claiming that current assets passed a new survey or review.
New grounds default to `required`. Adding a new routing to an existing ground
also requires that whole shared ground to qualify.

## 2. Use the common techniques and ground-specific evidence

| Area | Required approach |
|---|---|
| Sources and coordinates | Pin bounded source windows, dates and checksums. Use the source catalogue, independent controls and one approved SWEREF 99 TM/RH 2000 frame per ground. Retain uncertainty; never copy another ground's approval or offset. |
| Terrain | Use the shared `standard-ground-rings.mjs` contract: 469 tiles, a 4,096 m square core at 1 m, seven LODs and a 16,384 m world. Check edges, coverage, finite heights and source agreement. A larger required extent needs an explicit versioned policy change. |
| Routing and surfaces | Reconcile every hole with the current card and source imagery/survey. Review tees, greens, fairways, bunkers and water as geometry. Preserve accepted features and annotate uncertainty. Resolution and feature counts are not accuracy evidence. |
| Vegetation | Follow the [tree placement workflow](tree-placement-workflow.md): frozen references, held-out evaluation, independent canopy checks, reviewed play-relevant individuals, measured woodland stands and stable IDs. Adapt and validate Visby pilot methods on the target ground before adopting them. |
| Infrastructure | Review roads, paths, buildings, bridges and other relevant objects with measured/source-linked placement. Explain genuine absence explicitly. |
| Runtime | Use v2 terrain + Ghibli styling through the common graph, loader, height sampler and reviewed renderer configuration. Verify default selection, WebGPU, WebGL2, mobile, seasons, caching, offline reopen and a clear boot failure if v2 cannot be verified. Retain and verify GPK1 compatibility data; it is not an alternative player renderer. |

The [production guide](v2-course-runbook.md) contains the detailed spatial and
compiler contracts; the [mapping workflow](v2-course-mapping-workflow.md) contains
the source inspection and editing methods. Historical course chapters describe
their dated checkpoints, not the defaults for a new course.

## 3. Configure and run reviewed adapters

The six stages are fixed and ordered. Every stage needs an argument-array
`command`, existing `inputs`, and independently verifiable `outputs` in
`workflow.json`. Unconfigured stages stop execution; they never fall back to
an old course's builder silently.

| Stage | Adapter responsibility | Retained output examples |
|---|---|---|
| `sources` | Verify acquired windows, alignment controls, metadata and source checksums. | Source validation and coordinate-control reports. |
| `terrain` | Compile the standard terrain, rings and shell using the shared compiler. | Immutable terrain compilation and seam/coverage report. |
| `mapping` | Compile reviewed routing, surfaces, water and infrastructure. | Validated geometry and all-hole coverage report. |
| `vegetation` | Apply the reviewed canopy/object/stand method to the frozen geography. | Registry, stand fields, exclusions and evaluation report. |
| `assemble` | Emit one coherent graph for every shared routing and its exact GPK1 compatibility reference (`fallbackV1` in the schema). | Staged ground/course assets and catalogue references. |
| `validate` | Run geometry, source, graph, renderer and course-specific checks. | Validation reports and capture manifests for subsequent review. |

Adapter configuration example (the script must actually be implemented for the
target; it is not a bundled executable):

```json
{
  "command": ["node", "examplebuild/compile-terrain.mjs", "--out", "{public}"],
  "inputs": ["examplebuild/terrain-inputs.json", "examplebuild/compile-terrain.mjs"],
  "outputs": ["output/course-workflow/example-ground/public/grounds/example-ground/terrain"]
}
```

Commands execute directly, without a shell. Supported executables are Node,
Python, Pixi and pnpm. `{ground}` and `{public}` expand in arguments; adapters also
receive `BANVY_WORKFLOW_GROUND` and `BANVY_WORKFLOW_PUBLIC_ROOT`. Paths in
`inputs`/`outputs` are explicit repository-relative paths, without placeholders.
Adapters are trusted repository code; this runner is not a process sandbox.
Review existing scripts carefully: several publication tools default to the live
public directory and need a staging-capable adapter before use here.

Use separate immutable outputs per stage. A downstream stage must not overwrite
an earlier stage's outputs, its own inputs, or watched implementation. Include
the adapter directory and every relevant compiler, configuration, model and
dependency lockfile in `watch`/`inputs`. Raw download caches may remain local;
pin their source hashes and reproduce them in the adapter. Retain the reports
and checkpoints needed to verify receipts in CI. Do not use empty success
scripts or reports that merely claim an adapter ran.

```sh
pnpm course run --ground example-ground --through validate
# Or execute one stage after its prerequisites:
pnpm course run --ground example-ground --stage mapping
pnpm course plan --ground example-ground
```

The runner locks one ground during execution, records successful/failed runs
under `build-records/`, hashes inputs, outputs, implementation and previous
receipts, and resumes only unchanged work. A changed dependency invalidates
later stages. If a process is killed, inspect the interrupted run before removing
its `.run-lock`. Commit successful build records with the candidate and evidence.

## 4. Finish registration in staging

The initializer deliberately leaves these geographic and runtime decisions to
the reviewed implementation:

1. Move the completed source manifest into `geo_data/course-v2/<ground>/` when
   adding the ground to the source registry. Update its schema link and
   `workflow.sourceManifest`; keep referenced evidence paths valid. Register all
   slugs in `EXPECTED_GROUNDS` in `packages/course-geo/manifest.mjs` and add the
   source/window, migration and terrain-driver registrations its consumers need.
2. Use the shared terrain compiler/emitter and standard ring specification.
   Supply a reviewed ground driver, frame, source checksum and routing data.
3. Register compatibility build/card information in `COURSES` in
   `packages/course-pack/emit-manifest.mjs`; construct and verify actual GPK1
   packs. Emit all v2 course manifests against one shared ground generation.
4. Add the target's renderer/configuration to
   `apps/golf/src/engine/v2-frontier-configs.mjs` and its required supporting
   registrations. Validate the real player catalogue and default URL. Keep the
   candidate public files under `workflow.publicRoot` while reviewing.

Finish code/configuration changes before final captures. The candidate digest
includes the selected v2/player catalogue entries and graph, source ledger and
catalogue, retained source
artifacts, workflow policy, watched implementation and stage inputs. Code changes
after review invalidate the review. Evidence and review files should be outside
watched implementation/input directories to avoid circular fingerprints.

## 5. Review the exact candidate

```sh
pnpm course candidate --ground example-ground
pnpm course review-template --ground example-ground --out course-workflows/example-ground/review-candidate.json
pnpm course evidence --path course-workflows/example-ground/evidence/terrain-report.json
```

The template never overwrites an earlier review. Copy its contents into the
configured `reviewFile` after review, retaining prior evidence as needed. If you
change the `reviewFile` path or other workflow policy, recompute the candidate
digest before recording the final review. Each gate needs `passed`, the real
reviewer identity, timestamp, findings and file references with SHA-256 hashes.
Identify agent, human, survey or club review accurately; a hash authenticates
the submitted bytes, not the truth of the findings.

Every routing/hole must include tees, greens, fairways, bunkers, water,
vegetation and infrastructure. Each category must be `reviewed` or
`not-applicable`, with findings/absence rationale and hashed evidence. Tees and
greens cannot be marked not applicable. One evidence file may cover multiple
holes when it explicitly contains those inspections. Missing and unknown rows
block release.

The 14 required gates cover sources, coordinates, terrain, routing, surfaces,
vegetation, reproducibility, infrastructure, WebGPU, WebGL2, mobile, performance,
offline and rollback. Use the detailed guide's independent-control and visual
review requirements; a successful build does not replace them. Capture matched
views for every hole and relevant season/quality mode, retain source overlays
and discrepancies, and test the candidate that will actually be served.

Performance evidence needs one set for each of WebGPU, WebGL2 and mobile: named
device, matched scenario, baseline/candidate digests, evidence files and at least
three paired runs. Each run records positive `coldLoadMs` and `frameP95Ms` values
under `baseline` and `candidate`. The median must meet both the relative and
absolute limits. For a new ground, choose a documented comparable baseline on
the same hardware, camera path, quality and cache/network conditions.

Default engineering targets are at most 10% regression, 10 seconds cold load,
20 ms frame p95 on WebGPU, and 33.4 ms on WebGL2/mobile. These are explicit
starting budgets, not claims about measured app performance. Agree hardware and
budgets before collecting evidence; budget changes change the candidate identity.

## 6. Verify and promote without rebuilding

```sh
pnpm course release --ground example-ground --out output/course-production/example-release.json
```

Release succeeds only with current build receipts, valid graph/schema/topology,
an approved matching frame, acquired terrain/imagery/canopy source metadata, no
release-blocking source entries, current source artifacts, complete matching
review evidence and performance results. It then verifies every selected BVCH
chunk, decoded payload and reference, plus the GPK1 compatibility pack hash, identity,
framing and compressed streams, and direct player sidecar hashes. It does not
publish or merge.

Promote the reviewed content-addressed files into `apps/golf/public`, merging
the selected catalogue entries while preserving other grounds. Update GPK1
catalogue references consistently and retain the previous generation and rollback
instructions. Stage outputs under `workflow.publicRoot` are verified against the
promoted public root, so duplicate staged binary files need not be committed.
Keep every other declared input/output checkpoint available in CI. If a receipt
covers the whole catalogue, the merged catalogue must match that reviewed
snapshot; use precise per-ground outputs to avoid unnecessary dependencies.

```sh
pnpm course release --ground example-ground --public-root apps/golf/public
pnpm course audit --check
pnpm test
```

Review captures on the promoted candidate, including default v2 + Ghibli
activation and failure when v2 integrity checks cannot pass. Historical opt-out
links must open the same supported setup. A matching digest alone does not test
application routing; follow [the supported visual setup](v2-ghibli-only.md).
Ship the code, source ledger, candidate files, build records, evidence and review
in one PR. No test fixture geography belongs in the player catalogue.

## 7. CI and adoption policy

The `course production / course-production` job runs on every PR and main push,
without a changed-path filter. It tests this workflow, validates configurations,
audits all published manifests and compares the catalogue with the base commit.
New grounds, new shared routings and previously mandatory grounds must pass the
full release check. Deleting or downgrading an already mandatory workflow fails.
Make this job a required branch-protection check to enforce it at merge time;
adding the workflow file does not change repository protection settings.

Existing advisory grounds continue to report source/review gaps. To qualify one,
configure and run its adapters, resolve its evidence backlog, set its policy to
`required`, then create a review against that final policy and pass release.
The audit's successful exit means structural consistency, not survey approval;
use `release` for the stricter verdict. Retiring a mandatory course requires an
explicitly reviewed policy change rather than deleting its configuration.

The test suite exercises real Ribbingsfors, Lidingö and shared Johannesberg
manifest adoption, plus a synthetic 469-tile candidate from setup through release
and staging promotion. It tests stale dependencies, missing evidence, changed
assets, performance regression and CI policy preservation. Synthetic evidence
proves workflow behavior only. A real new ground still needs source acquisition,
reviewed adapters and geographic/rendering evidence before it can qualify.
