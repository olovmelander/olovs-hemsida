/* A round as a picture to send: the course's poster, the score, the card.

   "Dela rundan" used to share a few lines of text. A round is what a golfer
   wants to show, and in a chat a picture is what is seen, so this draws one --
   1080 x 1350, the shape every feed and chat shows whole -- on a canvas, in
   the app's own type and colours: the course in its poster, strokes and the
   score against par as the headline, the putts, fairways and greens, and the
   card nine by nine with each score in its scorecard shape (a circle under
   par, a square over). Shared as a file where the device can, saved where it
   cannot; the text goes with it either way.

   Pure drawing on a canvas the caller's document gives; no network beyond the
   poster, which the start menu and the map have usually cached already. */
import { kindOf } from './stats-model.mjs';

const W = 1080, H = 1350;
const INK = '#ffffff', DIM = '#b7c8bc', FAINT = '#7f9587', TURF = '#5fd07a', PANEL = 'rgba(8,18,13,0.86)';

const toParText = value => (value === 0 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`);

function loadImage(url) {
  return new Promise(resolve => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* What the picture says, worked out from the kept record (map-rounds.mjs). */
export function roundCardFacts(record) {
  const holes = (record.holes || []).filter(h => !h.picked && Number.isFinite(h.strokes));
  const strokes = holes.reduce((s, h) => s + h.strokes, 0);
  const par = holes.reduce((s, h) => s + h.par, 0);
  const withPutts = holes.filter(h => Number.isFinite(h.putts));
  const fairways = holes.filter(h => h.par >= 4 && h.fairway);
  const greens = withPutts.filter(h => h.strokes - h.putts <= h.par - 2);
  return {
    strokes, toPar: strokes - par, played: holes.length, of: record.holeCount ?? holes.length,
    putts: withPutts.length ? withPutts.reduce((s, h) => s + h.putts, 0) : null,
    fairways: fairways.length ? `${fairways.filter(h => h.fairway === 'hit').length}/${fairways.length}` : null,
    greens: withPutts.length ? `${greens.length}/${withPutts.length}` : null,
    points: record.totals?.points ?? null,
  };
}

export async function drawRoundCard(record, { poster = null, document: doc = globalThis.document } = {}) {
  const canvas = doc.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await Promise.all([doc.fonts?.load('800 64px Outfit'), doc.fonts?.load('600 32px Outfit'), doc.fonts?.load('600 32px "JetBrains Mono"')]); } catch { /* the system's sans */ }
  const facts = roundCardFacts(record);

  /* the course in its poster, darkened toward the card */
  ctx.fillStyle = '#05100b';
  ctx.fillRect(0, 0, W, H);
  const img = await loadImage(poster);
  if (img) {
    const scale = Math.max(W / img.width, 760 / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, 0, w, h);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  /* fully dark a little above the poster's foot (760 px of 1350), so it has no edge */
  shade.addColorStop(0, 'rgba(5,16,11,0.35)');
  shade.addColorStop(0.3, 'rgba(5,16,11,0.12)');
  shade.addColorStop(0.47, 'rgba(5,16,11,0.78)');
  shade.addColorStop(0.55, '#05100b');
  shade.addColorStop(1, '#05100b');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  /* the brand, small, top left */
  ctx.fillStyle = TURF;
  ctx.beginPath(); ctx.arc(76, 92, 9, 0, Math.PI * 2); ctx.fill();
  ctx.font = '800 44px Outfit, system-ui, sans-serif';
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText('Banvy', 98, 94);

  /* the course and the day */
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = TURF;
  ctx.font = '700 30px Outfit, system-ui, sans-serif';
  const day = record.date ? new Date(record.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  ctx.fillText(day.toUpperCase(), 72, 560);
  ctx.fillStyle = INK;
  ctx.font = '800 76px Outfit, system-ui, sans-serif';
  ctx.fillText(record.courseName || record.course, 72, 640, W - 144);

  /* the headline: strokes and the score against par */
  ctx.font = '800 220px Outfit, system-ui, sans-serif';
  ctx.fillText(String(facts.strokes), 64, 870);
  const strokesWidth = ctx.measureText(String(facts.strokes)).width;
  ctx.font = '700 84px Outfit, system-ui, sans-serif';
  ctx.fillStyle = facts.toPar < 0 ? '#8fbcf2' : facts.toPar > 0 ? '#ffb48a' : DIM;
  ctx.fillText(toParText(facts.toPar), 64 + strokesWidth + 30, 870);
  ctx.fillStyle = DIM;
  ctx.font = '500 32px Outfit, system-ui, sans-serif';
  ctx.fillText(`${facts.played === facts.of ? `${facts.of} hål` : `${facts.played} av ${facts.of} hål`}${facts.points !== null ? ` · ${facts.points} poäng` : ''}`, 72, 930);

  /* three readings */
  const readings = [['Puttar', facts.putts ?? '–'], ['Fairway', facts.fairways ?? '–'], ['Greener', facts.greens ?? '–']];
  readings.forEach(([label, value], i) => {
    const x = 72 + i * 320;
    ctx.fillStyle = 'rgba(95,208,122,0.55)';
    ctx.fillRect(x, 984, 4, 92);
    ctx.fillStyle = INK;
    ctx.font = '600 56px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(String(value), x + 24, 1040);
    ctx.fillStyle = FAINT;
    ctx.font = '700 22px Outfit, system-ui, sans-serif';
    ctx.fillText(label.toUpperCase(), x + 24, 1074);
  });

  /* the card, nine by nine */
  const byNumber = new Map((record.holes || []).map(h => [h.n, h]));
  const pars = record.pars || (record.holes || []).map(h => h.par);
  const nines = pars.length > 9 ? [[1, 9], [10, Math.min(18, pars.length)]] : [[1, pars.length]];
  const top = 1110, rowH = nines.length > 1 ? 104 : 140;
  roundedRect(ctx, 48, top, W - 96, rowH * nines.length + 24, 28);
  ctx.fillStyle = PANEL;
  ctx.fill();
  nines.forEach(([from, to], row) => {
    const count = to - from + 1;
    const cell = (W - 96 - 48) / Math.max(9, count);
    const y = top + 24 + row * rowH;
    for (let n = from; n <= to; n++) {
      const cx = 72 + (n - from) * cell + cell / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = FAINT;
      ctx.font = '600 22px Outfit, system-ui, sans-serif';
      ctx.fillText(String(n), cx, y + 22);
      const hole = byNumber.get(n);
      if (!hole || hole.picked || !Number.isFinite(hole.strokes)) {
        ctx.fillStyle = FAINT;
        ctx.font = '700 34px Outfit, system-ui, sans-serif';
        ctx.fillText('–', cx, y + 70);
        continue;
      }
      const kind = kindOf(hole.strokes, hole.par);
      const r = 25;
      if (kind.key !== 'par') {
        ctx.fillStyle = kind.colour;
        if (kind.key === 'better' || kind.key === 'birdie') { ctx.beginPath(); ctx.arc(cx, y + 58, r, 0, Math.PI * 2); ctx.fill(); }
        else { roundedRect(ctx, cx - r, y + 58 - r, r * 2, r * 2, 6); ctx.fill(); }
        if (kind.key === 'better' || kind.key === 'double') {
          ctx.strokeStyle = kind.colour; ctx.lineWidth = 3;
          if (kind.key === 'better') { ctx.beginPath(); ctx.arc(cx, y + 58, r + 6, 0, Math.PI * 2); ctx.stroke(); }
          else { roundedRect(ctx, cx - r - 6, y + 58 - r - 6, (r + 6) * 2, (r + 6) * 2, 8); ctx.stroke(); }
        }
      }
      ctx.fillStyle = INK;
      ctx.font = '800 34px Outfit, system-ui, sans-serif';
      ctx.fillText(String(hole.strokes), cx, y + 70);
    }
    ctx.textAlign = 'left';
  });
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}

/* Share the picture where the device can, else save it; the words go with it. */
export async function shareRoundCard(record, { poster = null, text = '' } = {}) {
  const blob = await drawRoundCard(record, { poster });
  if (!blob) return 'failed';
  const name = `banvy-${(record.courseName || record.course || 'runda').toLowerCase().replace(/[^a-z0-9åäö]+/g, '-')}-${record.date || ''}.png`;
  const file = new globalThis.File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: record.courseName || 'Rundan', text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  return 'saved';
}
