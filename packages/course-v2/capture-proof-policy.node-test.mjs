import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizePuttomAppCaptureProof } from './capture-proof-policy.mjs';

const capture = (caseId, extra = {}) => ({
  caseId,
  backendMatched: true,
  acceptedFrameVisible: true,
  surfaceEvidencePassed: true,
  legacyCoreCutoutPassed: true,
  liveAdapterPassed: true,
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
  assert.equal(proof.requiredCasesPassed, true);
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
