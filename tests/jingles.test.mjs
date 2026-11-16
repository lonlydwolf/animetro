import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jinglesOn, setJingles, onJinglesChange, findThemes, JinglesOff, themeList, episodeRange, pickSource, withoutOgg, unplayable, songLine,
  isWebKit, lengthTrusted, clipEnd, SURE_END,
  quizPool, showKey, shuffle, quizOrder, quizChoices, pickOpening, clipStart, verdict, CLIP,
} from '../web/js/jingles.js';

// A cut-down AnimeThemes answer for Frieren (findAnimeByExternalSite), in its own shape: titles and artist names
// are objects, every video lists the audio file cut from it.
const video = (file, resolution, size, audio = `${file}-NC`) => ({
  link: `https://v.animethemes.moe/${file}.webm`, resolution, size,
  audio: { link: `https://a.animethemes.moe/${audio}.ogg`, mimetype: 'audio/ogg', size: 3_700_000 },
});
const FRIEREN = {
  slug: 'sousou_no_frieren', siteUrl: 'https://animethemes.moe/anime/sousou_no_frieren',
  animethemes: [
    { type: 'ED', sequence: 1, group: null, song: { title: { romaji: 'Anytime Anywhere', native: null }, performances: [{ as: null, alias: null, artist: { name: { main: 'milet' } } }] },
      animethemeentries: [
        { version: 1, episodes: '1-14, 16', videos: { nodes: [video('Frieren-ED1-NCBD1080', 1080, 59_000_000), video('Frieren-ED1', 720, 47_000_000)] } },
        { version: 2, episodes: '17-27', videos: { nodes: [video('Frieren-ED1v2', 720, 38_000_000)] } },
        { version: 3, episodes: '28', videos: { nodes: [] } }] },
    { type: 'OP', sequence: 2, group: null, song: { title: { romaji: 'Haru', native: 'ハル' }, performances: [{ as: null, alias: null, artist: { name: { main: 'Yorushika' } } }] },
      animethemeentries: [{ version: 1, episodes: '17-28', videos: { nodes: [video('Frieren-OP2', 720, 40_000_000)] } }] },
    { type: 'OP', sequence: 1, group: null, song: { title: { romaji: 'Yuusha', native: null }, performances: [{ as: null, alias: null, artist: { name: { main: 'YOASOBI' } } }] },
      animethemeentries: [{ version: 1, episodes: '1-16', videos: { nodes: [video('Frieren-OP1', 720, 41_000_000)] } }] },
    { type: 'ED', sequence: null, slug: 'ED1-TV', group: { name: 'TV Version' }, song: { title: { romaji: 'bliss', native: null }, performances: [] },
      animethemeentries: [{ version: 1, episodes: '1', videos: { nodes: [video('Frieren-ED1-TV', 720, 41_000_000)] } }] },
  ],
};

test('an AnimeThemes answer becomes a theme list: openings first, songs, artists, episodes and files', () => {
  const list = themeList(FRIEREN);
  assert.deepEqual(list.map(t => [t.label, t.group, t.song, t.artists, t.episodes]), [
    ['OP1', '', 'Yuusha', ['YOASOBI'], '1–16'],
    ['OP2', '', 'Haru', ['Yorushika'], '17–28'],
    ['ED1', '', 'Anytime Anywhere', ['milet'], '1–14, 16–28'],
    ['ED1', 'TV Version', 'bliss', [], '1'], // no sequence: numbered from its slug, after the numbered ones
  ]);
  const ed = list[2];
  assert.equal(ed.audio.link, 'https://a.animethemes.moe/Frieren-ED1-NCBD1080-NC.ogg', 'the first version with files plays');
  assert.deepEqual(ed.video, { link: 'https://v.animethemes.moe/Frieren-ED1.webm', resolution: 720, size: 47_000_000 }, 'smallest resolution');
  assert.equal(new Set(list.map(t => t.key)).size, list.length, 'keys are unique');
});

