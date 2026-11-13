// Home's +1 keeps keyboard focus through a slow save that ends in a full redraw (web/js/focus.js).
// A stand-in DOM: a document with an <body>, a header outside the redrawn region, and a region whose controls are
// replaced by new ones on every redraw, the way Home's render() replaces #page.
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdFocus, refocus } from '../web/js/focus.js';

function dom() {
  const doc = new EventTarget();
  const el = (name, inRegion) => ({ name, inRegion, focus() { doc.activeElement = this; doc.dispatchEvent(new Event('focusin')); } });
  doc.body = el('body', false);
  doc.activeElement = doc.body;
  const header = el('header search', false);
  const region = {
    controls: {},
    redraw() { this.controls = Object.fromEntries(['+1 of show 1', 'title of show 1', 'title of show 2'].map(k => [k, el(k, true)])); },
    contains: x => !!x?.inRegion,
    querySelector(sel) { return this.controls[sel] || null; },
  };
  region.redraw();
  return { doc, header, region };
}
const keyOf = x => x.name; // the stand-in's selectors are control names
const mine = ['+1 of show 1', 'title of show 1'];
const wait = ms => new Promise(r => setTimeout(r, ms));

// Click +1, save for a while (doing `during` meanwhile), then redraw and restore focus, like home.js does.
async function save({ doc, region }, during = () => {}) {
  const button = region.controls['+1 of show 1'];
  button.focus();
  const hold = holdFocus(doc, region, button);
  doc.activeElement = doc.body; // disabling the focused button drops focus to <body>, with no focus event
  await wait(5);
  during();
  await wait(5);
  const to = hold.settle(keyOf, mine);
  region.redraw();
  refocus(region, to);
}

test('no interaction during the save: focus comes back to the new +1', async () => {
  const d = dom();
  await save(d);
  assert.equal(d.doc.activeElement, d.region.controls['+1 of show 1'], 'the redrawn +1, not the old one');
});

test('focus moved to the header during the save stays there', async () => {
  const d = dom();
  await save(d, () => d.header.focus());
  assert.equal(d.doc.activeElement, d.header);
});

test('focus moved to another control on Home during the save stays on that control', async () => {
  const d = dom();
  await save(d, () => d.region.controls['title of show 2'].focus());
  assert.equal(d.doc.activeElement, d.region.controls['title of show 2'], 'its redrawn equivalent');
});

test('a click on a blank spot during the save leaves focus on <body>', async () => {
  const d = dom();
  await save(d, () => d.doc.dispatchEvent(new Event('pointerdown')));
  assert.equal(d.doc.activeElement, d.doc.body);
});

test('a mouse click that never focused +1 leaves focus alone', async () => {
  const d = dom();
  const button = d.region.controls['+1 of show 1'];
  const hold = holdFocus(d.doc, d.region, button); // focus was on <body> the whole time
  await wait(5);
  d.region.redraw();
  refocus(d.region, hold.settle(keyOf, mine));
  assert.equal(d.doc.activeElement, d.doc.body);
});

test('the clicked +1 gone after the redraw: the nearest control on its card', async () => {
  const d = dom();
  const button = d.region.controls['+1 of show 1'];
  button.focus();
  const hold = holdFocus(d.doc, d.region, button);
  await wait(5);
  const to = hold.settle(keyOf, mine);
  d.region.redraw();
  delete d.region.controls['+1 of show 1']; // caught up: no more +1
  refocus(d.region, to);
  assert.equal(d.doc.activeElement, d.region.controls['title of show 1']);
});
