// Logical trees stay in their original tables. Only drawable slots grow.
// Start above Three's matrix-uniform threshold so growth keeps the same
// instanced vertex path as a full-population allocation.
export function initialTreeTierCapacity(population, compact = true) {
  if (!Number.isSafeInteger(population) || population < 0) throw new RangeError('invalid tree population');
  return compact ? Math.min(population, 2048) : population;
}

function resizedAttribute(attribute, capacity) {
  const replacement = attribute.clone();
  replacement.array = new attribute.array.constructor(capacity * attribute.itemSize);
  replacement.array.set(attribute.array);
  replacement.count = capacity;
  replacement.clearUpdateRanges();
  replacement.needsUpdate = true;
  return replacement;
}

/** Reserve both incoming and outgoing fade slots without changing their order. */
export function reserveTreeTier(tier, needed, population) {
  if (!Number.isSafeInteger(needed) || needed < 0 || needed > population) throw new RangeError('tree tier exceeds its population');
  if (needed <= tier.slots.length) return false;
  const capacity = Math.min(population, Math.max(needed, 2048, tier.slots.length * 2));
  const objects = tier.mesh ? [tier.mesh] : tier.parts;
  // Allocate everything first. A failed allocation leaves the current tier intact.
  const replacements = objects.map(object => {
    const geometry = object.geometry.clone();
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
      if (attribute.isInstancedBufferAttribute) geometry.setAttribute(name, resizedAttribute(attribute, capacity));
    }
    return { object, geometry, matrix: object.isInstancedMesh ? resizedAttribute(object.instanceMatrix, capacity) : null };
  });
  const slots = new Int32Array(capacity);
  slots.set(tier.slots);
  for (const { object, geometry, matrix } of replacements) {
    // Geometry disposal releases old vertex and node matrix buffers. Object
    // disposal also releases bindings/node state referring to their old arrays.
    // Materials and the object itself survive, preserving scene/render order.
    object.geometry.dispose();
    object.dispose();
    object.geometry = geometry;
    if (matrix) object.instanceMatrix = matrix;
  }
  tier.slots = slots;
  tier.fade = objects.map(object => object.geometry.getAttribute('aFade')).filter(Boolean);
  tier.tint = objects.map(object => object.geometry.getAttribute('aTint')).filter(Boolean);
  if (tier.mesh) {
    tier.geo = tier.mesh.geometry;
    tier.pos = tier.geo.getAttribute('aImpostorPos');
    tier.par = tier.geo.getAttribute('aImpostorParam');
  }
  tier.capacityResizes = (tier.capacityResizes || 0) + 1;
  return true;
}

export function treeTierAllocation(tiers) {
  let drawableBytes = 0, slotBytes = 0, capacity = 0, used = 0, resizes = 0;
  for (const species of tiers) {
    if (!species) continue;
    for (const tier of species.t.slice(1)) {
      slotBytes += tier.slots.byteLength; capacity += tier.slots.length;
      used += tier.count; resizes += tier.capacityResizes || 0;
      for (const object of tier.mesh ? [tier.mesh] : tier.parts) {
        if (object.isInstancedMesh) drawableBytes += object.instanceMatrix.array.byteLength;
        for (const attribute of Object.values(object.geometry.attributes)) {
          if (attribute.isInstancedBufferAttribute) drawableBytes += attribute.array.byteLength;
        }
      }
    }
  }
  return { drawableBytes, slotBytes, capacity, used, resizes };
}
