import { gql, me, UnknownUser, title, CARD, clientId, setClientId, loginUrl, useUsername, logout, builtInLogin, inApp, loginRejected, prefs } from './api.js';
import { header, $, esc, toast, cover, tint, safeUrl, nsfw, safeColor } from './ui.js';
import { ride, TIERS } from './score.js';
import { syncOn, simklConnected } from './simkl.js';
import { chime } from './chime.js';
import { passCard, showCard } from './share.js';
import { picker } from './themes.js';
import { lock } from './lock.js';
import { saveChecked, describeEntry, notSaved } from './plan.js';

header();
const page = $('#page');

const PROFILE = { blue: '#3db4f2', purple: '#c063ff', pink: '#fc9dd6', orange: '#ef881a', red: '#e13333', green: '#4cca51', gray: '#677b94' };
const GENRE_COLOR = {
  Action: 'ginza', Adventure: 'namboku', Comedy: 'yurakucho', Drama: 'marunouchi', Fantasy: 'hanzomon', Romance: 'marunouchi',
  'Slice of Life': 'tozai', 'Sci-Fi': 'tozai', Mystery: 'fukutoshin', Psychological: 'chiyoda', Sports: 'hibiya', Supernatural: 'hanzomon',
};
const PERSONA = {
  Action: ['The Express Rider', 'You want momentum. Every episode should end mid-punch, and filler is a delay on the line.'],
  Adventure: ['The Explorer', 'You ride to the end of the line just to see what is there. Maps, journeys, found families.'],
  Comedy: ['The Night-Bus Comedian', 'You judge a show by how often it makes you snort. Plot is optional, timing is not.'],
  Drama: ['The Window-Seat Crier', 'You stare out the window and feel everything. A good show leaves you a little wrecked.'],
  Fantasy: ['The Otherworld Commuter', 'Your daily commute goes through a magic portal. Swords, spells and world-building, please.'],
  Romance: ['The Platform Confessor', 'Missed trains, almost-confessions, two people under one umbrella. You live for the slow burn.'],
  'Slice of Life': ['The Local-Train Lounger', 'No rush. You take the stopping service and enjoy every quiet station along the way.'],
  'Sci-Fi': ['The Maglev Futurist', 'Mechs, space, time travel. You like your stories running on next-century rails.'],
  Mystery: ['The Detective in Car 4', 'Someone on this train is lying and you will figure out who before the final episode.'],
  Psychological: ['The Tunnel Philosopher', 'You like shows that go dark for a while and come out asking questions.'],
  Sports: ['The Rush-Hour Sprinter', 'Training arcs, rival schools, the last-second goal. You cry at tournament finals.'],
  Supernatural: ['The Ghost-Station Regular', 'Spirits, curses, yokai. Your favorite stops are not on the official map.'],
  Mecha: ['The Rolling-Stock Engineer', 'Giant robots are just trains with arms, and you know every part number.'],
  Horror: ['The Midnight Line Survivor', 'You take the last train on purpose and you never look at the empty carriage behind you.'],
  Thriller: ['The Emergency-Brake Puller', 'High stakes, ticking clocks, nobody is safe. You watch with your hand on the brake.'],
  Music: ['The Busker on Platform 2', 'Idols, bands, orchestras. You judge a show by its OP and stay for the concert episode.'],
  'Mahou Shoujo': ['The Magical Pass Holder', 'Transformation sequences are non-negotiable. And yes, you know how dark the genre gets.'],
};

