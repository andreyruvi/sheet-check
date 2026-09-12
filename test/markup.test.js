import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The page and the scripts have a contract. Nothing enforces it at load time —
 * a renamed attribute just makes a panel stop updating — so it is derived from
 * the source here and checked against index.html.
 */

const html = readFileSync('index.html', 'utf8');

function sourceFiles(dir = 'src') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const sources = sourceFiles().map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
const allSource = sources.map((s) => s.text).join('\n');

const attributeHooks = () => [...new Set(
  [...allSource.matchAll(/\[(data-[a-z-]+)(?:="([^"]+)")?\]/g)]
    .map((m) => (m[2] ? `${m[1]}="${m[2]}"` : m[1])),
)].sort();

const fieldNames = () => [...new Set([
  ...[...allSource.matchAll(/elements\.namedItem\('([A-Za-z]+)'\)/g)].map((m) => m[1]),
  ...[...allSource.matchAll(/\bvalue\('([A-Za-z]+)'\)/g)].map((m) => m[1]),
  ...[...allSource.matchAll(/\bfield\('([A-Za-z]+)'\)/g)].map((m) => m[1]),
])].sort();

function actionNames() {
  const block = allSource.match(/const actions = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'the actions table should be findable in main.js');
  // The brace matters: it distinguishes a method key from a call such as
  // `update();` sitting on its own line inside one of the handlers.
  return [...new Set(
    [...block[1].matchAll(/^\s*(?:async\s+)?'?([a-z-]+)'?\s*\(\)\s*\{/gm)].map((m) => m[1]),
  )].sort();
}

test('the source really declares hooks to check', () => {
  assert.ok(sources.length >= 7, `expected the full module set, found ${sources.length}`);
  assert.ok(attributeHooks().length >= 12);
  assert.ok(fieldNames().length >= 8);
  assert.ok(actionNames().length >= 9);
});

test('every data attribute the scripts query exists in the page', () => {
  const missing = attributeHooks().filter((hook) => !html.includes(hook));
  assert.deepEqual(missing, [], `index.html is missing: ${missing.join(', ')}`);
});

test('every form field the scripts read exists as a named control', () => {
  const missing = fieldNames().filter((name) => !new RegExp(`name="${name}"`).test(html));
  assert.deepEqual(missing, [], `index.html is missing controls named: ${missing.join(', ')}`);
});

test('every named control is read by the scripts', () => {
  const declared = [...new Set(
    [...html.matchAll(/<(?:input|textarea|select)[^>]*\bname="([A-Za-z]+)"/g)].map((m) => m[1]),
  )];
  const read = new Set([...fieldNames(), 'index']);
  const orphans = declared.filter((n) => !read.has(n));
  assert.deepEqual(orphans, [], `controls nothing reads: ${orphans.join(', ')}`);
});

test('every button action has a handler and every handler has a button', () => {
  const inPage = [...new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(inPage, actionNames());
});

test('every input and textarea has a label bound to its id', () => {
  const ids = [...html.matchAll(/<(?:input|textarea)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8, `expected the full control set, found ${ids.length}`);
  const unlabelled = ids.filter((id) => !html.includes(`for="${id}"`));
  assert.deepEqual(unlabelled, [], `controls with no label: ${unlabelled.join(', ')}`);
});

test('the convention field is wired to the presets datalist', () => {
  assert.match(html, /list="convention-presets"/);
  assert.match(html, /id="convention-presets"[^>]*data-convention-presets/);
});

test('the stylesheets and the entry script are linked', () => {
  assert.match(html, /href="styles\/sheet-check\.css"/);
  assert.match(html, /href="styles\/print\.css"[^>]*media="print"/);
  assert.match(html, /<script type="module" src="src\/main\.js">/);
});

test('the status region is announced politely', () => {
  assert.match(html, /data-status[^>]*role="status"/);
  assert.match(html, /data-status[^>]*aria-live="polite"/);
});

test('the page declares a language, a title and a description', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]{10,}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{40,}">/);
});

test('the page states plainly that a clean report is not an approval', () => {
  // Collapsed, because the wording wraps across lines in the markup.
  const prose = html.replace(/\s+/g, ' ');
  assert.match(prose, /not an approval/i);
  assert.match(prose, /does not read the drawings/i);
});

test('the stylesheet defines every severity colour the renderer relies on', () => {
  const css = readFileSync('styles/sheet-check.css', 'utf8');
  for (const token of ['--c-error', '--c-warning', '--c-note', '--c-clear']) {
    assert.ok(css.includes(`${token}:`), `${token} is used but never defined`);
    assert.ok(css.includes(`${token}-bg:`), `${token}-bg is used but never defined`);
  }
});

test('every severity has a dark-theme value as well as a light one', () => {
  const css = readFileSync('styles/sheet-check.css', 'utf8');
  const dark = css.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/);
  assert.ok(dark, 'there is a dark-theme block');
  for (const token of ['--c-error', '--c-warning', '--c-note', '--c-clear', '--c-ink', '--c-paper']) {
    assert.ok(dark[1].includes(`${token}:`), `${token} is not redefined for dark mode`);
  }
});

test('the print sheet marks severity with a symbol, not only a colour', () => {
  const print = readFileSync('styles/print.css', 'utf8');
  assert.match(print, /data-severity="error"\].*::after/s);
  assert.match(print, /content: ' ■'/);
  assert.ok(/data-valid="false"\].*::after/s.test(print), 'an unreadable number is marked too');
});

test('the print sheet hides the inputs and the buttons', () => {
  const print = readFileSync('styles/print.css', 'utf8');
  for (const selector of ['.inputs', '.export-row', '.status', '.drop']) {
    assert.ok(print.includes(selector), `${selector} should be handled by the print sheet`);
  }
});

test('the stylesheet has no syntax left over from editing', () => {
  const css = readFileSync('styles/sheet-check.css', 'utf8');
  // A stray at-rule nested inside a selector list is valid-looking and fatal.
  assert.ok(!/,\s*@media/.test(css), 'an @media cannot appear inside a selector list');
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'braces balance');
});
