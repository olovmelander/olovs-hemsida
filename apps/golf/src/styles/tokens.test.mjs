/* The design tokens hold (styles/tokens.css, docs/ui-redesign-2026-11-25.md §E).

   - Every var(--bv-*) the app reads is defined, so a misspelt token cannot quietly
     fall back to nothing.
   - Dag restates every colour role, so a surface turned light never keeps a dark ink.
   - JetBrains Mono stays gone: Outfit's tabular figures set the numbers.
   - The raw colours, radii and font sizes written outside tokens.css may only fall.
     When a change removes some, lower the matching count in RATCHET with it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(APP, relative), 'utf8');
const embedded = (relative, pattern) => [...read(relative).matchAll(pattern)].map(match => match[1]).join('\n');
const STYLES = path.join(APP, 'src/styles');

/* Where the app writes styles: its stylesheets, the player page's <style>, and the
   CSS the Simulator and Återupplev carry as strings. */
const SOURCES = {
  'index.html': () => embedded('index.html', /<style>([\s\S]*?)<\/style>/g),
  'src/play/play-hud.mjs': () => embedded('src/play/play-hud.mjs', /const CSS = `([\s\S]*?)`;/g),
  'src/play/relive.mjs': () => embedded('src/play/relive.mjs', /const CSS = `([\s\S]*?)`;/g),
  'src/ui/bag-editor.css': () => read('src/ui/bag-editor.css'),
  ...Object.fromEntries(fs.readdirSync(STYLES).filter(name => name.endsWith('.css') && name !== 'tokens.css')
    .map(name => [`src/styles/${name}`, () => read(`src/styles/${name}`)])),
};

const withoutComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const hexOf = value => {
  const hex = value.slice(1).toLowerCase();
  return '#' + (hex.length <= 4 ? [...hex].map(digit => digit + digit).join('') : hex);
};

/* The distinct raw values one stylesheet writes. */
export function rawValues(css) {
  const text = withoutComments(css);
  const values = [...text.matchAll(/:([^;{}]*)/g)].map(match => match[1]);
  const colours = new Set(values.flatMap(value => [...value.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(match => hexOf(match[0]))));
  /* a radius read wholly from the roles (var(--bv-radius-*), with zeros) writes nothing raw */
  const radii = new Set([...text.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;}]+)/g)]
    .map(match => match[1].trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(value => /[1-9]/.test(value.replace(/var\(--bv-[a-z0-9-]+\)/g, ''))));
  const sizes = new Set([
    ...[...text.matchAll(/font-size\s*:\s*(\d*\.?\d+(?:px|rem|em))/g)].map(match => match[1]),
    ...[...text.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)].map(match => match[1].match(/(\d*\.?\d+(?:px|rem))/)?.[1]).filter(Boolean),
  ]);
  return { colours, radii, sizes };
}

/* The counts when the tokens arrived (25 November; colours were 333 the day before).
   They may only fall. Radii were 38 until a radius read from the roles stopped
   counting as raw (the lobby, the same day). */
const RATCHET = {
  colours: 282,
  radii: 34,
  sizes: 42,
};

const tokens = read('src/styles/tokens.css');
const defined = new Set([...tokens.matchAll(/(--bv-[a-z0-9-]+)\s*:/g)].map(match => match[1]));

function appFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'studies' ? [] : appFiles(full);
    return /\.(?:css|js|mjs|html)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name) ? [full] : [];
  });
}

describe('design tokens', () => {
  it('defines every token the app reads', () => {
    const files = [path.join(APP, 'index.html'), ...appFiles(path.join(APP, 'src'))];
    const missing = files.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/var\((--bv-[a-z0-9-]+)/g)]
      .map(match => match[1]).filter(name => !defined.has(name)).map(name => `${path.relative(APP, file)}: ${name}`));
    expect(missing).toEqual([]);
  });

  it('restates every colour role in the Dag material', () => {
    const dag = tokens.match(/\.bv-dag\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const roles = ['canvas', 'surface-glass', 'surface-solid', 'surface-opaque', 'surface-2', 'surface-3', 'hairline',
      'hairline-strong', 'ink-1', 'ink-2', 'ink-3', 'link', 'under', 'over', 'signal', 'action', 'on-action', 'focus'];
    expect(roles.filter(role => !new RegExp(`--bv-${role}\\s*:`).test(dag))).toEqual([]);
    expect(roles.filter(role => !defined.has(`--bv-${role}`))).toEqual([]);
  });

  it('sets numbers in Outfit, never JetBrains Mono', () => {
    const files = [path.join(APP, 'index.html'), path.join(APP, 'public/fonts/fonts.css'), ...appFiles(path.join(APP, 'src'))];
    expect(files.filter(file => fs.readFileSync(file, 'utf8').includes('JetBrains Mono')).map(file => path.relative(APP, file))).toEqual([]);
  });

  it('writes no more raw colours, radii or font sizes than when the tokens arrived', () => {
    const totals = { colours: new Set(), radii: new Set(), sizes: new Set() };
    for (const source of Object.values(SOURCES)) {
      const found = rawValues(source());
      for (const kind of Object.keys(totals)) for (const value of found[kind]) totals[kind].add(value);
    }
    const over = Object.entries(totals).filter(([kind, set]) => set.size > RATCHET[kind])
      .map(([kind, set]) => `${kind}: ${set.size} distinct raw values, RATCHET allows ${RATCHET[kind]}`);
    // Use a token from styles/tokens.css instead, or lower RATCHET when values were removed.
    expect(over).toEqual([]);
  });
});
