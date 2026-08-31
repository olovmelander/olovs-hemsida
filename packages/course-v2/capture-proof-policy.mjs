export const PUTTOM_APP_CAPTURE_CASES = Object.freeze([
  Object.freeze({ id: 'webgl2-mobile', backend: 'webgl2', mobile: true, quality: 'lo' }),
  Object.freeze({ id: 'webgl2-desktop', backend: 'webgl2', mobile: false, quality: 'hi' }),
  Object.freeze({ id: 'webgpu-desktop', backend: 'webgpu', mobile: false, quality: 'hi' }),
]);

function passed(captures, caseId) {
  return captures.some(capture => capture?.caseId === caseId &&
    capture.backendMatched === true && capture.acceptedFrameVisible === true &&
    capture.surfaceEvidencePassed === true);
}

/** Keep the release decision separate from Playwright orchestration so a
    missing/blank WebGPU case can never regress into a report-only warning. */
export function summarizePuttomAppCaptureProof(captures, failures) {
  if (!Array.isArray(captures) || !Array.isArray(failures)) {
    throw new TypeError('capture proof requires capture and failure arrays');
  }
  const webgl2MobilePassed = passed(captures, 'webgl2-mobile');
  const webgl2DesktopPassed = passed(captures, 'webgl2-desktop');
  const webgpuCapture = captures.find(capture => capture?.caseId === 'webgpu-desktop');
  const webgpuBackendPassed = Boolean(webgpuCapture?.backendMatched);
  const webgpuReadbackPassed = webgpuCapture?.sceneReadbackPassed === true;
  const webgpuCanvasPassed = webgpuCapture?.canvasPresentationVisible === true;
  const surfaceEvidencePassed = PUTTOM_APP_CAPTURE_CASES
    .every(item => captures.some(capture => capture?.caseId === item.id &&
      capture.surfaceEvidencePassed === true));
  return Object.freeze({
    webgl2MobilePassed,
    webgl2DesktopPassed,
    webgl2Passed: webgl2MobilePassed && webgl2DesktopPassed,
    webgpuBackendPassed,
    webgpuReadbackPassed,
    webgpuCanvasPassed,
    surfaceEvidencePassed,
    requiredCasesPassed: PUTTOM_APP_CAPTURE_CASES.every(item => passed(captures, item.id)) &&
      webgpuReadbackPassed && failures.length === 0,
  });
}
