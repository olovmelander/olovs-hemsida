export const CLUB_KINDS = Object.freeze({ driver: 'Driver', fairway: 'Fairwaywood', hybrid: 'Hybrid', iron: 'Järn', wedge: 'Wedge', putter: 'Putter' });

/** Names take precedence over legacy IDs when an existing club is renamed. */
export function clubKind(club) {
  if (Object.hasOwn(CLUB_KINDS, club?.kind)) return club.kind;
  const identify = value => {
    const name = String(value || '').toLowerCase().trim();
    if (/putt/.test(name)) return 'putter';
    if (/driver|^1w$/.test(name)) return 'driver';
    if (/hybrid|^h\d/.test(name)) return 'hybrid';
    if (/wood|fairway|trä|^\d+w$/.test(name)) return 'fairway';
    if (/wedge|^(pw|gw|sw|lw)$|^(4[4-9]|5\d|60)°?$/.test(name)) return 'wedge';
    if (/iron|järn|^i\d|^\d+i$/.test(name)) return 'iron';
    return null;
  };
  return identify(club?.name) || identify(club?.id) || 'iron';
}

export function clubAssetKey(club) {
  const kind = clubKind(club);
  const text = `${club?.name || ''} ${club?.id || ''}`.toLowerCase();
  const number = Number(text.match(/\d+/)?.[0]);
  if (kind === 'iron') return `iron-${Math.max(5, Math.min(9, number || 7))}`;
  if (kind === 'fairway') return number >= 5 ? 'wood-5' : 'wood-3';
  if (kind === 'hybrid') return 'hybrid-4';
  if (kind === 'wedge') {
    if (/\blw\b|lob/.test(text) || number >= 58) return 'lw';
    if (/\bsw\b|sand/.test(text) || number >= 54) return 'sw';
    if (/\bgw\b|gap/.test(text) || number >= 48) return 'gw';
    return 'pw';
  }
  return kind;
}

/* Each club's own head, toe left and hosel right, drawn only in currentColor
   so it reads on the dark list and the light selected chip alike. Woods and
   the putter are seen at address: a solid crown over a light face. Irons and
   wedges are seen face-on, and the toe rises with loft from the 5-iron to the
   lob wedge, wedges rounding it off, so the list climbs like the bag does.
   The view box crops the shaft so the head fills the icon. */
