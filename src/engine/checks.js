/**
 * The checks.
 *
 * Each rule returns findings rather than a pass/fail, because "wrong" is not
 * something a tool can decide about a drawing set — a gap in the numbering may
 * be a sheet that was deliberately withdrawn, and a mixed paper size may be a
 * schedule sheet that belongs at A3. So the output is a list of things worth
 * looking at, each with a severity that says how likely it is to matter, and
 * every finding names the sheets it is about so it can be checked in seconds.
 *
 * Rules only run on information that is actually present. If the index has no
 * revision column, nothing is reported about revisions — an absent column is
 * not an empty field.
 */

import { analyseSequence, findOutOfOrder, conventionToRegex, parseSheetNumber } from './numbering.js';

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning', NOTE: 'note' });

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };

const SCALE_RE = /^(1\s*[:/]\s*\d+|\d+\s*[:/]\s*1|NTS|N\.T\.S\.?|AS\s*(SHOWN|NOTED)|VARIES?|FULL\s*SIZE|1\s*=\s*\d+)$/i;

/**
 * Compare two revision marks.
 * @returns {number|null} negative if a is earlier, null when they cannot be compared
 */
export function compareRevisions(a, b) {
  const clean = (x) => String(x ?? '').trim().toUpperCase().replace(/^REV\.?\s*/, '');
  const A = clean(a);
  const B = clean(b);
  if (!A || !B) return null;
  if (A === B) return 0;
  const bothDigits = /^\d+$/.test(A) && /^\d+$/.test(B);
  if (bothDigits) return Number(A) - Number(B);
  const bothLetters = /^[A-Z]{1,2}$/.test(A) && /^[A-Z]{1,2}$/.test(B);
  if (bothLetters) {
    if (A.length !== B.length) return A.length - B.length;
    return A < B ? -1 : 1;
  }
  // P1 vs C2, or anything else mixed: not something to rank confidently.
  return null;
}

/** The highest revision present, or null when the marks cannot be ranked. */
export function latestRevision(values) {
  const present = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (!present.length) return null;
  let best = present[0];
  for (const v of present.slice(1)) {
    const c = compareRevisions(best, v);
    if (c === null) return null;
    if (c < 0) best = v;
  }
  return best;
}

function label(sheet) {
  return sheet.parsed.valid ? sheet.parsed.normalised : (sheet.number || `line ${sheet.line}`);
}

/**
 * Run every applicable check.
 *
 * @param {object} index   a parseIndex result
 * @param {object} options { convention, requiredSheets, pdf, fields }
 */
