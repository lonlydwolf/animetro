// Share cards: a watch-order line, your pass or a ticket stub, drawn on a canvas as a 1200x675 image you can save,
// copy, or share. No libraries; AniList's image server allows canvas export (it sends CORS headers;
// the Mac app proxies pictures instead, see img below).
import { toast, safeFilename } from './ui.js';
import { inApp } from './api.js';

const W = 1200, H = 675;
const C = { night: '#131833', tunnel: '#1c2346', rail: '#2d3768', ink: '#eef1fa', dim: '#9aa3c7', platform: '#ffd23f' };
const DISPLAY = '"Dela Gothic One", "Zen Kaku Gothic New", system-ui, sans-serif';
const BODY = '"Zen Kaku Gothic New", system-ui, sans-serif';
const DOT = '"DotGothic16", ui-monospace, monospace';

const img = src => new Promise(res => {
  if (!src) return res(null);
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => res(null); // a missing picture shouldn't stop the card
  // The Mac app fetches pictures itself and serves them from its own origin (AniList refuses CORS to animetro://).
  if (inApp && /^https:/.test(src)) return void (i.src = `__image?u=${encodeURIComponent(src)}`);
  i.crossOrigin = 'anonymous';
  // The page already showed this picture without CORS, and Chrome reuses that cached copy, which a canvas
  // may not read. A query string gives the card its own CORS copy (AniList's image server ignores it).
  i.src = /^https:/.test(src) ? `${src}${src.includes('?') ? '&' : '?'}card` : src;
});

function canvas() {
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2; // drawn at 2x so it stays sharp
  const g = c.getContext('2d');
  g.scale(2, 2);
  return [c, g];
}

