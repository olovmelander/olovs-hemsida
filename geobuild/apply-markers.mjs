/* Skyltar -- the toggleable marker layer, patched into every course page.

   usage: node geobuild/apply-markers.mjs [page.html ...]      (default: all six)

   The six pages are byte-identical in every block this touches, so one set of
   anchors serves all of them. Every substitution asserts its anchor matches
   EXACTLY ONCE and aborts otherwise: this file has been destroyed by blind
   regex before, and an anchored patch is the discipline that replaced it.

   What it adds:
     - hole-number discs at the hole MIDPOINT (banguide/guide-markers.json measured
       the club's own overview discs at a mean 46 m from the midpoint against 185 m
       and 190 m from the tee and the green), de-collided along each hole's own line
     - lettered facility squares: K klubbhus, R drivingrange, Oovningsgreen
     - a three-state "Skyltar" toggle driving BOTH the minimap and a sprite layer
       in the scene, so the map and the world can never disagree
     - the pin drawn as a flag rather than a red dot (red on green is the one pair
       colour-blind eyes cannot separate; shape carries the meaning too)
     - the minimap as a hole selector, which is what every golf app makes it
     - the next-tee sign plates, which have stood blank at every green, painted    */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, patcher } from './lib.mjs';

const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'veckefjarden3d.html', 'norrfallsviken3d.html', 'puttom3d.html',
  'angso3d.html', 'upsala3d.html', 'johannesberg3d.html',
];

/* ---------------------------------------------------------------- the pieces */

/* 1. the button. One row of its own, after the tools and before share/photo. */
const A_BTN = `  <div class="grp"><button class="btn" id="shareBtn">Dela vyn</button><button class="btn" id="fotoBtn">Foto</button></div>`;
const B_BTN = `  <div class="grp"><button class="btn on" id="skyltBtn">Skyltar</button></div>
${A_BTN}`;

/* 2. the minimap panel. A number has to be legible or it is decoration, and at
      186 px the 360-px backing store lands on screen at 0.48x -- a 30 px disc
      reads 14 px and its numeral about 6. Where the viewport can spare it the
      panel grows and the same disc reads 19 px. Below 1200 the hole strip is
      already within 100 px of the panel, so it stays as it was. */
const A_MINI = `#mini{bottom:14px;right:14px;width:186px;height:186px;padding:7px}`;
const B_MINI = `${A_MINI}
@media(min-width:1200px){#mini{width:232px;height:232px}}`;

/* 3. the toggle state, declared up here because setPreset -> syncURL runs long
      before the minimap section builds, and a const read in its dead zone throws. */
const A_STATE = `const RMOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;`;
const B_STATE = `${A_STATE}
/* skyltar: 0 off, 1 hole numbers, 2 numbers + faciliteter. skyMax is 1 on a course
   whose facilities are not in the data, so the cycle never promises an empty layer. */
let skyState = 2, skyMax = 2, skyHidden = false;`;

/* 4. the share URL carries it, because it is a property of the view like the
      light is -- unlike Kikaren and Greengrid, which are tools and reset. */
const A_URL = `    if (teeIdx) sp.set('tee', teeIdx + 1); else sp.delete('tee');`;
const B_URL = `${A_URL}
    if (skyState !== skyMax) sp.set('skylt', skyState); else sp.delete('skylt');`;

/* 5. a photograph of the course should look like the course. */
const A_PHOTO = `  (renderer.__post || renderer).render(scene, camera);
  const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));`;
const B_PHOTO = `  skyHidden = true; updateSky();
  (renderer.__post || renderer).render(scene, camera);
  const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));
  skyHidden = false; updateSky();`;

/* 6. keyboard */
const A_KEY = `  if (e.key === 's') takePhoto();`;
const B_KEY = `${A_KEY}
  if (e.key === 'm') setSky(skyState + 1);`;

/* 7. the marker anchors, the de-collision and the two offscreen layers. This goes
      immediately after MX/MZ because it needs them to measure in pixels. */
