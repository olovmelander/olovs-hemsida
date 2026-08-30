const encoder = new TextEncoder();

function canonicalValue(value, seen, at) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${at} must be a finite JSON number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${at} contains a non-JSON ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError(`${at} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${at}[${index}] is a sparse array slot`);
        result.push(canonicalValue(value[index], seen, `${at}[${index}]`));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${at} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError(`${at} contains symbol keys`);
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalValue(value[key], seen, `${at}.${key}`);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, new Set(), '$'));
}

export function canonicalJsonBytes(value) {
  return encoder.encode(canonicalJson(value));
}