function cover(g, im, x, y, w, h) { // like CSS object-fit: cover
  if (!im) return;
  const s = Math.max(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s;
  g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

function lines(g, text, max, n) { // word-wrap into at most n lines, with an ellipsis
  const out = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const t = cur ? cur + ' ' + word : word;
    if (g.measureText(t).width > max && cur) { out.push(cur); cur = word; } else cur = t;
  }
  out.push(cur);
  if (out.length > n) { out.length = n; out[n - 1] = out[n - 1].replace(/\s*\S*$/, '') + '…'; }
  return out;
}

function footer(g) {
  g.fillStyle = C.night;
  g.beginPath(); g.arc(68, H - 44, 17, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = C.platform; g.stroke();
  g.fillStyle = C.ink; g.font = `14px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('A', 68, H - 43);
  g.textAlign = 'left'; g.font = `20px ${DISPLAY}`; g.fillText('Animetro', 96, H - 43);
  g.fillStyle = C.dim; g.font = `500 15px ${BODY}`; g.fillText('anime watch orders as train lines', 214, H - 42);
}

async function ready() { await document.fonts?.ready; }

// ---- watch-order line ----------------------------------------------------
// line: { name, color, banner, stops: [{ name, state: 'done'|'here'|'todo'|'recap'|'soon' }], facts: [..], progress: 0-100 | null, rider }
export async function lineCard(line) {
  await ready();
  const [c, g] = canvas();
  const banner = await img(line.banner);
  g.fillStyle = C.night; g.fillRect(0, 0, W, H);
  if (banner) { g.globalAlpha = .55; cover(g, banner, 0, 0, W, 330); g.globalAlpha = 1; }
  const fade = g.createLinearGradient(0, 120, 0, 340);
  fade.addColorStop(0, 'rgba(19,24,51,0)'); fade.addColorStop(1, C.night);
  g.fillStyle = fade; g.fillRect(0, 0, W, 340);

  g.fillStyle = line.color; rrect(g, 60, 54, 150, 34, 17); g.fill();
  g.fillStyle = C.night; g.font = `600 16px ${BODY}`; g.textBaseline = 'middle'; g.fillText('WATCH ORDER', 78, 72);
  g.fillStyle = C.ink; g.font = `62px ${DISPLAY}`; g.textBaseline = 'alphabetic';
  lines(g, line.name, W - 120, 2).forEach((t, i) => g.fillText(t, 60, 168 + i * 72));
  g.fillStyle = C.dim; g.font = `500 22px ${BODY}`;
  g.fillText(line.facts.join('  ·  '), 60, 318);

  // the line itself: stations evenly spread, ridden ones filled
  const n = line.stops.length, x0 = 90, x1 = W - (n <= 16 ? 210 : 90), y = 420; // room for the last slanted name
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  g.lineCap = 'round';
  g.strokeStyle = '#0d1129'; g.lineWidth = 22; g.beginPath(); g.moveTo(x0, y); g.lineTo(n > 1 ? x1 : x0 + 1, y); g.stroke();
  g.strokeStyle = line.color; g.lineWidth = 12; g.stroke();
  const r = Math.max(7, Math.min(15, step / 3.2));
  line.stops.forEach((s, i) => {
    const x = n > 1 ? x0 + i * step : (x0 + x1) / 2;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    const ridden = s.state === 'done' || s.state === 'here';
    g.fillStyle = ridden ? '#fff' : C.night; g.fill();
    g.lineWidth = r * .55; g.strokeStyle = ridden ? line.color : s.state === 'soon' ? C.dim : '#5b6594';
    g.setLineDash(s.state === 'soon' || s.state === 'recap' ? [4, 4] : []); g.stroke(); g.setLineDash([]);
    if (s.state === 'here') { g.beginPath(); g.arc(x, y, r * .4, 0, Math.PI * 2); g.fillStyle = line.color; g.fill(); }
    if (n <= 16) { // names only when there's room
      g.save(); g.translate(x + 4, y - r - 14); g.rotate(-Math.PI / 5.5);
      g.fillStyle = ridden ? C.ink : C.dim; g.font = `600 14px ${BODY}`;
      g.fillText(s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name, 0, 0); g.restore();
    }
  });

  if (line.progress != null) {
    g.fillStyle = C.ink; g.font = `600 20px ${BODY}`;
    g.fillText(`${line.rider} has ridden ${line.progress}% of the line`, 60, 512);
    g.fillStyle = C.rail; rrect(g, 60, 528, W - 120, 14, 7); g.fill();
    g.fillStyle = line.color; rrect(g, 60, 528, Math.max(14, (W - 120) * line.progress / 100), 14, 7); g.fill();
  }
  footer(g);
  return c;
}

// ---- my pass ---------------------------------------------------------------
// pass: { name, avatar, color, since, tier: { name, jp, c }, points, next, pct, persona, stats: [[value, label]], stamps: [got, total] }
export async function passCard(p) {
  await ready();
  const [c, g] = canvas();
  const [avatar, banner] = await Promise.all([img(p.avatar), img(p.banner)]);
  g.fillStyle = C.night; g.fillRect(0, 0, W, H);

  // the IC card on the left
  const cx = 60, cy = 70, cw = 560, ch = 353;
  const grad = g.createLinearGradient(cx, cy, cx + cw, cy + ch);
  grad.addColorStop(0, p.color); grad.addColorStop(1, '#1c2346');
  g.fillStyle = grad; rrect(g, cx, cy, cw, ch, 26); g.fill();
  g.save(); rrect(g, cx, cy, cw, ch, 26); g.clip();
  if (banner) { // the AniList profile banner, faded like the card on My pass
    cover(g, banner, cx, cy, cw, ch);
    const tintFade = g.createLinearGradient(cx, cy, cx + cw * .55, cy + ch);
    tintFade.addColorStop(0, p.color); tintFade.addColorStop(.5, 'transparent');
    g.globalAlpha = .45; g.fillStyle = tintFade; g.fillRect(cx, cy, cw, ch); g.globalAlpha = 1;
    const dark = g.createLinearGradient(cx, cy, cx + cw * .55, cy + ch);
    dark.addColorStop(0, 'rgba(0,0,0,.1)'); dark.addColorStop(.45, 'rgba(0,0,0,.3)'); dark.addColorStop(1, 'rgba(0,0,0,.7)');
    g.fillStyle = dark; g.fillRect(cx, cy, cw, ch);
  }
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 38; g.beginPath(); g.arc(cx + cw - 10, cy + 20, 150, 0, Math.PI * 2); g.stroke();
  g.restore();
  g.fillStyle = '#fff'; g.font = `22px ${DISPLAY}`; g.fillText('Animetro pass', cx + 30, cy + 52);
  g.fillStyle = '#e9c45a'; rrect(g, cx + cw - 90, cy + 26, 56, 42, 9); g.fill();
  if (avatar) {
    g.save(); g.beginPath(); g.arc(cx + 80, cy + 170, 48, 0, Math.PI * 2); g.clip(); cover(g, avatar, cx + 32, cy + 122, 96, 96); g.restore();
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(cx + 80, cy + 170, 48, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = '#fff'; g.font = `38px ${DISPLAY}`;
  g.fillText(lines(g, p.name, cw - 190, 1)[0], cx + 150, cy + 168);
  g.font = `500 18px ${BODY}`; g.globalAlpha = .85; g.fillText(`Rider since ${p.since}`, cx + 150, cy + 198); g.globalAlpha = 1;
  p.stats.forEach(([v, l], i) => {
    const x = cx + 30 + i * ((cw - 60) / p.stats.length);
    g.fillStyle = '#fff'; g.font = `22px ${DISPLAY}`; g.fillText(v, x, cy + ch - 46);
    g.font = `500 15px ${BODY}`; g.globalAlpha = .85; g.fillText(l, x, cy + ch - 22); g.globalAlpha = 1;
  });

  // rank and personality on the right
  const rx = 670;
  g.fillStyle = p.tier.c; g.font = `700 18px ${BODY}`; g.fillText(p.tier.jp, rx, 110);
  g.fillStyle = C.ink; g.font = `52px ${DISPLAY}`; g.fillText(lines(g, p.tier.name, W - rx - 60, 1)[0], rx, 168);
  g.fillStyle = C.dim; g.font = `500 20px ${BODY}`;
  g.fillText(`${p.points.toLocaleString()} ride points${p.next ? `, ${(p.next.at - p.points).toLocaleString()} to ${p.next.name}` : ''}`, rx, 204);
  g.fillStyle = C.rail; rrect(g, rx, 222, W - rx - 60, 14, 7); g.fill();
  g.fillStyle = p.tier.c; rrect(g, rx, 222, Math.max(14, (W - rx - 60) * p.pct), 14, 7); g.fill();
  g.fillStyle = C.dim; g.font = `500 18px ${BODY}`; g.fillText('Anime personality', rx, 300);
  g.fillStyle = C.ink; g.font = `34px ${DISPLAY}`;
  lines(g, p.persona, W - rx - 60, 2).forEach((t, i) => g.fillText(t, rx, 344 + i * 42));
  g.fillStyle = C.dim; g.font = `500 20px ${BODY}`; g.fillText(`${p.stamps[0]} of ${p.stamps[1]} station stamps collected`, rx, 430);

  // a row of stamp circles under the card
  // up to two rows of stamp circles (19 a row fit across the card)
  const perRow = p.stampList.length > 16 ? Math.ceil(p.stampList.length / 2) : 16, gap = Math.min(66, (W - 2 * 92) / Math.max(1, perRow - 1));
  p.stampList.forEach((s, i) => {
    const x = 92 + (i % perRow) * gap, y = 490 + Math.floor(i / perRow) * 58;
    g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2);
    g.setLineDash(s.got ? [] : [5, 5]); g.lineWidth = s.got ? 4 : 2.5; g.strokeStyle = s.got ? s.c : C.rail; g.stroke(); g.setLineDash([]);
    g.fillStyle = s.got ? s.c : C.rail; g.font = `20px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.k, x, y + 1); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  });
  footer(g);
  return c;
}

