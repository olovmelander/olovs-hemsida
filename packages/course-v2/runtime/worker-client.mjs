import { abortError } from './decode-web.mjs';

function exactBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    return value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError('worker input must be an ArrayBuffer or Uint8Array');
}

function workerError(value) {
  const error = new Error(String(value?.message || 'Worker decode failed'));
  error.name = String(value?.name || 'Error');
  return error;
}

export class ChunkWorkerClient {
  constructor(worker, options = {}) {
    if (!worker?.postMessage || !worker?.addEventListener) throw new TypeError('worker must implement the Worker interface');
    this.worker = worker;
    this.supportedFeatures = options.supportedFeatures;
    this.nextId = 1;
    this.pending = new Map();
    this.disposed = false;
    this.onMessage = event => this.#message(event.data);
    this.onError = event => this.#fatal(event?.error || new Error(event?.message || 'Worker failed'));
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onError);
  }

  decode(reference, input, options = {}) {
    if (this.disposed) return Promise.reject(new Error('chunk worker client is disposed'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    const id = this.nextId++;
    const buffer = exactBuffer(input);
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.worker.postMessage({ type: 'cancel', id });
        reject(abortError());
      };
      this.pending.set(id, { resolve, reject, signal: options.signal, abort });
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({
          type: 'decode', id, reference, buffer, supportedFeatures: this.supportedFeatures,
        }, [buffer]);
      } catch (error) {
        this.pending.delete(id);
        options.signal?.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }

  #message(message) {
    if (!message || !Number.isSafeInteger(message.id)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.signal?.removeEventListener('abort', pending.abort);
    if (message.type === 'decoded' && message.payload instanceof ArrayBuffer) {
      pending.resolve({
        header: message.header,
        payload: new Uint8Array(message.payload),
        content: message.content,
        inspection: message.inspection,
      });
    } else if (message.type === 'cancelled') {
      pending.reject(abortError());
    } else {
      pending.reject(workerError(message.error));
    }
  }

  #fatal(error) {
    for (const pending of this.pending.values()) {
      pending.signal?.removeEventListener('abort', pending.abort);
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onError);
    this.#fatal(new Error('chunk worker client disposed'));
    this.worker.terminate?.();
  }
}

