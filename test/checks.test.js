import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex } from '../src/engine/index-parser.js';
import { runChecks, compareRevisions, latestRevision, summarise, SEVERITY } from '../src/engine/checks.js';

const check = (text, options) => runChecks(parseIndex(text), options);
const cats = (r) => r.findings.map((f) => f.category);
const find = (r, category) => r.findings.find((f) => f.category === category);

const CLEAN = `Sheet Number,Sheet Name,Revision,Date
A-101,Ground Floor Plan,B,2026-08-14
A-102,First Floor Plan,B,2026-08-14
A-103,Roof Plan,B,2026-08-14`;

test('compareRevisions ranks letters and numbers separately', () => {
  assert.ok(compareRevisions('A', 'B') < 0);
  assert.ok(compareRevisions('C', 'A') > 0);
  assert.equal(compareRevisions('B', 'B'), 0);
  assert.ok(compareRevisions('1', '2') < 0);
  assert.ok(compareRevisions('9', '10') < 0, 'numbers compare numerically, not as text');
});

test('compareRevisions handles two-letter revisions', () => {
  assert.ok(compareRevisions('Z', 'AA') < 0, 'AA comes after Z');
  assert.ok(compareRevisions('AB', 'AA') > 0);
});

test('compareRevisions strips a "Rev" prefix and is case-insensitive', () => {
  assert.equal(compareRevisions('rev B', 'B'), 0);
  assert.equal(compareRevisions('Rev. b', 'B'), 0);
});

test('compareRevisions refuses to rank marks it cannot compare', () => {
  assert.equal(compareRevisions('P1', 'C2'), null);
  assert.equal(compareRevisions('A', '1'), null);
  assert.equal(compareRevisions('', 'B'), null);
});

test('latestRevision picks the highest and gives up on mixed schemes', () => {
  assert.equal(latestRevision(['A', 'B', 'A']), 'B');
  assert.equal(latestRevision(['1', '2', '10']), '10');
  assert.equal(latestRevision(['A']), 'A');
  assert.equal(latestRevision(['P1', 'C2']), null);
  assert.equal(latestRevision([]), null);
});

test('a clean set produces no findings at all', () => {
  const r = check(CLEAN);
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.total, 0);
  assert.equal(r.summary.worst, 'clear');
  assert.match(r.summary.verdict, /Nothing flagged across 3 sheets/);
});

test('a clean set still says which checks ran and which did not', () => {
  const r = check(CLEAN);
  assert.ok(r.checked.some((c) => /numbering/.test(c)));
  assert.ok(r.checked.some((c) => /title-block/.test(c)));
  assert.ok(r.skipped.some((s) => /no PDF was provided/.test(s)));
  assert.ok(r.skipped.some((s) => /required sheets/.test(s)));
});

test('a gap in the numbering is a warning naming the missing sheet', () => {
  const r = check('A-101,Plan\nA-102,Plan\nA-104,Plan');
  const f = find(r, 'numbering-gap');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.deepEqual(f.sheets, ['A-103']);
  assert.match(f.detail, /not automatically a mistake/i);
});

test('a duplicated number is an error', () => {
  const r = check('A-101,Plan\nA-102,Plan\nA-101,Plan again');
  const f = find(r, 'numbering-duplicate');
  assert.equal(f.severity, SEVERITY.ERROR);
  assert.deepEqual(f.sheets, ['A-101']);
});

test('an unreadable number is reported verbatim with its line', () => {
  const r = check('A-101,Plan\nTBC,Plan to follow\nA-102,Plan');
  const f = find(r, 'numbering-unreadable');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.deepEqual(f.sheets, ['line 2: TBC']);
  assert.match(f.detail, /left out of the gap, duplicate and title-block checks/i);
  assert.ok(f.detail.length < 220, 'the detail stays short enough to read');
});

test('a row with an unreadable number is not also reported for every blank field', () => {
  // One placeholder row with nothing filled in is one problem, not five.
  const r = check(`Sheet Number,Sheet Name,Revision,Date,Scale
A-101,Ground Floor Plan,C,2026-09-04,1:100
TBC,,,,`);
  assert.ok(find(r, 'numbering-unreadable'), 'the unreadable number is still reported');
  for (const c of ['blank-name', 'blank-revision', 'blank-date', 'blank-scale']) {
    assert.equal(find(r, c), undefined, `${c} should not double-report the placeholder row`);
  }
});

test('a readable sheet with blank fields is still reported alongside an unreadable row', () => {
  const r = check(`Sheet Number,Sheet Name
A-101,Ground Floor Plan
A-102,
TBC,`);
  assert.deepEqual(find(r, 'blank-name').sheets, ['A-102'], 'A-102 is reported, TBC is not');
});

test('a convention breach names the offending numbers', () => {
  const r = check('A-101,Plan\nA102,Plan\nA-103,Plan', { convention: '@+-###' });
  const f = find(r, 'numbering-convention');
  assert.deepEqual(f.sheets, ['A102']);
  assert.ok(r.checked.includes('naming convention'));
});

