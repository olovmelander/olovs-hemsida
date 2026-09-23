# Distant Hero review prototype

Status: prototype implemented, rebaked and tested; hardware comparison and
owner visual review pending. The default remains the geographic Hero/Impostor
policy. This experiment does not authorize changing that default or merging.

Use `?distanthero=16` or `?distanthero=24` (`1` aliases 24). Missing, disabled,
empty and unrecognised values leave the experiment off. In geographic mode,
only a zone A/B tree assigned Hero by the geographic policy may use its own Hero-baked
impostor when it becomes small on screen. Outer zones remain impostors even
when the camera approaches; forced diagnostic tiers retain their precedence.

The measurement uses the existing projected **whole-tree height** at the
tree's centre distance, rather than just the crown's height. It retains:

- 10% hysteresis: a 24 px tree demotes below 21.6 px and promotes above 26.4 px
  (14.4/17.6 px for the 16 px variant);
- six consecutive decision frames before a visible tree changes detail;
- complementary 0.3 s high-quality / 0.25 s low-quality crossfades, with the
  existing instant deterministic capture policy;
- approved Hero geometry/atlases, geographic zones, planting, cell bounds,
  dirty upload ranges, shadow update policy and four-sample MSAA.

The flag is classified as display-only by prepared-startup eligibility, so a
review URL does not accidentally disable prepared colors, water or vegetation.
The source revision is
`25202cc6903ffb8f909d97adb7673e84e9cb9e4fab87b9721e97801268b6a972`.
All 13 courses were actually rebaked with the existing tint, water and vista
tools (the last also bakes scatter), and the prepared-startup release gate
passed. All 26 tint, 26 vista and 26 scatter records retain identical content;
all ten supported water payloads retain identical field bytes and metadata
apart from their required source identities. The other three courses retain
their existing unsupported-water path. The changed water filenames result
from identities embedded in the payload, not changed geometry.

[Publication identity comparison](graphics/performance-distant-hero-2026-09-23/publication-identity.json)
and its [audit script](graphics/performance-distant-hero-2026-09-23/check-publication.mjs)
compare against PR #89. Original bake receipts are retained for
[tint](graphics/performance-distant-hero-2026-09-23/tint-publication.json),
[water](graphics/performance-distant-hero-2026-09-23/water-publication.json) and
[vista/scatter](graphics/performance-distant-hero-2026-09-23/vista-publication.json).

## Verification and decision

The focused tests execute the application's actual tier update and slot/fade
code across high/low detail heights and both backend coordinate systems. They
check default geographic detail, threshold dwell and hysteresis, fade drain,
outer-zone invariance, forced tiers and the absence of retired Full/Lite slots.
The existing default-vs-baseline replay tests retain exact state/upload parity.

Validation: 1,314 Vitest tests pass; the complete Node list passes 478 tests
with three environment skips. Production build, prepared-startup release gate,
no-undef lint and course-workflow check/audit pass. Windows fixture support
uses directory junctions where symlink privileges are unavailable, and replay
counter anchors normalize line endings and do not depend on explanatory comments.
The offline COPC test dependency was installed from its existing lockfile; two
unmodified source fixtures needed their exact committed bytes restored after
checkout newline conversion. Those source fixtures are not changed in this PR.

GPU comparisons use the same built prototype with the flag absent, 16 and 24,
interleaved twice each. Capture Puttom 1 tee, 12 orbit and 14 tee under `det=1`,
plus identical Veckefjärden tour poses after terrain settles. Report the 45 s
tour separately from uncapped stationary-view cost. Inspect silhouettes, color,
gaps, shadows and transition stability before recommending a threshold.

The decision table and side-by-side captures will be added after accepted GPU
runs. The same application build records the selected tree policy and compares
exact planting fingerprints across flag values, while its default arm can be
checked against the merged-build screenshots.

Motion review uses the existing pop meter's three 45 m dollies (180 steps at
0.25 m) and the glitter meter's hole 12 orbit creep, with `lodmode=zone` explicit
so these probes exercise the proposed geographic-policy exception. These
bounded probes and a 45-second tour do not qualify every hole of a complete
course flight or establish phone FPS. A default-change proposal still needs
the owner's visual review and the plan's full-tour video evidence.
