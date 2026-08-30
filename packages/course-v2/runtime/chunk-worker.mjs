import { abortError, verifyChunkAssetWeb } from './decode-web.mjs';

function messageError(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error || 'Unknown worker error'),
  };
}

export function installChunkWorker(scope = globalThis) {
  const tasks = new Map();
  const listener = async event => {
    const message = event?.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'cancel') {
      tasks.get(message.id)?.abort(abortError());
      return;
    }
    if (message.type !== 'decode' || !Number.isSafeInteger(message.id) || message.id < 1 ||
        !(message.buffer instanceof ArrayBuffer)) {
      scope.postMessage({ type: 'protocol-error', id: message?.id ?? null, error: { name: 'Error', message: 'invalid worker request' } });
      return;
    }
    if (tasks.has(message.id)) {
      scope.postMessage({ type: 'protocol-error', id: message.id, error: { name: 'Error', message: 'duplicate worker request id' } });
      return;
    }
    const controller = new AbortController();
    tasks.set(message.id, controller);
    try {
      const result = await verifyChunkAssetWeb(message.reference, message.buffer, {
        signal: controller.signal,
        supportedFeatures: message.supportedFeatures,
      });
      if (controller.signal.aborted) throw abortError();
      const payload = result.payload.buffer;
      scope.postMessage({
        type: 'decoded',
        id: message.id,
        header: result.header,
        content: result.content,
        inspection: result.inspection,
        payload,
      }, [payload]);
    } catch (error) {
      scope.postMessage({
        type: error?.name === 'AbortError' ? 'cancelled' : 'decode-error',
        id: message.id,
        error: messageError(error),
      });
    } finally {
      tasks.delete(message.id);
    }
  };
  scope.addEventListener('message', listener);
  return () => {
    scope.removeEventListener('message', listener);
    for (const controller of tasks.values()) controller.abort(abortError('Worker disposed'));
    tasks.clear();
  };
}
