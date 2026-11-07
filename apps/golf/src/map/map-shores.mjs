/* A lake reaches its ground's own shore (7 November, owner request: no straight,
   sharp lines on the water; the map and the course agree).

   A traced lake is a sketch: Puttom's run 30-90 m between points and lie inside the
   real shore, where the laser's ground stays flat at the lake's level for 2-10 m more.
   The simulator draws each lake out to where that ground rises above it
   (engine/water-reach.mjs). The map takes the same reach, read by the same rule and
   level off the same tiles, once per ground (tools/map-shores-bake.mjs; a lake's
   whole shore is more ground than a view streams), and paints two pictures of it on
   the reach's own lattice:

   - the WET ground, as water, under the course's surfaces like the ground's other
     water picture, softened by the same filtering;
   - the BANK the reach found above the water, which takes that picture's 8 m water
     off ground the laser shows dry: filtered, it reached a few metres up the bank.

   The outline stays every other reader's water: hazards, carries and the frozen lake.
   `?waterreach=0` is the before. */

/* A lake on the sheet, placed in the map's world: its lattice's node (c, r) lies at
   the pack's (x0 + c cell, z0 + r cell), carried by the frame, which is affine. */
export function shoreSprite(lake, frame) {
  const { x0, z0, cell, cols, rows } = lake;
  const [ox, oz] = frame.toWorld(x0, z0);
  const [ax, az] = frame.toWorld(x0 + cell, z0);
  const [bx, bz] = frame.toWorld(x0, z0 + cell);
  const matrix = [ax - ox, az - oz, bx - ox, bz - oz, ox, oz];
  let x0w = Infinity, z0w = Infinity, x1w = -Infinity, z1w = -Infinity;
  for (const [c, r] of [[-0.5, -0.5], [cols - 0.5, -0.5], [cols - 0.5, rows - 0.5], [-0.5, rows - 0.5]]) {
    const x = ox + c * matrix[0] + r * matrix[2], z = oz + c * matrix[1] + r * matrix[3];
    x0w = Math.min(x0w, x); x1w = Math.max(x1w, x); z0w = Math.min(z0w, z); z1w = Math.max(z1w, z);
  }
  return Object.freeze({ wet: lake.wet, bank: lake.bank, cols, rows, matrix, x0: x0w, z0: z0w, x1: x1w, z1: z1w });
}

/* The sheet's lakes this layout draws: a body of its own pack, matched by its outline,
   the way a dry outline is (map-land.mjs). A republished pack simply stops matching. */
export function shoreSprites(course, lakes) {
  const sprites = [];
  for (const item of course.features.water) {
    const key = item.shoreKey;
    if (!key) continue;
    const lake = lakes.find(entry => entry.layouts.includes(course.slug) && entry.points === key.points
      && entry.first[0] === key.first[0] && entry.first[1] === key.first[1]);
    if (lake) sprites.push({ item, sprite: shoreSprite(lake, course.frame) });
  }
  return sprites;
}

const drawSprite = (ctx, picture, sprite, [u, v]) => {
  ctx.save();
  ctx.transform(...sprite.matrix);
  /* a texel's centre on its node */
  ctx.drawImage(picture, u, v, sprite.cols, sprite.rows, -0.5, -0.5, sprite.cols, sprite.rows);
  ctx.restore();
};

/* Into a picture of the water already painted, in world units: every bank first, then
   every lake's water, so no lake's bank takes another's water away. */
export function drawShores(ctx, picture, sprites) {
  ctx.globalCompositeOperation = 'destination-out';
  for (const sprite of sprites) drawSprite(ctx, picture, sprite, sprite.bank);
  ctx.globalCompositeOperation = 'source-over';
  for (const sprite of sprites) drawSprite(ctx, picture, sprite, sprite.wet);
}
