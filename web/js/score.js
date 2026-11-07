// Ride points, rider tiers and station stamps for My pass, plus the taste match used on For you.
// Pure functions over AniList's User.statistics.anime: no DOM, no network, so test/check.mjs can run them.

// Train service types, slowest to fastest. `at` = ride points needed.
export const TIERS = [
  { at: 0, name: 'Platform Ticket', jp: '入場券', c: '#9caeb7', about: 'Just through the gates. Every rider starts here.' },
  { at: 300, name: 'Local', jp: '各駅停車', c: '#00a650', about: 'Stopping at every station while you find your line.' },
  { at: 1500, name: 'Rapid', jp: '快速', c: '#00a7db', about: 'Skipping the small stops. You know what you like.' },
  { at: 4000, name: 'Express', jp: '急行', c: '#9b7cb6', about: 'A regular commuter with favourite lines.' },
  { at: 8000, name: 'Limited Express', jp: '特急', c: '#f39700', about: 'Reserved seats only. Serious hours on the rails.' },
  { at: 15000, name: 'Shinkansen', jp: '新幹線', c: '#e60012', about: 'Bullet train. Whole seasons fly past the window.' },
  { at: 30000, name: 'Maglev', jp: 'リニア', c: '#ffd23f', about: 'Floating above the tracks. Few riders get this far.' },
  { at: 60000, name: 'Galaxy Express', jp: '銀河鉄道', c: '#c063ff', about: 'Off the map and into the stars. A legend of the line.' },
];

const n = (arr, key, val) => arr?.find(x => x[key] === val)?.count || 0;
const done = s => n(s.statuses, 'status', 'COMPLETED') + n(s.statuses, 'status', 'REPEATING');
const genresTried = s => (s.genres || []).filter(g => g.count >= 3).length;
const DAY = 1440;

// Japanese stations have ink stamps for collectors. These are ours: [kanji, name, how to get it, how far you are, goal].
// `have` counts in the goal's units; yes/no stamps have a goal of 1.
const fmt = (s, f) => n(s.formats, 'format', f);
const genre = (s, g) => s.genres?.find(x => x.genre === g)?.count || 0;
const year = new Date().getFullYear();
export const STAMPS = [
  // milestones
  ['初', 'First ride', 'Complete your first title', done, 1],
  ['百', 'Century', 'Complete 100 titles', done, 100],
  ['極', 'Completionist', 'Complete 500 titles', done, 500],
  ['千', 'Thousand episodes', 'Watch 1,000 episodes', s => s.episodesWatched || 0, 1000],
  ['万', 'Ten thousand', 'Watch 10,000 episodes', s => s.episodesWatched || 0, 10000],
  ['週', 'Week pass', 'Spend 7 days watching', s => Math.floor((s.minutesWatched || 0) / DAY), 7],
  ['月', 'Month pass', 'Spend 30 days watching', s => Math.floor((s.minutesWatched || 0) / DAY), 30],
  ['年', 'Year pass', 'Spend a whole year watching', s => Math.floor((s.minutesWatched || 0) / DAY), 365],
  // kinds of ride
  ['映', 'Cinema car', 'Watch 25 movies', s => fmt(s, 'MOVIE'), 25],
  ['短', 'Short hop', 'Watch 20 TV shorts', s => fmt(s, 'TV_SHORT'), 20],
  ['特', 'Special service', 'Watch 25 OVAs and specials', s => fmt(s, 'OVA') + fmt(s, 'SPECIAL'), 25],
  ['網', 'Web line', 'Watch 25 web series (ONA)', s => fmt(s, 'ONA'), 25],
  ['歌', 'Music car', 'Watch 5 music videos', s => fmt(s, 'MUSIC'), 5],
  ['長', 'Long haul', 'Watch a show with 100+ episodes', s => n(s.lengths, 'length', '101+'), 1],
  // when it's from
  ['古', 'Time traveler', 'Watch something from before 1990', s => +(s.releaseYears || []).some(y => y.releaseYear < 1990), 1],
  ['黎', 'Dawn of anime', 'Watch something from before 1970', s => +(s.releaseYears || []).some(y => y.releaseYear < 1970), 1],
  ['代', 'Every decade', 'Watch anime from 5 different decades', s => new Set((s.releaseYears || []).map(y => Math.floor(y.releaseYear / 10))).size, 5],
  ['旬', 'Fresh off the line', `Watch 10 shows from ${year}`, s => n(s.releaseYears, 'releaseYear', year), 10],
  ['暦', 'Five-year rider', 'Start shows in 5 different years', s => (s.startYears || []).length, 5],
  // what it's about
  ['色', 'Genre hopper', 'Watch 3+ titles in 12 genres', genresTried, 12],
  ['全', 'All lines', 'Watch something in 18 genres', s => (s.genres || []).filter(g => g.count > 0).length, 18],
  ['恋', 'Hopeless romantic', 'Watch 50 romance titles', s => genre(s, 'Romance'), 50],
  ['謎', 'Detective', 'Watch 30 mystery titles', s => genre(s, 'Mystery'), 30],
  ['機', 'Mecha pilot', 'Watch 20 mecha titles', s => genre(s, 'Mecha'), 20],
  ['怖', 'Ghost train', 'Watch 20 horror titles', s => genre(s, 'Horror'), 20],
  ['球', 'Sports fan', 'Watch 20 sports titles', s => genre(s, 'Sports'), 20],
  ['外', 'International transfer', 'Watch anime from 3 countries', s => (s.countries || []).length, 3],
  ['華', 'Donghua line', 'Watch 10 anime from China', s => n(s.countries, 'country', 'CN'), 10],
  // who makes it
  ['常', 'Studio regular', 'Watch 20 titles from one studio', s => s.studios?.[0]?.count || 0, 20],
  ['声', 'Voice fan', 'Watch 30 titles with the same voice actor', s => s.voiceActors?.[0]?.count || 0, 30],
  ['匠', 'Familiar names', 'Watch 30 titles with the same staff member', s => s.staff?.[0]?.count || 0, 30],
  // how you ride
  ['評', 'Critic', 'Score 100 titles', s => (s.scores || []).reduce((a, x) => a + x.count, 0), 100],
  ['辛', 'Tough crowd', 'Mean score under 70 across 50+ titles', s => +(s.meanScore > 0 && s.meanScore < 70 && s.count >= 50), 1],
  ['甘', 'Easy to please', 'Mean score of 85+ across 50+ titles', s => +(s.meanScore >= 85 && s.count >= 50), 1],
  ['夢', 'Dreamer', 'Keep 100+ shows on Planning', s => n(s.statuses, 'status', 'PLANNING'), 100],
  ['休', 'Rest stop', 'Pause 10 shows', s => n(s.statuses, 'status', 'PAUSED'), 10],
  ['非', 'Emergency exit', 'Drop 20 shows', s => n(s.statuses, 'status', 'DROPPED'), 20],
];
export const STAMP_POINTS = 75;