const A_MXMZ = `const MX = x => MOX + (x - MB.x0) * MS, MZ = z => MOZ + (z - MB.z0) * MS;`;
const B_MXMZ = `${A_MXMZ}

/* ------------------------------------------------------------------ skyltar
   Where a hole's number belongs is not a matter of taste. banguide/guide-markers.json
   measured the numbered discs on the club's own overview map at a mean 46 m from the
   hole MIDPOINT, against 185 m and 190 m from the tee and the green -- so the number
   sits at the middle of the hole, the way a Swedish oversiktskarta draws it.

   Facilities get a LETTER, not a pictogram. Somewhere under about sixteen displayed
   pixels a pictogram stops being a picture of anything and becomes a blob, and a
   letter is still a letter. K klubbhus, R rangen, O ovningsgreen. */
const SKY_R = 15, SKY_MIN = 31;
const SKY = { holes: [], fac: [] };
{
  for (const h of HOLES) SKY.holes.push({ n: h.n, f: 0.5, line: h.line, x: 0, z: 0 });
  const B = M.infra.buildings || [];
  const cb = B.find(q => q.amenity === 'clubhouse')
          || B.find(q => q.name && /golfklubb|klubbhus/i.test(q.name));
  if (cb) { const c = centroidOf(cb.ring); SKY.fac.push({ ch: 'K', nm: 'Klubbhus', x: c[0], z: c[1] }); }
  const rg = (M.scenery.range || [])[0];
  if (rg) { const c = centroidOf(rg); SKY.fac.push({ ch: 'R', nm: 'Drivingrange', x: c[0], z: c[1] }); }
  /* A putting green is a scenery green standing by the clubhouse. The ones scattered
     across the property are a short course, which is a different thing and does not
     get called an ovningsgreen: at Veckefjarden nine of the ten scenery greens are
     the korthalsbana, spread over 380 m, and one all-rings centroid would land in
     the middle of it and name it wrongly. */
  if (cb) {
    const k = SKY.fac[0];
    const near = (M.scenery.greens || []).map(centroidOf).filter(c => hyp(c, [k.x, k.z]) < 200);
    if (near.length) SKY.fac.push({ ch: '\\u00d6', nm: '\\u00d6vningsgreen',
      x: near.reduce((a, c) => a + c[0], 0) / near.length,
      z: near.reduce((a, c) => a + c[1], 0) / near.length });
  }
  skyMax = SKY.fac.length ? 2 : 1;
  if (skyState > skyMax) skyState = skyMax;
}

function skyAt(m) { const p = alongLine(m.line, m.f); m.x = p.x; m.z = p.z; }

/* Two facilities can genuinely adjoin: Veckefjarden's putting green stands 64 m from
   its clubhouse, which on this map is fourteen pixels -- one square inside the other.
   They are pushed apart ON THE MAP ONLY. The crowding belongs to the map, not to the
   ground, and moving the world markers to tidy a picture would be the wrong way round:
   at 0.22 px/m the same nudge would carry the klubbhus seventy metres off its roof. */
{
  for (const f of SKY.fac) { f.mx = MX(f.x); f.my = MZ(f.z); }
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < SKY.fac.length; i++) for (let j = i + 1; j < SKY.fac.length; j++) {
      const a = SKY.fac[i], b = SKY.fac[j];
      let dx = b.mx - a.mx, dy = b.my - a.my, d = Math.hypot(dx, dy);
      if (d >= SKY_MIN) continue;
      if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
      const k = (SKY_MIN - d) / (2 * d);
      a.mx -= dx * k; a.my -= dy * k; b.mx += dx * k; b.my += dy * k;
      moved = true;
    }
    if (!moved) break;
  }
}
/* A compact routing puts parallel corridors within a disc of each other, and sliding
   every offender toward its own tee -- the obvious rule -- is not enough: it cannot
   separate a SAME-direction pair, and where two holes share a loop hub it drives them
   together. So each offender moves along its OWN centreline in whichever direction buys
   the most room, worst first, and never sideways: a number that has left its corridor is
   worse than one that grazes a neighbour. A disc nothing helps is marked stuck and the
   rest carry on, which is the honest outcome on a tight routing. */
{
  SKY.holes.forEach(skyAt);
  const fixed = SKY.fac.map(f => [f.mx, f.my]);
  const room = (i, c) => {
    let d = 1e9;
    for (let j = 0; j < SKY.holes.length; j++) {
      if (j === i) continue;
      const o = SKY.holes[j];
      d = Math.min(d, Math.hypot(c[0] - MX(o.x), c[1] - MZ(o.z)));
    }
    for (const q of fixed) d = Math.min(d, Math.hypot(c[0] - q[0], c[1] - q[1]));
    /* the north arrow owns its corner of the canvas */
    if (c[0] > 314 && c[1] < 76) d = 0;
    return d;
  };
  const stuck = new Set();
  for (let pass = 0; pass < 400; pass++) {
    let wi = -1, wd = SKY_MIN;
    for (let i = 0; i < SKY.holes.length; i++) {
      if (stuck.has(i)) continue;
      const m = SKY.holes[i], d = room(i, [MX(m.x), MZ(m.z)]);
      if (d < wd) { wd = d; wi = i; }
    }
    if (wi < 0) break;
    const m = SKY.holes[wi];
    let bf = m.f, bd = wd;
    for (const df of [-0.035, 0.035]) {
      const f = Math.min(0.88, Math.max(0.12, m.f + df));
      if (f === m.f) continue;
      const p = alongLine(m.line, f);
      const d = room(wi, [MX(p.x), MZ(p.z)]);
      if (d > bd) { bd = d; bf = f; }
    }
    if (bf === m.f) { stuck.add(wi); continue; }
    m.f = bf; skyAt(m);
  }
}
/* a marker on the rim would render half off the canvas; the clamp costs a few metres
   of position and buys a whole icon (Johannesberg's klubbhus sits 9 px from the top) */
const skyXY = p => {
  const e = mini.width - SKY_R - 2;
  return [Math.min(e, Math.max(SKY_R + 2, p.mx === undefined ? MX(p.x) : p.mx)),
          Math.min(e, Math.max(SKY_R + 2, p.my === undefined ? MZ(p.z) : p.my))];
};

/* One routine draws every marker on both surfaces -- the minimap blits it, the sprite
   layer bakes it into a texture -- so a disc on the map and a disc in the world are
   the same object seen twice. The numeral shrinks for two digits: at the single-digit
   size "18" crosses the rim, which is how the engine's own design.svg sizes it too. */
function drawPuck(g, cx, cy, r, ch, o) {
  o = o || {};
  const s = String(ch);
  g.save();
  g.beginPath();
  if (o.square) {
    const a = r * 0.93, k = a * 0.36;
    g.moveTo(cx - a + k, cy - a);
    g.arcTo(cx + a, cy - a, cx + a, cy + a, k);
    g.arcTo(cx + a, cy + a, cx - a, cy + a, k);
    g.arcTo(cx - a, cy + a, cx - a, cy - a, k);
    g.arcTo(cx - a, cy - a, cx + a, cy - a, k);
    g.closePath();
  } else g.arc(cx, cy, r, 0, TAU);
  g.fillStyle = o.fill || 'rgba(14,26,18,.88)';
  g.fill();
  g.lineWidth = Math.max(1.2, r * 0.11);
  g.strokeStyle = o.stroke || 'rgba(234,243,236,.46)';
  g.stroke();
  g.fillStyle = o.ink || '#eaf3ec';
  g.font = '700 ' + (r * (s.length > 1 ? 1.00 : 1.16)).toFixed(1) + 'px Outfit,sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(s, cx, cy + r * 0.05);
  g.restore();
}

/* static layers: eighteen discs and a handful of squares do not change between
   frames, so they are painted once and blitted, the way the base map already is */
const skyNum = document.createElement('canvas'), skyFac = document.createElement('canvas');
skyNum.width = skyNum.height = skyFac.width = skyFac.height = mini.width;
function paintSky() {
  const g1 = skyNum.getContext('2d'), g2 = skyFac.getContext('2d');
  g1.clearRect(0, 0, skyNum.width, skyNum.height);
  g2.clearRect(0, 0, skyFac.width, skyFac.height);
  for (const m of SKY.holes) { const p = skyXY(m); drawPuck(g1, p[0], p[1], SKY_R, m.n); }
  for (const f of SKY.fac) { const p = skyXY(f); drawPuck(g2, p[0], p[1], SKY_R, f.ch, { square: true, ink: '#e2cf9a' }); }
}
paintSky();`;

