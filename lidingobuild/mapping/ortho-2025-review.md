# Lidingö: first review using the new orthophotos

**Both 2025 RGBI source tiles were successfully read.** They were captured on 31 May 2025 at 0.16 m source pixel spacing. The approved pipeline measured all 110 adopted playing-surface polygons using a 1 m averaged grid. Coverage failures: 0.

## Bunker outlines requiring inspection

These are review flags, not confirmed bunker removals. No boundary has been moved or deleted from spectral statistics alone.

| Hole | Adopted outline | Pixels with NDVI > 0.25 | Median NDVI | Priority |
|---|---|---|---|---|
| 16 | lidingo-bunker-16-w-ortho2019 | 100.0% | 0.3716 | high |
| 15 | way/331796623 | 98.5% | 0.2830 | high |
| Unassigned | way/427426842 | 56.5% | 0.2549 | review |

The two largest signals are the western hole-16 bunker and the mapped hole-15 bunker. Inspect the actual 2025 crop against the outlines before deciding whether the bunker was filled, the outline is misplaced, or another explanation fits. The independently reported new hole-13 bunker is outside the adopted bunker inventory and cannot be discovered by within-polygon statistics alone.

The next image review should cover hole 13's green/bunker area, these hole-15/16 flags, hole 17/18 alterations and the uncertain tee platforms. All 18 holes remain in the review queue. Green and tee grass often has lower NDVI than fairway grass in this acquisition, so a single vegetation threshold must not be used to remove turf surfaces.

Source pixels were not published. Private visual crop transfer is still blocked by automatic approval review; this report contains only the approved derived statistics.

Run `node lidingobuild/mapping/review-ortho-2025.mjs` to regenerate this report from the retained measurement output.
