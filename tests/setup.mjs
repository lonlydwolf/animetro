// The app's modules expect a browser: a page address and web storage. Import this first in every test file.
globalThis.location = { hash: '', pathname: '/', search: '', href: 'http://localhost/', protocol: 'http:' };
const memory = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i], get length() { return m.size; } };
};
globalThis.sessionStorage = memory();
globalThis.localStorage = memory();
// window events (storage, ratelimit, …) on a plain EventTarget
const win = new EventTarget();
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[k] ??= win[k].bind(win);
