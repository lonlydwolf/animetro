// Share cards: a watch-order line or your pass, drawn on a canvas as a 1200x675 image you can save,
// copy, or share. No libraries; AniList's image server allows canvas export (it sends CORS headers).
import { toast, safeFilename } from './ui.js';

const W = 1200, H = 675;
const C = { night: '#131833', tunnel: '#1c2346', rail: '#2d3768', ink: '#eef1fa', dim: '#9aa3c7', platform: '#ffd23f' };
const DISPLAY = '"Dela Gothic One", "Zen Kaku Gothic New", system-ui, sans-serif';
const BODY = '"Zen Kaku Gothic New", system-ui, sans-serif';

const img = src => new Promise(res => {
  if (!src) return res(null);
  const i = new Image();
  i.crossOrigin = 'anonymous';
  i.onload = () => res(i);
  i.onerror = () => res(null); // a missing picture shouldn't stop the card
  i.src = src;
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
  const avatar = await img(p.avatar);
  g.fillStyle = C.night; g.fillRect(0, 0, W, H);

  // the IC card on the left
  const cx = 60, cy = 70, cw = 560, ch = 353;
  const grad = g.createLinearGradient(cx, cy, cx + cw, cy + ch);
  grad.addColorStop(0, p.color); grad.addColorStop(1, '#1c2346');
  g.fillStyle = grad; rrect(g, cx, cy, cw, ch, 26); g.fill();
  g.save(); rrect(g, cx, cy, cw, ch, 26); g.clip();
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
  p.stampList.forEach((s, i) => {
    const x = 92 + i * 66, y = 500;
    g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2);
    g.setLineDash(s.got ? [] : [5, 5]); g.lineWidth = s.got ? 4 : 2.5; g.strokeStyle = s.got ? s.c : C.rail; g.stroke(); g.setLineDash([]);
    g.fillStyle = s.got ? s.c : C.rail; g.font = `22px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.k, x, y + 1); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  });
  footer(g);
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