test('missing songs, artists and files leave gaps, not errors', () => {
  const list = themeList({ animethemes: [
    { type: 'OP', sequence: 1, song: null, animethemeentries: [] },
    { type: 'ED', sequence: 1, song: { title: { romaji: null, native: 'ねこ' }, performances: [{ alias: 'Neko Band', as: 'Tama', artist: { name: { main: 'Real Name' } } }, { artist: null }] },
      animethemeentries: [{ episodes: null, videos: { nodes: [{ link: 'https://v.animethemes.moe/x.webm', resolution: null, size: 9, audio: null }] } }] },
    { type: 'IN', sequence: 1, song: { title: {} }, animethemeentries: [{ videos: { nodes: [{ link: 'http://v.animethemes.moe/plain.webm', audio: { link: 'https://evil.example/a.ogg' } }] } }] },
    { type: 'ED', sequence: null, slug: null, song: null, animethemeentries: [] },
    { type: 'XX', sequence: 9 }, null,
  ] });
  assert.deepEqual(list.map(t => [t.label, t.song, t.artists, t.episodes, !!t.audio, !!t.video]), [
    ['OP1', '', [], '', false, false],
    ['ED1', 'ねこ', ['Neko Band (as Tama)'], '', false, true],
    ['ED', '', [], '', false, false], // no number anywhere
    ['IN1', '', [], '', false, false], // only AnimeThemes' own https file servers count
  ]);
  assert.deepEqual(themeList(null), []);
  assert.deepEqual(themeList({}), []);
  assert.equal(songLine(list[0]), 'Untitled');
  assert.equal(songLine(list[1]), '“ねこ” by Neko Band (as Tama)');
});

test('episode lists from every version merge into ranges; anything else is shown as written', () => {
  assert.equal(episodeRange(['1-14, 16', '17-27', '28']), '1–14, 16–28');
  assert.equal(episodeRange(['3']), '3');
  assert.equal(episodeRange(['1-12', 'OVA']), '1-12, OVA');
  assert.equal(episodeRange(['5-2']), '5-2');
  assert.equal(episodeRange([null, '', undefined]), '');
});

test('Ogg plays where the browser can; elsewhere the smallest WebM video is the fallback', () => {
  const [op1] = themeList(FRIEREN);
  const all = () => 'probably';
  const noOgg = t => (t.startsWith('audio/ogg') ? '' : 'maybe');
  assert.deepEqual(pickSource(op1, all), { src: 'https://a.animethemes.moe/Frieren-OP1-NC.ogg', kind: 'ogg', size: 3_700_000 });
  assert.deepEqual(pickSource(op1, noOgg), { src: 'https://v.animethemes.moe/Frieren-OP1.webm', kind: 'webm', size: 41_000_000 });
  assert.equal(pickSource(op1, () => ''), null, 'nothing playable');
  assert.equal(pickSource({ audio: null, video: null }, all), null);
  assert.equal(pickSource({ ...op1, audio: null }, all).kind, 'webm', 'no audio file: the video');
  // an Ogg that fails to play after all: the same question with Ogg ruled out
  assert.equal(pickSource(op1, withoutOgg(all)).kind, 'webm');
  // only an error that says the file can't be played here calls for the fallback; a failed download doesn't
  assert.deepEqual([1, 2, 3, 4].map(code => unplayable({ code })), [false, false, true, true]);
  assert.equal(unplayable(null), false);
  // it asks for Ogg Opus specifically (what AnimeThemes serves), not just any Ogg
  const asked = [];
  pickSource(op1, t => (asked.push(t), ''));
  assert.equal(asked[0], 'audio/ogg; codecs="opus"');
});

test('with Opening jingles off nothing is sent to AnimeThemes', async () => {
  let calls = 0;
  const spy = async () => { calls++; return new Response('{}'); };
  setJingles(false);
  assert.equal(jinglesOn(), false, 'off by default');
  assert.equal(localStorage.getItem('animetro.jingles'), null, 'nothing stored while off');
  await assert.rejects(findThemes(154587, { fetch: spy }), JinglesOff);
  await assert.rejects(findThemes(154587, { fetch: spy, on: false }), JinglesOff);
  assert.equal(calls, 0);
  setJingles(true);
  assert.equal(localStorage.getItem('animetro.jingles'), '1');
  setJingles(false);
  assert.equal(localStorage.getItem('animetro.jingles'), null);
});

test('switching it in another tab reaches open pages, so they can stop', () => {
  const heard = [];
  const stop = onJinglesChange(on => heard.push(on));
  const fromTab = (key, storageArea = localStorage) => dispatchEvent(Object.assign(new Event('storage'), { key, storageArea }));
  setJingles(true); // as the other tab writes it; the browser then tells every other tab
  fromTab('animetro.jingles');
  setJingles(false);
  fromTab('animetro.jingles');
  fromTab('animetro.mode'); // other settings don't count
  fromTab('animetro.jingles', sessionStorage); // nor this tab's own session storage
  location.reload = () => {}; // api.js reloads a page whose storage was cleared; there's no page to reload here
  fromTab(null); // all of the site's storage cleared: off
  delete location.reload;
  assert.deepEqual(heard, [true, false, false]);
  stop();
  fromTab('animetro.jingles');
  assert.equal(heard.length, 3, 'stops listening');
});

