/**
 * Wiring.
 *
 * Reads the form, runs the checks, renders the report and handles the exports.
 * Everything it calls is tested on its own; this file is deliberately the only
 * part that is not.
 */

import { parseIndex, describeParse } from './engine/index-parser.js';
import { runChecks } from './engine/checks.js';
import { readPdf } from './engine/pdf.js';
import { toCSV, toMarkdown, sheetsToCSV, slug } from './engine/report.js';
import { CONVENTION_PRESETS } from './engine/numbering.js';
import { createReportView } from './ui/render.js';
import {
  readText, readBytes, isPdf, onDrop, downloadText, pickFiles, saveSettings, loadSettings,
} from './ui/files.js';

const form = document.querySelector('[data-form]');
const input = document.querySelector('[data-index-input]');
const dropZone = document.querySelector('[data-drop]');
const status = document.querySelector('[data-status]');
const pdfNote = document.querySelector('[data-pdf-note]');
const view = createReportView(document.querySelector('[data-report]'));

let pdf = null;
let pdfName = null;
let current = null;
let frame = 0;

const announce = (message) => { status.textContent = message; };

function settings() {
  const field = (name) => form.elements.namedItem(name);
  const value = (name) => (field(name)?.value ?? '').trim();
  return {
    project: value('project'),
    issue: value('issue'),
    convention: value('convention'),
    required: value('required'),
    checkName: Boolean(field('checkName')?.checked),
    checkRevision: Boolean(field('checkRevision')?.checked),
    checkDate: Boolean(field('checkDate')?.checked),
    checkScale: Boolean(field('checkScale')?.checked),
  };
}

function applySettings(saved) {
  if (!saved) return;
  for (const [name, value] of Object.entries(saved)) {
    const node = form.elements.namedItem(name);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = Boolean(value);
    else node.value = value ?? '';
  }
}

/** Recompute and redraw. Cheap enough to run on every keystroke. */
function update() {
  const s = settings();
  const index = parseIndex(input.value);
  const result = runChecks(index, {
    convention: s.convention || null,
    requiredSheets: s.required
      ? s.required.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
      : [],
    pdf,
    fields: {
      name: s.checkName,
      revision: s.checkRevision,
      date: s.checkDate,
      scale: s.checkScale,
    },
  });

  current = { index, result, describe: describeParse(index), pdf, settings: s };
  view.render(current);
  document.body.dataset.state = result.summary.worst;
  saveSettings(s);
}

function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { frame = 0; update(); });
}

// ---- Files ---------------------------------------------------------------

async function accept(files) {
  const pdfs = files.filter(isPdf);
  const texts = files.filter((f) => !isPdf(f));

  for (const file of texts) {
    try {
      input.value = await readText(file);
      announce(`Loaded ${file.name}.`);
    } catch (error) {
      announce(error.message);
    }
  }

  for (const file of pdfs) {
    announce(`Reading ${file.name}…`);
    try {
      pdf = await readPdf(await readBytes(file));
      pdfName = file.name;
      if (pdf.ok) {
        announce(`Read ${file.name}: ${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'}.`);
      } else {
        announce(`${file.name}: ${pdf.warnings[0]}`);
      }
    } catch (error) {
      pdf = null;
      pdfName = null;
      announce(`Could not read ${file.name}: ${error.message}`);
    }
  }

  renderPdfNote();
  update();
}

function renderPdfNote() {
  if (!pdf) {
    pdfNote.textContent = 'No PDF attached — paper-size and page-count checks are skipped.';
    pdfNote.dataset.state = 'none';
    return;
  }
  if (!pdf.ok) {
    pdfNote.textContent = `${pdfName}: ${pdf.warnings[0]}`;
    pdfNote.dataset.state = 'bad';
    return;
  }
  const sizes = pdf.sizes.map((s) => `${s.paper} ${s.orientation}${s.count > 1 ? ` ×${s.count}` : ''}`).join(', ');
  pdfNote.textContent = `${pdfName}: ${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'}, ${sizes}.`;
  pdfNote.dataset.state = 'ok';
}

onDrop(dropZone, accept);
onDrop(document.body, accept);

