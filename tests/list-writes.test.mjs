// Every change to your AniList list that a page builds from what it shows goes through plan.js's saveChecked(),
// which checks it against AniList at the click (Audit N1 and its Line/anime/+1 cousins). This keeps a page from
// quietly going back to writing from a stale view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../web/js/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.js'));
const src = f => readFileSync(new URL(f, dir), 'utf8');

test('only plan.js uses saveEntries() (as the default save behind saveChecked)', () => {
  const users = files.filter(f => f !== 'api.js' && /\bsaveEntries\b/.test(src(f)));
  assert.deepEqual(users, ['plan.js']);
});

test('no page sends its own SaveMediaListEntry with a status or progress', () => {
  for (const f of files.filter(f => f !== 'api.js')) {
    for (const [m] of src(f).matchAll(/SaveMediaListEntry\([^)]*\)/g)) {
      assert.doesNotMatch(m, /\b(status|progress)\s*:/, `${f}: ${m}`);
    }
  }
});

test('the pages that change your list use saveChecked', () => {
  for (const f of ['line.js', 'anime.js', 'home.js', 'pass.js']) assert.match(src(f), /\bsaveChecked\b|\baddToPlanning\b/, f);
  assert.match(src('gacha.js'), /planBoard/);
});
