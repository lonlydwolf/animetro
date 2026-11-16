// Name that opening: a 15-second clip of an opening from a show on your list (started or finished, not Planning),
// four shows to pick from, then the reveal. Ten stops a round. Openings come from AnimeThemes (jingles.js), so the
// quiz needs Opening jingles on, and only the shows the round needs are looked up there; decoys never are.
import { gql, me, prefs } from './api.js';
import { header, $, esc, toast, fail, nsfw, safeUrl, safeColor } from './ui.js';
import { chime } from './chime.js';
import {
  jinglesOn, setJingles, onJinglesChange, findThemes, JinglesOff, pickSource, withoutOgg, unplayable, songLine,
  quizPool, quizOrder, quizChoices, pickOpening, clipStart, clipEnd, lengthTrusted, SURE_END, verdict, CLIP,
} from './jingles.js';

header();
const box = $('#quiz');
const STOPS = 10; // rounds in a game
const LOOKUPS = 30; // at most this many shows asked of AnimeThemes per game (it allows 90 requests a minute)
const AHEAD = 2; // rounds kept ready while you play
const LINES = ['ginza', 'marunouchi', 'tozai', 'chiyoda']; // a metro line color per answer button
const probe = document.createElement('audio');
const canPlay = t => probe.canPlayType(t);
const CUE_WAIT = 35_000; // a clip that isn't ready to play by then is skipped
let pool = [], user, game, played = new Set();

const hero = (body, sub = '') => `
  <div class="quiz-hero">
    <span class="quiz-roundel" aria-hidden="true">♪</span>
    <h1 id="quiz-h">Name that opening</h1>
    ${sub ? `<p class="hint quiz-sub">${sub}</p>` : ''}
  </div>${body}`;
const offNote = `Turning it on asks <a href="https://animethemes.moe" target="_blank" rel="noopener">AnimeThemes</a> (free, fan-run) for the openings of shows on your list and plays the music from its servers. While it's off, Animetro sends nothing to AnimeThemes.`;
const foot = () => `<p class="hint quiz-foot">Openings from <a href="https://animethemes.moe" target="_blank" rel="noopener">AnimeThemes</a>. <button class="spoiler-btn" data-quiz="off">Turn off opening jingles</button> · <a href="gacha.html">Gacha</a></p>`;

async function boot() {
  user = await me();
  if (!user) {
    box.innerHTML = hero(`<div class="quiz-card quiz-gate"><p>The quiz is built from your own AniList list: everything you've started or finished. Connect AniList on My pass first. A username is enough.</p>
      <p class="quiz-actions"><a class="btn" href="pass.html">Connect AniList</a></p></div>`, 'Ten openings from shows you’ve watched. Can you name them?');
    return;
  }
  if (!jinglesOn()) return gateOff();
  await loadPool();
  ready();
}

function gateOff() {
  stop();
  box.innerHTML = hero(`<div class="quiz-card quiz-gate"><h2>Opening jingles is off</h2><p class="hint">${offNote}</p>
    <p class="quiz-actions"><button class="btn" data-quiz="on">Turn on opening jingles</button></p></div>`, 'Ten openings from shows you’ve watched. Can you name them?');
}

async function loadPool() {
  if (pool.length) return;
  const d = await gql(`query($u:Int){ MediaListCollection(userId:$u,type:ANIME,status_not:PLANNING){ lists{ entries{ status media{ id isAdult title{english romaji} coverImage{large color} } } } } }`, { u: user.id });
  pool = quizPool(d.MediaListCollection.lists.flatMap(l => l.entries), prefs.adult());
}

function ready() {
  if (!jinglesOn()) return gateOff(); // switched off in another tab while the list loaded
  if (pool.length < 4) {
    box.innerHTML = hero(`<div class="quiz-card quiz-gate"><p>The quiz needs at least 4 shows you've started or finished on AniList${prefs.adult() ? '' : ' (not counting 18+ titles)'}, and ${esc(user.name)} has ${pool.length}. Ride a few more lines and come back.</p>
      <p class="quiz-actions"><a class="btn" href="gacha.html">Find something on the Gacha</a></p></div>`);
    return;
  }
  box.innerHTML = hero(`<div class="quiz-card quiz-start">
      <ol class="quiz-rules">
        <li><span><b>${STOPS} stops.</b> Each plays ${CLIP} seconds of an opening from a show on ${esc(user.name)}'s list.</span></li>
        <li><span><b>Four shows</b> to pick from. Number keys 1 to 4 work too.</span></li>
        <li><span><b>The reveal</b> shows the show and the song, and the song keeps playing while you look.</span></li>
      </ol>
      <p class="quiz-actions"><button class="btn quiz-go" data-quiz="start">Depart <span aria-hidden="true">→</span></button>
        <span class="hint">${pool.length.toLocaleString()} shows on the line</span></p>
    </div>${foot()}`, `Ten openings from ${esc(user.name)}'s watched list. Can you name them?`);
  $('[data-quiz="start"]').focus();
  newGame();
}