// ---- Actions -------------------------------------------------------------

function meta() {
  return {
    project: current?.settings.project || '',
    issue: current?.settings.issue || '',
    source: pdfName || '',
    date: new Date().toISOString().slice(0, 10),
  };
}

/**
 * The filename stem. Named after the project when there is one, so a folder of
 * reports is sortable; otherwise just the tool's name, because
 * "sheet-check-check.md" looks like a mistake.
 */
function stem(suffix) {
  const project = slug(current?.settings.project, '');
  return project ? `${project}-${suffix}` : `sheet-check-${suffix}`;
}

const actions = {
  async 'choose-index'() {
    const files = await pickFiles('.csv,.tsv,.txt,text/csv,text/plain');
    if (files.length) accept(files);
  },
  async 'choose-pdf'() {
    const files = await pickFiles('.pdf,application/pdf');
    if (files.length) accept(files);
  },
  'clear-pdf'() {
    pdf = null;
    pdfName = null;
    renderPdfNote();
    update();
    announce('PDF removed.');
  },
  'export-md'() {
    const name = `${stem('report')}.md`;
    downloadText(name, toMarkdown(current.result, meta()), 'text/markdown;charset=utf-8');
    announce(`Saved ${name}.`);
  },
  'export-csv'() {
    const name = `${stem('report')}.csv`;
    downloadText(name, toCSV(current.result, meta()), 'text/csv;charset=utf-8');
    announce(`Saved ${name}.`);
  },
  'export-sheets'() {
    const name = `${stem('register')}.csv`;
    downloadText(name, sheetsToCSV(current.index), 'text/csv;charset=utf-8');
    announce(`Saved the register as ${name}.`);
  },
  async 'copy-md'() {
    const text = toMarkdown(current.result, meta());
    try {
      await navigator.clipboard.writeText(text);
      announce('Report copied. Paste it into an email or an issue.');
    } catch {
      announce('This browser would not allow copying. Use "Save report" instead.');
    }
  },
  print() {
    window.print();
  },
  example() {
    input.value = EXAMPLE;
    const conv = form.elements.namedItem('convention');
    if (conv) conv.value = '@+-###';
    const req = form.elements.namedItem('required');
    if (req) req.value = 'A-101 A-102 A-201 A-301 A-401';
    update();
    announce('Loaded an example register with a few deliberate problems in it.');
  },
  clear() {
    input.value = '';
    pdf = null;
    pdfName = null;
    renderPdfNote();
    update();
    announce('Cleared.');
  },
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = actions[button.dataset.action];
  if (!action) return;
  event.preventDefault();
  action();
});

form.addEventListener('input', schedule);
form.addEventListener('change', schedule);
form.addEventListener('submit', (event) => event.preventDefault());
input.addEventListener('input', schedule);

/** A register with the problems this tool exists to catch. */
const EXAMPLE = `Sheet Number,Sheet Name,Revision,Date,Scale
A-101,Site and Ground Floor Plan,C,2026-09-04,1:100
A-102,First Floor Plan,C,2026-09-04,1:100
A-104,Roof Plan,B,2026-08-12,1:100
A-104,Roof Plan (superseded),A,2026-07-20,1:100
A-201,North and East Elevations,C,2026-09-04,1:100
A-202,South and West Elevations,C,2026-09-11,1:100
A-301,Section A-A,C,2026-09-04,1:50
A302,Section B-B,C,2026-09-04,1:50
A-401,,C,2026-09-04,see plan
TBC,Door and Window Schedule,,,`;

/** Offer the common numbering conventions without forcing a choice. */
function fillConventionPresets() {
  const list = document.querySelector('[data-convention-presets]');
  if (!list) return;
  list.replaceChildren(...CONVENTION_PRESETS.map((preset) => {
    const option = document.createElement('option');
    option.value = preset.template;
    option.label = `${preset.label} — ${preset.note}`;
    return option;
  }));
}

fillConventionPresets();
applySettings(loadSettings());
renderPdfNote();
update();
announce('Paste a sheet list, or drop a CSV and the PDF set anywhere on this page.');
