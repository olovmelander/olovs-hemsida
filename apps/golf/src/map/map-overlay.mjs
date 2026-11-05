/* Everything drawn on top of the ground: a 2D canvas above the 3D one, so lines
   and numbers stay crisp at any tilt and cost nothing on the frames the ground
   does not move. Lines follow the ground by being carried through its heights. */
const DISTANCE_RINGS = [100, 150, 200, 250];
const PIN_RINGS = [{ radius: 1, opacity: 0.78 }, { radius: 2, opacity: 0.5 }, { radius: 3, opacity: 0.32 }];
const FONT = 'Outfit,ui-sans-serif,system-ui,sans-serif';

function along(line, step) {
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < parts; k++) out.push([ax + (bx - ax) * k / parts, az + (bz - az) * k / parts]);
  }
  out.push(line.at(-1));
  return out;
}

export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 1, height = 1, ratio = 1, emphasis = 1;
  const hits = [];

  function pill(x, y, text, { fill = 'rgba(12,24,18,.86)', ink = '#fff', size = 13, weight = 700 } = {}) {
    const tall = size * emphasis;
    ctx.font = `${emphasis > 1 ? 800 : weight} ${tall}px ${FONT}`;
    const w = ctx.measureText(text).width + 14, h = tall + 9;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  return {
    canvas,
    resize(cssWidth, cssHeight, pixelRatio) {
      width = cssWidth; height = cssHeight; ratio = pixelRatio;
      canvas.width = Math.round(cssWidth * pixelRatio);
      canvas.height = Math.round(cssHeight * pixelRatio);
    },

    /* The hole a tap landed on in the overview, if any. */
    holeAt(x, y) {
      let best = null, reach = 26;
      for (const hit of hits) {
        const d = Math.hypot(hit.x - x, hit.y - y);
        if (d < reach) { reach = d; best = hit.hole; }
      }
      return best;
    },

    draw(scene) {
      const { camera, ground, course, mode, hole, origin, player, target, tee, hazards = [], shotFrom = null, pinRings = false, trail = [], carryArcs = true } = scene;
      /* In the sun's look the lines and numbers are drawn heavier. */
      emphasis = scene.emphasis ?? 1;
      /* The column's side: a label stays clear of it. */
      const labelAt = scene.mirrored ? 15 : 3;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      hits.length = 0;

      const at = (x, z) => camera.project(x, ground(x, z), z);
      const trace = points => {
        ctx.beginPath();
        let open = false;
        for (const [x, z] of points) {
          const s = at(x, z);
          if (!Number.isFinite(s.x)) { open = false; continue; }
          if (open) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
          open = true;
        }
      };
      const cased = (points, colour, wide, dash = []) => {
        trace(points);
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.setLineDash(dash);
        ctx.strokeStyle = 'rgba(10,24,16,.55)';
        ctx.lineWidth = wide * emphasis + 2.5;
        ctx.stroke();
        ctx.strokeStyle = colour;
        ctx.lineWidth = wide * emphasis;
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (mode === 'course') {
        for (const each of course.holes) {
          cased(along(each.line, 24), 'rgba(255,255,255,.82)', 1.6);
          const s = at(each.green.c[0], each.green.c[1]);
          if (!Number.isFinite(s.x)) continue;
          ctx.fillStyle = 'rgba(12,24,18,.88)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `700 12.5px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(each.n), s.x, s.y + 0.5);
          hits.push({ x: s.x, y: s.y, hole: each.n });
        }
      } else if (hole) {
        cased(along([tee ?? hole.line[0], ...hole.line.slice(1)], 10), 'rgba(255,255,255,.92)', 2);

        /* The green's edge is the line a golfer reads off the map, so it is drawn
           here, sharp at any zoom, and not in the tile's picture. */
        trace(along([...hole.green.ring, hole.green.ring[0]], 2));
        ctx.closePath();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 1.6 * emphasis;
        ctx.stroke();

        /* Two pills never sit on each other, and a hazard's comes first: its number is the
           one that matters, and the nearer hazard of two. */
        const clash = (a, b, wide) => Math.abs(a.x - b.x) < wide * emphasis && Math.abs(a.y - b.y) < 26 * emphasis;
        const placed = [];
        for (const hazard of hazards) {
          const s = at(hazard.at[0], hazard.at[1]);
          if (!Number.isFinite(s.x) || s.x < 8 || s.x > width - 8 || s.y < 8 || s.y > height - 8) continue;
          if (placed.some(other => clash(other, s, 66))) continue;
          placed.push({ x: s.x, y: s.y, hazard });
        }

        /* Carry arcs from where the ball is now. */
        const bearing = Math.atan2(hole.green.c[0] - origin[0], -(hole.green.c[1] - origin[1]));
        const toGreen = Math.hypot(hole.green.c[0] - origin[0], hole.green.c[1] - origin[1]);
        for (const metres of DISTANCE_RINGS) {
          /* Seen from the ground they all fall in a heap on the horizon. */
          if (!carryArcs || metres > toGreen + 15) continue;
          const arc = [];
          for (let k = -9; k <= 9; k++) {
            const a = bearing + k * 0.045;
            arc.push([origin[0] + Math.sin(a) * metres, origin[1] - Math.cos(a) * metres]);
          }
          trace(arc);
          ctx.strokeStyle = `rgba(255,255,255,${emphasis > 1 ? 0.95 : 0.72})`;
          ctx.lineWidth = 1.2 * emphasis;
          ctx.setLineDash([3, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          const end = at(arc[labelAt][0], arc[labelAt][1]);
          if (!Number.isFinite(end.x) || placed.some(other => clash(other, end, 50))) continue;
          placed.push({ x: end.x, y: end.y });
          pill(end.x, end.y, String(metres), { size: 11, weight: 600 });
        }

        /* The greengrid's rings round the cup, each a metre further. */
        if (pinRings) {
          const [px, pz] = hole.pin;
          PIN_RINGS.forEach(({ radius, opacity }, ring) => {
            const circle = [];
            for (let k = 0; k <= 48; k++) {
              const a = k / 48 * Math.PI * 2;
              circle.push([px + Math.cos(a) * radius, pz + Math.sin(a) * radius]);
            }
            trace(circle);
            ctx.strokeStyle = `rgba(232,240,255,${opacity})`;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            if (ring) return;
            for (let k = 0; k < 4; k++) {
              const a = k / 4 * Math.PI * 2;
              trace([[px + Math.cos(a) * (radius - 0.15), pz + Math.sin(a) * (radius - 0.15)], [px + Math.cos(a) * (radius + 0.15), pz + Math.sin(a) * (radius + 0.15)]]);
              ctx.stroke();
            }
          });
        }

        /* The flag stands on the ground and rises off it, so it reads as 3D. */
        const pin = at(hole.pin[0], hole.pin[1]);
        if (Number.isFinite(pin.x)) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pin.x, pin.y);
          ctx.lineTo(pin.x, pin.y - 30);
          ctx.stroke();
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath();
          ctx.moveTo(pin.x, pin.y - 30);
          ctx.lineTo(pin.x + 16, pin.y - 24.5);
          ctx.lineTo(pin.x, pin.y - 19);
          ctx.fill();
          ctx.fillStyle = 'rgba(10,20,14,.5)';
          ctx.beginPath();
          ctx.ellipse(pin.x, pin.y, 3.5, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        if (tee) {
          const s = at(tee[0], tee[1]);
          if (Number.isFinite(s.x)) {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = 'rgba(10,24,16,.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }

        if (target) {
          cased([origin, target], '#ffd23f', 2.2);
          cased([target, hole.green.c], 'rgba(255,210,63,.75)', 1.6, [5, 5]);
          const s = at(target[0], target[1]);
          if (Number.isFinite(s.x)) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#ffd23f';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          const mid = (a, b) => at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          const label = (a, b) => `${Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))} m`;
          const first = mid(origin, target), second = mid(target, hole.green.c);
          if (Number.isFinite(first.x)) pill(first.x, first.y, label(origin, target), { fill: '#ffd23f', ink: '#10201a' });
          if (Number.isFinite(second.x)) pill(second.x, second.y, label(target, hole.green.c));
        }

        /* Reach and carry, where the hazard is. */
        for (const { x, y, hazard } of placed) {
          if (!hazard) continue;
          const words = hazard.carry === null ? String(Math.round(hazard.front)) : `${Math.round(hazard.front)}–${Math.round(hazard.carry)}`;
          pill(x, y, words, hazard.kind === 'water'
            ? { fill: 'rgba(20,92,140,.94)', size: 11.5 }
            : { fill: 'rgba(240,229,194,.96)', ink: '#2a2415', size: 11.5 });
        }
      }

      /* The hole so far: every shot locked, from where it was struck to where it lay. */
      if (mode === 'hole') {
        for (const shot of trail) {
          cased([shot.from, shot.to], 'rgba(255,255,255,.9)', 2);
          const s = at((shot.from[0] + shot.to[0]) / 2, (shot.from[1] + shot.to[1]) / 2);
          if (Number.isFinite(s.x)) pill(s.x, s.y, `${Math.round(Math.hypot(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1]))} m`, { size: 11, weight: 600 });
          for (const [x, z] of [shot.from, shot.to]) {
            const end = at(x, z);
            if (!Number.isFinite(end.x)) continue;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (shotFrom && player) {
        cased([shotFrom, player.point], '#fff', 2.2, [2, 6]);
        const s = at(shotFrom[0], shotFrom[1]);
        if (Number.isFinite(s.x)) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(10,24,16,.7)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (player) {
        const [x, z] = player.point;
        const s = at(x, z);
        if (Number.isFinite(s.x)) {
          const circle = [];
          for (let k = 0; k <= 28; k++) {
            const a = k / 28 * Math.PI * 2;
            circle.push([x + Math.cos(a) * player.accuracy, z + Math.sin(a) * player.accuracy]);
          }
          trace(circle);
          ctx.fillStyle = 'rgba(46,134,255,.18)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(46,134,255,.6)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2e86ff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}