// ---- a game ---------------------------------------------------------------------
// The feed looks shows up a few at a time, in the shuffled order, and keeps AHEAD rounds ready. A show AnimeThemes
// doesn't have (or has no opening this browser can play) is skipped. Network errors skip the show too, but three in a
// row, or AnimeThemes asking for a break, end the game with that message.
function feeder(order) {
  let i = 0, inflight = 0, misses = 0, errors = 0, failed = null;
  const out = [], waiting = [], cued = []; // cued: every clip this feed started loading
  const done = () => failed || ((i >= order.length || i >= LOOKUPS) && !inflight);
  const flush = () => { while (waiting.length && (out.length || done())) waiting.shift()(out.shift() || null); };
  const pump = () => {
    while (!failed && inflight < 3 && out.length + inflight < AHEAD + waiting.length && i < order.length && i < LOOKUPS) {
      const show = order[i++];
      inflight++;
      findThemes(show.id, { type: 'OP' }).then(found => {
        if (failed) return; // stopped meanwhile: don't start loading audio for it
        if (!jinglesOn()) { failed ??= new JinglesOff(); return; } // switched off in another tab: load nothing
        errors = 0;
        const theme = found && pickOpening(found.themes, canPlay);
        if (theme) { const r = cue({ show, theme }); cued.push(r); out.push(r); } else misses++;
      }, e => {
        if (e instanceof JinglesOff || /break/.test(e.message) || ++errors >= 3) failed ??= e;
      }).finally(() => { inflight--; pump(); flush(); });
    }
    flush();
  };
  return {
    next: () => new Promise(r => { waiting.push(r); pump(); }), error: () => failed, misses: () => misses, prime: pump,
    // stop loading: what's queued, and a clip a round is still waiting on (the one playing is stopped by stop())
    drop: () => { failed ??= new Error('stopped'); out.length = 0; cued.splice(0).forEach(silence); },
  };
}

function newGame() {
  stop();
  // shows from the last games go to the back of the line
  const order = quizOrder(pool).sort((a, b) => played.has(a.id) - played.has(b.id));
  game = { feed: feeder(order), rounds: [], score: 0, streak: 0, best: 0 };
  game.feed.prime(); // the first clips load while you read the rules, so Depart starts straight away
}
function start() {
  if (!game || game.over || game.rounds.length) newGame(); // a finished game's feed is spent, even with no rounds
  next();
}

async function next() {
  const n = game.rounds.length;
  if (n >= STOPS) return finish();
  box.innerHTML = `${track()}<div class="quiz-card quiz-wait"><div class="train" aria-hidden="true"><i></i><i></i><i></i></div><p aria-live="polite">Next train arriving…</p></div>`;
  const g = game;
  const slow = setTimeout(() => { const p = $('.quiz-wait p'); if (p) p.textContent = 'Still loading… AnimeThemes is slow right now.'; }, 8_000);
  let r, missed = 0;
  // a clip that won't load or play is dropped and the next show takes its place; three in a row and the server is
  // too slow (or down) to keep a game going, so it ends with that rather than waiting on and on
  while ((r = await g.feed.next()) && !(await r.ready)) {
    silence(r);
    if (++missed >= 3) { g.feed.drop(); r = null; break; }
    g.feed.prime();
  }
  clearTimeout(slow);
  if (g !== game) return silence(r); // a new game started (or the quiz was switched off) meanwhile
  if (!r) return finish(missed >= 3 ? new Error("AnimeThemes' music server isn't sending clips fast enough right now. Try again in a while.") : g.feed.error());
  played.add(r.show.id);
  Object.assign(r, { choices: quizChoices(r.show, pool), pick: null });
  g.rounds.push(r);
  g.feed.prime(); // look the next ones up while this one plays
  drawRound(r);
  play(r);
}

