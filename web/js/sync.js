import { gql, me, title } from './api.js';
import { header, $, esc, toast, fail } from './ui.js';
import { syncOn, setSyncOn, simklClient, setSimklClient, simklConnected, simklDisconnect, startLogin, waitForLogin, simklLibrary, plan, send, SIMKL_LABEL } from './simkl.js';

header();
const page = $('#page');
const AL_LABEL = { watching: 'Watching', plantowatch: 'Planning', completed: 'Completed', hold: 'Paused', dropped: 'Dropped' };
let login; // AbortController for the Simkl login in progress, from asking for a code until the token is saved

function boot() {
  if (!syncOn()) {
    page.innerHTML = `
      <section class="fy-hero">
        <p class="hint" style="margin:0">Transfers</p>
        <h1>Backup sync</h1>
        <p class="hint" style="font-size:1rem;max-width:62ch">Copies your AniList list to other trackers, as a backup next to MAL-Sync. It only runs when you press the button, it never changes anything on AniList, and it never removes anything from the other tracker.</p>
        <button class="btn" id="on">Turn on backup sync</button>
      </section>`;
    $('#on').onclick = () => { setSyncOn(true); boot(); };
    return;
  }
  page.innerHTML = `
    <section class="fy-hero">
      <p class="hint" style="margin:0">Transfers</p>
      <h1>Backup sync</h1>
      <p class="hint" style="font-size:1rem;max-width:62ch">AniList is the source. Check what would change, then send it: your statuses, episode progress and scores go to the trackers below. Nothing runs on its own, nothing on AniList changes, and nothing is removed elsewhere.</p>
    </section>
    <div class="transfers">
      <div class="transfer" id="simkl"></div>
      <div class="transfer off">
        <h3>MyAnimeList</h3>
        <p class="hint">Not yet. MyAnimeList blocks web pages from using its API, so this needs native code in the Mac app, planned for a later version. MAL-Sync already covers it for now.</p>
      </div>
      <div class="transfer">
        <h3>Bingers</h3>
        <p class="hint">Bingers' API needs a paid plan, so this goes through Simkl instead, for free:</p>
        <ol class="steps">
          <li>Sync to Simkl here.</li>
          <li>On Simkl, download your backup: <a href="https://simkl.com/apps/backup/" target="_blank" rel="noopener">simkl.com/apps/backup</a>, JSON.</li>
          <li>Upload that file at <a href="https://bingers.app/import" target="_blank" rel="noopener">bingers.app/import</a> as a Simkl backup.</li>
        </ol>
        <p class="hint">Simkl's own docs disagree on whether the JSON backup is free. If it asks for Simkl Pro, this route won't work for now.</p>
      </div>
    </div>
    <p style="margin-top:28px"><button class="btn ghost" id="off">Turn off backup sync</button> <span class="hint">Forgets your Simkl connection and client ID in this browser.</span></p>`;
  $('#off').onclick = () => { login?.abort(); setSyncOn(false); toast('Backup sync is off.'); boot(); };
  simkl();
}

// ---- Simkl card -------------------------------------------------------------
function simkl() {
  const el = $('#simkl');
  if (!simklClient()) {
    el.innerHTML = `
      <h3>Simkl</h3>
      <p class="hint">Free. Simkl needs a client ID from you once:</p>
      <ol class="steps">
        <li>Open <a href="https://simkl.com/settings/developer/" target="_blank" rel="noopener">simkl.com/settings/developer</a> and create a new app.</li>
        <li>Name it anything. For the type, pick <b>TV, devices &amp; command line</b>: no redirect URL needed.</li>
        <li>Paste its client ID here. It stays in this browser.</li>
      </ol>
      <form id="client" class="inline-form"><input name="id" placeholder="Simkl client ID" required autocomplete="off"><button class="btn">Save</button></form>`;
    $('#client').onsubmit = e => { e.preventDefault(); setSimklClient(e.target.id.value); simkl(); };
    return;
  }
  if (!simklConnected()) {
    el.innerHTML = `
      <h3>Simkl</h3>
      <p class="hint">Client ID saved. Connect your Simkl account: you'll approve a short code on simkl.com.</p>
      <div class="row-btns"><button class="btn" id="connect">Connect Simkl</button><button class="btn ghost" id="reset">Change client ID</button></div>
      <div id="code"></div>`;
    $('#reset').onclick = () => { login?.abort(); setSimklClient(''); simkl(); };
    $('#connect').onclick = connect;
    return;
  }
  el.innerHTML = `
    <h3>Simkl <span class="tag s-COMPLETED">Connected</span></h3>
    <p class="hint">First Animetro shows what would change. Nothing is sent until you confirm.</p>
    <div class="row-btns"><button class="btn" id="check">Check what would change</button><button class="btn ghost" id="disconnect">Disconnect</button></div>
    <div id="preview"></div>`;
  $('#disconnect').onclick = () => { simklDisconnect(); simkl(); };
  $('#check').onclick = check;
}

