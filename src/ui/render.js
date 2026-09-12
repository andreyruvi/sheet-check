/**
 * Putting the result on the page.
 *
 * Everything here is real document text — no canvas, no images. A check report
 * exists to be read, copied into an email and printed, so the DOM is the
 * deliverable rather than a view of it.
 */

const SEVERITY_WORD = { error: 'Fix', warning: 'Look at', note: 'Note' };
const SEVERITY_HEADING = { error: 'To fix', warning: 'To look at', note: 'Notes' };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export function createReportView(root) {
  const need = (selector) => {
    const node = root.querySelector(selector);
    if (!node) throw new Error(`Report hook ${selector} is missing from the page`);
    return node;
  };

  const nodes = {
    verdict: need('[data-verdict]'),
    counts: need('[data-counts]'),
    findings: need('[data-findings]'),
    empty: need('[data-empty]'),
    parseNote: need('[data-parse-note]'),
    warnings: need('[data-warnings]'),
    coverage: need('[data-coverage]'),
    sheetTable: need('[data-sheet-table]'),
    sheetBody: need('[data-sheet-body]'),
    sheetCount: need('[data-sheet-count]'),
  };

  function render({ index, result, describe, pdf }) {
    nodes.verdict.textContent = result.summary.verdict;
    nodes.verdict.dataset.state = result.summary.worst;

    nodes.counts.replaceChildren(...[
      ['error', 'to fix', result.summary.error],
      ['warning', 'to look at', result.summary.warning],
      ['note', 'notes', result.summary.note],
      ['sheets', 'sheets read', result.summary.sheetCount],
    ].map(([kind, label, n]) => el('div', { class: 'count', 'data-kind': kind }, [
      el('span', { class: 'count__n', text: String(n) }),
      el('span', { class: 'count__label', text: label }),
    ])));

    renderParseNote(index, describe, pdf);
    renderWarnings(index, pdf);
    renderFindings(result);
    renderCoverage(result);
    renderSheets(index);
  }

  function renderParseNote(index, describe, pdf) {
    if (!index.sheets.length) { nodes.parseNote.textContent = ''; nodes.parseNote.hidden = true; return; }
    const bits = [
      `Read ${describe.sheets} sheet${describe.sheets === 1 ? '' : 's'}`,
      `separated by ${describe.delimiter}`,
      describe.header,
      `columns recognised: ${describe.recognised.join(', ') || 'none'}`,
    ];
    if (pdf && pdf.ok) {
      bits.push(`PDF: ${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'}, `
        + pdf.sizes.map((s) => `${s.paper} ${s.orientation}${s.count > 1 ? ` ×${s.count}` : ''}`).join(' + '));
    }
    nodes.parseNote.textContent = `${bits.join(' · ')}.`;
    nodes.parseNote.hidden = false;
  }

  function renderWarnings(index, pdf) {
    const all = [...(index.warnings || []), ...((pdf && pdf.warnings) || [])];
    nodes.warnings.replaceChildren(...all.map((w) => el('li', { text: w })));
    nodes.warnings.hidden = all.length === 0;
  }

  function renderFindings(result) {
    const { findings } = result;
    nodes.empty.hidden = findings.length > 0;
    nodes.findings.hidden = findings.length === 0;
    if (!findings.length) return;

    const sections = [];
    for (const severity of ['error', 'warning', 'note']) {
      const group = findings.filter((f) => f.severity === severity);
      if (!group.length) continue;
      sections.push(el('h3', { class: 'group', 'data-severity': severity, text: SEVERITY_HEADING[severity] }));
      for (const f of group) {
        sections.push(el('article', { class: 'finding', 'data-severity': f.severity }, [
          el('h4', { class: 'finding__title' }, [
            el('span', { class: 'tag', 'data-severity': f.severity, text: SEVERITY_WORD[f.severity] }),
            el('span', { text: f.title }),
          ]),
          el('p', { class: 'finding__detail', text: f.detail }),
          f.sheets.length
            ? el('ul', { class: `finding__sheets${f.sheets.length > 12 ? ' finding__sheets--dense' : ''}` },
              f.sheets.map((s) => el('li', { text: s })))
            : null,
        ]));
      }
    }
    nodes.findings.replaceChildren(...sections);
  }

  function renderCoverage(result) {
    const list = (items, fallback) => (items.length
      ? items.map((i) => el('li', { text: i }))
      : [el('li', { class: 'muted', text: fallback })]);

    nodes.coverage.replaceChildren(
      el('div', { class: 'coverage__col' }, [
        el('h4', { text: 'Checked' }),
        el('ul', {}, list(result.checked, 'nothing')),
      ]),
      el('div', { class: 'coverage__col' }, [
        el('h4', { text: 'Not checked' }),
        el('ul', {}, list(result.skipped, 'everything applicable was checked')),
      ]),
    );
  }

  function renderSheets(index) {
    const roles = ['number', 'name', 'revision', 'date', 'scale', 'status', 'discipline']
      .filter((r) => index.columns[r] !== undefined);

    const head = nodes.sheetTable.querySelector('thead tr');
    head.replaceChildren(
      el('th', { scope: 'col', text: 'Line' }),
      ...roles.map((r) => el('th', { scope: 'col', text: r[0].toUpperCase() + r.slice(1) })),
      el('th', { scope: 'col', text: 'Read as' }),
    );

    nodes.sheetBody.replaceChildren(...index.sheets.map((s) => el('tr', { 'data-valid': String(s.parsed.valid) }, [
      el('td', { class: 'numeric muted', text: String(s.line) }),
      ...roles.map((r) => el('td', { text: s[r] || '—' })),
      el('td', { class: 'read-as', text: s.parsed.valid ? s.parsed.normalised : `unreadable` }),
    ])));

    nodes.sheetCount.textContent = `${index.sheets.length} sheet${index.sheets.length === 1 ? '' : 's'}`;
    nodes.sheetTable.hidden = index.sheets.length === 0;
  }

  return { render };
}