// the round as a metro line: a station per stop, green or red once you've guessed, the current one blinking
const track = () => stops() + scoreLine();
const stops = () => {
  const rounds = game?.rounds || [];
  return `<ol class="quiz-track" aria-label="Stops">${Array.from({ length: STOPS }, (_, i) => {
    const r = rounds[i], state = !r ? '' : r.pick == null ? 'now' : r.pick === r.show.id ? 'right' : 'wrong';
    return `<li class="${state}"><span class="sr-only">Stop ${i + 1}${state === 'right' ? ': right' : state === 'wrong' ? ': wrong' : state === 'now' ? ': now' : ''}</span></li>`;
  }).join('')}</ol>`;
};
const scoreLine = () => {
  const rounds = game?.rounds || [];
  return `<p class="quiz-score"><span>Stop <b>${Math.min(rounds.length || 1, STOPS)}</b> of ${STOPS}</span><span>Score <b>${game?.score || 0}</b></span>${game?.streak > 1 ? `<span class="quiz-streak">${game.streak} in a row</span>` : ''}</p>`;
};

function drawRound(round) {
  const n = game.rounds.length;
  box.innerHTML = `${track()}
    <div class="quiz-card quiz-round">
      <div class="quiz-player">
        <button class="quiz-speaker" data-quiz="replay" style="--p:0" aria-label="Replay the clip">
          <span class="quiz-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          <span class="quiz-left" aria-hidden="true">${CLIP}</span>
        </button>
        <div class="quiz-q">
          <p class="quiz-kicker">Stop ${n} · ${esc(round.theme.label.replace(/^OP/, 'Opening '))}</p>
          <h2>Which show is this from?</h2>
          <p class="hint" id="quiz-status" aria-live="polite">Listen…</p>
        </div>
      </div>
      <div class="quiz-choices" role="group" aria-label="Your guess">${round.choices.map((m, i) => `
        <button class="quiz-choice" data-pick="${m.id}" style="--c:var(--${LINES[i]})"><kbd>${i + 1}</kbd><span>${esc(m.name)}</span></button>`).join('')}
      </div>
      <div id="quiz-reveal"></div>
    </div>`;
}

