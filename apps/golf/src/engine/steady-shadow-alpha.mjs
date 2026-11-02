/* The shadow pass draws every caster with one shared override material and
   copies each caster's alphaTest onto it. three's Material.alphaTest setter
   bumps `version` whenever the value crosses zero, and the pass sorts casters
   by depth, so foliage (0.5) interleaves with trunks, terrain and buildings (0)
   and the version moves many times per pass. Every caster whose cached render
   object remembers an older version then walks its whole node graph for a new
   cache key: 21 ms a frame at a phone's CPU speed (docs/performance-plan-
   2026-09-23.md, 3.6).

   The recheck is redundant: each caster's cache key already holds alphaTest
   (on/off), so its pipeline was built for its own value, and the other fields
   the pass copies per caster (positionNode, colorNode, side...) never bump the
   version either. This gives the shared material an alphaTest that stores the
   value without the bump. It relies on one invariant: a source material's
   alphaTest is fixed after creation (true of every material here).

   r187 does the same upstream: its renderer writes the override's
   `_alphaTest` directly, "bypass the setter so the version doesn't change".
   So the accessor keeps the value in that same backing field, never in a
   copy of its own. A private copy read a stale 0 on r187 -- three no longer
   calls the setter -- and every caster's shadow would have been built and
   cut as if it had no alpha test (the crowns' default cut is their
   maskShadowNode, but `?foliageshadow=mip` and any other alpha-tested
   caster rely on the copied value). With the shared field the patch is
   exact on r186's setter path and a no-op on r187's direct write. */
export function steadyShadowAlpha(material) {
  if (!material?.isShadowPassMaterial || material.userData.steadyAlphaTest) return false;
  Object.defineProperty(material, 'alphaTest', {
    configurable: true, enumerable: false,
    get() { return this._alphaTest; },
    set(v) { this._alphaTest = v; },
  });
  material.userData.steadyAlphaTest = true;
  return true;
}