test('no convention given means no convention finding, and it is listed as skipped', () => {
  const r = check('A-101,Plan\nA102,Plan');
  assert.equal(find(r, 'numbering-convention'), undefined);
  assert.ok(r.skipped.some((s) => /naming convention — none was given/.test(s)));
});

test('an unparseable convention is skipped with a reason, not silently ignored', () => {
  const r = check('A-101,Plan', { convention: 'custom:[unclosed' });
  assert.equal(find(r, 'numbering-convention'), undefined);
  assert.ok(r.skipped.some((s) => /could not be read as a pattern/.test(s)));
});

test('sheets listed out of sequence are a note, not a warning', () => {
  const r = check('A-101,Plan\nA-103,Plan\nA-102,Plan');
  const f = find(r, 'numbering-order');
  assert.equal(f.severity, SEVERITY.NOTE);
  assert.deepEqual(f.sheets, ['A-102 after A-103']);
});

test('a missing required sheet is an error', () => {
  const r = check('A-101,Plan\nA-102,Plan', { requiredSheets: ['A-101', 'A-102', 'A-401'] });
  const f = find(r, 'missing-required');
  assert.equal(f.severity, SEVERITY.ERROR);
  assert.deepEqual(f.sheets, ['A-401']);
});

test('required sheets are matched however they are written', () => {
  const r = check('A101,Plan\nA-102,Plan', { requiredSheets: ['A-101', 'A102'] });
  assert.equal(find(r, 'missing-required'), undefined, 'A101 and A-101 are the same sheet');
});

test('a blank title-block field is reported against its sheet', () => {
  const r = check('Sheet Number,Sheet Name\nA-101,Ground Floor Plan\nA-102,\nA-103,Roof Plan');
  const f = find(r, 'blank-name');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.deepEqual(f.sheets, ['A-102']);
});

test('a column that is empty for every sheet is only a note', () => {
  const r = check('Sheet Number,Sheet Name,Revision\nA-101,Plan,\nA-102,Plan,');
  const f = find(r, 'blank-revision');
  assert.equal(f.severity, SEVERITY.NOTE);
  assert.match(f.detail, /may simply not be filled in yet/i);
});

test('a field the index does not have is never reported', () => {
  const r = check('A-101\nA-102');
  assert.equal(find(r, 'blank-revision'), undefined);
  assert.equal(find(r, 'blank-scale'), undefined);
  assert.ok(r.skipped.some((s) => /revisions — the index has no revision column/.test(s)));
});

test('a field check can be switched off', () => {
  const text = 'Sheet Number,Sheet Name\nA-101,\nA-102,Plan';
  assert.ok(find(check(text), 'blank-name'));
  assert.equal(find(check(text, { fields: { name: false } }), 'blank-name'), undefined);
});

test('sheets behind the latest revision are flagged', () => {
  const r = check(`Sheet Number,Revision
A-101,B
A-102,A
A-103,B`);
  const f = find(r, 'revision-behind');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.deepEqual(f.sheets, ['A-102 (rev A)']);
  assert.match(f.title, /not at revision B/);
});

test('one revision throughout produces no revision finding', () => {
  const r = check('Sheet Number,Revision\nA-101,B\nA-102,B');
  assert.equal(find(r, 'revision-behind'), undefined);
});

test('revision marks that cannot be ranked are reported as such, not guessed at', () => {
  const r = check('Sheet Number,Revision\nA-101,P1\nA-102,C2');
  const f = find(r, 'revision-unrankable');
  assert.equal(f.severity, SEVERITY.NOTE);
  assert.match(f.detail, /will not guess which is latest/i);
  assert.equal(find(r, 'revision-behind'), undefined);
});

test('the same revision carrying two dates is a warning', () => {
  const r = check(`Sheet Number,Revision,Date
A-101,B,2026-08-14
A-102,B,2026-08-20
A-103,B,2026-08-14`);
  const f = find(r, 'revision-date-clash');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.equal(f.sheets.length, 1);
  assert.match(f.sheets[0], /rev B/);
  assert.match(f.sheets[0], /2026-08-14/);
  assert.match(f.sheets[0], /2026-08-20/);
});

test('different revisions with different dates is normal and not flagged', () => {
  const r = check(`Sheet Number,Revision,Date
A-101,B,2026-08-14
A-102,A,2026-07-01`);
  assert.equal(find(r, 'revision-date-clash'), undefined);
});

test('a scale that is not a recognised form is a note', () => {
  const r = check(`Sheet Number,Scale
A-101,1:100
A-102,see plan
A-103,NTS`);
  const f = find(r, 'scale-unreadable');
  assert.equal(f.severity, SEVERITY.NOTE);
  assert.deepEqual(f.sheets, ['A-102: see plan']);
});

test('common scale forms are all accepted', () => {
  const r = check(`Sheet Number,Scale
A-101,1:100
A-102,1/50
A-103,NTS
A-104,N.T.S.
A-105,As shown
A-106,Varies
A-107,Full size`);
  assert.equal(find(r, 'scale-unreadable'), undefined);
});