// ---- audio ------------------------------------------------------------------------
// Each round has its own <audio>, loaded and cued to its clip while the round before plays: seeking into an Ogg file
// over the network can take seconds, and a round should start the moment you press Next. Only the current one is in
// the page (#quiz-audio).
let clock = 0, round = null;
const audio = () => round?.audio;
function cue(r) {
  const a = (r.audio = document.createElement('audio'));
  a.preload = 'auto';
  r.src = pickSource(r.theme, canPlay);
  r.start = 0;
  r.ready = new Promise(resolve => {
    const timer = setTimeout(() => done(false), CUE_WAIT);
    const done = ok => { clearTimeout(timer); a.onloadedmetadata = a.onprogress = a.onsuspend = a.onseeked = a.oncanplay = null; resolve(ok); };
    // Ogg files have no seek index, so jumping ahead means probing the file over the network, a second or more a probe.
    // Instead the clip downloads from the start and the clip is cued inside what has arrived, which is instant.
    const arrived = () => (a.buffered.length && a.buffered.start(0) < 0.5 ? a.buffered.end(0) : 0);
    let cued = false;
    const cueAt = end => {
      if (cued) return;
      cued = true;
      r.start = clipStart(clipEnd(end, sure())); // unsure of the length: within the first SURE_END seconds
      if (r.start) a.currentTime = r.start; else if (a.readyState >= 3) done(true); else a.oncanplay = () => done(true);
    };
    // the whole opening (its first 90 seconds) has arrived, or the browser paused the download with more than a clip
    const enough = () => arrived() > CLIP + 1;
    const sure = () => lengthTrusted(r.src.kind, navigator.userAgent); // WebKit only estimates an Ogg file's length
    a.onprogress = () => (sure() ? Number.isFinite(a.duration) && arrived() >= Math.min(a.duration, 90) - 0.5 : arrived() >= SURE_END) && cueAt(arrived());
    a.onsuspend = () => enough() && cueAt(arrived());
    // a slow download: settle for a clip's worth after a few seconds, and for whatever has arrived a little later
    a.onloadedmetadata = () => {
      setTimeout(() => enough() && cueAt(arrived()), 4_000);
      setTimeout(() => cueAt(arrived()), 12_000);
    };
    a.onseeked = () => (a.readyState >= 3 ? done(true) : (a.oncanplay = () => done(true)));
    a.addEventListener('error', () => {
      if (!a.getAttribute('src')) return;
      // the Ogg can't be played here after all: the video's sound. A failed download just skips the show.
      const other = r.src.kind === 'ogg' && unplayable(a.error) && pickSource(r.theme, withoutOgg(canPlay));
      if (other && round !== r && jinglesOn()) { r.src = other; a.dataset.kind = other.kind; a.src = other.src; return; }
      if (round === r) toast(r.pick == null ? "The clip stopped loading. Take a guess, or try the next stop." : 'The song stopped playing. AnimeThemes may be busy.');
      done(false);
    });
  });
  a.dataset.kind = r.src.kind;
  a.src = r.src.src;
  for (const ev of ['playing', 'pause', 'ended', 'waiting']) a.addEventListener(ev, () => round === r && tick());
  a.addEventListener('playing', () => round === r && status(r.pick == null ? 'Listen… which show is it?' : ''));
  return r;
}
function silence(r) {
  const a = r?.audio;
  if (!a) return;
  a.pause();
  a.removeAttribute('src');
  a.load(); // stops the download too
  a.remove();
}
function play(r) {
  if (round && round !== r) silence(round);
  round = r;
  r.audio.id = 'quiz-audio';
  document.body.append(r.audio); // no controls, so it's invisible; the speaker is its control
  go();
}
function go() {
  if (!jinglesOn()) return gateOff(); // switched off in another tab: playing on would load more from AnimeThemes
  audio()?.play().catch(e => {
    if (e?.name === 'AbortError' || e?.name === 'NotSupportedError') return; // a newer clip, or the error event handles it
    status('Press the speaker to play the clip.');
  });
}
function replay() {
  const a = audio();
  if (!a) return;
  if (round.pick != null) { if (a.paused) go(); else a.pause(); return; }
  if (!a.paused) return a.pause();
  if (a.ended || a.currentTime - round.start >= CLIP - 0.1) a.currentTime = round.start;
  go();
}
const status = text => { const el = $('#quiz-status'); if (el) el.textContent = text; };
// the countdown ring and seconds left, smooth while it plays; the clip stops itself after CLIP seconds until you guess
function tick() {
  cancelAnimationFrame(clock);
  const speaker = $('.quiz-speaker'), a = audio();
  if (!a || !speaker) return;
  const heard = Math.max(0, a.currentTime - round.start);
  if (round.pick == null) {
    if (heard >= CLIP || a.ended) { // an opening shorter than its clip ends the clip with it
      a.pause();
      speaker.style.setProperty('--p', 1);
      $('.quiz-left').textContent = '↺';
      status('Clip over. Press the speaker to hear it again, or take a guess.');
      return;
    }
    speaker.style.setProperty('--p', Math.min(1, heard / CLIP));
    $('.quiz-left').textContent = Math.ceil(CLIP - heard);
  }
  speaker.classList.toggle('on', !a.paused);
  if (!a.paused) clock = requestAnimationFrame(tick);
}
function stop() {
  cancelAnimationFrame(clock);
  silence(round);
  round = null;
  game?.feed.drop();
  game = null;
}

// ---- guessing ------------------------------------------------------------------------
function guess(id) {
  const r = round;
  if (!r || r.pick != null) return;
  r.pick = id;
  const right = id === r.show.id;
  game.score += right;
  game.streak = right ? game.streak + 1 : 0;
  game.best = Math.max(game.best, game.streak);
  if (right) chime('tick'); // the departure chime, if Chimes are on (home page)
  document.querySelectorAll('.quiz-choice').forEach(b => {
    b.disabled = true;
    const it = +b.dataset.pick;
    b.classList.toggle('right', it === r.show.id);
    b.classList.toggle('wrong', it === id && !right);
    b.classList.toggle('dim', it !== r.show.id && it !== id);
  });
  $('.quiz-track').outerHTML = stops();
  $('.quiz-score').outerHTML = scoreLine();
  $('.quiz-round').classList.add(right ? 'got' : 'missed');
  const m = r.show, last = game.rounds.length >= STOPS;
  $('#quiz-reveal').innerHTML = `
    <div class="quiz-reveal" style="--c:${safeColor(m.color, 'var(--platform)')}">
      <a class="quiz-cover${nsfw(m)}" href="anime.html?id=${+m.id}"><img src="${safeUrl(m.cover) || ''}" alt=""></a>
      <div>
        <p class="quiz-verdict">${right ? (game.streak > 2 ? `Right! ${game.streak} in a row.` : 'Right!') : 'Not this time.'}</p>
        <h3><a href="anime.html?id=${+m.id}">${esc(m.name)}</a></h3>
        <p class="quiz-song"><span class="quiz-tag">${esc(r.theme.label)}</span> ${esc(songLine(r.theme))}</p>
        <p class="quiz-actions"><button class="btn" data-quiz="next">${last ? 'See your ticket' : 'Next stop'} <span aria-hidden="true">→</span></button>
          <button class="btn ghost" data-quiz="replay">Pause or play</button></p>
      </div>
    </div>`;
  $('[data-quiz="next"]').focus();
  status('');
  $('.quiz-left').textContent = right ? '✓' : '✗';
  $('.quiz-speaker').style.setProperty('--p', 1);
  $('.quiz-speaker').setAttribute('aria-label', 'Pause or play the song');
  if (audio()?.paused) go(); // the reveal plays the rest of the song
}

