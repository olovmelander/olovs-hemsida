/* Ängsö's laser terrain and orthoimagery, in the pack's own frame.

   geobuild/dtm-lib.mjs holds the readers and takes every constant from the
   slug's own reviewed v2 frontier contract (contractOf), so nothing about this
   course is restated here; geobuild/imagery/wayback.mjs reads Esri z18 live or
   as a dated Wayback release, and takes its frame from BUILD's course model.
   Both are env-driven, so this module's only job is to point them at Ängsö
   before they are loaded, and to say where the tracing box is.

   Which capture: tools/wayback-captures.mjs measured that this course is not a
   patchwork and carries two single-capture frames, and angsobuild/derive-dtm-
   features.mjs measured that only the older one reproduces the surveyed
   bunkers. CAPTURE is that verdict; --release overrides it.                  */
process.env.BUILD ||= 'angsobuild';

/** the capture the surveyed bunkers chose: 2018-10-25 Maxar, 8 of 9 at 1.3 m */
export const CAPTURE = 58924;
/** the eighteen holes, the practice ground and the hub, with a margin */
export const BOX = Object.freeze({ x0: -700, z0: -1200, x1: 300, z1: 850 });

const dtmLib = await import('../geobuild/dtm-lib.mjs');
export const loadTerrain = () => dtmLib.loadTerrain('angso');

/** the imagery, bound to one release (the tiles cache per release) */
export async function imagery(release = CAPTURE) {
  process.env.SAT_REL = release == null ? '' : String(release);
  const wb = await import(`../geobuild/imagery/wayback.mjs?rel=${release}`);
  return {
    release,
    metresPerPixel: wb.mPerPx,
    pxOf: wb.pxOf,
    ensureImagery: (x0, z0, x1, z1) => wb.ensure(x0, z0, x1, z1, release == null ? '' : String(release)),
    rgbAt: (x, z) => wb.rgbAt(x, z, release == null ? '' : String(release)),
  };
}