/* 8a. blit the layers under the dynamic pass */
const A_BLIT = `  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(miniBase, 0, 0);
  const h = HOLES[hole - 1];`;
const B_BLIT = `  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(miniBase, 0, 0);
  if (skyState >= 1) mctx.drawImage(skyNum, 0, 0);
  if (skyState >= 2) mctx.drawImage(skyFac, 0, 0);
  const h = HOLES[hole - 1];`;

/* 8b. the tee stays a dot; the pin becomes a flag; the hole being played wears the
       accent, drawn over its own static twin so a hole change repaints nothing. */
const A_PIN = `  mctx.fillStyle = '#f0a23a';
  mctx.beginPath(); mctx.arc(MX(h.line[0][0]), MZ(h.line[0][1]), 4.5, 0, TAU); mctx.fill();
  mctx.fillStyle = '#e8443c';
  mctx.beginPath(); mctx.arc(MX(h.pin[0]), MZ(h.pin[1]), 4.5, 0, TAU); mctx.fill();`;
const B_PIN = `  mctx.fillStyle = '#f0a23a';
  mctx.beginPath(); mctx.arc(MX(h.line[0][0]), MZ(h.line[0][1]), 4.5, 0, TAU); mctx.fill();
  /* a flag, not a dot. Red on green is the one pair a deuteranope cannot split, so
     the pin is told apart by its shape as much as by its vermillion. */
  {
    const px = MX(h.pin[0]), py = MZ(h.pin[1]);
    mctx.strokeStyle = 'rgba(244,240,232,.9)'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.moveTo(px, py + 1.5); mctx.lineTo(px, py - 11); mctx.stroke();
    mctx.fillStyle = '#d55e00';
    mctx.beginPath(); mctx.moveTo(px, py - 11); mctx.lineTo(px + 8.5, py - 7.6);
    mctx.lineTo(px, py - 4.2); mctx.closePath(); mctx.fill();
  }
  if (skyState >= 1) {
    const p = skyXY(SKY.holes[hole - 1]);
    drawPuck(mctx, p[0], p[1], SKY_R + 1.5, h.n,
             { fill: '#8cf0a8', stroke: 'rgba(6,18,10,.5)', ink: '#06210f' });
  }`;

