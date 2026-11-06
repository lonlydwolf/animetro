// Checks that the app hangs together: every page's scripts and styles exist, every module import
// resolves, and every link between pages points at a page that exists. Catches broken moves and renames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const pages = readdirSync(web).filter(f => f.endsWith('.html'));
const scripts = readdirSync(join(web, 'js')).filter(f => f.endsWith('.js'));
const read = f => readFileSync(join(web, f), 'utf8');

test('every page loads styles and scripts that exist', () => {
  for (const page of pages) {
    const html = read(page);
    const refs = [...html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg))"/g)].map(m => m[1]);
    assert.ok(refs.some(r => r.endsWith('.js')), `${page} loads a script`);
    for (const ref of refs) assert.ok(existsSync(join(web, ref)), `${page} -> ${ref}`);
  }
});

test('every module import resolves', () => {
  for (const file of scripts) {
    for (const [, spec] of read('js/' + file).matchAll(/from\s+'(\.[^']+)'/g)) {
      assert.ok(existsSync(join(web, 'js', spec)), `js/${file} imports ${spec}`);
    }
  }
});

test('every link between pages points at a page that exists', () => {
  const sources = [...pages.map(p => read(p)), ...scripts.map(f => read('js/' + f))];
  const linked = new Set(sources.flatMap(s => [...s.matchAll(/['"`(]([a-z]+\.html)/g)].map(m => m[1])));
  assert.ok(linked.size > 5);
  for (const page of linked) assert.ok(pages.includes(page), `link to missing page ${page}`);
});
