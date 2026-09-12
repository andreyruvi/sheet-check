import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetNumber, seriesKey, conventionToRegex, CONVENTION_PRESETS,
  analyseSequence, renderNumber, findOutOfOrder,
} from '../src/engine/numbering.js';

const parse = (list) => list.map(parseSheetNumber);

test('parses the common dash-and-three-digits form', () => {
  const p = parseSheetNumber('A-101');
  assert.equal(p.valid, true);
  assert.equal(p.discipline, 'A');
  assert.equal(p.series, '1');
  assert.equal(p.number, 1);
  assert.equal(p.suffix, null);
  assert.equal(p.normalised, 'A-101');
});

test('parses the same number without a separator', () => {
  const p = parseSheetNumber('A101');
  assert.equal(p.valid, true);
  assert.equal(p.discipline, 'A');
  assert.equal(p.series, '1');
  assert.equal(p.number, 1);
  assert.equal(p.normalised, 'A-101');
});

test('parses a dotted series and number', () => {
  const p = parseSheetNumber('A-1.01');
  assert.equal(p.series, '1');
  assert.equal(p.number, 1);
  assert.equal(p.body, '1.01');
  assert.equal(p.normalised, 'A-1.01');
});

test('parses a two-letter discipline and an inserted-sheet suffix', () => {
  const p = parseSheetNumber('AD-101a');
  assert.equal(p.discipline, 'AD');
  assert.equal(p.suffix, 'A');
  assert.equal(p.number, 1);
  assert.equal(p.normalised, 'AD-101A');
});

test('a short number has no series at all', () => {
  const p = parseSheetNumber('S-7');
  assert.equal(p.series, null);
  assert.equal(p.number, 7);
  assert.equal(seriesKey(p), 'S');
});

test('tolerates surrounding whitespace, lower case and underscores', () => {
  assert.equal(parseSheetNumber('  m-301 ').normalised, 'M-301');
  assert.equal(parseSheetNumber('e_401').normalised, 'E-401');
  assert.equal(parseSheetNumber('p.501').normalised, 'P-501');
});

test('reports an unreadable number rather than guessing', () => {
  for (const bad of ['', '   ', '101', 'SHEET ONE', 'A--101', '12A34']) {
    const p = parseSheetNumber(bad);
    assert.equal(p.valid, false, `${JSON.stringify(bad)} should not parse`);
    assert.equal(p.normalised, null);
    assert.ok(p.reason, 'a reason is given');
  }
});

test('an unreadable number keeps its raw text exactly', () => {
  const p = parseSheetNumber('  Sheet 1 (old)  ');
  assert.equal(p.valid, false);
  assert.equal(p.raw, '  Sheet 1 (old)  ', 'the register entry is preserved verbatim');
});

test('seriesKey groups by discipline and series', () => {
  assert.equal(seriesKey(parseSheetNumber('A-101')), 'A-1');
  assert.equal(seriesKey(parseSheetNumber('A-201')), 'A-2');
  assert.equal(seriesKey(parseSheetNumber('S-101')), 'S-1');
  assert.equal(seriesKey(parseSheetNumber('nonsense')), null);
});

test('the convention template matches what it says it matches', () => {
  const re = conventionToRegex('@+-###');
  assert.ok(re.test('A-101'));
  assert.ok(re.test('AD-101'));
  assert.ok(!re.test('A-101a'));
  assert.ok(!re.test('A101'));
  assert.ok(!re.test('A-10'));
});

test('the template supports optional tokens', () => {
  const re = conventionToRegex('@+-###@?');
  assert.ok(re.test('A-101'));
  assert.ok(re.test('A-101a'));
  assert.ok(!re.test('A-101ab'));
});

test('a single # is exactly one digit', () => {
  const re = conventionToRegex('@-#.##');
  assert.ok(re.test('A-1.01'));
  assert.ok(!re.test('A-11.01'));
  assert.ok(!re.test('A-1.1'));
});

test('literal characters in a template are escaped', () => {
  const re = conventionToRegex('@+.###');
  assert.ok(re.test('A.101'));
  assert.ok(!re.test('AX101'), 'the dot is a literal dot, not "any character"');
});

