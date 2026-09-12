import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitLine, detectDelimiter, detectColumns, looksLikeHeader, parseIndex, describeParse,
} from '../src/engine/index-parser.js';

/** A Revit sheet-list export, which is the most common real input. */
const REVIT_CSV = `"Sheet Number","Sheet Name","Current Revision","Current Revision Date"
"A-101","Ground Floor Plan","B","2026-08-14"
"A-102","First Floor Plan","B","2026-08-14"
"A-201","North and East Elevations","A","2026-07-30"
"A-301","Section A-A","B","2026-08-14"`;

const TAB_NO_HEADER = `A-101\tGround Floor Plan\t1:100
A-102\tFirst Floor Plan\t1:100
A-201\tElevations\t1:50`;

test('splitLine handles quoted fields containing the delimiter', () => {
  assert.deepEqual(
    splitLine('"A-101","Plan, ground floor","B"', ','),
    ['A-101', 'Plan, ground floor', 'B'],
  );
});

test('splitLine handles an escaped double quote', () => {
  assert.deepEqual(splitLine('"A-101","24"" riser detail"', ','), ['A-101', '24" riser detail']);
});

test('splitLine on whitespace needs two or more spaces, so titles stay whole', () => {
  assert.deepEqual(
    splitLine('A-101    Ground Floor Plan    1:100', null),
    ['A-101', 'Ground Floor Plan', '1:100'],
  );
});

test('splitLine keeps empty fields', () => {
  assert.deepEqual(splitLine('A-101,,B', ','), ['A-101', '', 'B']);
});

test('detects a comma, a tab and a semicolon', () => {
  assert.equal(detectDelimiter(REVIT_CSV), ',');
  assert.equal(detectDelimiter(TAB_NO_HEADER), '\t');
  assert.equal(detectDelimiter('A-101;Plan\nA-102;Plan'), ';');
});

test('falls back to whitespace for a plain list', () => {
  assert.equal(detectDelimiter('A-101\nA-102\nA-103'), null);
});

test('does not mistake a comma inside a title for a delimiter', () => {
  // Each line has a different field count if the comma is taken as the
  // delimiter, which is exactly the signal the detector looks for.
  const text = 'A-101   Plan, ground\nA-102   First floor\nA-103   Roof, plant and access';
  assert.equal(detectDelimiter(text), null);
});

test('recognises a heading row by its wording', () => {
  const rows = REVIT_CSV.split('\n').map((l) => splitLine(l, ','));
  assert.equal(looksLikeHeader(rows), true);
});

test('recognises the absence of a heading row', () => {
  const rows = TAB_NO_HEADER.split('\n').map((l) => splitLine(l, '\t'));
  assert.equal(looksLikeHeader(rows), false);
});

test('treats a first row with no sheet number as a heading even if unfamiliar', () => {
  const rows = [['Ref', 'Bezeichnung'], ['A-101', 'Grundriss'], ['A-102', 'Grundriss']];
  assert.equal(looksLikeHeader(rows), true);
});

test('reads the Revit export end to end', () => {
  const r = parseIndex(REVIT_CSV);
  assert.equal(r.delimiter, ',');
  assert.equal(r.hasHeader, true);
  assert.equal(r.sheets.length, 4);
  assert.deepEqual(r.sheets.map((s) => s.number), ['A-101', 'A-102', 'A-201', 'A-301']);
  assert.equal(r.sheets[0].name, 'Ground Floor Plan');
  assert.equal(r.sheets[0].revision, 'B');
  assert.equal(r.sheets[0].date, '2026-08-14');
  assert.deepEqual(r.warnings, []);
});

test('finds the columns by content when there is no heading row', () => {
  const r = parseIndex(TAB_NO_HEADER);
  assert.equal(r.hasHeader, false);
  assert.equal(r.sheets.length, 3);
  assert.equal(r.sheets[0].number, 'A-101');
  assert.equal(r.sheets[0].name, 'Ground Floor Plan');
  assert.equal(r.sheets[0].scale, '1:100');
});

