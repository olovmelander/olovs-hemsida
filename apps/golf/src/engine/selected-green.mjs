import { createHoleMarker } from './hole-marker.mjs';

export function createSelectedGreen({ camera, heightAt, onLocate }) {
  const marker = createHoleMarker({ id: 'selectedGreen', kind: 'green', camera, heightAt, onLocate,
    icon: `<svg viewBox="0 0 24 28" fill="none"><path d="M6 24V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M7 4 21 8.5 7 14Z" fill="currentColor"/><path d="M3 25h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    describe: () => ({ action: 'Visa green' }),
  });
  let selected = null;
  function select(hole) {
    selected = hole;
    marker.select({ key: `${hole.n}:${hole.pin.join(',')}`, c: hole.pin, hole: hole.n,
      label: `Green ${hole.n}`, outline: hole.green.ring,
      accessibleLabel: `Flaggan på green, hål ${hole.n}` });
  }
  function drawMini(ctx, mapX, mapZ) {
    if (!selected) return;
    const x = mapX(selected.pin[0]), y = mapZ(selected.pin[1]);
    ctx.save();
    ctx.beginPath();
    selected.green.ring.forEach(([gx, gz], i) => i ? ctx.lineTo(mapX(gx), mapZ(gz)) : ctx.moveTo(mapX(gx), mapZ(gz)));
    ctx.closePath(); ctx.strokeStyle = '#ffd0bd'; ctx.lineWidth = 1.5; ctx.stroke();
    // A flag silhouette remains distinct from the tee's circle.
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 15);
    ctx.strokeStyle = '#13231c'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = '#fff2eb'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 1, y - 15); ctx.lineTo(x + 12, y - 10); ctx.lineTo(x + 1, y - 5); ctx.closePath();
    ctx.fillStyle = '#ffd0bd'; ctx.strokeStyle = '#13231c'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  return { select, update: marker.update, drawMini };
}
