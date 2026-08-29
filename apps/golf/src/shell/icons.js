/* ===========================================================================
   Banvy Bespoke Vector Icon System
   Custom pixel-crafted vector SVGs designed specifically for Banvy 3D:
   - Consistent 24x24 viewBox
   - Clean geometric stroke geometry
   - Zero generic emojis
   =========================================================================== */

export const ICONS = {
  // Course environments
  wave: (s = 14, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12c2.5-2.5 5.5-2.5 8 0s5.5 2.5 8 0 3-1.5 4-1.5"></path>
      <path d="M2 17c2.5-2.5 5.5-2.5 8 0s5.5 2.5 8 0 3-1.5 4-1.5"></path>
    </svg>
  `,

  tree: (s = 14, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L6 9h3l-4 6h4l-3 4h12l-3-4h4l-4-6h3z"></path>
      <path d="M12 19v3"></path>
    </svg>
  `,

  castle: (s = 14, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 21h18"></path>
      <path d="M5 21V7l2-2 2 2v2h6V7l2-2 2 2v14"></path>
      <path d="M10 21v-4a2 2 0 0 1 4 0v4"></path>
      <path d="M4 11h2"></path>
      <path d="M18 11h2"></path>
      <path d="M12 3v4"></path>
    </svg>
  `,

  flag: (s = 14, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
      <line x1="4" y1="22" x2="4" y2="15"></line>
    </svg>
  `,

  golfBall: (s = 14, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"></circle>
      <circle cx="9.5" cy="10" r="1" fill="currentColor"></circle>
      <circle cx="14.5" cy="10" r="1" fill="currentColor"></circle>
      <circle cx="12" cy="14" r="1" fill="currentColor"></circle>
    </svg>
  `,

  // Tools & Experiences
  fly: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3.5c-.5-.5-2.5 0-4 1.5L13.5 8.5 5.3 6.7c-.8-.2-1.6.2-2 .9l-.5.9 6.5 3.8-3.3 3.3-2.3-.4-.9.9 2.8 2.2 2.2 2.8.9-.9-.4-2.3 3.3-3.3 3.8 6.5.9-.5c.7-.4 1.1-1.2.9-2z"></path>
    </svg>
  `,

  compass: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="rgba(95,208,122,0.2)"></polygon>
    </svg>
  `,

  rangefinder: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"></circle>
      <circle cx="12" cy="12" r="4"></circle>
      <line x1="12" y1="2" x2="12" y2="6"></line>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line>
      <line x1="18" y1="12" x2="22" y2="12"></line>
    </svg>
  `,

  grid: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="12" rx="10" ry="6"></ellipse>
      <path d="M2 12c0 3.3 4.5 6 10 6s10-2.7 10-6"></path>
      <path d="M6 8v8"></path>
      <path d="M12 6v12"></path>
      <path d="M18 8v8"></path>
    </svg>
  `,

  cleanView: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `,

  camera: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
      <circle cx="12" cy="13" r="4"></circle>
    </svg>
  `,

  share: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"></circle>
      <circle cx="6" cy="12" r="3"></circle>
      <circle cx="18" cy="19" r="3"></circle>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
    </svg>
  `,

  sign: (s = 18, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="3" width="16" height="11" rx="2"></rect>
      <line x1="12" y1="14" x2="12" y2="21"></line>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="8" y1="7" x2="16" y2="7"></line>
      <line x1="8" y1="10" x2="12" y2="10"></line>
    </svg>
  `,

  home: (s = 20, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  `,

  search: (s = 16, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  `,

  map: (s = 15, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
      <line x1="9" y1="3" x2="9" y2="18"></line>
      <line x1="15" y1="6" x2="15" y2="21"></line>
    </svg>
  `,

  gridCards: (s = 15, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"></rect>
      <rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect>
      <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
  `,

  close: (s = 16, sw = 2) => `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `,
};
