import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex } from '../src/engine/index-parser.js';
import { runChecks } from '../src/engine/checks.js';
import { toCSV, toMarkdown, sheetsToCSV, slug } from '../src/engine/report.js';

const MESSY = `Sheet Number,Sheet Name,Revision,Date
A-101,Ground Floor Plan,B,2026-08-14
A-101,Ground Floor Plan (old),A,2026-07-01
A-104,,B,2026-08-20`;

const index = parseIndex(MESSY);
const result = runChecks(index, { convention: '@+-###', requiredSheets: ['A-101', 'A-999'] });
const META = { project: 'Plot 12, Nguyen Trai', issue: 'Planning', date: '2026-09-11', source: 'revit-sheet-list.csv' };

test('the CSV opens with the project stamp', () => {
  const csv = toCSV(result, META);
  assert.match(csv, /^Project,"Plot 12, Nguyen Trai"$/m);
  assert.match(csv, /^Issue,Planning$/m);
  assert.match(csv, /^Source,revit-sheet-list\.csv$/m);
  assert.match(csv, /^Checked,2026-09-11$/m);
});

test('the CSV carries the counts and the verdict', () => {
  const csv = toCSV(result, META);
  assert.match(csv, /^Sheets read,3$/m);
  assert.match(csv, new RegExp(`^To fix,${result.summary.error}$`, 'm'));
  assert.match(csv, new RegExp(`^To look at,${result.summary.warning}$`, 'm'));
  assert.ok(csv.includes(result.summary.verdict.replace(/"/g, '""')));
});

test('the CSV has one row per finding with its sheets', () => {
  const csv = toCSV(result, META);
  const lines = csv.split('\n');
  const headerAt = lines.findIndex((l) => l.startsWith('Severity,Category,'));
  assert.ok(headerAt > 0);
  const body = lines.slice(headerAt + 1).filter((l) => /^(Fix|Look at|Note),/.test(l));
  assert.equal(body.length, result.findings.length);
  assert.ok(csv.includes('numbering-duplicate'));
});

test('the CSV severity labels are the words a reader acts on', () => {
  const csv = toCSV(result, META);
  assert.match(csv, /^Fix,/m);
  assert.match(csv, /^Look at,/m);
});

test('the CSV lists what was checked and what was not', () => {
  const csv = toCSV(result, META);
  assert.match(csv, /^Checks run$/m);
  assert.match(csv, /^Not checked$/m);
  for (const s of result.skipped) assert.ok(csv.includes(s.replace(/"/g, '""')), s);
});

test('the CSV quotes any cell containing a comma or a quote', () => {
  const csv = toCSV(result, { project: 'A, B "C"' });
  assert.match(csv, /^Project,"A, B ""C"""$/m);
});

test('a clean result still produces a complete CSV', () => {
  const clean = runChecks(parseIndex('A-101,Plan\nA-102,Plan'), {});
  const csv = toCSV(clean, {});
  assert.match(csv, /Nothing flagged/);
  assert.match(csv, /^Not checked$/m);
  assert.match(csv, /^Checked,\d{4}-\d{2}-\d{2}$/m, 'the date defaults to today');
});

test('the Markdown leads with the verdict, not the findings', () => {
  const md = toMarkdown(result, META);
  const verdictAt = md.indexOf(result.summary.verdict);
  const firstFindingAt = md.indexOf('## To fix');
  assert.ok(verdictAt > 0 && verdictAt < firstFindingAt);
});

test('the Markdown groups findings by severity in the order they matter', () => {
  const md = toMarkdown(result, META);
  const fix = md.indexOf('## To fix');
  const look = md.indexOf('## To look at');
  assert.ok(fix > 0, 'there is a To fix section');
  assert.ok(look > fix, 'To look at comes after To fix');
});

test('the Markdown lists short sheet lists as bullets', () => {
  const md = toMarkdown(result, META);
  assert.match(md, /^- A-101$/m);
});

test('the Markdown runs a long sheet list inline rather than as 20 bullets', () => {
  // 20 sheets, 15 of them with no name: one finding naming 15 sheets.
  const rows = Array.from({ length: 20 }, (_, i) => {
    const number = `A-1${String(i + 1).padStart(2, '0')}`;
    return `${number},${i < 5 ? 'Plan' : ''}`;
  });
  const r = runChecks(parseIndex(['Sheet Number,Sheet Name', ...rows].join('\n')), {});
  const blank = r.findings.find((f) => f.category === 'blank-name');
  assert.equal(blank.sheets.length, 15, 'the fixture really does produce a long list');

  const md = toMarkdown(r, {});
  assert.ok(md.includes('A-120'), 'every sheet is still named');
  assert.ok(!/^- A-120$/m.test(md), 'but not as its own bullet');
  assert.ok(md.includes('A-106, A-107'), 'they run inline, comma separated');
});

test('the Markdown uses bullets when the list is short enough to scan', () => {
  const rows = Array.from({ length: 8 }, (_, i) => `A-10${i + 1},${i < 5 ? 'Plan' : ''}`);
  const r = runChecks(parseIndex(['Sheet Number,Sheet Name', ...rows].join('\n')), {});
  const md = toMarkdown(r, {});
  assert.match(md, /^- A-106$/m);
});

test('the Markdown always names what was not checked', () => {
  const md = toMarkdown(result, META);
  assert.match(md, /## What was not checked/);
  for (const s of result.skipped) assert.ok(md.includes(s), s);
});

test('the Markdown says plainly that a clean report is not an approval', () => {
  const clean = runChecks(parseIndex('A-101,Plan\nA-102,Plan'), {});
  const md = toMarkdown(clean, {});
  assert.match(md, /Nothing was flagged/);
  assert.match(md, /does not read the drawings/);
  assert.match(md, /not an approval/);
});

test('the Markdown handles an empty check without throwing', () => {
  const empty = runChecks(parseIndex(''), {});
  const md = toMarkdown(empty, {});
  assert.match(md, /No sheets were read/);
  assert.match(md, /nothing — no sheets were read/);
});

test('sheetsToCSV returns the register as the tool understood it', () => {
  const csv = sheetsToCSV(index);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Line,Number,Name,Revision,Date,Number read as');
  assert.equal(lines.length, 4, 'a header and three sheets');
  assert.ok(lines[1].startsWith('2,A-101,'));
});

test('sheetsToCSV says why a number was unreadable', () => {
  const csv = sheetsToCSV(parseIndex('A-101,Plan\nTBC,Plan'));
  assert.match(csv, /unreadable \(does not look like/);
});

test('sheetsToCSV only emits columns the index actually had', () => {
  const csv = sheetsToCSV(parseIndex('A-101\nA-102'));
  assert.equal(csv.trim().split('\n')[0], 'Line,Number,Number read as');
});

test('slug makes a safe filename stem', () => {
  assert.equal(slug('Plot 12, Nguyen Trai'), 'plot-12-nguyen-trai');
  assert.equal(slug(''), 'sheet-check');
  assert.equal(slug('   ---  '), 'sheet-check');
  assert.equal(slug('a'.repeat(90)).length, 60);
});

test('slug honours an empty fallback, so a caller can detect "no name given"', () => {
  assert.equal(slug('', ''), '');
  assert.equal(slug(null, ''), '');
  assert.equal(slug('Plot 12', ''), 'plot-12');
});