function finish(error) {
  const g = game;
  stop();
  game = g; // the ticket is drawn from it
  game.over = true;
  const total = game.rounds.length;
  if (!total) {
    box.innerHTML = hero(`<div class="quiz-card quiz-gate"><p>${error ? esc(error.message) : `AnimeThemes didn't have openings for the shows it was asked about (${game.feed.misses()} tried). Try again for a different set.`}</p>
      <p class="quiz-actions"><button class="btn" data-quiz="start">Try again</button></p></div>${foot()}`);
    return;
  }
  const v = verdict(game.score, total);
  if (game.score / total >= 0.6) chime('done');
  box.innerHTML = `${track()}
    <div class="quiz-card quiz-end">
      <div class="quiz-ticket">
        <small>Name that opening · ${esc(user.name)}</small>
        <b class="quiz-final">${game.score}<span>/${total}</span></b>
        <span class="quiz-rank">${esc(v.name)}</span>
        <p>${esc(v.line)}${game.best > 2 ? ` Best run: ${game.best} in a row.` : ''}</p>
        ${total < STOPS ? `<p class="hint">${error ? esc(error.message) : `Only ${total} of the shows AnimeThemes was asked about had openings, so this run was short.`}</p>` : ''}
      </div>
      <ol class="quiz-log">${game.rounds.map(r => `
        <li class="${r.pick === r.show.id ? 'right' : 'wrong'}">
          <a class="${nsfw(r.show).trim()}" href="anime.html?id=${+r.show.id}"><img src="${safeUrl(r.show.cover) || ''}" alt="" loading="lazy"></a>
          <div><b>${esc(r.show.name)}</b><small>${esc(r.theme.label)} · ${esc(songLine(r.theme))}</small></div>
          <span aria-label="${r.pick === r.show.id ? 'Right' : 'Wrong'}">${r.pick === r.show.id ? '✓' : '✗'}</span>
        </li>`).join('')}</ol>
      <p class="quiz-actions"><button class="btn" data-quiz="start">Play again</button><a class="btn ghost" href="gacha.html">Back to the Gacha</a></p>
    </div>${foot()}`;
  $('[data-quiz="start"]').focus();
}

// ---- controls ------------------------------------------------------------------------
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]');
  if (pick) return guess(+pick.dataset.pick);
  const b = e.target.closest('[data-quiz]');
  if (!b) return;
  const what = b.dataset.quiz;
  if (what === 'replay') replay();
  if (what === 'next') next();
  if (what === 'start') start();
  if (what === 'on') {
    setJingles(true);
    toast('Opening jingles on.');
    switchedOn();
  }
  if (what === 'off') {
    setJingles(false);
    toast('Opening jingles off. Nothing more is asked of AnimeThemes.');
    gateOff();
  }
});
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches?.('input, select, textarea')) return;
  const choice = document.querySelectorAll('.quiz-choice:not(:disabled)')[+e.key - 1];
  if (/^[1-4]$/.test(e.key) && choice) { e.preventDefault(); choice.click(); }
});

function switchedOn() {
  box.innerHTML = '<div class="loading"><div class="train" aria-hidden="true"><i></i><i></i><i></i></div><p>Loading your list…</p></div>';
  loadPool().then(ready, err => fail(box, err));
}
// Switched in another tab: off stops the clip and drops every queued one; on picks up from the "it's off" screen.
onJinglesChange(on => {
  if (!user) return; // not connected (or still loading): that screen says what's needed either way
  if (!on) gateOff();
  else if ($('[data-quiz="on"]')) switchedOn();
});

boot().catch(e => fail(box, e));
