// Remembers fn's answer per key for the page's lifetime. Calls made while the first is still running share it;
// a failure isn't remembered, so the next call tries again.
export function memo(fn, key = x => x) {
  const seen = new Map();
  return (...args) => {
    const k = key(...args);
    if (!seen.has(k)) {
      const p = Promise.resolve().then(() => fn(...args));
      seen.set(k, p);
      p.catch(() => { if (seen.get(k) === p) seen.delete(k); });
    }
    return seen.get(k);
  };
}
