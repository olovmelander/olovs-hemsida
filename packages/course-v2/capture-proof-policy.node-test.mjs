import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isV2RequestUrl, summarizePuttomAppCaptureProof } from './capture-proof-policy.mjs';

const capture = (caseId, extra = {}) => ({
  caseId,
  backendMatched: true,
  acceptedFrameVisible: true,
  surfaceEvidencePassed: true,
  legacyCoreCutoutPassed: true,
  liveAdapterPassed: true,
  selectionPassed: true,
  ...extra,
});

const complete = () => [
  capture('webgl2-mobile'),
  capture('webgl2-desktop'),
  capture('webgpu-desktop', {
    sceneReadbackPassed: true,
    canvasPresentationVisible: false,
  }),
];

test('all required app captures pass with bounded WebGPU readback', () => {
  const proof = summarizePuttomAppCaptureProof(complete(), []);
  assert.equal(proof.webgl2Passed, true);
  assert.equal(proof.webgpuBackendPassed, true);
  assert.equal(proof.webgpuReadbackPassed, true);
  assert.equal(proof.webgpuCanvasPassed, false, 'software readback must not imply canvas presentation');
  assert.equal(proof.surfaceEvidencePassed, true);
  assert.equal(proof.legacyCoreCutoutPassed, true);
  assert.equal(proof.liveAdapterPassed, true);
  assert.equal(proof.selectionPassed, true);
  assert.equal(proof.requiredCasesPassed, true);
});

test('a pilot served outside the generic selection boundary fails every backend proof', () => {
  const captures = complete();
  captures[0] = capture('webgl2-mobile', { selectionPassed: false });
  const proof = summarizePuttomAppCaptureProof(captures, []);
  assert.equal(proof.selectionPassed, false);
  assert.equal(proof.requiredCasesPassed, false);
});

test('the no-request policy recognises the real v2 data, root and chunk names', () => {
  for (const url of [
    'http://127.0.0.1:8080/v2/puttom/preview.json',
    'http://127.0.0.1:8080/v2/puttom/grounds/puttom/terrain/0123456789abcdef.bvch',
    'https://banvy.test/olovs-hemsida/courses/v2-index.json',
    'https://banvy.test/olovs-hemsida/courses/v2-index.json?fresh=1',
    'http://127.0.0.1:8080/assets/v2-graph-source-DZYLfcdi.js',
    'http://127.0.0.1:8080/assets/v2-terrain-preview-loader-BJYsvHda.js',
  ]) assert.equal(isV2RequestUrl(url), true, url);
  for (const url of [
    'http://127.0.0.1:8080/assets/main-BSyUpNlO.js',
    'http://127.0.0.1:8080/courses/index.json',
    'http://127.0.0.1:8080/courses/puttom/pack.bin?v=abc',
    'http://127.0.0.1:8080/assets/three.tsl-CydnvXmQ.js',
  ]) assert.equal(isV2RequestUrl(url), false, url);
});

test('a missing WebGPU capture fails closed', () => {
  assert.equal(summarizePuttomAppCaptureProof(complete().slice(0, 2), []).requiredCasesPassed, false);
});

test('a blank WebGPU readback fails even when the composited canvas looked visible', () => {
  const captures = complete();
  captures[2] = capture('webgpu-desktop', {
    sceneReadbackPassed: false,
    canvasPresentationVisible: true,
  });
  assert.equal(summarizePuttomAppCaptureProof(captures, []).requiredCasesPassed, false);
});

test('any captured browser failure fails the proof', () => {
  assert.equal(summarizePuttomAppCaptureProof(complete(), [
    { caseId: 'webgpu-desktop', error: 'shader compilation failed' },
  ]).requiredCasesPassed, false);
});

test('missing semantic surface evidence fails even with visible backend frames', () => {
  const captures = complete();
  captures[1] = capture('webgl2-desktop', { surfaceEvidencePassed: false });
  assert.equal(summarizePuttomAppCaptureProof(captures, []).requiredCasesPassed, false);
});

test('missing construction-time legacy cutout evidence fails every backend proof', () => {
  const captures = complete();
  captures[0] = capture('webgl2-mobile', { legacyCoreCutoutPassed: false });
  const proof = summarizePuttomAppCaptureProof(captures, []);
  assert.equal(proof.legacyCoreCutoutPassed, false);
  assert.equal(proof.requiredCasesPassed, false);
});

test('a renderer bypassing the live adapter fails every backend proof', () => {
  const captures = complete();
  captures[1] = capture('webgl2-desktop', { liveAdapterPassed: false });
  const proof = summarizePuttomAppCaptureProof(captures, []);
  assert.equal(proof.liveAdapterPassed, false);
  assert.equal(proof.requiredCasesPassed, false);
});

test('duplicate cases cannot split WebGPU requirements across different captures', () => {
  const captures = complete();
  captures[2] = capture('webgpu-desktop', {
    backendMatched: false,
    sceneReadbackPassed: true,
  });
  captures.push(capture('webgpu-desktop', {
    sceneReadbackPassed: false,
  }));
  assert.equal(summarizePuttomAppCaptureProof(captures, []).requiredCasesPassed, false);
});
