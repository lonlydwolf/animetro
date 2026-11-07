import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LIVERIES } from '../web/js/themes.js';

const web = new URL('../web/', import.meta.url);
const css = readFileSync(new URL('css/style.css', web), 'utf8');
const ids = LIVERIES.flatMap(([, list]) => list.map(l => l[0]));

// the colors one [data-theme] block sets
const palette = sel => {
  const body = css.match(new RegExp(`^${sel.replace(/[[\]"]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1];
  return body && Object.fromEntries([...body.matchAll(/--(\w+): (#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
};
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4));
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test('every livery has a dark and a light mode that stay readable', () => {
  for (const id of ids) for (const sel of [`[data-theme="${id}"]`, `[data-theme="${id}"][data-mode="light"]`]) {
    const p = palette(sel);
    assert.ok(p, `${sel} is missing from style.css`);
    assert.ok(contrast(p.ink, p.night) >= 4.5, `${sel}: text on the page`);
    assert.ok(contrast(p.dim, p.tunnel) >= 4.5, `${sel}: secondary text on cards`);
    assert.ok(contrast(p.night, p.platform) >= 4.5, `${sel}: button text`);
  }
});

test('every page applies the saved livery before it paints', () => {
  for (const page of readdirSync(web).filter(f => f.endsWith('.html'))) {
    assert.match(readFileSync(new URL(page, web), 'utf8'), /<head>[\s\S]*<script src="js\/boot.js"><\/script>[\s\S]*<\/head>/, page);
  }
});
