# Lidingö tee and out-of-bounds alignment

All 18 tee areas were reviewed against the latest complete Lantmäteriet campaign available on 9 September 2026. The contributing imagery was captured **31 May 2025**, with **0.16 m native pixels**. The [acquisition report](lm-alignment-imagery-2026-09-09.md) records the live catalog check, source dates, native grids and checksums.

The course now has **52 distinct playing tee platforms**, represented by 54 hole associations because holes 2/4 and holes 15/17 share physical surfaces. There are **81 reviewed colour references** with representative marker pairs contained by their nominated turf. The other **9 Orange references**—holes 10–18—remain explicit camera fallbacks on identified turf; their physical marker display is withheld. None of the displayed pairs claims to locate today's movable tee markers.

The earlier model contained 36 hole-associated platforms and placed all 90 colour references on just 34 distinct centers. It also suppressed every tee marker on Lidingö. The new review separates the missing forward platforms, corrects hole associations, replaces displaced or oversized outlines with observed mowing edges, and enables only supported colour groups. In particular:

- Holes 1 and 5 gain their separate red/orange platforms.
- Hole 2's white/yellow platforms and missing blue/red and Orange platforms now have their correct associations. Its former `a` outline was associated with the wrong hole area.
- Hole 4 Orange shares the hole 2 White platform. The exact native-window transformation preserves its geometry; the two starts face opposite directions.
- Holes 6–9 gain missing rear/forward platforms, including visibly distinct small Orange platforms.
- Hole 11's merged outline is separated into two platforms. Holes 12, 13, 14 and 18 gain previously missing platforms.
- The old hole 17 range strip is removed from the playing-tee inventory; its shared rear platform with hole 15 has one rendered ground owner and separate per-hole references.

Tree shadow obscures portions of the hole 5 and hole 8 boundaries. Those traces explicitly represent conservative visible turf, with larger interpretation uncertainty. Full hidden boundaries and absolute survey accuracy remain unresolved. The club-linked guides establish relative platform grouping and tee order; their illustrated positions and scorecard distances were not used as geographic geometry.

A [follow-up check of the live guide and official club material](orange-source-followup-2026-09-09.json) found no additional geographic dataset. A subsequent full-guide cross-check resolved hole 4 Orange on the shared hole 2 White platform. The back-nine unresolved entries do not assert that those tees are absent on the real course.

The [OB review](ob-placement-review.md) adds **six virtual map segments, approximately 503 m**, along visible asphalt edges that the club's 2026 local rules define as out of bounds on holes 2, 11, 12, 14 and 15. All 57 vertices retain their source-pixel transforms. Individual white stakes and the fence behind hole 10 are insufficiently resolved for precise physical placement. No regularly spaced stakes were generated from the road lines.

The exact EPSG:3006 frame, 277 terrain tiles, original elevations, water, greens, fairways, bunkers and buildings are preserved. Fourteen canopy stand tiles were refreshed to respect the new tee exclusions. This is a provisional image-based course update, not a survey or a claim about changes after May 2025.

## Reproduce and inspect

The canonical review is [tee-native-alignment-review-2026-09-09.json](tee-native-alignment-review-2026-09-09.json), assembled from the separately retained front-five, holes 6–9 and back-nine reviews. The source PNGs and inspection overlays remain in ignored local caches. The [front-five independent check](tee-review-front5-independent.json) records the original 15 outlines and 25 reference points against its retained review hash. It predates the [supplemental forward-tee check](tee-review-forward-2026-09-09.json), which adds hole 4 Orange as another association with the existing hole 2 White surface.

```powershell
node lidingobuild/mapping/assemble-native-tee-review.mjs
node lidingobuild/mapping/reviewed-tee-alignment.mjs --surfaces-only
node lidingobuild/build-course.mjs
node --test lidingobuild/mapping/reviewed-tee-alignment.node-test.mjs lidingobuild/mapping/ob-placement.node-test.mjs lidingobuild/mapping/publish-reviewed-stands.node-test.mjs
node lidingobuild/mapping/tee-runtime-audit.mjs
```

`build-playing-surfaces.py` also reapplies the native tee review after reconstructing the older source layers, so a rebuild cannot silently restore superseded tees. Source changes require a fresh migration, compatibility pack, canopy exclusion compilation and ledger refresh before running `publish-reviewed-stands.mjs --write`. That publisher preserves the expanded terrain graph; the historical fixed-pyramid compiler is not suitable for this update.

The software checks cover native pixel transforms, valid polygons, per-colour platform containment, unresolved-marker suppression, repeatable source application, unchanged card/routing data, shared-surface ownership, source-to-pack equality and preservation of all terrain tiles.

The final [WebGPU browser validation](tee-ob-runtime-validation.json) **passed all 15 gates** against the current model and pack. It checks all 18 loaded holes, all 162 actual GPU marker instances, the six dashed OB map segments and 57 vertices, and four real tee-selector/camera interactions on holes 1, 10, 12 and 18. The independent [runtime geometry audit](tee-runtime-validation.json) checks all 90 reference coordinates. Screenshots of holes 1, 10 and 18 were also inspected. No browser exceptions remained.

The browser exposed a pre-existing startup failure caused by Windows changing the content-addressed surrounding-water GeoJSON's final newline. Restoring the original LF bytes recovered the exact expected checksum and size. Narrow Git line-ending rules and a shipped-file identity regression protect that contract without weakening the loader checks.

The [WebGPU tee/OB verification](tee-ob-runtime-validation.json) passed against the rebuilt production app: all 162 marker instances match the pack, fit inside their nominated platforms and sit at the measured terrain height. All six reviewed OB segments reach the map canvas, with zero physical white stakes. Yellow-tee views on holes 1, 10, 12 and 18 retain the selected reference and forward aim. The Lidingö check suite passes all 32 checks. The browser also exposed a Windows newline conversion in the existing surrounding-water asset; its original checksummed bytes were restored and pinned to LF without changing any water geometry.

Changes are in the local workspace; no remote deployment is part of this review.
