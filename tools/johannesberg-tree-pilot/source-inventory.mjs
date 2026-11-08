#!/usr/bin/env node
/* The pilot's credential-free evidence ledger: what was read, from where,
   captured when, with which checksums and over what coverage.
   usage: node tools/johannesberg-tree-pilot/source-inventory.mjs           */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PILOT, haloWindow } from './pilot-config.mjs';
import { ROOT } from './panels.mjs';

const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const campaigns = read(PILOT.laserCampaigns);
const canopy = read(`${PILOT.reviewDir}/canopy-rasters.json`);
const ortho = read(`${PILOT.orthoCache}/ledger.json`);
const registration = read(`${PILOT.reviewDir}/registration.json`);
const discovery = read('geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json');
const pinnedDiscovery = read('geo_data/course-v2/johannesberg/acquisition/d2-discovery.json');
const w = haloWindow();
const inventory = {
  schemaVersion: 1,
  kind: 'source-inventory',
  reviewId: PILOT.reviewId,
  groundId: PILOT.groundId,
  observedOn: '2026-11-08',
  frame: 'EPSG:3006 horizontal, RH2000 (EPSG:5613) heights, compound EPSG:5845',
  windowEpsg3006: { inner: PILOT.innerWindow, analysed: w },
  provider: 'Lantmäteriet only (Skogsstyrelsen not used; the orthophoto-derived surface model not used)',
  laser: {
    collection: 'dsm-skoglig-copc (Laserdata Nedladdning, skog)',
    campaign: '21C039',
    capturedOn: '2021-04-17',
    leafState: 'leaf-off (Skogsstyrelsen scan-area metadata recorded in the accepted 2026-09-04 pin: 21C039, 2021-04-17, Lov_Avlov 2, ALS80-HP)',
    retiling: 'Lantmäteriet re-tiled the campaign into 2.5 km items (updated 2026-10-14); the accepted pin\'s 10 km items 21c039-662_67/68 now return 404',
    pin: { file: PILOT.laserCampaigns, sha256: sha(PILOT.laserCampaigns), census: 'geo_data/course-v2/johannesberg/acquisition/copc-hierarchy-census-2026-11-08.json', censusSha256: sha('geo_data/course-v2/johannesberg/acquisition/copc-hierarchy-census-2026-11-08.json') },
    items: campaigns.items.filter(i => PILOT.laserItems.includes(i.id)).map(i => ({ id: i.id, href: i.assets.data.href, bytes: i.assets.data.bytes, sha256: i.assets.data.sha256, projBbox: i.projBbox, pointCount: i.statistics.pointCount, allReturnDensityPerSquareMetre: i.statistics.allReturnDensityPerSquareMetre, updatedAt: i.updatedAt, cachedAndVerified: true })),
    licence: campaigns.terms,
    measured: canopy.innerDensity,
    groundCheck: canopy.groundCheck,
  },
  orthophotos: Object.fromEntries(Object.entries(ortho.campaigns).map(([key, c]) => [key, {
    collection: c.collection, date: c.date, season: c.season, bands: c.items[0].bands,
    bandEvidence: 'TIFF photometric RGB (2) with one unspecified extra sample (ExtraSamples 0, not alpha), 4 x 8 bit, pixel-interleaved; STAC spektraltyp rgbi',
    items: c.items.map(i => ({ id: i.id, href: i.href, captureStart: i.captureStart, captureEnd: i.captureEnd, sourceBytes: i.sourceBytes, stacSha256: i.stacSha256, software: i.tiffTags.software, tilesCached: i.tilesCached, tileHashDigest: i.tileHashDigest })),
    windowEpsg3006: c.windowEpsg3006,
    mosaic: { pixelMetres: c.mosaic.pixelMetres, width: c.mosaic.width, height: c.mosaic.height, validFraction: c.mosaic.validFraction, sha256: c.mosaic.sha256 },
    registration: registration.decisions?.[key] || null,
    applied: registration.applied?.[key] ?? null,
  }])),
  orthophotosAvailableNotFetched: { 'orto-o2-2023': '2023-05-10 RGBI, HTTP 206 on all four items', 'orto-o2-2019': '2019-07-20 RGBI (leaf-on), HTTP 206 on all four items' },
  terrain: {
    appTerrain: canopy.groundCheck.publishedGroundManifest,
    note: 'tree bases sample the published terrain the app draws (createGroundHeightLookup over the finest tiles)',
    dtmItems: discovery.terrain.items.map(i => ({ id: i.id, captureStart: i.captureStart, captureEnd: i.captureEnd, capturedAt: i.capturedAt, modifiedAt: i.modifiedAt, bytesNow: i.assets.data.bytes, sha256Now: i.assets.data.sha256, bytesPinned: pinnedDiscovery.terrain.items.find(p => p.id === i.id)?.assets.data.bytes, sha256Pinned: pinnedDiscovery.terrain.items.find(p => p.id === i.id)?.assets.data.sha256 })),
    dtmNote: '662_68 covers E >= 680000 (the inner window\'s east 451 m) and carries the 2023-05-16 capture inside its 2021-04-17..2025-06-13 range; its point cloud is not offered. Both DTM items were republished with new bytes and checksums but unchanged dates; the accepted discovery pin still names the old ones.',
  },
  rawCaches: { copc: PILOT.copcCache, ortho: PILOT.orthoCache, rasters: PILOT.rasterDir, note: 'ignored by git (johannesbergbuild/cache/); never committed' },
};
fs.writeFileSync(path.join(ROOT, PILOT.reviewDir, 'source-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log('wrote source-inventory.json');
