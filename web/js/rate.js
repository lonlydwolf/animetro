// Rapid rating: one finished, unscored show at a time. Press a number and the next one pulls in.
// Scores save in the background, one after another, so fast rating can't trip AniList's rate limit or land
// out of order. A show only leaves the queue for good once AniList has its score.
import { gql, me, title, prefs } from './api.js';
import { header, $, esc, toast, fail, cover, tint, nsfw, FORMAT } from './ui.js';
import { scale } from './scale.js';

header();
const page = $('#page');
const MUT = 'mutation($id:Int,$s:Float){ SaveMediaListEntry(mediaId:$id,score:$s){ id score } }';
let queue = [], done = [], steps = [], saving = Promise.resolve(), pending = 0;

// custom lists repeat entries; 18+ titles stay hidden unless 18+ is on
const entries = d => [...new Map(d.lists.flatMap(l => l.entries).map(e => [e.media.id, e])).values()].filter(e => !e.media.isAdult || prefs.adult());
const finished = e => (e.completedAt?.year ? new Date(e.completedAt.year, (e.completedAt.month || 1) - 1, e.completedAt.day || 1) : new Date(e.updatedAt * 1000));
const label = v => steps.find(s => s.value === v)?.label ?? v;
// one line instead of a key under every button: the keys are the numbers, except 0 for the tenth
const keysHint = () => (steps.length < 10 ? `Keys 1–${steps.length}`
  : steps[0].label === '1' ? 'Keys 1–9, and 0 for 10' : `Keys 1–9 for ${steps[0].label}–${steps[8].label}, and 0 for ${steps[9].label}`);
// screen readers hear what happened and which show is up now (the toast is for errors)
const say = msg => { $('#rate-live').textContent = `${msg} ${queue[0] ? `Now: ${title(queue[0].media)}. ${queue.length} to rate.` : 'All rated.'}`; };
// The Mac app can't run beforeunload when its window closes or quits, so it asks before leaving while this is above 0.
const busy = () => window.webkit?.messageHandlers?.animetro?.postMessage({ type: 'busy', n: pending });

async function boot() {
  const user = await me();
  if (!user || !user.canWrite) {
    page.innerHTML = `<section class="fy-hero"><h1>Rapid rating</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Score every show you've finished but never rated, one keypress each. ${user
        ? 'Saving scores needs you logged in with AniList; a username alone can only read your list.'
        : 'Connect AniList and log in to start.'}</p>
      <a class="btn" href="pass.html">${user ? 'Log in with AniList' : 'Connect AniList'}</a></section>`;
    return;
  }
  // fresh: a score given elsewhere should take the show off this page
  const d = await gql(`query($u:Int){ Viewer{ mediaListOptions{ scoreFormat } }
    list: MediaListCollection(userId:$u,type:ANIME,status_in:[COMPLETED,REPEATING]){ lists{ entries{ score updatedAt completedAt{year month day}
      media{ id title{english romaji} format seasonYear episodes averageScore genres isAdult coverImage{extraLarge large color} } } } } }`,
  { u: user.id }, { fresh: true });
  steps = scale(d.Viewer.mediaListOptions?.scoreFormat);
  queue = entries(d.list).filter(e => !e.score).sort((a, b) => finished(b) - finished(a)); // freshest memories first
  draw();
}

// Redraw, keeping keyboard focus on the same control (or the first score button) if it was on this page.
function draw() {
  const f = page.contains(document.activeElement) ? document.activeElement : null; // a button, or a link like the poster
  const again = f?.matches('button') && (f.dataset.v ? `[data-v="${f.dataset.v}"]` : 'skip' in f.dataset ? '[data-skip]' : 'undo' in f.dataset ? '[data-undo]' : null);
  paint();
  if (f) ((again && page.querySelector(`${again}:not(:disabled)`)) || page.querySelector('.rate-scale button, .rate-done .btn'))?.focus({ preventScroll: true });
}

