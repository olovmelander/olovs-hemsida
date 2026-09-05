#!/usr/bin/env node
/* Fetch the wide Ribbingsfors surroundings extract from the raw OSM map API
   (not Overpass — the map API is the one that survives large responses here).

   The bbox deliberately reaches past the course window: north to the edge of
   Gullspång town, east across Noret into Lake Skagern, south past Väggetorp
   and west past Skagersvik, so the model can carry the whole landscape the
   course sits in — the lake, the manor, the villages and the far buildings. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const OUT = path.join(CACHE, 'osm-wide.xml');
export const BBOX = '14.090,58.948,14.160,58.985';
const URL = `https://api.openstreetmap.org/api/0.6/map?bbox=${BBOX}`;

fs.mkdirSync(CACHE, { recursive: true });
const response = await fetch(URL, { headers: { 'User-Agent': 'olovs-hemsida course build' } });
if (!response.ok) throw new Error(`OSM map API answered ${response.status}`);
const xml = await response.text();
if (!/<osm /.test(xml)) throw new Error('response is not an OSM XML document');
fs.writeFileSync(OUT, xml);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(xml.length / 1e6).toFixed(2)} MB)`);