test('with it on, one lookup per show, by AniList ID, without cookies; a miss is null', async () => {
  const sent = [];
  const fake = answer => async (url, opts) => {
    sent.push({ url, opts, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ data: { findAnimeByExternalSite: answer } }), { status: 200 });
  };
  const hit = await findThemes(154587, { on: true, fetch: fake([FRIEREN]) });
  assert.equal(hit.siteUrl, FRIEREN.siteUrl);
  assert.equal(hit.themes.length, 4);
  assert.equal(sent[0].url, 'https://graphql.animethemes.moe/');
  assert.equal(sent[0].opts.credentials, 'omit');
  assert.deepEqual(sent[0].body.variables, { id: [154587] });
  assert.match(sent[0].body.query, /findAnimeByExternalSite\(site: ANILIST/);
  await findThemes(154587, { on: true, fetch: fake([]) });
  assert.equal(sent.length, 1, 'asked once per page');
  // openings only, for the quiz: its own question
  await findThemes(154587, { on: true, type: 'OP', fetch: fake([FRIEREN]) });
  assert.match(sent[1].body.query, /animethemes\(type: OP\)/);
  assert.equal(await findThemes(424242, { on: true, fetch: fake([]) }), null, 'not on AnimeThemes');
  assert.equal(await findThemes(0, { on: true, fetch: fake([]) }), null, 'no id, no request');
  assert.equal(sent.length, 3);
});