async function connect() {
  const box = $('#code'), btn = $('#connect');
  btn.disabled = true;
  login?.abort();
  const ctl = login = new AbortController(); // made before the first request, so Off cancels even that one
  try {
    const code = await startLogin(ctl.signal);
    box.innerHTML = `
      <div class="pin">
        <p class="hint" style="margin:0">Approve this code on Simkl:</p>
        <b class="pin-code">${esc(code.user_code)}</b>
        <div class="row-btns"><a class="btn" href="${esc(code.verification_uri_complete || code.verification_uri)}" target="_blank" rel="noopener">Open Simkl</a><button class="btn ghost" id="cancel">Cancel</button></div>
        <p class="hint" style="margin:0">Waiting for you to approve… The code works for ${Math.round((code.expires_in || 900) / 60)} minutes.</p>
      </div>`;
    $('#cancel').onclick = () => ctl.abort();
    await waitForLogin(code, ctl.signal);
    toast('Simkl connected.');
    simkl();
  } catch (e) {
    if (ctl.signal.aborted && !box.isConnected) return; // turned off: the page already moved on
    box.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    btn.disabled = false;
  } finally {
    if (login === ctl) login = null;
  }
}

// ---- preview, then send ----------------------------------------------------
async function anilistList(user) {
  // fresh: skip the 5-minute cache so the backup reflects AniList right now
  const d = await gql(`query($u:Int){ MediaListCollection(userId:$u,type:ANIME){ lists{ entries{
    status progress score(format:POINT_10_DECIMAL) media{ id idMal episodes title{ romaji english } } } } } }`, { u: user.id }, { fresh: true });
  const byId = new Map();
  for (const e of d.MediaListCollection.lists.flatMap(l => l.entries)) byId.set(e.media.id, e); // custom lists repeat entries
  return [...byId.values()];
}

async function check() {
  const box = $('#preview'), btn = $('#check');
  btn.disabled = true;
  try {
    const user = await me();
    if (!user) { box.innerHTML = '<p class="hint">Connect AniList on <a href="pass.html">My pass</a> first.</p>'; return; }
    box.innerHTML = '<p class="hint">Reading both lists…</p>';
    const [entries, library] = await Promise.all([anilistList(user), simklLibrary()]);
    const p = plan(entries, library);
    const writes = p.history.length + p.list.length + p.ratings.length;
    if (!writes) { box.innerHTML = `<p class="done-note">Simkl already matches your AniList list (${entries.length} titles). Nothing to send.</p>`; return; }
    const added = p.changes.filter(c => !c.from).length;
    const batches = Math.ceil(p.history.length / 50) + Math.ceil(p.list.length / 50) + Math.ceil(p.ratings.length / 50);
    const SHOW = 200;
    box.innerHTML = `
      <div class="sync-sum">
        <div><b>${p.changes.length}</b><span>titles to update</span></div>
        <div><b>${added}</b><span>new on Simkl</span></div>
        <div><b>${p.episodes.toLocaleString()}</b><span>episodes</span></div>
        <div><b>${p.ratings.length}</b><span>scores</span></div>
      </div>
      <div class="sync-table">${p.changes.slice(0, SHOW).map(row).join('')}</div>
      ${p.changes.length > SHOW ? `<p class="hint">…and ${p.changes.length - SHOW} more.</p>` : ''}
      <div class="row-btns"><button class="btn" id="send">Send to Simkl</button><span class="hint" style="margin:0">${batches} request${batches === 1 ? '' : 's'}, about ${Math.max(1, Math.ceil(batches * 1.1))}s: Simkl allows one write a second.</span></div>
      <div id="progress"></div>`;
    $('#send').onclick = () => go(p, entries);
  } catch (e) { fail(box, e); } finally { btn.disabled = false; } // every exit, including "nothing to send", re-enables Check
}

function row(c) {
  const name = title(c.media);
  const link = c.simkl ? `https://simkl.com/anime/${c.simkl}` : `anime.html?id=${c.media.id}`;
  return `<div class="sync-row">
    <a href="${esc(link)}"${c.simkl ? ' target="_blank" rel="noopener"' : ''}>${esc(name)}</a>
    <span>${c.from ? `${SIMKL_LABEL[c.from] || esc(c.from)} → ` : '<i class="new">new</i> '}${AL_LABEL[c.to]}</span>
    <span>${c.eps ? `+${c.eps} ep` : ''}${c.rating ? ` ★ ${c.rating}` : ''}</span>
  </div>`;
}

async function go(p, entries) {
  const btn = $('#send'), prog = $('#progress'), check = $('#check');
  btn.disabled = check.disabled = true;
  prog.innerHTML = '<div class="bar"><i style="width:0%"></i></div><p class="hint">Sending…</p>';
  try {
    const missing = await send(p, (i, n) => {
      prog.querySelector('i').style.width = `${(i / n) * 100}%`;
      prog.querySelector('p').textContent = `Sent ${i} of ${n}…`;
    });
    const names = entries.filter(e => missing.has(e.media.id)).map(e => title(e.media));
    prog.innerHTML = `<p class="done-note">Done. Simkl now has your AniList list.</p>
      ${names.length ? `<p class="hint">Simkl couldn't find ${names.length} title${names.length === 1 ? '' : 's'} in its catalog, so ${names.length === 1 ? 'it was' : 'they were'} skipped: ${names.slice(0, 20).map(esc).join(', ')}${names.length > 20 ? '…' : ''}</p>` : ''}
      <p><a href="https://simkl.com/" target="_blank" rel="noopener">Open Simkl</a></p>`;
    btn.remove();
  } catch (e) {
    prog.innerHTML = `<p class="hint">${esc(e.message)} Press "Check what would change" again to pick up where it stopped.</p>`;
  }
  check.disabled = false;
}

try { boot(); } catch (e) { fail(page, e); }