function paint() {
  const e = queue[0], m = e?.media;
  page.innerHTML = `
    <section class="rate-head">
      <div><h1>Rapid rating</h1>
        <p class="hint">Shows you've finished but never scored, most recent first. Rated ones leave the line.</p></div>
      <p class="rate-count"><b>${queue.length}</b> to rate${done.length ? `<span> · ${done.length} rated now</span>` : ''}</p>
    </section>
    ${e ? `
    <article class="rate-card${nsfw(m)}" style="--c:${tint(m, 'var(--platform)')}">
      <a class="rate-poster" href="anime.html?id=${m.id}" title="Details"><img src="${cover(m, 'extraLarge')}" alt=""></a>
      <div class="rate-body">
        <p class="rate-meta">${esc([FORMAT[m.format], m.seasonYear, m.episodes > 1 ? `${m.episodes} episodes` : ''].filter(Boolean).join(' · '))}</p>
        <h2>${esc(title(m))}</h2>
        ${m.title.romaji && m.title.romaji !== title(m) ? `<p class="rate-alt">${esc(m.title.romaji)}</p>` : ''}
        <p class="hint">Finished ${finished(e).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}${m.averageScore ? ` · AniList average ${m.averageScore}%` : ''}</p>
        ${m.genres?.length ? `<div class="tags">${m.genres.slice(0, 4).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
        <div class="rate-scale" role="group" aria-label="Your score" style="--n:${steps.length}">
          ${steps.map(s => `<button type="button" data-v="${s.value}" aria-label="Score ${s.value}" aria-keyshortcuts="${s.key}"><b>${esc(s.label)}</b></button>`).join('')}
        </div>
        <div class="rate-tools">
          <button class="btn ghost" type="button" data-skip${queue.length < 2 ? ' disabled' : ''}>Skip for now <kbd>S</kbd></button>
          <button class="btn ghost" type="button" data-undo${done.length ? '' : ' disabled'}>Undo <kbd>U</kbd></button>
          <small class="rate-keys">${keysHint()}</small>
        </div>
      </div>
    </article>
    ${queue.length > 1 ? `<section class="rate-next"><h3>Next stops</h3><div>${queue.slice(1, 11).map((x, i) => `
      <button type="button" class="${nsfw(x.media).trim()}" data-jump="${i + 1}" title="Rate ${esc(title(x.media))} now"><img src="${cover(x.media)}" alt="${esc(title(x.media))}" loading="lazy"></button>`).join('')}
      ${queue.length > 11 ? `<span>+${queue.length - 11}</span>` : ''}</div></section>` : ''}`
    : `<section class="rate-done">
      <span class="roundel" aria-hidden="true">終</span>
      <h2>End of the line</h2>
      <p class="hint">${done.length ? `You rated ${done.length} ${done.length === 1 ? 'show' : 'shows'}. ` : ''}Every show you've finished has a score. Your scores sharpen the picks on For you.</p>
      <p><a class="btn" href="foryou.html">See what fits you</a> ${done.length ? '<button class="btn ghost" type="button" data-undo>Undo last</button>' : ''}</p>
    </section>`}
    ${done.length ? `<section class="rate-log"><h3>Punched just now</h3><div>${done.slice(0, 12).map((x, i) => `
      <a href="anime.html?id=${x.e.media.id}" class="${i === 0 ? 'new' : ''}${nsfw(x.e.media)}" title="${esc(title(x.e.media))}" aria-label="${esc(`${title(x.e.media)}, rated ${label(x.v)}`)}"><img src="${cover(x.e.media)}" alt="" loading="lazy"><b>${esc(label(x.v))}</b></a>`).join('')}</div></section>` : ''}`;
}

// Save one score. Each change for a show gets a ticket; only the latest one may undo the screen after a failure.
function send(e, v) {
  const n = e.seq = (e.seq || 0) + 1;
  pending++;
  busy();
  saving = saving.then(() => gql(MUT, { id: e.media.id, s: v })).then(() => { e.saved = v; }, err => {
    if (e.seq !== n) return; // a newer change for this show is already on its way
    // put it back where its saved score says it belongs, so nothing looks rated that isn't
    queue = queue.filter(x => x !== e);
    done = done.filter(x => x.e !== e);
    if (e.saved) done.unshift({ e, v: e.saved }); else queue.unshift(e);
    draw();
    toast(`Couldn't save ${title(e.media)}: ${err.message}`);
    say(`${title(e.media)} wasn't saved.`);
  }).finally(() => { pending--; busy(); });
}

function rate(v) {
  const e = queue.shift();
  if (!e) return;
  done.unshift({ e, v });
  draw();
  send(e, v);
  say(`Rated ${title(e.media)} ${label(v)}.`);
}
function undo() {
  const last = done.shift();
  if (!last) return;
  queue.unshift(last.e);
  draw();
  send(last.e, 0); // 0 = no score on AniList
  toast(`${title(last.e.media)} is back on the line.`);
  say('Undone.');
}
function skip() {
  if (queue.length < 2) return;
  queue.push(queue.shift());
  draw();
  say('Skipped.');
}

page.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.v) rate(+b.dataset.v);
  else if ('skip' in b.dataset) skip();
  else if ('undo' in b.dataset) undo();
  else if (b.dataset.jump) { queue.unshift(...queue.splice(+b.dataset.jump, 1)); draw(); say(''); }
});
addEventListener('keydown', ev => {
  if (!steps.length || ev.target.closest?.('input, textarea, select, dialog') || ev.altKey) return;
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && !ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); return undo(); } // ⇧ is Redo, left alone
  if (mod || ev.repeat) return;
  const step = queue.length && steps.find(s => s.key === ev.key);
  if (step) rate(step.value);
  else if (ev.key === 's' || ev.key === 'S' || ev.key === 'ArrowRight') skip();
  else if (ev.key === 'u' || ev.key === 'U') undo();
});
// leaving while scores are still on their way would lose them (the Mac app asks through busy() instead)
addEventListener('beforeunload', ev => { if (pending) ev.preventDefault(); });

boot().catch(err => fail(page, err));
