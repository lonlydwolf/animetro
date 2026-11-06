import { gql, me, title, CARD, listStatus, saveEntries, clientId, setClientId, loginUrl, useUsername, logout } from './api.js';
import { header, $, esc, card, minutes, toast, fail } from './ui.js';

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
  const user = await me();
  if (!user) return connect();
  const d = await gql(`query($u:Int){
    User(id:$u){ createdAt statistics{anime{ count episodesWatched minutesWatched meanScore genres(limit:6,sort:COUNT_DESC){ genre count } statuses{ status count } }} }
    current: Page(perPage:12){ mediaList(userId:$u,type:ANIME,status:CURRENT,sort:UPDATED_TIME_DESC){ progress media{ id episodes title{english romaji} coverImage{medium color} nextAiringEpisode{episode timeUntilAiring} } } }
    loved: Page(perPage:12){ mediaList(userId:$u,type:ANIME,status:COMPLETED,sort:SCORE_DESC){ score media{ id title{english romaji}
      recommendations(perPage:8,sort:RATING_DESC){ nodes{ rating mediaRecommendation{ ${CARD} } } } } } }
  }`, { u: user.id });

  const s = d.User.statistics.anime;
  const planned = s.statuses.find(x => x.status === 'PLANNING')?.count || 0;
  const genres = s.genres;
  const top = genres[0]?.genre;
  const [persona, blurb] = PERSONA[top] || ['The Commuter', 'Keep riding and your anime personality will show up here.'];
  const pc = PROFILE[user.options?.profileColor] || user.options?.profileColor || '#3db4f2';
  const totalG = genres.reduce((a, g) => a + g.count, 0) || 1;

  page.innerHTML = `
    <div class="pass-grid">
      <div class="ic" style="--pc:${esc(pc)}">
        <div class="ic-top"><span>Animetro pass</span><i class="ic-chip"></i></div>
        <div class="ic-who"><img src="${user.avatar.large}" alt=""><div><b>${esc(user.name)}</b>
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
          <a class="btn ghost" href="${user.siteUrl}" target="_blank" rel="noopener">Open AniList profile</a>
          <button class="btn ghost" id="logout">Disconnect</button>
        </p>
      </div>
    </div>

    <section>
      <div class="section-head"><h2>Tonight's ride</h2></div>
      <div class="tonight" id="tonight">
        <div><b>Can't pick from your Planning list?</b><p class="hint" style="margin:0">${planned ? `You have ${planned} shows waiting.` : 'Got a backlog?'} Let the machine choose one.</p></div>
        <button class="btn" id="pick">Pick one for me</button>
      </div>
    </section>

    ${d.current.mediaList.length ? `<section><div class="section-head"><h2>Currently riding</h2></div><div class="journeys" id="current"></div></section>` : ''}

    <section>
      <div class="section-head"><h2>Picked for you</h2></div>
      <p class="hint">Recommended by people who loved the same shows you rated highest. Anything already on your list is left out.</p>
      <div class="grid" id="foryou"><p class="empty">Finding picks…</p></div>
    </section>`;

  $('#logout').onclick = () => { logout(); location.reload(); };
  $('#pick').onclick = () => pick(user, planned);
  renderCurrent(user, d.current.mediaList);
  forYou(d.loved.mediaList).catch(e => fail($('#foryou'), e));
}

function renderCurrent(user, list) {
  const el = $('#current');
  if (!el) return;
  el.innerHTML = list.map(({ progress, media: m }) => {
    const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0);
    return `
      <div class="journey" style="--c:${m.coverImage.color || 'var(--platform)'}">
        <a href="line.html?id=${m.id}"><img src="${m.coverImage.medium}" alt=""></a>
        <div><a href="anime.html?id=${m.id}" style="text-decoration:none"><b>${esc(title(m))}</b></a>
          <div class="bar"><i style="width:${total ? Math.min(100, (progress / total) * 100) : 0}%"></i></div>
          <small>Episode <span data-progress>${progress}</span>${total ? ` of ${total}` : ''}</small></div>
        ${user.canWrite ? `<button class="tag add" data-plus="${m.id}" data-total="${total}">+1</button>` : ''}
      </div>`;
  }).join('');
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-plus]');
    if (!b) return;
    const span = b.closest('.journey').querySelector('[data-progress]');
    const progress = +span.textContent + 1, total = +b.dataset.total;
    try {
      await saveEntries([{ mediaId: +b.dataset.plus, progress, ...(total && progress >= total ? { status: 'COMPLETED' } : {}) }]);
      span.textContent = progress;
      b.closest('.journey').querySelector('.bar i').style.width = `${total ? Math.min(100, (progress / total) * 100) : 0}%`;
      toast(total && progress >= total ? 'Completed. End of the line!' : `Episode ${progress} logged`);
    } catch (err) { toast(err.message); }
  });
}

