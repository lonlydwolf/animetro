import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refresher, refreshes } from '../web/js/refresh.js';

const s = 1000; // ms

test('coming back refreshes only after being away longer than a minute', () => {
  const r = refresher();
  assert.equal(r.show(0), false, 'never hidden');
  r.hide(10 * s);
  assert.equal(r.show(60 * s), false, '50s away');
  r.hide(100 * s);
  r.hide(130 * s); // blur, then hidden: the earliest counts
  assert.equal(r.show(161 * s), true, '61s away');
  assert.equal(r.show(162 * s), false, 'focus and visibility both fire on return; only the first counts');
});

test('refreshes start at most once a minute', () => {
  const r = refresher();
  assert.equal(r.start(0), true, 'the first one starts right away');
  assert.equal(r.start(30 * s), false);
  assert.equal(r.start(60 * s), true);
  assert.equal(r.start(119 * s), false);
  assert.equal(r.start(120 * s), true);
});

test('a countdown reaching zero is due, and stops being due after a few tries', () => {
  const r = refresher({ retries: 2 });
  const ats = [100, 5000]; // airingAt, in seconds
  assert.equal(r.due(ats, 99 * s), false, 'nothing has aired yet');
  assert.equal(r.due(ats, 100 * s), true);
  assert.equal(r.start(100 * s, ats), true);
  assert.equal(r.due(ats, 130 * s), true, 'AniList still shows it: try again');
  assert.equal(r.start(130 * s, ats), false, 'but not within the minute');
  assert.equal(r.start(160 * s, ats), true);
  assert.equal(r.due(ats, 300 * s), false, 'gave up on that one');
  assert.equal(r.due(ats, 5000 * s), true, 'the next countdown still counts');
});

// A stand-in Home: loads resolve when the test says so, and it records what was shown.
function home() {
  const h = { shown: [], saves: 0, busy: false, editing: false, loads: [], clock: 0 };
  h.r = refreshes({
    load: () => new Promise(res => h.loads.push(res)),
    show: d => h.shown.push(d),
    saves: () => h.saves, busy: () => h.busy, editing: () => h.editing, now: () => h.clock,
  });
  h.answer = async d => { h.loads.shift()(d); await new Promise(r => setTimeout(r)); };
  return h;
}

test('data that arrives while you are typing waits until you are done, and the latest wins', async () => {
  const h = home();
  h.r.request(); // a refresh starts
  h.editing = true; // you click into the minutes field and type "60"
  await h.answer('A'); // the refresh lands mid-typing
  assert.deepEqual(h.shown, [], 'nothing redrawn under your typing');
  h.r.settle(); // a change event while still in the field
  assert.deepEqual(h.shown, [], 'still typing');
  h.editing = false;
  h.r.settle(); // you leave the field
  assert.deepEqual(h.shown, ['A']);
  h.r.settle();
  assert.deepEqual(h.shown, ['A'], 'shown once');
});

test('nothing starts while you are typing; it starts once you stop', async () => {
  const h = home();
  h.editing = true;
  h.r.request();
  assert.equal(h.loads.length, 0);
  h.editing = false;
  h.r.tick();
  assert.equal(h.loads.length, 1);
  await h.answer('A');
  assert.deepEqual(h.shown, ['A']);
});

test('held data a +1 has overtaken is dropped and asked for again', async () => {
  const h = home();
  h.r.request();
  h.editing = true;
  await h.answer('old');
  h.saves++; // a +1 saved while you were typing
  h.editing = false;
  h.r.settle();
  assert.deepEqual(h.shown, [], 'its data predates the save');
  h.clock = 60e3;
  h.r.tick();
  await h.answer('new');
  assert.deepEqual(h.shown, ['new']);
});

test('not while a +1 is saving; a refresh overtaken by one is retried', async () => {
  const h = home();
  h.busy = true;
  h.r.request();
  assert.equal(h.loads.length, 0, 'waits for the save');
  h.busy = false;
  h.r.tick();
  h.saves++; // a +1 starts while it loads
  await h.answer('stale');
  assert.deepEqual(h.shown, []);
  h.clock = 60e3;
  h.r.tick();
  await h.answer('fresh');
  assert.deepEqual(h.shown, ['fresh']);
});

test('one at a time, and a failed load keeps what is shown', async () => {
  const h = home();
  h.r.request();
  h.r.request();
  assert.equal(h.loads.length, 1);
  h.loads.shift()(Promise.reject(new Error('offline')));
  await new Promise(r => setTimeout(r));
  assert.deepEqual(h.shown, []);
});
