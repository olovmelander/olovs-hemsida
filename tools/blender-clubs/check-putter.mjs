/* Capture the production putter viewer. Start check-clubs --serve first. */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { browserArgs } from '../browser-args.mjs';

const before = process.argv.includes('--before'), prefix = before ? 'before-' : '';
const out = fileURLToPath(new URL('../../docs/graphics/clubs/putter-refinement/', import.meta.url));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BANVY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: browserArgs(),
});
const errors = [], framing = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:5187/');
  await page.locator('#clubCanvas[data-state=ready]').waitFor({ timeout: 60000 });
  await page.locator('[data-club-id=putter] .bag-preview').click();
  await page.locator('#clubCanvas[data-state=ready]').waitFor();

  async function checkFraming(view, full = false) {
    if (before) return;
    const limits = await page.evaluate(full => {
      const { scene, camera } = clubReview;
      const point = camera.position.clone();
      let x = 0, y = 0, vertices = 0;
      scene.updateMatrixWorld(true);
      scene.traverse(object => {
        const positions = object.geometry?.attributes.position;
        if (!positions) return;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
          if (!full && point.y > .055) continue;
          point.project(camera);
          x = Math.max(x, Math.abs(point.x)); y = Math.max(y, Math.abs(point.y)); vertices++;
        }
      });
      return { x, y, vertices };
    }, full);
    assert.ok(limits.vertices > 1000, `putter/${view}: inspected model vertices`);
    assert.ok(limits.x < .95 && limits.y < .95, `putter/${view}: geometry clipped: ${JSON.stringify(limits)}`);
    framing.push({ id: 'putter', view, ...limits });
  }

  async function capture(view) {
    await page.locator('.club-studio').screenshot({ path: out + `${prefix}putter-${view}.png` });
  }

  for (const pose of ['hero', 'face', 'sole']) {
    await page.locator(`[data-club-pose=${pose}]`).click();
    await page.waitForTimeout(200);
    await checkFraming(pose);
    await capture(pose);
  }

  if (process.argv.includes('--clay') && !before) {
    await page.locator('[data-club-pose=hero]').click();
    await page.evaluate(() => {
      const materials = new Set();
      clubReview.scene.traverse(object => {
        for (const material of [object.material].flat().filter(Boolean)) {
          if (material.metalness > .5) materials.add(material);
        }
      });
      window.putterMaterials = [...materials].map(material => ({
        material, color: material.color.clone(), metalness: material.metalness, roughness: material.roughness,
      }));
      for (const { material } of putterMaterials) {
        material.color.setRGB(.4, .4, .4); material.metalness = 0; material.roughness = .85;
      }
    });
    await page.waitForTimeout(200);
    await capture('clay-hero');
    await page.evaluate(() => {
      for (const { material, color, metalness, roughness } of putterMaterials) {
        material.color.copy(color); material.metalness = metalness; material.roughness = roughness;
      }
      delete window.putterMaterials;
    });
  }

  for (const [name, direction] of [['address', [.04, 1, .08]], ['toe', [-1, .16, .02]]]) {
    await page.locator('[data-club-pose=hero]').click();
    await page.evaluate(direction => {
      const { scene, camera } = clubReview;
      const target = camera.position.clone().set(0, .021, -.017);
      const back = target.clone().set(...direction).normalize();
      const right = target.clone().set(0, 1, 0).cross(back).normalize();
      const up = back.clone().cross(right);
      const tanY = Math.tan(camera.fov * Math.PI / 360) * .86;
      const tanX = tanY * camera.aspect;
      const point = target.clone();
      let distance = .20;
      scene.updateMatrixWorld(true);
      scene.traverse(object => {
        const positions = object.geometry?.attributes.position;
        if (!positions) return;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
          if (point.y > .055) continue;
          point.sub(target);
          distance = Math.max(distance, point.dot(back) + Math.abs(point.dot(up)) / tanY, point.dot(back) + Math.abs(point.dot(right)) / tanX);
        }
      });
      camera.position.copy(target).addScaledVector(back, distance);
    }, direction);
    await page.waitForTimeout(200);
    await checkFraming(name);
    await capture(name);
  }

  await page.locator('[data-club-mode=full]').click();
  await page.waitForTimeout(200);
  await checkFraming('full', true);
  await capture('full');
  await page.locator('[data-club-mode=head]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  // A phone opens on the list; the putter's page holds the model.
  await page.locator('[data-club-id=putter] .bag-preview').click();
  await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('[data-club-pose=hero]').click();
  await page.locator('.bag-workspace').evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(200);
  await checkFraming('mobile');
  await page.screenshot({ path: out + `${prefix}putter-mobile.png` });

  assert.deepEqual(errors, []);
  await fs.writeFile(out + prefix + 'browser-audit.json', JSON.stringify({ models: ['putter'], framing, errors }, null, 2) + '\n');
  console.log('Putter captured: hero, face, sole, address, toe, full club, mobile. No browser errors.');
} finally {
  await browser.close();
}