// ---- ticket stub -------------------------------------------------------------
// stub: { no, name, color, cover, kind, origin, terminus, single, boarded, arrived, ride, days, score: { text, out } | null,
//   rewatch: 'Again' | '×2' | 'Now' | null, rider, nth: '455th' }
// no is the printed serial ('0455').
// cover is null for an 18+ show while 18+ covers are blurred: the card leaves the picture out rather than show it.
const PAPER = '#f3eee0', PRINT = '#131833', FAINT = '#5d6283', SERIAL = '#b3101f';
// mix a #rrggbb color toward another, like CSS color-mix (canvas can't be trusted to parse color-mix itself)
function mix(a, b, t) {
  const n = h => (h.length === 4 ? [...h.slice(1)].map(c => parseInt(c + c, 16)) : [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const [x, y] = [n(a), n(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
export async function stubCard(s) {
  await ready();
  const [c, g] = canvas();
  const pic = await img(s.cover);
  const base = /^#([0-9a-f]{3}){1,2}$/i.test(s.color) ? s.color : C.platform;
  const line = mix(base, PRINT, .18); // pale covers still show on paper
  g.fillStyle = C.night; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 290, 40, W / 2, 290, 620);
  glow.addColorStop(0, mix(base, C.night, .55)); glow.addColorStop(1, C.night);
  g.globalAlpha = .55; g.fillStyle = glow; g.fillRect(0, 0, W, H); g.globalAlpha = 1;

  // the paper, tilted a little like a stub dropped on a table
  const x = 70, y = 56, w = 1060, h = 486, tail = 270, cut = x + w - tail;
  g.save();
  g.translate(W / 2, y + h / 2); g.rotate(-.012); g.translate(-W / 2, -(y + h / 2));
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 40; g.shadowOffsetY = 16;
  g.fillStyle = PAPER; rrect(g, x, y, w, h, 22); g.fill();
  g.shadowColor = 'transparent';
  g.save(); rrect(g, x, y, w, h, 22); g.clip();
  g.strokeStyle = line; g.globalAlpha = .07; g.lineWidth = 2; // security print
  for (let i = -h; i < w; i += 12) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke(); }
  g.globalAlpha = .09; g.fillStyle = line; g.fillRect(cut, y, tail, h); g.globalAlpha = 1;
  g.fillStyle = line; g.fillRect(x, y, w, 18); // the line color across the top
  g.restore();
  // notches at the tear line, then the perforation
  g.fillStyle = C.night;
  for (const ny of [y, y + h]) { g.beginPath(); g.arc(cut, ny, 18, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(19,24,51,.3)'; g.lineWidth = 3; g.setLineDash([9, 9]);
  g.beginPath(); g.moveTo(cut, y + 26); g.lineTo(cut, y + h - 26); g.stroke(); g.setLineDash([]);

  // header row
  const mx = x + 44, mw = cut - mx - 40;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = PRINT; g.font = `24px ${DISPLAY}`; g.fillText('Animetro', mx, y + 70);
  const bw = g.measureText('Animetro').width;
  g.fillStyle = FAINT; g.font = `700 17px ${BODY}`; g.fillText(s.kind.toUpperCase(), mx + bw + 18, y + 69);
  g.fillStyle = SERIAL; g.font = `26px ${DOT}`; g.textAlign = 'right'; g.fillText(`No. ${s.no}`, cut - 40, y + 70); g.textAlign = 'left';

  // title
  // a long name steps down a size before it gets cut short
  const room = mw - (s.rewatch ? 110 : 0);
  g.fillStyle = PRINT; g.font = `50px ${DISPLAY}`;
  if (lines(g, s.name, room, 3).length > 2) g.font = `40px ${DISPLAY}`;
  const lh = g.font.startsWith('50') ? 58 : 48;
  const title = lines(g, s.name, room, 2);
  title.forEach((t, i) => g.fillText(t, mx, y + 140 + i * lh));
  const ty = y + 140 + (title.length - 1) * lh;

  // origin ── terminus
  const ry = ty + 92;
  g.fillStyle = FAINT; g.font = `700 15px ${BODY}`; g.fillText('FROM', mx, ry - 40);
  g.textAlign = 'right'; g.fillText('TO', cut - 40, ry - 40);
  g.fillStyle = PRINT; g.font = `30px ${DISPLAY}`; g.fillText(s.terminus, cut - 40, ry); g.textAlign = 'left';
  g.fillText(s.origin, mx, ry);
  const a = mx + g.measureText(s.origin).width + 34, b = cut - 40 - g.measureText(s.terminus).width - 34, my = ry - 11;
  g.lineCap = 'round'; g.strokeStyle = line; g.lineWidth = 12;
  if (s.single) g.setLineDash([20, 12]);
  g.beginPath(); g.moveTo(a, my); g.lineTo(b, my); g.stroke(); g.setLineDash([]);
  for (const [px, fill] of [[a, PAPER], [b, line]]) {
    g.beginPath(); g.arc(px, my, 14, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 7; g.strokeStyle = line; g.stroke();
  }

  // the facts, printed like a ticket machine would
  const fy = y + h - 104;
  g.strokeStyle = 'rgba(19,24,51,.3)'; g.lineWidth = 2; g.setLineDash([5, 6]);
  g.beginPath(); g.moveTo(mx, fy - 30); g.lineTo(cut - 40, fy - 30); g.stroke(); g.setLineDash([]);
  const facts = [['BOARDED', s.boarded || '—'], ['ARRIVED', s.arrived || '—'], ['RIDE TIME', s.ride || '—']];
  facts.forEach(([k, v], i) => {
    const fx = mx + i * (mw / 3);
    g.fillStyle = FAINT; g.font = `700 15px ${BODY}`; g.fillText(k, fx, fy);
    g.fillStyle = PRINT; g.font = `28px ${DOT}`; g.fillText(v, fx, fy + 40);
  });
  if (s.days) { g.fillStyle = FAINT; g.font = `500 17px ${BODY}`; g.fillText(`in ${s.days} ${s.days === 1 ? 'day' : 'days'}`, mx + 2 * (mw / 3), fy + 68); }

  // 再: a round station stamp for a rewatch
  if (s.rewatch) {
    g.save(); g.translate(cut - 96, y + 150); g.rotate(-.25); g.globalAlpha = .85;
    g.strokeStyle = SERIAL; g.fillStyle = SERIAL;
    g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 42, 0, Math.PI * 2); g.stroke();
    g.textAlign = 'center'; g.font = `40px ${DISPLAY}`; g.fillText('再', 0, 8);
    g.font = `700 14px ${BODY}`; g.fillText(s.rewatch.toUpperCase(), 0, 30);
    g.restore();
  }

  // the tail: cover and score
  const tx = cut + tail / 2, cw = 160, ch = 228, cy = y + 56;
  g.fillStyle = line; rrect(g, tx - cw / 2 - 7, cy - 7, cw + 14, ch + 14, 14); g.fill();
  g.fillStyle = PAPER; rrect(g, tx - cw / 2 - 3, cy - 3, cw + 6, ch + 6, 11); g.fill();
  g.save(); rrect(g, tx - cw / 2, cy, cw, ch, 9); g.clip();
  g.fillStyle = mix(PAPER, PRINT, .12); g.fillRect(tx - cw / 2, cy, cw, ch);
  if (pic) cover(g, pic, tx - cw / 2, cy, cw, ch);
  else { g.fillStyle = FAINT; g.font = `30px ${DISPLAY}`; g.textAlign = 'center'; g.fillText(s.cover === null && s.adult ? '18+' : '?', tx, cy + ch / 2 + 10); }
  g.restore();
  g.textAlign = 'center';
  g.fillStyle = FAINT; g.font = `700 15px ${BODY}`; g.fillText('YOUR SCORE', tx, cy + ch + 46);
  g.fillStyle = s.score ? PRINT : FAINT; g.font = `${s.score?.text.length > 4 ? 40 : 56}px ${DISPLAY}`;
  g.fillText(s.score ? s.score.text : '—', tx, cy + ch + 106);
  g.fillStyle = FAINT; g.font = `700 18px ${BODY}`; g.fillText(s.score ? s.score.out : 'not rated', tx, cy + ch + 134);
  g.textAlign = 'left';
  g.restore();

  footer(g);
  g.fillStyle = C.dim; g.font = `500 17px ${BODY}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(`${s.rider}'s ${s.nth} completed show`, W - 70, H - 42);
  g.textAlign = 'left';
  return c;
}

// ---- show it ----------------------------------------------------------------
export async function showCard(make, name) {
  const filename = safeFilename(name);
  toast('Drawing your card…');
  let c;
  try { c = await make(); } catch (e) { return toast(`Couldn't draw the card: ${e.message}`); }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  if (!blob) return toast("Couldn't save the card in this browser.");
  const url = URL.createObjectURL(blob), file = new File([blob], filename, { type: 'image/png' });
  const native = window.webkit?.messageHandlers?.animetro; // the Mac app saves through a native Save dialog
  const d = document.createElement('dialog');
  d.className = 'gate share-dialog';
  d.innerHTML = `<form method="dialog">
    <img src="${url}" alt="Share card preview">
    <div class="gate-actions">
      <button class="btn ghost" value="close">Close</button>
      ${navigator.clipboard && window.ClipboardItem ? '<button class="btn ghost" type="button" data-copy>Copy image</button>' : ''}
      ${navigator.canShare?.({ files: [file] }) ? '<button class="btn ghost" type="button" data-share>Share…</button>' : ''}
      ${native ? '<button class="btn" type="button" data-save>Save image…</button>' : `<a class="btn" href="${url}" download="${filename}">Save image</a>`}
    </div></form>`;
  document.body.append(d);
  d.addEventListener('close', () => { URL.revokeObjectURL(url); d.remove(); });
  d.querySelector('[data-copy]')?.addEventListener('click', () =>
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => toast('Image copied.'), () => toast("Couldn't copy. Save it instead.")));
  d.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
  d.querySelector('[data-save]')?.addEventListener('click', async () => {
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    native.postMessage({ type: 'save', name: filename, data: b64 });
  });
  d.showModal();
}
