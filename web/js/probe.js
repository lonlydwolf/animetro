// Exact count of matching results when the API won't say: AniList's pageInfo.total is stuck at 5000,
// but asking for page N with perPage 1 returns an item only if at least N results match.
// probe(positions) -> Promise of the positions that exist (one aliased request per call).
// Pure logic, so tests can run it with a fake probe.
const MAX = 5000;      // AniList won't page past this
const PER_CALL = 30;   // positions checked per request

export async function countPages(probe, max = MAX) {
  const pows = [];
  for (let p = 1; p < max; p *= 2) pows.push(p);
  pows.push(max);
  const hits = await probe(pows);
  if (!hits.length) return 0;
  let lo = Math.max(...hits);                 // known to exist
  if (lo >= max) return max;
  let hi = pows.find(p => p > lo);            // known missing
  while (hi - lo > 1) {                       // narrow the gap until it closes
    const step = Math.max(1, Math.ceil((hi - lo - 1) / PER_CALL));
    const positions = [];
    for (let p = lo + step; p < hi; p += step) positions.push(p);
    const got = await probe(positions);
    if (got.length) lo = Math.max(...got);
    hi = positions.find(p => p > lo) ?? hi;
  }
  return lo;
}