test('a PDF page count that disagrees with the index is an error', () => {
  const pdf = { ok: true, pageCount: 2, pages: [], sizes: [{ paper: 'A1', orientation: 'landscape', count: 2 }], warnings: [] };
  const r = check('A-101,Plan\nA-102,Plan\nA-103,Plan', { pdf });
  const f = find(r, 'page-count-mismatch');
  assert.equal(f.severity, SEVERITY.ERROR);
  assert.match(f.title, /2 pages but the index lists 3/);
  assert.match(f.detail, /1 sheet in the register did not make it into the PDF/);
});

test('a matching page count produces no mismatch finding', () => {
  const pdf = { ok: true, pageCount: 3, pages: [], sizes: [{ paper: 'A1', orientation: 'landscape', count: 3 }], warnings: [] };
  const r = check('A-101,Plan\nA-102,Plan\nA-103,Plan', { pdf });
  assert.equal(find(r, 'page-count-mismatch'), undefined);
  assert.ok(r.checked.some((c) => /PDF page count/.test(c)));
});

test('mixed paper sizes are a warning listing each size and its count', () => {
  const pdf = {
    ok: true,
    pageCount: 3,
    pages: [],
    sizes: [
      { paper: 'A1', orientation: 'landscape', count: 2 },
      { paper: 'A3', orientation: 'landscape', count: 1 },
    ],
    warnings: [],
  };
  const r = check('A-101,Plan\nA-102,Plan\nA-103,Schedule', { pdf });
  const f = find(r, 'paper-mixed');
  assert.equal(f.severity, SEVERITY.WARNING);
  assert.deepEqual(f.sheets, ['A1 landscape × 2', 'A3 landscape × 1']);
});

test('mixed orientation on one paper size is a note', () => {
  const pdf = {
    ok: true,
    pageCount: 2,
    pages: [],
    sizes: [
      { paper: 'A1', orientation: 'landscape', count: 1 },
      { paper: 'A1', orientation: 'portrait', count: 1 },
    ],
    warnings: [],
  };
  const r = check('A-101,Plan\nA-102,Plan', { pdf });
  assert.equal(find(r, 'orientation-mixed').severity, SEVERITY.NOTE);
  assert.equal(find(r, 'paper-mixed'), undefined, 'one paper size is not a mixed-paper finding');
});

test('an unreadable PDF skips its checks with the reason, and does not fail the rest', () => {
  const pdf = { ok: false, pageCount: 0, pages: [], sizes: [], warnings: ['The page tree could not be read from this PDF.'] };
  const r = check('A-101,Plan\nA-103,Plan', { pdf });
  assert.equal(find(r, 'page-count-mismatch'), undefined);
  assert.ok(r.skipped.some((s) => /page tree could not be read/.test(s)));
  assert.ok(find(r, 'numbering-gap'), 'the numbering check still ran');
});

test('findings come back worst first', () => {
  const r = check(`Sheet Number,Sheet Name,Revision
A-101,Plan,B
A-101,Plan,A
A-104,,B`, { requiredSheets: ['A-999'] });
  const severities = r.findings.map((f) => f.severity);
  const rank = { error: 0, warning: 1, note: 2 };
  for (let i = 1; i < severities.length; i += 1) {
    assert.ok(rank[severities[i]] >= rank[severities[i - 1]], 'sorted by severity');
  }
  assert.equal(severities[0], SEVERITY.ERROR);
});

test('an empty index returns no findings and says why', () => {
  const r = runChecks(parseIndex(''), {});
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.sheetCount, 0);
  assert.match(r.summary.verdict, /No sheets were read/);
  assert.ok(r.skipped.some((s) => /no sheets to check/.test(s)));
});

test('an index with no recognisable number column skips numbering but keeps going', () => {
  const r = check('Widget,Thing\nGadget,Thing');
  assert.ok(r.skipped.some((s) => /no column of sheet numbers/.test(s)));
  assert.equal(find(r, 'numbering-gap'), undefined);
});

test('the summary wording matches what was found', () => {
  assert.match(summarise([{ severity: 'error' }], 5).verdict, /1 thing to fix before issuing\./);
  assert.match(
    summarise([{ severity: 'error' }, { severity: 'warning' }], 5).verdict,
    /1 thing to fix before issuing, and 1 to look at\./,
  );
  assert.match(summarise([{ severity: 'warning' }, { severity: 'warning' }], 5).verdict, /2 things worth looking at/);
  assert.match(summarise([{ severity: 'note' }], 5).verdict, /1 note only\. Nothing wrong\./);
  assert.match(summarise([], 5).verdict, /Nothing flagged across 5 sheets\./);
  assert.match(summarise([], 1).verdict, /across 1 sheet\./);
});

test('the summary counts each severity', () => {
  const s = summarise([{ severity: 'error' }, { severity: 'note' }, { severity: 'note' }], 4);
  assert.deepEqual({ e: s.error, w: s.warning, n: s.note, t: s.total }, { e: 1, w: 0, n: 2, t: 3 });
  assert.equal(s.worst, 'error');
});
