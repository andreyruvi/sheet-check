/**
 * Reading a sheet index.
 *
 * The input is whatever the user has to hand: a sheet list exported from Revit
 * or ArchiCAD, a column pasted out of Excel, or a plain list typed into the
 * box. So the delimiter, the header row and the meaning of each column are all
 * detected rather than demanded — and the detection is reported back, so the
 * user can see what the tool decided and correct it.
 *
 * Columns are identified two ways: by header wording, and by sniffing the
 * content. Sniffing matters because a pasted column often has no header at
 * all, and because export headers are localised.
 */

import { parseSheetNumber } from './numbering.js';

const HEADER_PATTERNS = [
  ['number', /^(sheet\s*(number|no\.?|#)|dwg\.?\s*no\.?|drawing\s*(number|no\.?)|number|no\.?|code|id)$/i],
  ['name', /^(sheet\s*(name|title)|drawing\s*(name|title)|name|title|description)$/i],
  ['revision', /^(current\s*revision|revision(\s*(number|no\.?))?|rev\.?(\s*no\.?)?|issue)$/i],
  ['date', /^((current\s*revision|revision|issue|sheet)\s*date|date)$/i],
  ['scale', /^(scale|drawing\s*scale)$/i],
  ['discipline', /^(discipline|trade|package)$/i],
  ['status', /^(status|sheet\s*status|issue\s*status)$/i],
];

/** Split one delimited line, honouring double-quoted fields. */
export function splitLine(line, delimiter) {
  if (delimiter === null) return line.trim().split(/\s{2,}|\t/).map((s) => s.trim());
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/**
 * Guess the delimiter. `null` means "whitespace", which is what a list pasted
 * out of a PDF or a text editor usually is.
 */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (!lines.length) return null;
  const candidates = ['\t', ',', ';', '|'];
  let best = null;
  let bestScore = 0;
  for (const d of candidates) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const first = counts[0];
    // A real delimiter splits every line into the same number of fields.
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = first > 1 ? consistent * first : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore >= 1.5 ? best : null;
}

/** How many cells in this column read as sheet numbers? */
function sheetNumberScore(cells) {
  const filled = cells.filter((c) => c && c.trim());
  if (!filled.length) return 0;
  return filled.filter((c) => parseSheetNumber(c).valid).length / filled.length;
}

const REV_RE = /^(rev\.?\s*)?([A-Z]{1,2}|\d{1,3}|[A-Z]\d{1,2})$/i;
const DATE_RE = /^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})$/;
const SCALE_RE = /^(1\s*[:/]\s*\d+|\d+\s*[:/]\s*1|NTS|N\.T\.S\.?|AS\s*(SHOWN|NOTED)|VARIES?|FULL\s*SIZE)$/i;

/**
 * Decide what each column is.
 * Header wording wins when it is unambiguous; otherwise the content decides.
 */
export function detectColumns(rows, hasHeader) {
  const width = Math.max(...rows.map((r) => r.length), 0);
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const columns = {};
  const byHeader = {};

  if (hasHeader) {
    for (let c = 0; c < width; c += 1) {
      const cell = (header[c] || '').trim();
      for (const [role, pattern] of HEADER_PATTERNS) {
        if (pattern.test(cell) && byHeader[role] === undefined) { byHeader[role] = c; break; }
      }
    }
  }

  const columnCells = [];
  for (let c = 0; c < width; c += 1) columnCells.push(body.map((r) => r[c] || ''));

  // The sheet-number column is the one the numbers actually parse in.
  const numberScores = columnCells.map((cells, c) => ({ c, score: sheetNumberScore(cells) }));
  numberScores.sort((a, b) => b.score - a.score);
  if (byHeader.number !== undefined && sheetNumberScore(columnCells[byHeader.number] || []) >= 0.4) {
    columns.number = byHeader.number;
  } else if (numberScores.length && numberScores[0].score >= 0.5) {
    columns.number = numberScores[0].c;
  } else if (byHeader.number !== undefined) {
    columns.number = byHeader.number;
  }

  const fraction = (cells, re) => {
    const filled = cells.filter((x) => x && x.trim());
    return filled.length ? filled.filter((x) => re.test(x.trim())).length / filled.length : 0;
  };

  const sniff = (role, re, threshold) => {
    if (byHeader[role] !== undefined) { columns[role] = byHeader[role]; return; }
    let bestC = null;
    let bestF = 0;
    for (let c = 0; c < width; c += 1) {
      if (Object.values(columns).includes(c)) continue;
      const f = fraction(columnCells[c], re);
      if (f > bestF) { bestF = f; bestC = c; }
    }
    if (bestC !== null && bestF >= threshold) columns[role] = bestC;
  };

  sniff('date', DATE_RE, 0.6);
  sniff('scale', SCALE_RE, 0.5);
  sniff('revision', REV_RE, 0.6);

  // The name is the widest remaining column — sheet titles are prose.
  if (byHeader.name !== undefined) {
    columns.name = byHeader.name;
  } else {
    let bestC = null;
    let bestLen = 0;
    for (let c = 0; c < width; c += 1) {
      if (Object.values(columns).includes(c)) continue;
      const cells = columnCells[c].filter((x) => x && x.trim());
      if (!cells.length) continue;
      const avg = cells.reduce((s, x) => s + x.trim().length, 0) / cells.length;
      if (avg > bestLen) { bestLen = avg; bestC = c; }
    }
    if (bestC !== null && bestLen >= 4) columns.name = bestC;
  }

  if (byHeader.status !== undefined) columns.status = byHeader.status;
  if (byHeader.discipline !== undefined) columns.discipline = byHeader.discipline;

  return columns;
}

/** Does the first row look like headings rather than data? */
export function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const first = rows[0];
  const namedCells = first.filter((c) => HEADER_PATTERNS.some(([, re]) => re.test((c || '').trim())));
  if (namedCells.length >= 1) return true;
  // Otherwise: a header row holds no sheet numbers while the body does.
  const firstHasNumber = first.some((c) => parseSheetNumber(c).valid);
  const bodyHasNumber = rows.slice(1, 6).some((r) => r.some((c) => parseSheetNumber(c).valid));
  return !firstHasNumber && bodyHasNumber;
}