async function boot() {
  let user;
  try { user = await me(); } catch (err) {
    if (!(err instanceof UnknownUser)) throw err; // offline / AniList down: stuck() below
    // the saved username is gone (renamed or deleted): forget it and offer a fresh start
    logout();
    toast(`${err.message} Connect again below.`);
    return connect();
  }
  if (!user) return connect();
  const d = await gql(`query($u:Int){
    User(id:$u){ createdAt statistics{anime{ count episodesWatched minutesWatched meanScore statuses{ status count }
      genres(limit:30,sort:COUNT_DESC){ genre count } formats{ format count } releaseYears(limit:200){ releaseYear count } lengths{ length count }
      countries{ country count } studios(limit:1,sort:COUNT_DESC){ count } voiceActors(limit:1,sort:COUNT_DESC){ count }
      staff(limit:1,sort:COUNT_DESC){ count } scores{ count } startYears{ startYear count } }} }
    current: Page(perPage:12){ mediaList(userId:$u,type:ANIME,status:CURRENT,sort:UPDATED_TIME_DESC){ progress media{ id episodes isAdult title{english romaji} coverImage{medium color} nextAiringEpisode{episode timeUntilAiring} } } }
  }`, { u: user.id });

  const s = d.User.statistics.anime;
  const planned = s.statuses.find(x => x.status === 'PLANNING')?.count || 0;
  const genres = s.genres.slice(0, 6);
  const rank = ride(s);
  const top = genres[0]?.genre;
  const [persona, blurb] = PERSONA[top] || ['The Commuter', 'Keep riding and your anime personality will show up here.'];
  const pc = safeColor(PROFILE[user.options?.profileColor] || user.options?.profileColor, '#3db4f2'); // custom colors are hex
  const totalG = genres.reduce((a, g) => a + g.count, 0) || 1;

  page.innerHTML = `
    <div class="pass-grid">
      <div class="ic${safeUrl(user.bannerImage) ? ' has-banner' : ''}" style="--pc:${pc}${safeUrl(user.bannerImage) ? `;--banner:url(${safeUrl(user.bannerImage)})` : ''}">
        <div class="ic-top"><span>Animetro pass</span><span class="ic-tier" style="--tc:${rank.tier.c}">${rank.tier.name}</span><i class="ic-chip"></i></div>
        <div class="ic-who"><img src="${safeUrl(user.avatar?.large)}" alt=""><div><b>${esc(user.name)}</b>
          <small>Rider since ${new Date(d.User.createdAt * 1000).getFullYear()}${user.canWrite ? '' : ', read only'}</small></div></div>
        <div class="ic-stats">
          <div><b>${s.count}</b>titles</div>
          <div><b>${s.episodesWatched.toLocaleString()}</b>episodes</div>
          <div><b>${(s.minutesWatched / 1440).toFixed(1)}</b>days riding</div>
          <div><b>${s.meanScore ? Math.round(s.meanScore) : '–'}</b>mean score</div>
        </div>
        <div class="ic-stripes">${genres.map(g => `<i style="--w:${g.count};--c:var(--${GENRE_COLOR[g.genre] || 'hibiya'})"></i>`).join('')}</div>
      </div>
      <div class="persona">
        ${top ? `<p class="hint" style="margin:0">Your anime personality</p><h2>${persona}</h2><p>${blurb}</p>
        <div class="genre-bars">${genres.map(g => `
          <div class="vibe"><span>${esc(g.genre)}</span><div class="bar" style="--c:var(--${GENRE_COLOR[g.genre] || 'hibiya'})"><i style="width:${(g.count / genres[0].count) * 100}%"></i></div><span>${Math.round((g.count / totalG) * 100)}%</span></div>`).join('')}</div>`
        : `<h2>${persona}</h2><p>${blurb} AniList hasn't calculated stats for this profile yet.</p>`}
        <p style="display:flex;gap:10px;flex-wrap:wrap;margin-top:24px">
          <a class="btn ghost" href="${safeUrl(user.siteUrl) || 'https://anilist.co'}" target="_blank" rel="noopener">Open AniList profile</a>
          <button class="btn ghost" id="card">Share my pass</button>
          <button class="btn ghost" id="logout">Disconnect</button>
        </p>
      </div>
    </div>

    ${rankHTML(rank)}

    <section>
      <div class="section-head"><h2>Tonight's ride</h2></div>
      <div class="tonight" id="tonight">
        <div><b>Can't pick from your Planning list?</b><p class="hint" style="margin:0">${planned ? `You have ${planned} shows waiting.` : 'Got a backlog?'} Let the machine choose one.</p></div>
        <button class="btn" id="pick">Pick one for me</button>
      </div>
    </section>

    ${d.current.mediaList.length ? `<section><div class="section-head"><h2>Currently riding</h2></div><div class="journeys" id="current"></div></section>` : ''}

    <section>
      <a class="tonight fy-link" href="foryou.html">
        <div><b>Picked for you</b><p class="hint" style="margin:0">Sequels you skipped, shows that match your taste, hidden gems, and your Planning list ranked by fit.</p></div>
        <span class="btn">Open For you</span>
      </a>
      <a class="tonight fy-link" href="sync.html" style="margin-top:12px">
        <div><b>Backup sync <span class="tag${syncOn() ? ' s-COMPLETED' : ''}" style="font:700 .72rem var(--body);vertical-align:middle">${syncOn() ? (simklConnected() ? 'On, Simkl connected' : 'On') : 'Off'}</span></b>
          <p class="hint" style="margin:0">Copy your AniList list to Simkl when you press a button, as a backup next to MAL-Sync. Off until you turn it on.</p></div>
        <span class="btn ghost">${syncOn() ? 'Open' : 'Set up'}</span>
      </a>
    </section>`;

  $('#logout').onclick = () => { logout(); location.reload(); };
  const INK = ['#f39700', '#e60012', '#00a7db', '#00a650', '#9b7cb6', '#00ada9', '#bb641d', '#d7c447'];
  $('#card').onclick = () => showCard(() => passCard({
    name: user.name, avatar: user.avatar.large, banner: safeUrl(user.bannerImage) ? user.bannerImage : null, color: pc, since: new Date(d.User.createdAt * 1000).getFullYear(),
    tier: rank.tier, points: rank.points, next: rank.next, pct: rank.pct, persona,
    stats: [[String(s.count), 'titles'], [s.episodesWatched.toLocaleString(), 'episodes'], [(s.minutesWatched / 1440).toFixed(1), 'days riding'], [s.meanScore ? String(Math.round(s.meanScore)) : '–', 'mean score']],
    stamps: [rank.stamps.filter(x => x.got).length, rank.stamps.length],
    stampList: rank.stamps.map((x, i) => ({ ...x, c: INK[i % INK.length] })),
  }), `${user.name}-animetro-pass.png`);
  $('#pick').onclick = () => pick(user, planned);
  renderCurrent(user, d.current.mediaList.filter(x => !x.media.isAdult || prefs.adult())); // 18+ hidden unless switched on
}

function rankHTML({ points, parts, stamps, i, tier, next, pct }) {
  const got = stamps.filter(x => x.got).length;
  const INK = ['ginza', 'marunouchi', 'tozai', 'chiyoda', 'hanzomon', 'namboku', 'fukutoshin', 'yurakucho'];
  return `
    <section class="rider" style="--tc:${tier.c}">
      <div class="section-head"><h2>Rider rank</h2><span class="hint" style="margin:0">${points.toLocaleString()} ride points</span></div>
      <div class="rank-card">
        <div class="rank-now"><small lang="ja">${tier.jp}</small><b>${tier.name}</b></div>
        <div class="rank-progress">
          <div class="bar big" role="progressbar" aria-valuenow="${Math.round(pct * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to next tier"><i style="width:${pct * 100}%"></i></div>
          <p>${next ? `<b>${(next.at - points).toLocaleString()}</b> points to <b class="tier-name" style="--tc:${next.c}">${next.name}</b> <span lang="ja">${next.jp}</span>` : 'Top of the line. There is no next stop, only stars.'}</p>
        </div>
      </div>
      <ol class="tier-line">${TIERS.map((t, j) => `
        <li class="${j < i ? 'passed' : j === i ? 'now' : ''}" style="--c:${t.c}" tabindex="0"><i></i><b>${t.name}</b><small>${t.at.toLocaleString()}</small>
          <span class="tip" role="tooltip">${t.about}<small>${j < i ? 'Passed' : j === i ? "You're here" : `${(t.at - points).toLocaleString()} points to go`}</small></span></li>`).join('')}</ol>
      <div class="points">${parts.map(([k, v, how]) => `<div><b>${v.toLocaleString()}</b><span>${k}</span><small>${how}</small></div>`).join('')}</div>
    </section>
    <section>
      <div class="section-head"><h2>Station stamps</h2><span class="hint" style="margin:0">${got} of ${stamps.length} collected</span></div>
      <div class="stamps">${stamps.map((x, j) => `
        <div class="stamp${x.got ? ' got' : ''}" style="--c:var(--${INK[j % INK.length]});--r:${((j * 37) % 24) - 12}deg"${x.got ? ' tabindex="0"' : ''}>
          <span class="ink" lang="ja" aria-hidden="true">${x.k}</span><b>${x.name}</b>
          ${x.got ? `<small>Collected</small><span class="tip" role="tooltip">${x.how}</span>`
            : `<small>${x.how}</small>${x.need > 1 ? `<span class="stamp-bar" title="${x.have.toLocaleString()} of ${x.need.toLocaleString()}"><i style="width:${(x.have / x.need) * 100}%"></i></span><small class="stamp-n">${x.have.toLocaleString()} / ${x.need.toLocaleString()}</small>` : ''}`}
        </div>`).join('')}</div>
    </section>`;
}

function renderCurrent(user, list) {
  const el = $('#current');
  if (!el) return;
  el.innerHTML = list.map(({ progress, media: m }) => {
    // total = episodes out so far (for the bar); only a known final count can complete the show
    const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0), final = m.episodes || 0;
    return `
      <div class="journey${nsfw(m)}" style="--c:${tint(m, 'var(--platform)')}">
        <a href="line.html?id=${m.id}"><img src="${cover(m, 'medium')}" alt=""></a>
        <div><a href="anime.html?id=${m.id}" style="text-decoration:none"><b>${esc(title(m))}</b></a>
          <div class="bar"><i style="width:${total ? Math.min(100, (progress / total) * 100) : 0}%"></i></div>
          <small>Episode <span data-progress>${progress}</span>${total ? ` of ${total}` : ''}</small></div>
        ${user.canWrite && (!total || progress < total) ? `<button class="tag add" data-plus="${m.id}" data-total="${total}" data-final="${final}">+1</button>` : ''}
      </div>`;
  }).join('');
  // What each card shows (these are your Watching entries). A +1 is saved only if AniList still has the entry like
  // that (saveChecked), and AniList's answer, saved or changed elsewhere, is what the card shows next.
  const shown = new Map(list.map(({ progress, media: m }) => [m.id, { status: 'CURRENT', progress }]));
  const once = lock(); // one save per show at a time
  const draw = (b, p, total) => {
    const journey = b.closest('.journey');
    journey.querySelector('[data-progress]').textContent = p;
    journey.querySelector('.bar i').style.width = `${total ? Math.min(100, (p / total) * 100) : 0}%`;
    if (total && p >= total) b.remove(); // caught up with what's out
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-plus]');
    if (!b) return;
    const id = +b.dataset.plus;
    once(id, async () => {
      b.disabled = true;
      const total = +b.dataset.total, final = +b.dataset.final, seen = shown.get(id);
      const progress = (seen.progress ?? 0) + 1, done = final > 0 && progress >= final;
      const r = await saveChecked([{ id, seen, change: { progress, ...(done ? { status: 'COMPLETED' } : {}) } }]);
      if (r.saved.has(id)) {
        const now = r.saved.get(id), p = now.progress ?? progress, finished = now.status === 'COMPLETED';
        shown.set(id, { status: now.status, progress: p });
        draw(b, p, total);
        chime(finished ? 'done' : 'tick');
        toast(finished ? 'Completed. End of the line!' : `Episode ${p} logged`);
      } else if (r.changed.has(id)) {
        // logged somewhere else meanwhile: show it as it is now, and log nothing
        const now = r.changed.get(id);
        if (now) { shown.set(id, now); draw(b, now.progress ?? 0, total); }
        if (!now || now.status !== 'CURRENT') b.remove(); // finished, paused or removed elsewhere: no +1 here
        toast(`Changed somewhere else: ${describeEntry(now)} now. Nothing was logged.`);
      } else toast(notSaved(r));
      b.disabled = false;
    });
  });
}

async function pick(user, total) {
  $('#pick').disabled = true;
  try {
    // Pages of 50 in random order, then a random show from the first page that has one we can show.
    // (A page can hold only 18+ titles while 18+ is off.) At most 8 pages, to stay inside AniList's rate limit.
    const pages = Array.from({ length: Math.max(1, Math.ceil(total / 50)) }, (_, i) => i + 1).sort(() => Math.random() - .5).slice(0, 8);
    let m, seen = 0;
    for (const p of pages) {
      const d = await gql(`query($u:Int,$p:Int){ Page(page:$p,perPage:50){ mediaList(userId:$u,type:ANIME,status:PLANNING){ media{ ${CARD} } } } }`, { u: user.id, p });
      seen += d.Page.mediaList.length;
      const ok = d.Page.mediaList.filter(x => !x.media.isAdult || prefs.adult());
      if (ok.length) { m = ok[Math.floor(Math.random() * ok.length)].media; break; }
    }
    if (!m) throw new Error(seen ? 'Everything left on your Planning list is 18+, which is hidden. Turn 18+ on to include it.' : 'Your Planning list is empty. Add a few shows first.');
    $('#tonight').className = `tonight${nsfw(m)}`;
    $('#tonight').innerHTML = `
      <img src="${cover(m)}" alt="">
      <div><b>${esc(title(m))}</b><p class="hint" style="margin:0 0 12px">${[m.seasonYear, m.episodes && `${m.episodes} episodes`, m.averageScore && `${m.averageScore}%`].filter(Boolean).join(', ')}. ${esc((m.genres || []).slice(0, 3).join(', '))}.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="line.html?id=${m.id}">See watch order</a><button class="btn ghost" id="pick">Pick again</button></div></div>`;
    $('#pick').onclick = () => pick(user, total);
  } catch (e) { toast(e.message); $('#pick').disabled = false; }
}

function connect() {
  // the Mac app catches animetro://auth itself; in a browser AniList comes back to this page
  const redirect = inApp ? 'animetro://auth' : location.origin + location.pathname;
  page.innerHTML = `
    <section>
      <h1 style="font-size:clamp(2rem,5vw,3.4rem)">Get your pass</h1>
      <p class="hint" style="font-size:1rem;max-width:60ch">Connect AniList to see your progress on every watch-order line, get picks based on what you loved, and add shows to your lists from here.</p>
      <div class="connect">
        ${builtInLogin() ? `<div>
          <h3>Log in with AniList</h3>
          <p class="hint" style="margin:0">AniList asks you to approve Animetro, then sends you straight back. Animetro can then update your lists. You can revoke it any time in your AniList settings under Apps.</p>
          <a class="btn" href="${esc(loginUrl())}" style="justify-self:start">Log in with AniList</a>
        </div>` : `<div>
          <h3>Log in with AniList</h3>
          <p class="hint" style="margin:0">Lets Animetro update your lists. On this address AniList needs a free client ID from you once:</p>
          <ol>
            <li>Open <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a> and choose Create new client.</li>
            <li>Name it anything. Set the redirect URL to <code>${esc(redirect)}</code></li>
            <li>Paste the client ID it gives you below.</li>
          </ol>
          <form id="oauth"><input name="client" inputmode="numeric" placeholder="Client ID" value="${esc(clientId())}" required><button class="btn">Log in with AniList</button></form>
        </div>`}
        <div>
          <h3>Just use a username</h3>
          <p class="hint" style="margin:0">No setup needed. Read only: you'll see your progress and picks, but can't change your lists. Your AniList list must be public.</p>
          <form id="uname"><input name="name" placeholder="AniList username" required><button class="btn ghost">Look up</button></form>
        </div>
      </div>
      <p class="hint" style="margin-top:24px">Only your login token or username is saved, in this browser. Everything else is fetched live from AniList.</p>
    </section>`;
  if ($('#oauth')) $('#oauth').onsubmit = e => { e.preventDefault(); setClientId(e.target.client.value); location.href = loginUrl(); };
  $('#uname').onsubmit = async e => {
    e.preventDefault();
    useUsername(e.target.name.value);
    let u;
    try { u = await me(); } catch (err) { logout(); return toast(err.message); }
    if (!u) { logout(); return toast(`No AniList user called "${e.target.name.value}".`); }
    location.reload();
  };
}

if (loginRejected) toast("Ignored a login link this app didn't start. Log in from this page instead.");
// The livery picker sits at the bottom of My pass, logged in or not.
function livery() {
  const el = document.createElement('section');
  el.id = 'livery';
  page.append(el);
  picker(el);
}
// My pass is where you fix your connection, so an error here never takes away the way out:
// Try again, or Disconnect and start over.
function stuck(err) {
  page.innerHTML = `<section class="fy-hero"><h1>My pass</h1>
    <p class="hint" style="font-size:1rem;max-width:60ch" role="alert">${esc(err.message || err)}</p>
    <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="retry">Try again</button><button class="btn ghost" id="logout">Disconnect</button></p></section>`;
  $('#retry').onclick = () => location.reload();
  $('#logout').onclick = () => { logout(); location.reload(); };
}
boot().catch(stuck).finally(livery);
