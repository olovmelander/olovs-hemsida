export const PUTTOM_APP_CAPTURE_CASES = Object.freeze([
  Object.freeze({ id: 'webgl2-mobile', backend: 'webgl2', mobile: true, quality: 'lo' }),
  Object.freeze({ id: 'webgl2-desktop', backend: 'webgl2', mobile: false, quality: 'hi' }),
  Object.freeze({ id: 'webgpu-desktop', backend: 'webgpu', mobile: false, quality: 'hi' }),
]);

/* What counts as a v2 request is release policy, not orchestration detail: the
   flagless no-request proof is vacuous if these drift from the real chunk and
   root names, so they live here where the node tests pin them. */
export const V2_REQUEST_URL_PATTERNS = Object.freeze([
  /\/v2\//,
  /\/courses\/v2-index\.json(?:$|[?#])/,
  /\/assets\/v2-[a-z-]+-[A-Za-z0-9_-]+\.js(?:$|[?#])/,
]);

export function isV2RequestUrl(url) {
  const value = String(url);
  return V2_REQUEST_URL_PATTERNS.some(pattern => pattern.test(value));
}

function passed(capture) {
  return capture?.backendMatched === true && capture.acceptedFrameVisible === true &&
    capture.surfaceEvidencePassed === true && capture.legacyCoreCutoutPassed === true &&
    capture.liveAdapterPassed === true && capture.selectionPassed === true;
}

/** Keep the release decision separate from Playwright orchestration so a
    missing/blank WebGPU case can never regress into a report-only warning. */
export function summarizePuttomAppCaptureProof(captures, failures) {
  if (!Array.isArray(captures) || !Array.isArray(failures)) {
    throw new TypeError('capture proof requires capture and failure arrays');
  }
  const requiredIds = new Set(PUTTOM_APP_CAPTURE_CASES.map(item => item.id));
  const capturesByCase = new Map();
  let captureSetValid = true;
  for (const capture of captures) {
    if (!capture || !requiredIds.has(capture.caseId) || capturesByCase.has(capture.caseId)) {
      captureSetValid = false;
      continue;
    }
    capturesByCase.set(capture.caseId, capture);
  }
  captureSetValid = captureSetValid &&
    capturesByCase.size === PUTTOM_APP_CAPTURE_CASES.length;

  const webgl2Mobile = capturesByCase.get('webgl2-mobile');
  const webgl2Desktop = capturesByCase.get('webgl2-desktop');
  const webgpuCapture = capturesByCase.get('webgpu-desktop');
  const webgl2MobilePassed = passed(webgl2Mobile);
  const webgl2DesktopPassed = passed(webgl2Desktop);
  const webgpuBackendPassed = webgpuCapture?.backendMatched === true;
  const webgpuReadbackPassed = webgpuCapture?.sceneReadbackPassed === true;
  const webgpuCanvasPassed = webgpuCapture?.canvasPresentationVisible === true;
  const surfaceEvidencePassed = PUTTOM_APP_CAPTURE_CASES
    .every(item => capturesByCase.get(item.id)?.surfaceEvidencePassed === true);
  const legacyCoreCutoutPassed = PUTTOM_APP_CAPTURE_CASES
    .every(item => capturesByCase.get(item.id)?.legacyCoreCutoutPassed === true);
  const liveAdapterPassed = PUTTOM_APP_CAPTURE_CASES
    .every(item => capturesByCase.get(item.id)?.liveAdapterPassed === true);
  const selectionPassed = PUTTOM_APP_CAPTURE_CASES
    .every(item => capturesByCase.get(item.id)?.selectionPassed === true);
  return Object.freeze({
    webgl2MobilePassed,
    webgl2DesktopPassed,
    webgl2Passed: webgl2MobilePassed && webgl2DesktopPassed,
    webgpuBackendPassed,
    webgpuReadbackPassed,
    webgpuCanvasPassed,
    surfaceEvidencePassed,
    legacyCoreCutoutPassed,
    liveAdapterPassed,
    selectionPassed,
    requiredCasesPassed: captureSetValid &&
      PUTTOM_APP_CAPTURE_CASES.every(item => passed(capturesByCase.get(item.id))) &&
      webgpuReadbackPassed && failures.length === 0,
  });
}