/**
 * Parse a pasted or uploaded sheet index.
 * @returns {{sheets:Array, columns:object, delimiter:string|null, hasHeader:boolean, headings:string[], warnings:string[], skipped:number}}
 */
export function parseIndex(text, options = {}) {
  const raw = String(text ?? '');
  const warnings = [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);

  if (!lines.length) {
    return { sheets: [], columns: {}, delimiter: null, hasHeader: false, headings: [], warnings: ['Nothing to read.'], skipped: 0 };
  }

  const delimiter = options.delimiter !== undefined ? options.delimiter : detectDelimiter(raw);
  const rows = lines.map((l) => splitLine(l, delimiter));
  const hasHeader = options.hasHeader !== undefined ? options.hasHeader : looksLikeHeader(rows);
  const columns = options.columns || detectColumns(rows, hasHeader);
  const headings = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;

  if (columns.number === undefined) {
    warnings.push('No column of sheet numbers was recognised, so numbering cannot be checked.');
  }

  const at = (row, role) => (columns[role] === undefined ? '' : (row[columns[role]] || '').trim());

  let skipped = 0;
  const sheets = [];
  for (const [i, row] of body.entries()) {
    if (row.every((c) => !c || !c.trim())) { skipped += 1; continue; }
    const numberText = at(row, 'number');
    sheets.push({
      line: i + (hasHeader ? 2 : 1),
      number: numberText,
      parsed: parseSheetNumber(numberText),
      name: at(row, 'name'),
      revision: at(row, 'revision'),
      date: at(row, 'date'),
      scale: at(row, 'scale'),
      status: at(row, 'status'),
      discipline: at(row, 'discipline'),
      cells: row,
    });
  }

  if (!sheets.length) warnings.push('No sheet rows were found.');

  return { sheets, columns, delimiter, hasHeader, headings, warnings, skipped };
}

/** A human description of what the parser decided, for the interface to show. */
export function describeParse(result) {
  const names = { '\t': 'tab', ',': 'comma', ';': 'semicolon', '|': 'pipe' };
  const delim = result.delimiter === null ? 'whitespace' : (names[result.delimiter] || result.delimiter);
  const found = Object.keys(result.columns).sort();
  return {
    delimiter: delim,
    header: result.hasHeader ? 'first row treated as headings' : 'no heading row',
    recognised: found,
    sheets: result.sheets.length,
  };
}
