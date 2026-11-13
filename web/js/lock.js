// One job per key at a time: a call for a key that is still running is dropped (returns undefined), so a quick
// double click can't send the same save twice or let an older response land after a newer one.
export function lock() {
  const busy = new Set();
  return async (key, job) => {
    if (busy.has(key)) return undefined;
    busy.add(key);
    try { return await job(); } finally { busy.delete(key); }
  };
}