test('finds the sheet-number column even when it is not first', () => {
  const text = 'Ground Floor Plan\tA-101\tB\nFirst Floor Plan\tA-102\tB';
  const r = parseIndex(text);
  assert.equal(r.sheets[0].number, 'A-101');
  assert.equal(r.sheets[0].name, 'Ground Floor Plan');
});

test('reads a bare list of numbers with no other columns', () => {
  const r = parseIndex('A-101\nA-102\nA-103');
  assert.equal(r.sheets.length, 3);
  assert.deepEqual(r.sheets.map((s) => s.number), ['A-101', 'A-102', 'A-103']);
  assert.deepEqual(r.sheets.map((s) => s.name), ['', '', '']);
  assert.deepEqual(r.warnings, []);
});

test('warns when no sheet-number column can be found', () => {
  const r = parseIndex('Widget\tThing\nGadget\tThing');
  assert.ok(r.warnings.some((w) => /sheet numbers/i.test(w)));
  assert.equal(r.columns.number, undefined);
});

test('warns on empty input instead of throwing', () => {
  for (const input of ['', '   \n  \n', null, undefined]) {
    const r = parseIndex(input);
    assert.equal(r.sheets.length, 0);
    assert.ok(r.warnings.length);
  }
});

test('skips blank lines and counts them', () => {
  const r = parseIndex('A-101,Plan\n\n\nA-102,Plan');
  assert.equal(r.sheets.length, 2);
});

test('records the source line number so a finding can point at the row', () => {
  const r = parseIndex(REVIT_CSV);
  assert.deepEqual(r.sheets.map((s) => s.line), [2, 3, 4, 5]);
  const noHeader = parseIndex(TAB_NO_HEADER);
  assert.deepEqual(noHeader.sheets.map((s) => s.line), [1, 2, 3]);
});

test('each row carries its parsed sheet number', () => {
  const r = parseIndex(REVIT_CSV);
  assert.equal(r.sheets[0].parsed.valid, true);
  assert.equal(r.sheets[0].parsed.series, '1');
  assert.equal(r.sheets[2].parsed.series, '2');
});

test('an unreadable number is kept as a row, not dropped', () => {
  const r = parseIndex('A-101,Plan\nTBC,Plan to follow\nA-102,Plan');
  assert.equal(r.sheets.length, 3);
  assert.equal(r.sheets[1].parsed.valid, false);
  assert.equal(r.sheets[1].number, 'TBC');
});

test('recognises scales and dates in their own columns', () => {
  const text = 'A-101\tPlan\t1:100\t2026-08-14\nA-102\tPlan\t1:50\t2026-08-14\nA-103\tPlan\tNTS\t2026-08-15';
  const r = parseIndex(text);
  assert.deepEqual(r.sheets.map((s) => s.scale), ['1:100', '1:50', 'NTS']);
  assert.deepEqual(r.sheets.map((s) => s.date), ['2026-08-14', '2026-08-14', '2026-08-15']);
});

test('explicit options override the detection', () => {
  const r = parseIndex('A-101|Plan|B', { delimiter: '|', hasHeader: false, columns: { number: 0, name: 1, revision: 2 } });
  assert.equal(r.sheets[0].number, 'A-101');
  assert.equal(r.sheets[0].revision, 'B');
});

test('describeParse reports what the parser decided', () => {
  const d = describeParse(parseIndex(REVIT_CSV));
  assert.equal(d.delimiter, 'comma');
  assert.equal(d.header, 'first row treated as headings');
  assert.equal(d.sheets, 4);
  assert.ok(d.recognised.includes('number'));
  assert.ok(d.recognised.includes('name'));
});

test('detectColumns does not assign one column two roles', () => {
  const rows = [['A-101', 'Ground Floor Plan', '1:100', 'B']];
  const columns = detectColumns(rows, false);
  const used = Object.values(columns);
  assert.equal(new Set(used).size, used.length, 'every role points at a different column');
});
