#!/usr/bin/env node
/* Outdoor Contrast Verification Gate for Banvy Design Tokens (Natt & Dag).
   Composites every translucent and opaque HUD surface over the three hardest
   real-world golf backdrops (sunlit fairway, bright white sky, dark pine shadow)
   and enforces WCAG 2.1 AA contrast ratios (>= 4.5:1 text, >= 3.0:1 UI bounds). */

import fs from 'node:fs';
import path from 'node:path';

const TOKENS_FILE = path.resolve('apps/golf/src/styles/tokens.css');
const css = fs.readFileSync(TOKENS_FILE, 'utf8');

function extractVars(blockText) {
  const vars = {};
  for (const [, name, raw] of blockText.matchAll(/(--bv-[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    vars[name.trim()] = raw.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
  }
  return vars;
}

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const dagBlock = css.match(/\.bv-dag\s*\{([\s\S]*?)\}/)?.[1] ?? '';

const nattRaw = extractVars(rootBlock);
const dagRaw = { ...nattRaw, ...extractVars(dagBlock) };

function resolveVar(map, val, depth = 0) {
  if (!val || depth > 8) return val;
  const m = val.match(/^var\(\s*(--bv-[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i);
  if (!m) return val;
  return resolveVar(map, map[m[1]] ?? m[2] ?? '', depth + 1);
}

function parseColor(str) {
  const s = str.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16), a: 1 };
    }
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    }
  }
  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] !== undefined ? Number(rgba[4]) : 1 };
  }
  throw new Error(`Unsupported color token format: ${str}`);
}

function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const chan = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrast(c1, c2) {
  const l1 = luminance(c1), l2 = luminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const BACKDROPS = [
  { name: 'sunlit-fairway', color: { r: 115, g: 168, b: 82, a: 1 } },
  { name: 'white-sky', color: { r: 236, g: 242, b: 245, a: 1 } },
  { name: 'pine-shadow', color: { r: 14, g: 28, b: 19, a: 1 } },
];

const CHECKS = [
  { fg: '--bv-ink-1', bg: '--bv-surface-glass', min: 4.5, label: 'Primary text on HUD glass' },
  { fg: '--bv-ink-2', bg: '--bv-surface-glass', min: 4.5, label: 'Secondary text on HUD glass' },
  { fg: '--bv-ink-1', bg: '--bv-surface-solid', min: 7.0, label: 'Primary text on solid outdoor panel' },
  { fg: '--bv-ink-2', bg: '--bv-surface-solid', min: 4.5, label: 'Secondary text on solid outdoor panel' },
  { fg: '--bv-ink-3', bg: '--bv-surface-solid', min: 4.5, label: 'Muted label on solid outdoor panel' },
  { fg: '--bv-ink-1', bg: '--bv-surface-card', min: 7.0, label: 'Primary text on Lobby/Sheet card' },
  { fg: '--bv-ink-2', bg: '--bv-surface-card', min: 4.5, label: 'Secondary text on Lobby/Sheet card' },
  { fg: '--bv-signal', bg: '--bv-surface-solid', min: 7.0, label: 'Target yardage (--bv-signal) on solid HUD' },
  { fg: '--bv-on-action', bg: '--bv-action', min: 7.0, label: 'Primary CTA text on Flag-Yellow/Dag button' },
  { fg: '--bv-on-turf', bg: '--bv-turf', min: 4.5, label: 'Live-pill text on Turf Green' },
  { fg: '--bv-turf-text', bg: '--bv-surface-solid', min: 4.5, label: 'Turf status text on solid panel' },
  { fg: '--bv-link', bg: '--bv-surface-solid', min: 4.5, label: 'Link text on solid panel' },
];

let failures = 0;
let checked = 0;

for (const [material, vars] of [['Natt', nattRaw], ['Dag', dagRaw]]) {
  for (const check of CHECKS) {
    const fgColor = parseColor(resolveVar(vars, vars[check.fg]));
    const bgColor = parseColor(resolveVar(vars, vars[check.bg]));
    for (const backdrop of BACKDROPS) {
      const effectiveBg = bgColor.a < 1 ? composite(bgColor, backdrop.color) : bgColor;
      const effectiveFg = fgColor.a < 1 ? composite(fgColor, effectiveBg) : fgColor;
      const ratio = contrast(effectiveFg, effectiveBg);
      checked++;
      if (ratio < check.min) {
        failures++;
        console.error(`FAIL [${material}] ${check.label} over ${backdrop.name}: ${ratio.toFixed(2)}:1 (min ${check.min}:1)`);
      }
    }
  }
  /* Check selected neutral control readability over solid panels */
  const solid = parseColor(resolveVar(vars, vars['--bv-surface-solid']));
  const surf3 = parseColor(resolveVar(vars, vars['--bv-surface-3']));
  const ink1 = parseColor(resolveVar(vars, vars['--bv-ink-1']));
  for (const backdrop of BACKDROPS) {
    const base = solid.a < 1 ? composite(solid, backdrop.color) : solid;
    const selectedBg = composite(surf3, base);
    const ratio = contrast(ink1, selectedBg);
    checked++;
    if (ratio < 4.5) {
      failures++;
      console.error(`FAIL [${material}] Selected neutral segment text over ${backdrop.name}: ${ratio.toFixed(2)}:1 (min 4.5:1)`);
    }
  }
}

if (failures > 0) {
  console.error(`\nOutdoor contrast gate FAILED (${failures} violations out of ${checked} checks).`);
  process.exit(1);
}
console.log(`Outdoor contrast gate PASSED (${checked}/${checked} Natt & Dag checks >= WCAG AA over sunlit fairway, bright sky, and pine shadow).`);
