/** Internal architectural research. No downloaded source pixels are published. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const dir = path.dirname(fileURLToPath(import.meta.url));
const raw = path.join(dir, 'reference/photos');
function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Expected JPEG source');
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset++] !== 0xff) continue;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 1) continue;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2) break;
    offset += length;
  }
  throw new Error('JPEG dimensions unavailable');
}
await fs.mkdir(raw, { recursive: true });
const selections = [
  { site: 'club', domain: 'https://ribbingsforsgk.se', ids: [124, 132, 130, 128, 127, 136, 139, 140, 255] },
  { site: 'estate', domain: 'https://ribbingsforsherrgard.se', ids: [61, 69, 43] },
];
const previous = await fs.readFile(path.join(dir, 'photo-reference-manifest.json'), 'utf8').then(JSON.parse).catch(() => ({ records: [] }));
const records = [];
for (const selection of selections) {
  const apiUrl = `${selection.domain}/wp-json/wp/v2/media?per_page=100`;
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`${response.status} ${apiUrl}`);
  const media = await response.json();
  await fs.writeFile(path.join(raw, `${selection.site}-media-catalogue.json`), JSON.stringify(media, null, 2));
  for (const id of selection.ids) {
    const item = media.find((m) => m.id === id);
    if (!item) throw new Error(`Missing ${selection.site} media ${id}`);
    const original = item.media_details.original_image;
    const url = original ? new URL(original, item.source_url).href : item.source_url;
    const filename = `${selection.site}-${id}-${path.basename(new URL(url).pathname)}`;
    let bytes = await fs.readFile(path.join(raw, filename)).catch(() => null);
    if (!bytes) {
      const imageResponse = await fetch(url);
      if (!imageResponse.ok) throw new Error(`${imageResponse.status} ${url}`);
      if (!imageResponse.headers.get('content-type')?.startsWith('image/')) throw new Error(`Not an image: ${url}`);
      bytes = Buffer.from(await imageResponse.arrayBuffer());
      await fs.writeFile(path.join(raw, filename), bytes);
    }
    const meta = item.media_details.image_meta || {};
    const created = Number(meta.created_timestamp);
    records.push({
      id: `${selection.site}-${id}`, title: item.title.rendered, pageUrl: selection.domain,
      metadataUrl: `${selection.domain}/wp-json/wp/v2/media/${id}`,
      sourceUrl: url, publishedImageUrl: item.source_url,
      localPath: `reference/photos/${filename}`,
      downloadUtc: previous.records.find(r => r.id === `${selection.site}-${id}`)?.downloadUtc || new Date().toISOString(), bytes: bytes.length,
      dimensionsPx: jpegDimensions(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      wordpressUploadLocal: item.date, wordpressUploadGmt: item.date_gmt,
      captureDate: created > 0 ? new Date(created * 1000).toISOString().slice(0, 10) : null,
      captureDateEvidence: created > 0 ? 'WordPress image_meta.created_timestamp derived from EXIF; camera timezone is unverified, day used only.' : 'Unknown; WordPress upload date is not a capture date.',
      exifCreatedTimestamp: created || null, credit: meta.credit || null,
      copyright: meta.copyright || null, camera: meta.camera || null,
      permission: 'Internal research only; no redistribution licence found. Do not publish source pixels or texture crops.',
    });
    console.log(`${selection.site}-${id}: ${(bytes.length / 1e6).toFixed(1)} MB ${filename}`);
  }
}
for (const item of [
  {
    id: 'regional-aerial', title: 'Ribbingsfors Golf & Kultur aerial from lake',
    pageUrl: 'https://www.naturkartan.se/sv/vastra-gotalands-lan/ribbingsfors-golf-kultur',
    sourceUrl: 'https://uploads.naturkartan-cdn.se/2bd88ad7e4544b3242f84e84e4b6c047.jpeg',
  },
  {
    id: 'vgr-manor-veranda', title: 'Ribbingsfors manor veranda conservation reference',
    pageUrl: 'https://www.vgregion.se/f/kulturforvaltningen/natur-och-kulturarv/platser--landskap/underverk-i-vastra-gotaland/ribbingsfors-herrgard-gullspangs-kommun/',
    sourceUrl: 'https://www.vgregion.se/contentassets/a918fe571ba94d3bab7a92cfb89c4e34/vgr18-va22317.jpg',
  },
  {
    id: 'museum-granary', title: 'Old granary and agricultural museum exterior',
    pageUrl: 'https://www.hembygd.se/amneharad/page/31889',
    sourceUrl: 'https://shfstor.blob.core.windows.net/amneharad/uploads/images/original/04c6cf03-4b1b-4016-a441-c0868cd14eb0.JPG',
  },
]) {
  const filename = `${item.id}.jpg`;
  let bytes = await fs.readFile(path.join(raw, filename)).catch(() => null);
  if (!bytes) {
    const response = await fetch(item.sourceUrl);
    if (!response.ok) {
      records.push({ ...item, localPath: null, downloadStatus: `Unavailable: HTTP ${response.status}`,
        captureDate: null, credit: null, permission: 'No redistribution licence found.' });
      console.log(`${item.id}: reference URL recorded, download HTTP ${response.status}`);
      continue;
    }
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Not an image: ${item.sourceUrl}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(raw, filename), bytes);
  }
  records.push({ ...item, localPath: `reference/photos/${filename}`,
    downloadUtc: previous.records.find(r => r.id === item.id)?.downloadUtc || new Date().toISOString(),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    dimensionsPx: jpegDimensions(bytes),
    captureDate: null, captureDateEvidence: 'Unknown; page update date and filename are not verified capture dates.',
    credit: null, permission: 'Internal research only; no redistribution licence found. Do not publish source pixels or texture crops.' });
  console.log(`${item.id}: ${(bytes.length / 1e6).toFixed(1)} MB ${filename}`);
}
await fs.writeFile(path.join(dir, 'photo-reference-manifest.json'), JSON.stringify({
  schemaVersion: 1,
  acquiredUtc: new Date().toISOString(),
  purpose: 'Ribbingsfors architectural observation for original Blender geometry. Pixels remain gitignored.',
  records,
}, null, 2) + '\n');
