import { createHoleMarker } from './hole-marker.mjs';

/** The selected tee uses the same runtime reference as the tee camera. */
export function createSelectedTee({ camera, heightAt, onLocate }) {
  const marker = createHoleMarker({ id: 'selectedTee', kind: 'tee', camera, heightAt, onLocate,
    icon: `<svg viewBox="0 0 24 28" fill="none"><circle cx="12" cy="8" r="5" fill="currentColor"/>
      <path d="M7 16h10m-5 0v8m-3 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    describe: ({ docked }) => ({ action: docked ? 'Visa vald tee på kartan' : 'Visa från denna tee' }),
  });
  let selected = null;
  function select(hole, index, names) {
    const mark = hole.tees.marks[index];
    selected = mark?.c;
    marker.select(mark ? { key: `${hole.n}:${index}`, c: mark.c, hole: hole.n, teeIndex: index,
      label: `Tee ${names[index]}`, value: `${hole.t[index]} m`,
      accessibleLabel: `Vald tee ${names[index]}, ${hole.t[index]} meter, hål ${hole.n}` } : null);
  }
  function drawMini(ctx, mapX, mapZ) {
    if (!selected) return;
    const x = mapX(selected[0]), y = mapZ(selected[1]);
    ctx.save();
    ctx.fillStyle = '#14241c'; ctx.strokeStyle = '#fff1c9'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff1c9';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  return { select, update: marker.update, drawMini };
}
