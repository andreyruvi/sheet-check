/**
 * The report.
 *
 * Two formats, because the report has two audiences. CSV goes into a
 * spreadsheet and gets worked through row by row; Markdown gets pasted into an
 * email or an issue and read by someone who was not at the screen.
 *
 * Both carry the same three things: what was found, what was checked, and
 * what was *not* checked. The last one matters most — a report that lists six
 * findings and stays silent about the eight checks it skipped reads like a
 * clean bill of health, and isn't one.
 */

const NL = '\n';

const SEVERITY_LABEL = { error: 'Fix', warning: 'Look at', note: 'Note' };

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp(meta) {
  const lines = [];
  if (meta.project) lines.push(['Project', meta.project]);
  if (meta.issue) lines.push(['Issue', meta.issue]);
  if (meta.source) lines.push(['Source', meta.source]);
  lines.push(['Checked', meta.date || new Date().toISOString().slice(0, 10)]);
  return lines;
}

export function toCSV(result, meta = {}) {
  const { findings, summary, checked, skipped } = result;
  const rows = [];

  for (const [k, v] of stamp(meta)) rows.push([k, v]);
  rows.push([]);
  rows.push(['Sheets read', summary.sheetCount]);
  rows.push(['To fix', summary.error]);
  rows.push(['To look at', summary.warning]);
  rows.push(['Notes', summary.note]);
  rows.push(['Verdict', summary.verdict]);
  rows.push([]);

  rows.push(['Severity', 'Category', 'Finding', 'Sheets', 'Detail']);
  if (findings.length) {
    for (const f of findings) {
      rows.push([SEVERITY_LABEL[f.severity], f.category, f.title, f.sheets.join('; '), f.detail]);
    }
  } else {
    rows.push(['', '', 'Nothing flagged', '', '']);
  }

  rows.push([]);
  rows.push(['Checks run']);
  for (const c of checked) rows.push([c]);
  rows.push([]);
  rows.push(['Not checked']);
  if (skipped.length) for (const s of skipped) rows.push([s]);
  else rows.push(['— everything applicable was checked']);

  return rows.map((r) => r.map(csvCell).join(',')).join(NL) + NL;
}

export function toMarkdown(result, meta = {}) {
  const { findings, summary, checked, skipped } = result;
  const out = [];

  out.push(`# Drawing-set check${meta.project ? ` — ${meta.project}` : ''}`);
  out.push('');
  for (const [k, v] of stamp(meta)) out.push(`**${k}:** ${v}  `);
  out.push('');
  out.push(`**${summary.verdict}**`);
  out.push('');
  out.push(`${summary.sheetCount} sheet${summary.sheetCount === 1 ? '' : 's'} read · `
    + `${summary.error} to fix · ${summary.warning} to look at · ${summary.note} note${summary.note === 1 ? '' : 's'}`);
  out.push('');

  if (findings.length) {
    for (const group of ['error', 'warning', 'note']) {
      const inGroup = findings.filter((f) => f.severity === group);
      if (!inGroup.length) continue;
      const heading = { error: 'To fix', warning: 'To look at', note: 'Notes' }[group];
      out.push(`## ${heading}`);
      out.push('');
      for (const f of inGroup) {
        out.push(`### ${f.title}`);
        out.push('');
        out.push(f.detail);
        if (f.sheets.length) {
          out.push('');
          // A long list goes inline; a short one gets its own bullets.
          if (f.sheets.length > 12) out.push(f.sheets.join(', '));
          else for (const s of f.sheets) out.push(`- ${s}`);
        }
        out.push('');
      }
    }
  } else {
    out.push('Nothing was flagged.');
    out.push('');
  }

  out.push('## What was checked');
  out.push('');
  if (checked.length) for (const c of checked) out.push(`- ${c}`);
  else out.push('- nothing — no sheets were read');
  out.push('');

  out.push('## What was not checked');
  out.push('');
  if (skipped.length) for (const s of skipped) out.push(`- ${s}`);
  else out.push('- everything applicable was checked');
  out.push('');

  out.push('---');
  out.push('');
  out.push('Checked with [sheet-check](https://github.com/andreyruvi/sheet-check). '
    + 'The tool reads a register and a PDF; it does not read the drawings. '
    + 'A clean report is not an approval.');

  return out.join(NL) + NL;
}

/** The sheet table, for anyone who wants the parsed register back out. */
export function sheetsToCSV(index) {
  const roles = ['number', 'name', 'revision', 'date', 'scale', 'status', 'discipline']
    .filter((r) => index.columns[r] !== undefined);
  const header = ['Line', ...roles.map((r) => r[0].toUpperCase() + r.slice(1)), 'Number read as'];
  const rows = [header];
  for (const s of index.sheets) {
    rows.push([
      s.line,
      ...roles.map((r) => s[r]),
      s.parsed.valid ? s.parsed.normalised : `unreadable (${s.parsed.reason})`,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join(NL) + NL;
}

/** A filename stem that is safe on every platform. */
export function slug(text, fallback = 'sheet-check') {
  // An empty fallback is meaningful: the caller wants to know there was no name.
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}
