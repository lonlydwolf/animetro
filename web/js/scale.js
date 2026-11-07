// Rating buttons for each of AniList's score formats. Rapid rating saves `score` in the rider's own format,
// so a 5-star rider gets five buttons and a 100-point rider gets 10, 20 … 100.
// Each button has a number key: 1-9, then 0 for the tenth.
// ponytail: whole steps only (no 7.5 on POINT_10_DECIMAL, no 73 on POINT_100); the anime page on AniList does the fine tuning.
const FACES = ['🙁', '😐', '🙂'];

export function scale(format) {
  const n = { POINT_5: 5, POINT_3: 3 }[format] ?? 10;
  const step = format === 'POINT_100' ? 10 : 1;
  return Array.from({ length: n }, (_, i) => ({
    value: (i + 1) * step,
    label: format === 'POINT_3' ? FACES[i] : String((i + 1) * step),
    key: String((i + 1) % 10),
  }));
}