/* 9. the sprite layer, the click handler and the toggle. Placed at the end of the
      minimap section because everything here needs MX/MZ and the marker table. */
const A_LOOP = `/* ------------------------------------------------------------------- loop */`;
const B_LOOP = `/* ------------------------------------------------- skyltar i varlden
   Ovan is a real camera 330 m above the hole, where a 2.6 m flag is smaller than a
   pixel and nothing whatever says which hole is which. These are the same discs the
   minimap draws, billboarded over the ground and faded in by how high the camera is
   standing -- so they are there in the plan views and gone at eye level, where the
   card already names the hole and a number floating over the fairway is litter.
   Tying them to height rather than to the named view means Flygtur and the Bansafari
   stay clean without either knowing this layer exists. */
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const skySprites = [];
{
  const mk = (ch, x, z, square, ink) => {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const paint = () => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, S, S);
      drawPuck(g, S / 2, S / 2, S * 0.44, ch, { square, ink, fill: 'rgba(14,26,18,.9)' });
    };
    paint();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteNodeMaterial({
      map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    s.center.set(0.5, 0);
    s.scale.set(26, 26, 1);
    s.position.set(x, terrainH(x, z) + 5, z);
    s.renderOrder = 8;
    s.userData.repaint = () => { paint(); t.needsUpdate = true; };
    skyGroup.add(s);
    skySprites.push(s);
    return s;
  };
  for (const m of SKY.holes) { const s = mk(m.n, m.x, m.z, false, null); s.userData.fac = false; s.userData.n = m.n; }
  for (const f of SKY.fac) mk(f.ch, f.x, f.z, true, '#e2cf9a').userData.fac = true;
}
function updateSky() {
  const camH = camera.position.y - terrainH(camera.position.x, camera.position.z);
  const a = (skyHidden || skyState < 1) ? 0 : Math.min(1, Math.max(0, (camH - 110) / 110));
  skyGroup.visible = a > 0.01;
  if (!skyGroup.visible) return;
  for (const s of skySprites) {
    s.visible = !(s.userData.fac && skyState < 2);
    /* the hole being played stands at full strength and its neighbours step back --
       enough to orient by, without repainting a second texture for every disc */
    s.material.opacity = a * (s.userData.n === hole ? 1 : 0.66);
  }
}

/* the overview is a selector too -- that is what every golf app makes of it, and the
   canvas carried no handler to get in the way. The store is 360 px shown at 172 or
   232, so a click has to come back through the element's own box before it can be
   tested against the table, and the target is grown well past the disc: a 14 px disc
   is nowhere near a finger. */
mini.style.cursor = 'pointer';
const skyCanvasXY = e => {
  const R = mini.getBoundingClientRect();
  return [(e.clientX - R.left) * (mini.width / R.width),
          (e.clientY - R.top) * (mini.height / R.height)];
};
const skyNearest = (cx, cy, list, reach) => {
  let best = -1, bd = SKY_R * reach;
  list.forEach((m, i) => {
    const p = skyXY(m), d = Math.hypot(cx - p[0], cy - p[1]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
};
mini.addEventListener('click', e => {
  if (skyState < 1) return;
  const c = skyCanvasXY(e);
  const i = skyNearest(c[0], c[1], SKY.holes, 2.2);
  if (i >= 0) goHole(i + 1, true);
});
/* K and R and O are a private code without a legend, and a 360 px canvas has no room
   for one. The browser already owns a way to name a thing under the pointer. */
mini.addEventListener('pointermove', e => {
  if (skyState < 1) { mini.title = ''; return; }
  const c = skyCanvasXY(e);
  const f = skyState >= 2 ? skyNearest(c[0], c[1], SKY.fac, 1.1) : -1;
  if (f >= 0) { mini.title = SKY.fac[f].nm; return; }
  const i = skyNearest(c[0], c[1], SKY.holes, 1.4);
  mini.title = i >= 0 ? \`H\\u00e5l \${SKY.holes[i].n}\` : '';
});

const SKY_MSG = ['Skyltar av', 'Skyltar: halnummer', 'Skyltar: hal och faciliteter'];
function setSky(n, quiet) {
  skyState = n > skyMax || n < 0 ? 0 : n;
  document.getElementById('skyltBtn').classList.toggle('on', skyState > 0);
  updateSky();
  drawMini();
  syncURL();
  if (!quiet) toast(SKY_MSG[skyState]);
}
document.getElementById('skyltBtn').onclick = () => setSky(skyState + 1);
/* the webfont lands after the first paint, so every baked glyph is repainted once
   it is really there -- the base map's own N has always raced it */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  paintSky();
  for (const s of skySprites) s.userData.repaint();
  drawMini();
});

${A_LOOP}`;