export function runChecks(index, options = {}) {
  const sheets = index.sheets || [];
  const findings = [];
  const add = (severity, category, title, detail, subjects = []) => {
    findings.push({
      id: `${category}:${subjects.slice(0, 3).join(',')}`,
      severity,
      category,
      title,
      detail,
      sheets: subjects,
      count: subjects.length,
    });
  };

  if (!sheets.length) {
    return { findings: [], summary: summarise([], 0), checked: [], skipped: ['every check — there are no sheets to check'] };
  }

  const checked = [];
  const skipped = [];
  const parsedList = sheets.map((s) => s.parsed);
  const haveNumbers = index.columns.number !== undefined;

  // ---- Numbering -------------------------------------------------------

  if (haveNumbers) {
    checked.push('sheet numbering');

    const unreadable = sheets.filter((s) => !s.parsed.valid);
    if (unreadable.length) {
      add(
        SEVERITY.WARNING, 'numbering-unreadable',
        `${unreadable.length} sheet ${unreadable.length === 1 ? 'number' : 'numbers'} could not be read`,
        'These are reported exactly as written. A row with no readable number is left out of the gap, duplicate and title-block checks, so those results are incomplete until the entry is fixed.',
        unreadable.map((s) => `line ${s.line}: ${s.number || '(blank)'}`),
      );
    }

    const groups = analyseSequence(parsedList);
    const allMissing = groups.flatMap((g) => g.missingLabels);
    if (allMissing.length) {
      add(
        SEVERITY.WARNING, 'numbering-gap',
        `${allMissing.length} sheet ${allMissing.length === 1 ? 'number is' : 'numbers are'} missing from the sequence`,
        'A gap is not automatically a mistake — a withdrawn sheet leaves one. But an unintended gap usually means a sheet never made it into the set.',
        allMissing,
      );
    }

    const duplicates = groups.flatMap((g) => g.duplicates);
    if (duplicates.length) {
      add(
        SEVERITY.ERROR, 'numbering-duplicate',
        `${duplicates.length} sheet ${duplicates.length === 1 ? 'number is' : 'numbers are'} used twice`,
        'Two sheets with the same number cannot both be referred to. One of them needs renumbering before the set is issued.',
        duplicates,
      );
    }

    const outOfOrder = findOutOfOrder(parsedList);
    if (outOfOrder.length) {
      add(
        SEVERITY.NOTE, 'numbering-order',
        `${outOfOrder.length} sheet ${outOfOrder.length === 1 ? 'is' : 'are'} listed out of sequence`,
        'Only the order of the index is affected, not the sheets themselves.',
        outOfOrder.map((o) => `${o.sheet} after ${o.after}`),
      );
    }

    if (options.convention) {
      const re = conventionToRegex(options.convention);
      if (!re) {
        skipped.push(`the naming convention — "${options.convention}" could not be read as a pattern`);
      } else {
        checked.push('naming convention');
        const breaches = sheets.filter((s) => s.number && !re.test(s.number.trim()));
        if (breaches.length) {
          add(
            SEVERITY.WARNING, 'numbering-convention',
            `${breaches.length} sheet ${breaches.length === 1 ? 'number does' : 'numbers do'} not match ${options.convention}`,
            'Inconsistent numbering breaks sorting, cross-references and any script that reads the register.',
            breaches.map((s) => s.number.trim()),
          );
        }
      }
    } else {
      skipped.push('the naming convention — none was given');
    }
  } else {
    skipped.push('sheet numbering — no column of sheet numbers was recognised');
  }

  // ---- Required sheets -------------------------------------------------

  const required = (options.requiredSheets || []).map((r) => String(r).trim()).filter(Boolean);
  if (required.length) {
    checked.push('required sheets');
    const present = new Set(sheets.map((s) => {
      const p = s.parsed.valid ? s.parsed.normalised : String(s.number || '').trim().toUpperCase();
      return p;
    }));
    const absent = required.filter((r) => {
      const p = parseSheetNumber(r);
      const key = p.valid ? p.normalised : r.toUpperCase();
      return !present.has(key);
    });
    if (absent.length) {
      add(
        SEVERITY.ERROR, 'missing-required',
        `${absent.length} required sheet ${absent.length === 1 ? 'is' : 'are'} not in the set`,
        'These were listed as required for this issue, and the index does not contain them.',
        absent,
      );
    }
  } else {
    skipped.push('required sheets — no list was given');
  }

  // ---- Title-block fields ---------------------------------------------

  const fieldChecks = [
    ['name', 'sheet name'],
    ['revision', 'revision'],
    ['date', 'revision date'],
    ['scale', 'scale'],
  ];
  // A row whose number could not be read is already reported once; checking
  // its blank fields as well would report one problem several times over.
  const fieldSubjects = haveNumbers ? sheets.filter((s) => s.parsed.valid) : sheets;

  const checkedFields = [];
  for (const [key, wording] of fieldChecks) {
    if (index.columns[key] === undefined) continue;
    if (options.fields && options.fields[key] === false) continue;
    checkedFields.push(wording);
    const blank = fieldSubjects.filter((s) => !String(s[key] || '').trim());
    if (blank.length) {
      add(
        blank.length === fieldSubjects.length ? SEVERITY.NOTE : SEVERITY.WARNING,
        `blank-${key}`,
        `${blank.length} sheet${blank.length === 1 ? '' : 's'} ${blank.length === 1 ? 'has' : 'have'} no ${wording}`,
        blank.length === fieldSubjects.length
          ? `The column exists but is empty for every sheet, so it may simply not be filled in yet.`
          : `A blank ${wording} in the register usually means a blank field in the title block.`,
        blank.map(label),
      );
    }
  }
  if (checkedFields.length) checked.push(`title-block fields (${checkedFields.join(', ')})`);
  else skipped.push('title-block fields — the index has no name, revision, date or scale column');

  // ---- Revisions -------------------------------------------------------

  if (index.columns.revision !== undefined) {
    const marks = sheets.map((s) => s.revision).filter((r) => String(r || '').trim());
    const latest = latestRevision(marks);
    const distinct = [...new Set(marks.map((m) => m.trim()))];

    if (latest === null && distinct.length > 1) {
      add(
        SEVERITY.NOTE, 'revision-unrankable',
        `The set carries ${distinct.length} different revision marks that cannot be ranked`,
        `Found ${distinct.join(', ')}. Mixing letter and number revisions means the tool will not guess which is latest — that call is yours.`,
        distinct,
      );
    } else if (latest !== null && distinct.length > 1) {
      checked.push('revisions');
      const behind = sheets.filter((s) => {
        const r = String(s.revision || '').trim();
        return r && compareRevisions(r, latest) < 0;
      });
      if (behind.length) {
        add(
          SEVERITY.WARNING, 'revision-behind',
          `${behind.length} sheet${behind.length === 1 ? '' : 's'} ${behind.length === 1 ? 'is' : 'are'} not at revision ${latest}`,
          'Sheets at an earlier revision than the rest of the set are normal mid-project, but on an issue they are the usual cause of a set going out half-updated.',
          behind.map((s) => `${label(s)} (rev ${String(s.revision).trim()})`),
        );
      }
    }

    // Same revision, different dates — one of them is wrong.
    if (index.columns.date !== undefined) {
      const byRev = new Map();
      for (const s of sheets) {
        const r = String(s.revision || '').trim();
        const d = String(s.date || '').trim();
        if (!r || !d) continue;
        if (!byRev.has(r)) byRev.set(r, new Map());
        const dates = byRev.get(r);
        if (!dates.has(d)) dates.set(d, []);
        dates.get(d).push(label(s));
      }
      const clashes = [];
      for (const [rev, dates] of byRev) {
        if (dates.size > 1) clashes.push(`rev ${rev}: ${[...dates.keys()].join(' / ')}`);
      }
      if (clashes.length) {
        add(
          SEVERITY.WARNING, 'revision-date-clash',
          `${clashes.length} revision${clashes.length === 1 ? '' : 's'} ${clashes.length === 1 ? 'carries' : 'carry'} more than one date`,
          'The same revision of the same set should share one date. Differing dates usually mean a sheet was re-issued without its revision being bumped.',
          clashes,
        );
      }
    }
  } else {
    skipped.push('revisions — the index has no revision column');
  }

  // ---- Scales ----------------------------------------------------------

  if (index.columns.scale !== undefined) {
    const odd = sheets.filter((s) => {
      const v = String(s.scale || '').trim();
      return v && !SCALE_RE.test(v);
    });
    if (odd.length) {
      add(
        SEVERITY.NOTE, 'scale-unreadable',
        `${odd.length} scale${odd.length === 1 ? '' : 's'} ${odd.length === 1 ? 'is' : 'are'} not in a recognised form`,
        'Expected something like 1:100, 1:50, NTS or "as shown". Worth a look in case a field holds a note rather than a scale.',
        odd.map((s) => `${label(s)}: ${String(s.scale).trim()}`),
      );
    }
  }

  // ---- The PDF ---------------------------------------------------------

  const pdf = options.pdf;
  if (pdf && pdf.ok) {
    checked.push('PDF page count and paper sizes');

    if (pdf.pageCount !== sheets.length) {
      const diff = Math.abs(pdf.pageCount - sheets.length);
      add(
        SEVERITY.ERROR, 'page-count-mismatch',
        `The PDF has ${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'} but the index lists ${sheets.length}`,
        pdf.pageCount < sheets.length
          ? `${diff} sheet${diff === 1 ? '' : 's'} in the register did not make it into the PDF.`
          : `The PDF has ${diff} page${diff === 1 ? '' : 's'} that the register does not account for.`,
        [],
      );
    }

    const papers = [...new Set(pdf.sizes.map((s) => s.paper))];
    if (papers.length > 1) {
      add(
        SEVERITY.WARNING, 'paper-mixed',
        `The set mixes ${papers.length} paper sizes`,
        'A set on one paper size prints and binds predictably. Mixed sizes are often deliberate for schedules, and often accidental for everything else.',
        pdf.sizes.map((s) => `${s.paper} ${s.orientation} × ${s.count}`),
      );
    }

    const orientations = [...new Set(pdf.sizes.map((s) => s.orientation))];
    if (orientations.length > 1 && papers.length === 1) {
      add(
        SEVERITY.NOTE, 'orientation-mixed',
        'The set mixes portrait and landscape sheets',
        'Worth confirming this is intended before issuing — some viewers and plotters handle a mixed-orientation set badly.',
        pdf.sizes.map((s) => `${s.paper} ${s.orientation} × ${s.count}`),
      );
    }
  } else if (pdf && !pdf.ok) {
    skipped.push(`the PDF checks — ${pdf.warnings[0] || 'the file could not be read'}`);
  } else {
    skipped.push('the PDF checks — no PDF was provided');
  }

  findings.sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.category.localeCompare(b.category)
  ));

  return { findings, summary: summarise(findings, sheets.length), checked, skipped };
}

/** Counts by severity plus a sentence a reader can act on. */
export function summarise(findings, sheetCount) {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const total = findings.length;

  let verdict;
  if (!sheetCount) verdict = 'No sheets were read.';
  else if (!total) verdict = `Nothing flagged across ${sheetCount} sheet${sheetCount === 1 ? '' : 's'}.`;
  else if (counts.error) {
    verdict = `${counts.error} thing${counts.error === 1 ? '' : 's'} to fix before issuing`
      + (counts.warning ? `, and ${counts.warning} to look at.` : '.');
  } else if (counts.warning) {
    verdict = `${counts.warning} thing${counts.warning === 1 ? '' : 's'} worth looking at. Nothing that blocks an issue.`;
  } else {
    verdict = `${counts.note} note${counts.note === 1 ? '' : 's'} only. Nothing wrong.`;
  }

  return { ...counts, total, sheetCount, verdict, worst: counts.error ? 'error' : counts.warning ? 'warning' : counts.note ? 'note' : 'clear' };
}