const FACE = 'fill="currentColor" fill-opacity=".2"';
const CROWN = 'fill="currentColor" fill-opacity=".82"';
const GROOVES = 'stroke-width=".95" stroke-opacity=".62"';
const r = value => +value.toFixed(2);
function shaft(x, y) {
  const dx = 28.4 - x, dy = 1.5 - y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
  return `<path d="M${r(x)} ${r(y)} 28.4 1.5"/><path d="M${r(x + ux * .6)} ${r(y + uy * .6)} ${r(x + ux * 3.6)} ${r(y + uy * 3.6)}" stroke-width="2.6"/>`;
}
/** A wood at address: the face band below, the crown above its top edge. */
function wood({ toe, heel, roll, crown, grooves }) {
  const sole = 28.6, width = heel[0] - toe[0];
  const edge = `M${toe[0]} ${toe[1]}C${r(toe[0] + width * .28)} ${r(toe[1] - roll)} ${r(toe[0] + width * .7)} ${r(heel[1] - roll / 2)} ${heel[0]} ${heel[1]}`;
  const face = `${edge}L${r(heel[0] + .6)} ${sole - 3}C${r(heel[0] + .8)} ${sole - 1.2} ${r(heel[0] - .2)} ${sole} ${r(heel[0] - 1.8)} ${sole}L${r(toe[0] + 4)} ${sole}C${r(toe[0] + .6)} ${sole} ${r(toe[0] - .8)} ${r(toe[1] + 3.4)} ${toe[0]} ${toe[1]}z`;
  const dome = `${edge}C${r(heel[0] - 1.4)} ${r(heel[1] - crown * .7)} ${r(toe[0] + width * .5)} ${r(heel[1] - crown * 1.15)} ${r(toe[0] + width * .26)} ${r(heel[1] - crown)}C${r(toe[0] + 1.2)} ${r(heel[1] - crown * .9)} ${r(toe[0] - 1)} ${r(toe[1] - 1.6)} ${toe[0]} ${toe[1]}z`;
  return shaft(heel[0] - .5, heel[1] - .4) + `<path ${CROWN} d="${dome}"/><path ${FACE} d="${face}"/>` +
    `<path ${GROOVES} d="${grooves.map(([y, from, to]) => `M${from} ${y}H${to}`).join('')}"/>`;
}
/** An iron or wedge face: one curve from the top line round the toe into the sole. */
function blade(toeTop, round) {
  const heel = [23.1, 18.9], sole = 28.6, shoulder = [10.2 + round * 2.6, toeTop];
  const tip = [3.3 - round * .2, (toeTop + sole) / 2 + .2 - round * .8], reach = 3.8 + round * 2.2;
  const body = `M${heel[0]} ${heel[1]}L${r(shoulder[0])} ${r(shoulder[1])}` +
    `C${r(shoulder[0] - reach)} ${r(shoulder[1] - .2 - round * .4)} ${r(tip[0])} ${r(tip[1] - 3.2 - round)} ${r(tip[0])} ${r(tip[1])}` +
    `C${r(tip[0])} ${r(tip[1] + 3.4 + round * .6)} ${r(5 + round)} ${sole} ${r(8.6 + round * .6)} ${sole}H20.9C22.9 ${sole} 24.3 27.2 24 25.2z`;
  // Three scorelines, each stopping short of the sloping top line.
  const topAt = x => heel[1] + (toeTop - heel[1]) * (heel[0] - x) / (heel[0] - shoulder[0]);
  const grooves = [25.9, 23.5, 21.1].map(y => {
    let right = 20.2;
    while (right > 9 && topAt(right) > y - 1.6) right -= .2;
    const left = 7.6 + round * .6;
    return right - left > 4 ? `M${r(left)} ${y}H${r(right)}` : '';
  });
  return shaft(heel[0], heel[1]) + `<path ${FACE} d="${body}"/><path ${GROOVES} d="${grooves.join('')}"/>`;
}
const ICON_SHAPES = {
  driver: wood({ toe: [3, 21.8], heel: [24, 20.6], roll: 1.4, crown: 7.2, grooves: [[24.4, 8, 20.6], [26.5, 8.6, 20]] }),
  'wood-3': wood({ toe: [4.6, 23.2], heel: [24, 22.2], roll: 1.1, crown: 4.8, grooves: [[25.6, 9, 20.4]] }),
  'wood-5': wood({ toe: [5.4, 23.6], heel: [24, 22.7], roll: 1, crown: 4.3, grooves: [[25.9, 9.6, 20.4]] }),
  'hybrid-4': wood({ toe: [6.4, 23.8], heel: [24, 23.1], roll: .8, crown: 3.3, grooves: [[26, 10.4, 20.4]] }),
  ...Object.fromEntries([5, 6, 7, 8, 9].map(number => [`iron-${number}`, blade(16.2 - (number - 5) * .6, 0)])),
  pw: blade(13.4, .3), gw: blade(12.8, .55), sw: blade(12.2, .8), lw: blade(11.6, 1),
  putter: '<path d="M16.1 22.4 17.4 1.5"/><path d="M16.14 21.8 16.3 18.8" stroke-width="2.6"/>' +
    `<path ${CROWN} d="M3.6 24.4C5 19.4 26.6 19.4 28 24.4z"/>` +
    `<path ${FACE} d="M3.6 24.4H28v2.8c0 .9-.6 1.4-1.5 1.4H5.1c-.9 0-1.5-.5-1.5-1.4z"/><path ${GROOVES} d="M7 26.6h17.6"/>`,
};
const KIND_ICON = { driver: 'driver', fairway: 'wood-3', hybrid: 'hybrid-4', iron: 'iron-7', wedge: 'sw', putter: 'putter' };

/** An icon for a model key (`clubAssetKey`) or, for the type picker, a kind. */
export function clubIcon(key) {
  return `<svg viewBox="1.4 3 28 28" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SHAPES[key] || ICON_SHAPES[KIND_ICON[key]] || ICON_SHAPES['iron-7']}</svg>`;
}
