#!/usr/bin/env node
/* Validates an authored facility GLB + facilities-v1.json manifest before release.
 *
 * Enforces:
 *  1. Runtime static-GLB security contract (`inspectBuildingGlb`: no external
 *     URIs, textures, animations, skins, lights, cameras, or morph targets).
 *  2. Exact byte size & SHA-256 checksum between manifest and .glb on disk.
 *  3. Every declared `facilities[].nodeName` resolves to a node in the GLB with
 *     finite `groundAnchorLocal` & `groundAnchorRh2000M`.
 *  4. Linear albedo ceiling strictly below `GLOW.threshold` (0.86 in glow.mjs;
 *     default cap 0.82) on every PBR material so whitewashed stucco facades
 *     never blow out into bloom glare under noon/summer sun.
 *  5. Triangle count & primitive attribute sanity (`POSITION` + `NORMAL`).
 *
 * Usage:
 *   node tools/facility-pipeline/validate-facility-glb.mjs \
 *     --manifest apps/golf/public/models/visby/facilities-v1.json \
 *     [--max-luminance 0.82] [--max-triangles 80000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectBuildingGlb } from '../../apps/golf/src/engine/authored-buildings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_MAX_LUMINANCE = 0.82; // Strictly below GLOW.threshold (0.86) in glow.mjs
const DEFAULT_MAX_TRIANGLES = 80_000;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const linearLuminance = ([r = 1, g = 1, b = 1]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function countMeshTriangles(json) {
  let triangles = 0;
  let missingNormals = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes?.POSITION === undefined) missingNormals++;
      if (prim.attributes?.NORMAL === undefined) missingNormals++;
      if (prim.indices !== undefined) {
        triangles += Math.floor((json.accessors?.[prim.indices]?.count || 0) / 3);
      } else if (prim.attributes?.POSITION !== undefined) {
        triangles += Math.floor((json.accessors?.[prim.attributes.POSITION]?.count || 0) / 3);
      }
    }
  }
  return { triangles, missingNormals };
}

export function validateFacilityManifest({
  manifestPath,
  publicRoot = path.join(ROOT, 'apps/golf/public'),
  maxLinearLuminance = DEFAULT_MAX_LUMINANCE,
  maxTriangles = DEFAULT_MAX_TRIANGLES,
}) {
  const errors = [];
  const warnings = [];
  const resolvedManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));

  if (manifest.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${manifest.schemaVersion}`);
  if (!manifest.groundId) errors.push('missing groundId');
  if (!manifest.asset?.url || !manifest.asset?.sha256 || !Number.isSafeInteger(manifest.asset?.bytes)) {
    errors.push('manifest.asset must declare url, sha256, and bytes');
  }
  if (!Array.isArray(manifest.facilities) || !manifest.facilities.length) {
    errors.push('manifest.facilities must be a non-empty array');
  }

  const glbPath = path.resolve(publicRoot, manifest.asset.url);
  if (!fs.existsSync(glbPath)) {
    errors.push(`GLB asset not found at ${glbPath}`);
    return { valid: false, errors, warnings, summary: null };
  }

  const bytes = fs.readFileSync(glbPath);
  if (bytes.length !== manifest.asset.bytes) {
    errors.push(`GLB byte count ${bytes.length} != manifest ${manifest.asset.bytes}`);
  }
  const actualSha = sha256(bytes);
  if (actualSha !== manifest.asset.sha256) {
    errors.push(`GLB sha256 ${actualSha} != manifest ${manifest.asset.sha256}`);
  }

  let gltf;
  try {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    gltf = inspectBuildingGlb(ab);
  } catch (err) {
    errors.push(`GLB inspection failed: ${err.message}`);
    return { valid: false, errors, warnings, summary: null };
  }

  const nodeNames = new Set((gltf.nodes || []).map(n => n.name).filter(Boolean));
  for (const fac of manifest.facilities || []) {
    if (!fac.id || !fac.nodeName) {
      errors.push(`facility entry missing id or nodeName: ${JSON.stringify(fac)}`);
      continue;
    }
    if (!nodeNames.has(fac.nodeName)) {
      errors.push(`facility ${fac.id}: nodeName ${JSON.stringify(fac.nodeName)} not found in GLB`);
    }
    if (!Array.isArray(fac.groundAnchorLocal) || fac.groundAnchorLocal.length !== 2 || !fac.groundAnchorLocal.every(Number.isFinite)) {
      errors.push(`facility ${fac.id}: invalid groundAnchorLocal`);
    }
    if (!Number.isFinite(fac.groundAnchorRh2000M)) {
      errors.push(`facility ${fac.id}: missing finite groundAnchorRh2000M`);
    }
  }

  // Check PBR linear luminance ceiling (< GLOW.threshold)
  const brightestMaterials = [];
  for (let i = 0; i < (gltf.materials || []).length; i++) {
    const mat = gltf.materials[i];
    const baseColor = mat.pbrMetallicRoughness?.baseColorFactor;
    if (!Array.isArray(baseColor) || baseColor.length < 3) continue;
    const lum = linearLuminance(baseColor);
    brightestMaterials.push({ name: mat.name || `material[${i}]`, luminance: Math.round(lum * 10000) / 10000, baseColor });
    if (lum > maxLinearLuminance) {
      errors.push(`material ${JSON.stringify(mat.name || i)} linear luminance ${lum.toFixed(4)} exceeds bloom-safe ceiling ${maxLinearLuminance} (GLOW.threshold=0.86)`);
    }
  }
  brightestMaterials.sort((a, b) => b.luminance - a.luminance);

  const { triangles, missingNormals } = countMeshTriangles(gltf);
  if (missingNormals > 0) errors.push(`${missingNormals} primitive(s) missing POSITION or NORMAL attribute`);
  if (triangles > maxTriangles) {
    warnings.push(`triangle count ${triangles} exceeds advisory budget ${maxTriangles}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      groundId: manifest.groundId,
      assetUrl: manifest.asset.url,
      bytes: bytes.length,
      facilities: (manifest.facilities || []).length,
      nodes: (gltf.nodes || []).length,
      meshes: (gltf.meshes || []).length,
      materials: (gltf.materials || []).length,
      triangles,
      maxMaterialLuminance: brightestMaterials[0]?.luminance ?? null,
      brightestMaterial: brightestMaterials[0]?.name ?? null,
    },
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} requires a value`);
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.manifest) {
    throw new Error('Usage: validate-facility-glb.mjs --manifest FILE [--public-root DIR] [--max-luminance 0.82] [--max-triangles 80000]');
  }
  const result = validateFacilityManifest({
    manifestPath: opts.manifest,
    publicRoot: opts['public-root'] ? path.resolve(opts['public-root']) : path.join(ROOT, 'apps/golf/public'),
    maxLinearLuminance: opts['max-luminance'] ? Number(opts['max-luminance']) : DEFAULT_MAX_LUMINANCE,
    maxTriangles: opts['max-triangles'] ? Number(opts['max-triangles']) : DEFAULT_MAX_TRIANGLES,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