/* 10. the frame loop */
const A_FRAME = `  drawMini();
  (renderer.__post || renderer).render(scene, camera);`;
const B_FRAME = `  updateSky();
  drawMini();
  (renderer.__post || renderer).render(scene, camera);`;

/* 11. boot */
const A_BOOT = `  if (BOOTQ.get('ren') === '1') setClean(true);`;
const B_BOOT = `  const sk = parseInt(BOOTQ.get('skylt'), 10);
  setSky(Number.isFinite(sk) ? sk : skyMax, true);
${A_BOOT}`;

/* 12. the harness needs to be able to drive it */
const A_V3D = `  startTour, endTour, takePhoto, kikMeasure,`;
const B_V3D = `  startTour, endTour, takePhoto, kikMeasure,
  setSky, skyState: () => skyState, eachSky: fn => skySprites.forEach(fn),
  /* the CANVAS positions, not the world ones: where a marker is actually drawn is
     what a collision check has to measure */
  skyMarks: () => ({
    ppm: MS, r: SKY_R, w: mini.width,
    holes: SKY.holes.map(m => { const p = skyXY(m); return { id: String(m.n), f: +m.f.toFixed(3), px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }),
    fac: SKY.fac.map(f => { const p = skyXY(f); return { id: f.ch, px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }) }),`;

/* 13. the next-tee signs have stood blank at every green since they were built, and
       they are already placed and already turned to face the walk. */