export function ride(s) {
  const stamps = STAMPS.map(([k, name, how, have, need]) => { const h = have(s) || 0; return { k, name, how, have: Math.min(h, need), need, got: h >= need }; });
  const parts = [
    ['Time riding', Math.floor((s.minutesWatched || 0) / 20), '1 per 20 minutes'],
    ['Titles completed', done(s) * 20, '20 each'],
    ['Genres explored', genresTried(s) * 25, '25 per genre with 3+ titles'],
    ['Stamps', stamps.filter(x => x.got).length * STAMP_POINTS, `${STAMP_POINTS} each`],
  ];
  const points = parts.reduce((a, p) => a + p[1], 0);
  const i = TIERS.findLastIndex(t => points >= t.at);
  const tier = TIERS[i], next = TIERS[i + 1];
  return { points, parts, stamps, i, tier, next, pct: next ? (points - tier.at) / (next.at - tier.at) : 1 };
}

// ---- taste ---------------------------------------------------------------
// Who you are, from tags and genres in your stats: each weighted by how many you've watched (square-rooted,
// so "School" doesn't drown everything) and how you score them compared to your average.
const SKIP = new Set(['Cast-Main Cast', 'Demographic', 'Technical']);
const BLAND = new Set(['Heterosexual', 'Primarily Teen Cast', 'Primarily Adult Cast', 'Primarily Male Cast', 'Primarily Female Cast']); // on half of all anime, so they say nothing about taste
const counts = (name, category = '') => !SKIP.has(category) && !BLAND.has(name) && !category.startsWith('Sexual');
export function taste(s) {
  const mean = s.meanScore || 0;
  const weigh = (count, m) => Math.sqrt(count) * (mean && m ? Math.min(1.8, Math.max(0.4, 1 + (m - mean) / 10)) : 1);
  const norm = entries => {
    const top = Math.max(1e-9, ...entries.map(e => e[1]));
    return new Map(entries.map(([k, v]) => [k, v / top]).sort((a, b) => b[1] - a[1]));
  };
  const tags = (s.tags || []).filter(t => t.count >= 2 && counts(t.tag.name, t.tag.category));
  return {
    tags: norm(tags.map(t => [t.tag.name, weigh(t.count, t.meanScore)])),
    genres: norm((s.genres || []).map(g => [g.genre, weigh(g.count, g.meanScore)])),
  };
}

// 0-100 "match": how much of a show is your thing, plus a little bit of how good it is.
// Tag fit is the *share* of a show's tag strength that you like (+1 so a show with two tags can't ace it),
// so shows with piles of tags don't win just by having more of them.
export function match(m, t) {
  let raw = 0, mass = 0;
  const hits = [];
  for (const x of m.tags || []) {
    if (!counts(x.name, x.category)) continue;
    const r = x.rank / 100, w = (t.tags.get(x.name) || 0) * r;
    mass += r;
    raw += w;
    if (w) hits.push([x.name, w]);
  }
  const g = (m.genres || []).map(x => t.genres.get(x) || 0);
  const fit = 0.6 * (raw / (mass + 1)) + 0.4 * (g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0);
  return {
    // ponytail: 0.65 is where real candidates top out (checked on two lists); retune if matches all read 100%
    pct: Math.round(100 * (0.8 * Math.min(1, fit / 0.65) + 0.2 * (m.averageScore || 60) / 100)),
    why: hits.sort((a, b) => b[1] - a[1]).slice(0, 2).map(h => h[0]),
  };
}