test('network failures and refusals reject with a message, and a failed lookup is asked again', async () => {
  let n = 0;
  const down = async () => { n++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(findThemes(7, { on: true, fetch: down }), /Couldn't reach AnimeThemes/);
  await assert.rejects(findThemes(7, { on: true, fetch: down }), /Couldn't reach AnimeThemes/);
  assert.equal(n, 2);
  const broken = async () => new Response('oops', { status: 500 });
  await assert.rejects(findThemes(8, { on: true, fetch: broken }), /answered 500/);
  const refused = async () => { n++; return new Response('', { status: 429 }); };
  await assert.rejects(findThemes(9, { on: true, fetch: refused }), /short break/);
  const before = n;
  await assert.rejects(findThemes(10, { on: true, fetch: refused }), /short break/);
  assert.equal(n, before, 'after a refusal nothing is sent for a while');
});

// ---- the quiz ----
const media = (id, name, extra = {}) => ({ id, title: { english: name, romaji: name }, coverImage: { large: `https://s4.anilist.co/${id}.jpg`, color: '#123456' }, isAdult: false, ...extra });
const ENTRIES = [
  { status: 'COMPLETED', media: media(1, 'Frieren: Beyond Journey’s End') },
  { status: 'CURRENT', media: media(2, 'Attack on Titan') },
  { status: 'PLANNING', media: media(3, 'Monster') },
  { status: 'DROPPED', media: media(4, 'Mob Psycho 100') },
  { status: 'PAUSED', media: media(5, 'Attack on Titan Season 2') },
  { status: 'REPEATING', media: media(6, 'Cowboy Bebop') },
  { status: 'COMPLETED', media: media(7, 'Night Shift', { isAdult: true }) },
  { status: 'COMPLETED', media: media(8, 'The Apothecary Diaries') },
  { status: 'COMPLETED', media: media(9, 'Spy x Family') },
  { status: 'COMPLETED', media: media(1, 'Frieren: Beyond Journey’s End') },
];
// a seeded generator, so a "random" round is the same every run
const seeded = (seed = 1) => () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('the quiz pool: started or finished shows, no Planning, 18+ only when it is on', () => {
  assert.deepEqual(quizPool(ENTRIES).map(m => m.id), [1, 2, 4, 5, 6, 8, 9]);
  assert.deepEqual(quizPool(ENTRIES, true).map(m => m.id), [1, 2, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(quizPool(ENTRIES)[0], { id: 1, name: 'Frieren: Beyond Journey’s End', cover: 'https://s4.anilist.co/1.jpg', color: '#123456', isAdult: false });
});

test('franchise keys keep seasons of one show together', () => {
  assert.equal(showKey('Attack on Titan Season 2'), showKey('Attack on Titan'));
  assert.equal(showKey('The Apothecary Diaries'), 'apothecary diaries');
  assert.equal(showKey('Pokémon'), 'pokemon');
  assert.notEqual(showKey('Mob Psycho 100'), showKey('Monster'));
});

test('shuffle and quiz order are random but reproducible with a seed, one show per franchise', () => {
  const pool = quizPool(ENTRIES);
  assert.deepEqual(shuffle(pool, seeded(3)), shuffle(pool, seeded(3)));
  assert.deepEqual(shuffle(pool, seeded(3)).map(m => m.id).sort(), pool.map(m => m.id).sort(), 'nothing lost');
  for (let s = 1; s < 30; s++) {
    const order = quizOrder(pool, seeded(s));
    assert.equal(order.length, 6, 'the two Attack on Titan seasons count once');
    assert.equal(order.filter(m => [2, 5].includes(m.id)).length, 1);
  }
});

test('quiz rounds: 4 distinct choices with the answer among them, never a sibling season', () => {
  const pool = quizPool(ENTRIES);
  for (let s = 1; s < 60; s++) {
    for (const answer of pool) {
      const c = quizChoices(answer, pool, seeded(s));
      assert.equal(c.length, 4);
      assert.equal(new Set(c.map(m => m.id)).size, 4, 'distinct shows');
      assert.equal(new Set(c.map(m => m.name)).size, 4, 'distinct names');
      assert.ok(c.some(m => m.id === answer.id), 'the answer is a choice');
      assert.equal(new Set(c.map(m => showKey(m.name))).size, 4, 'one per franchise');
    }
  }
  // where the answer lands depends on the randomness
  const spots = new Set(Array.from({ length: 40 }, (_, s) => quizChoices(pool[0], pool, seeded(s + 1)).findIndex(m => m.id === pool[0].id)));
  assert.ok(spots.size > 1);
  // a tiny pool still fills up with whatever is left
  const small = quizPool(ENTRIES.slice(0, 5));
  assert.equal(quizChoices(small[1], small, seeded(2)).length, 4);
});

test('the quiz plays a random opening that can play here, and a clip that fits', () => {
  const themes = themeList(FRIEREN);
  const ops = new Set(Array.from({ length: 30 }, (_, s) => pickOpening(themes, () => 'probably', seeded(s + 1)).label));
  assert.deepEqual([...ops].sort(), ['OP1', 'OP2']);
  assert.equal(pickOpening(themes.filter(t => t.type === 'ED'), () => 'probably'), null, 'endings are not openings');
  assert.equal(pickOpening(themes, () => ''), null, 'nothing playable');
  assert.equal(clipStart(89.5, () => 0.999999), 89 - CLIP);
  assert.equal(clipStart(240, () => 0.999999), 90 - CLIP - 1, 'stays in the TV-size part');
  assert.equal(clipStart(89.5, () => 0), 0);
  assert.equal(clipStart(NaN, () => 0.5), 0, 'length unknown');
  assert.equal(clipStart(12, () => 0.5), 0, 'shorter than a clip');
});

// User agents as each engine sends them (the Mac app's is WebKit's own, without a Safari version)
const UA = {
  macApp: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.5; rv:145.0) Gecko/20100101 Firefox/145.0',
};

test('an Ogg length is trusted except in WebKit (the Mac app, Safari, iOS browsers); a WebM length always is', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(UA).map(([k, ua]) => [k, isWebKit(ua)])),
    { macApp: true, safari: true, iosChrome: true, chrome: false, edge: false, firefox: false });
  for (const ua of [UA.macApp, UA.safari, UA.iosChrome]) {
    assert.equal(lengthTrusted('ogg', ua), false);
    assert.equal(lengthTrusted('webm', ua), true, 'the WebM fallback states its length');
  }
  for (const ua of [UA.chrome, UA.edge, UA.firefox]) assert.equal(lengthTrusted('ogg', ua), true);
  assert.equal(lengthTrusted('ogg'), true, 'no user agent: not WebKit');
});

test('unsure of the length, a clip stays within the first 30 seconds, so it fits any opening', () => {
  assert.equal(clipEnd(88, true), 88, 'trusted: anywhere in what has arrived');
  assert.equal(clipEnd(150, false), SURE_END);
  assert.equal(clipEnd(20, false), 20, 'never past what has arrived');
  for (let s = 1; s < 50; s++) {
    const start = clipStart(clipEnd(150, false), seeded(s));
    assert.ok(start >= 0 && start + CLIP <= SURE_END, `clip ${start}–${start + CLIP} ends by ${SURE_END}s`);
  }
});

test('the rank at the end of a round', () => {
  assert.equal(verdict(10, 10).name, 'Galaxy Express');
  assert.equal(verdict(8, 10).name, 'Shinkansen');
  assert.equal(verdict(5, 10).name, 'Rapid');
  assert.equal(verdict(0, 10).name, 'Platform Ticket');
  assert.equal(verdict(0, 0).name, 'Platform Ticket');
});
