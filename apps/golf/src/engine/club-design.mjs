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

export function clubIcon(kind) {
  const shapes = {
    driver: '<path d="M13 24C5 22 3 29 6 34c3 5 12 4 14 0l-1-7z" fill="currentColor"/><path d="m8 29 9 2" opacity=".4"/>',
    fairway: '<path d="M12 27c-7 0-8 7-3 10 4 2 11 0 12-3l-3-6z" fill="currentColor"/>',
    hybrid: '<path d="M12 28c-7 0-8 6-3 8h11l-1-7z" fill="currentColor"/>',
    iron: '<path d="m18 26-9 4-3 8 14-3 1-6z" fill="currentColor"/><path d="m10 33 8-3" stroke="#fff" opacity=".45"/>',
    wedge: '<path d="M18 25C8 25 4 35 8 38l13-5-1-6z" fill="currentColor"/><path d="m10 33 8-3" stroke="#fff" opacity=".45"/>',
    putter: '<path d="M7 30h16v6H7z" fill="currentColor"/><path d="M8 36q7 6 14 0"/>',
  };
  return `<svg viewBox="0 0 32 44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M25 4 18 29"/><path d="m25 4-2 7" stroke-width="3"/>${shapes[kind] || shapes.iron}</svg>`;
}