const A_SIGN = `    g.add(new THREE.Mesh(signPost, signMat), new THREE.Mesh(signPlate, signMat));`;
const B_SIGN = `    /* both faces read: the plate is passed on one side and met on the other, and a
       real sign at a real green is painted on both */
    const face = new THREE.MeshStandardNodeMaterial({ map: signFace(next.n), roughness: 0.8 });
    g.add(new THREE.Mesh(signPost, signMat),
          new THREE.Mesh(signPlate, [signMat, signMat, signMat, signMat, face, face]));`;
const A_SIGNMAT = `  const signMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x2e4632), roughness: 0.75 });`;
const B_SIGNMAT = `${A_SIGNMAT}
  /* the plate is 0.5 x 0.2 m, so the face is drawn on a canvas of the same aspect --
     a square texture on a wide box stretches the arrow into a smear */
  const signFace = n => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#2e4632'; g.fillRect(0, 0, 160, 64);
    g.fillStyle = '#e6efe2';
    g.font = '700 34px Outfit,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('\\u2192 ' + n, 80, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };`;

/* 14. The range's target flags marched away from a hut coordinate written into each
       page by hand -- and five of the six carried Norrfallsvikens, so the moment a
       course gained a traced range its flags landed in the wrong field. The tee end
       is derivable: it is the end of the range you walk to from the clubhouse, which
       is where the bays are at every club there is. The page's own literal survives
       as the fallback for a course whose clubhouse is not in the data.
       An asserted regex, because this is the one line that differs between pages. */
const RE_HUT = /^( *)const hut = (\[[-\d., ]+\]);$/m;
const hutBlock = (ind, lit) => `${ind}/* The tee end is the end of the field you walk to from the clubhouse. Deriving it
${ind}   beats writing it down: five of these six pages carried Norrfallsvikens hut
${ind}   coordinate, and a range traced anywhere else put its flags in another field. */
${ind}const hut = (() => {
${ind}  const B = M.infra.buildings || [];
${ind}  const cb = B.find(q => q.amenity === 'clubhouse')
${ind}          || B.find(q => q.name && /golfklubb|klubbhus/i.test(q.name));
${ind}  if (!cb) return ${lit};
${ind}  const ref = centroidOf(cb.ring), rcen = centroidOf(rng);
${ind}  let best = rng[0], bd = Infinity;
${ind}  for (const p of rng) { const d = hyp(p, ref); if (d < bd) { bd = d; best = p; } }
${ind}  /* just inside the rim, so the first flag is not standing on the boundary */
${ind}  return [best[0] + (rcen[0] - best[0]) * 0.12, best[1] + (rcen[1] - best[1]) * 0.12];
${ind}})();`;

/* ------------------------------------------------------------------- apply */
let failed = 0;
for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  try {
    const p = patcher(src)
      .sub('button', A_BTN, B_BTN)
      .sub('mini-css', A_MINI, B_MINI)
      .sub('state', A_STATE, B_STATE)
      .sub('url', A_URL, B_URL)
      .sub('photo', A_PHOTO, B_PHOTO)
      .sub('key', A_KEY, B_KEY)
      .sub('anchors', A_MXMZ, B_MXMZ)
      .sub('blit', A_BLIT, B_BLIT)
      .sub('pin', A_PIN, B_PIN)
      .sub('world', A_LOOP, B_LOOP)
      .sub('frame', A_FRAME, B_FRAME)
      .sub('boot', A_BOOT, B_BOOT)
      .sub('v3d', A_V3D, B_V3D)
      .sub('signmat', A_SIGNMAT, B_SIGNMAT)
      .sub('sign', A_SIGN, B_SIGN);
    /* the one line that is not identical across the pages, so it is matched by an
       asserted regex rather than by text -- exactly once, or nothing is written */
    let out = p.src;
    const hits = out.match(new RegExp(RE_HUT.source, 'gm')) || [];
    if (hits.length !== 1) throw new Error(`ANCHOR FAIL [range-tee]: expected 1, found ${hits.length}`);
    out = out.replace(RE_HUT, (_, ind, lit) => hutBlock(ind, lit));
    fs.writeFileSync(file, out);
    console.log(`${rel.padEnd(24)} ${p.applied.length + 1} anchors  ${(out.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.error(`${rel.padEnd(24)} ${e.message}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