test('a custom regex passes straight through', () => {
  const re = conventionToRegex('custom:[A-Z]{1,2}-\\d{3}(?:\\.\\d)?');
  assert.ok(re.test('A-101'));
  assert.ok(re.test('A-101.1'));
  assert.ok(!re.test('A-1'));
});

test('a broken custom regex returns null instead of throwing', () => {
  assert.equal(conventionToRegex('custom:[unclosed'), null);
  assert.equal(conventionToRegex(''), null);
  assert.equal(conventionToRegex(null), null);
});

test('every preset matches its own example', () => {
  for (const preset of CONVENTION_PRESETS) {
    const re = conventionToRegex(preset.template);
    assert.ok(re, `${preset.template} compiles`);
    assert.ok(re.test(preset.label), `${preset.template} should match ${preset.label}`);
  }
});

test('finds a gap in the middle of a series', () => {
  const [group] = analyseSequence(parse(['A-101', 'A-102', 'A-104']));
  assert.equal(group.key, 'A-1');
  assert.deepEqual(group.gaps, [3]);
  assert.deepEqual(group.missingLabels, ['A-103']);
});

test('does not invent a gap before the first sheet of a series', () => {
  const [group] = analyseSequence(parse(['A-110', 'A-111']));
  assert.deepEqual(group.gaps, [], 'a series may legitimately start at 110');
  assert.equal(group.lowest, 10);
  assert.equal(group.highest, 11);
});

test('finds several gaps and renders each in the office numbering', () => {
  const [group] = analyseSequence(parse(['A-101', 'A-105']));
  assert.deepEqual(group.missingLabels, ['A-102', 'A-103', 'A-104']);
});

test('separates the series so plans and elevations do not interfere', () => {
  const groups = analyseSequence(parse(['A-101', 'A-102', 'A-201', 'A-203']));
  assert.deepEqual(groups.map((g) => g.key), ['A-1', 'A-2']);
  assert.deepEqual(groups[0].gaps, []);
  assert.deepEqual(groups[1].missingLabels, ['A-202']);
});

test('separates the disciplines', () => {
  const groups = analyseSequence(parse(['A-101', 'A-103', 'S-101', 'S-102']));
  assert.deepEqual(groups.map((g) => g.key), ['A-1', 'S-1']);
  assert.deepEqual(groups[0].missingLabels, ['A-102']);
  assert.deepEqual(groups[1].gaps, []);
});

test('reports a repeated sheet number', () => {
  const [group] = analyseSequence(parse(['A-101', 'A-102', 'A-101']));
  assert.deepEqual(group.duplicates, ['A-101']);
  assert.equal(group.count, 3);
});

test('an inserted sheet is not a duplicate of the sheet it follows', () => {
  const [group] = analyseSequence(parse(['A-101', 'A-101a', 'A-102']));
  assert.deepEqual(group.duplicates, []);
  assert.deepEqual(group.gaps, [], 'A-101a shares number 1, so nothing is missing');
});

test('unreadable numbers are left out of the sequence analysis', () => {
  const groups = analyseSequence(parse(['A-101', 'nonsense', 'A-103']));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].missingLabels, ['A-102']);
});

test('renderNumber keeps the digit width of its neighbours', () => {
  assert.equal(renderNumber(parseSheetNumber('A-101'), 3), 'A-103');
  assert.equal(renderNumber(parseSheetNumber('A-1.01'), 3), 'A-1.03');
  assert.equal(renderNumber(parseSheetNumber('S-07'), 9), 'S-09');
  assert.equal(renderNumber(parseSheetNumber('A-1001'), 23), 'A-1023');
});

test('spots a sheet listed out of order within its series', () => {
  const out = findOutOfOrder(parse(['A-101', 'A-103', 'A-102']));
  assert.equal(out.length, 1);
  assert.equal(out[0].sheet, 'A-102');
  assert.equal(out[0].after, 'A-103');
});

test('a change of series is not out of order', () => {
  assert.deepEqual(findOutOfOrder(parse(['A-101', 'A-102', 'A-201', 'S-101'])), []);
});

test('out-of-order detection skips unreadable entries rather than flagging them twice', () => {
  assert.deepEqual(findOutOfOrder(parse(['A-101', 'nonsense', 'A-102'])), []);
});