async function forYou(loved) {
  const pool = new Map();
  loved.forEach(({ score, media }, i) => {
    const weight = (score || 70 - i) / 10; // unscored lists still get a gentle preference for the top
    for (const n of media.recommendations.nodes) {
      const r = n.mediaRecommendation;
      if (!r || r.isAdult || n.rating <= 0) continue;
      const p = pool.get(r.id) || { media: r, score: 0, because: [] };
      p.score += weight * Math.log2(n.rating + 1);
      p.because.push(title(media));
      pool.set(r.id, p);
    }
  });
  const ranked = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 60);
  const list = await listStatus(ranked.map(p => p.media.id));
  const picks = ranked.filter(p => !list.has(p.media.id)).slice(0, 18);
  $('#foryou').innerHTML = picks.map(p => card(p.media).replace('</small>', `</small><span class="because">Because you liked ${esc(p.because[0])}${p.because.length > 1 ? ` and ${p.because.length - 1} more` : ''}</span>`)).join('')
    || '<p class="empty">Complete and score a few shows on AniList and picks will appear here.</p>';
}

async function pick(user, total) {
  $('#pick').disabled = true;
  try {
    // Random page of 50, then a random show from it. Works even when AniList hasn't counted the list yet.
    const d = await gql(`query($u:Int,$p:Int){ Page(page:$p,perPage:50){ mediaList(userId:$u,type:ANIME,status:PLANNING){ media{ ${CARD} } } } }`,
      { u: user.id, p: 1 + Math.floor(Math.random() * Math.max(1, Math.ceil(total / 50))) });
    const all = d.Page.mediaList;
    const m = all[Math.floor(Math.random() * all.length)]?.media;
    if (!m) throw new Error('Your Planning list is empty. Add a few shows first.');
    $('#tonight').innerHTML = `
      <img src="${m.coverImage.large}" alt="">
      <div><b>${esc(title(m))}</b><p class="hint" style="margin:0 0 12px">${[m.seasonYear, m.episodes && `${m.episodes} episodes`, m.averageScore && `${m.averageScore}%`].filter(Boolean).join(', ')}. ${m.genres.slice(0, 3).join(', ')}.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="line.html?id=${m.id}">See watch order</a><button class="btn ghost" id="pick">Pick again</button></div></div>`;
    $('#pick').onclick = () => pick(user, total);
  } catch (e) { toast(e.message); $('#pick').disabled = false; }
}

function connect() {
  const redirect = location.origin + location.pathname;
  page.innerHTML = `
    <section>
      <h1 style="font-size:clamp(2rem,5vw,3.4rem)">Get your pass</h1>
      <p class="hint" style="font-size:1rem;max-width:60ch">Connect AniList to see your progress on every watch-order line, get picks based on what you loved, and add shows to your lists from here.</p>
      <div class="connect">
        <div>
          <h3>Log in with AniList</h3>
          <p class="hint" style="margin:0">Lets Animetro update your lists. AniList needs a free client ID from you once:</p>
          <ol>
            <li>Open <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a> and choose Create new client.</li>
            <li>Name it anything. Set the redirect URL to <code>${esc(redirect)}</code></li>
            <li>Paste the client ID it gives you below.</li>
          </ol>
          <form id="oauth"><input name="client" inputmode="numeric" placeholder="Client ID" value="${esc(clientId())}" required><button class="btn">Log in with AniList</button></form>
        </div>
        <div>
          <h3>Just use a username</h3>
          <p class="hint" style="margin:0">No setup needed. Read only: you'll see your progress and picks, but can't change your lists. Your AniList list must be public.</p>
          <form id="uname"><input name="name" placeholder="AniList username" required><button class="btn ghost">Look up</button></form>
        </div>
      </div>
      <p class="hint" style="margin-top:24px">Only your login token or username is saved, in this browser. Everything else is fetched live from AniList.</p>
    </section>`;
  $('#oauth').onsubmit = e => { e.preventDefault(); setClientId(e.target.client.value); location.href = loginUrl(); };
  $('#uname').onsubmit = async e => {
    e.preventDefault();
    useUsername(e.target.name.value);
    const u = await me();
    if (!u) { logout(); return toast(`No AniList user called "${e.target.name.value}".`); }
    location.reload();
  };
}

boot().catch(e => fail(page, e));
