import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdf, namePaper, orientationOf, PAPER_SIZES } from '../src/engine/pdf.js';

const MM = 72 / 25.4;
const pt = (mm) => (mm * MM).toFixed(2);

/** Build a minimal but structurally valid PDF with the given pages. */
function makePdf(pages, { version = '1.4', inheritBox = null } = {}) {
  const parts = [`%PDF-${version}\n`];
  const kids = pages.map((_, i) => `${i + 3} 0 R`).join(' ');
  parts.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  const boxOnTree = inheritBox ? ` /MediaBox [0 0 ${pt(inheritBox[0])} ${pt(inheritBox[1])}]` : '';
  parts.push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages.length}${boxOnTree} >> endobj\n`);
  for (const [i, p] of pages.entries()) {
    const box = p.box ? ` /MediaBox [0 0 ${pt(p.box[0])} ${pt(p.box[1])}]` : '';
    const rotate = p.rotate ? ` /Rotate ${p.rotate}` : '';
    parts.push(`${i + 3} 0 obj << /Type /Page /Parent 2 0 R${box}${rotate} >> endobj\n`);
  }
  parts.push('trailer << /Root 1 0 R /Size 99 >>\n%%EOF\n');
  return new TextEncoder().encode(parts.join(''));
}

/** Build a PDF whose page objects live inside a Flate-compressed stream. */
async function makeCompressedPdf(pages) {
  const inner = pages.map((p, i) => (
    `${i + 3} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(p.box[0])} ${pt(p.box[1])}]`
    + `${p.rotate ? ` /Rotate ${p.rotate}` : ''} >> endobj\n`
  )).join('');
  const raw = new TextEncoder().encode(inner);
  const compressed = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')),
  ).arrayBuffer());

  const head = new TextEncoder().encode(
    '%PDF-1.5\n'
    + '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'
    + `2 0 obj << /Type /Pages /Count ${pages.length} >> endobj\n`
    + `5 0 obj << /Type /ObjStm /N ${pages.length} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
  );
  const tail = new TextEncoder().encode('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const out = new Uint8Array(head.length + compressed.length + tail.length);
  out.set(head, 0);
  out.set(compressed, head.length);
  out.set(tail, head.length + compressed.length);
  return out;
}

test('every named paper size round-trips through namePaper', () => {
  for (const p of PAPER_SIZES) {
    assert.equal(namePaper(p.w, p.h), p.name, `${p.name} portrait`);
    assert.equal(namePaper(p.h, p.w), p.name, `${p.name} landscape`);
  }
});

test('namePaper tolerates the rounding a CAD exporter introduces', () => {
  assert.equal(namePaper(209.9, 297.0), 'A4');
  assert.equal(namePaper(594.1, 840.8), 'A1');
});

test('namePaper describes a size it does not recognise', () => {
  assert.equal(namePaper(500, 700), '500×700 mm');
});

test('orientationOf reads width against height', () => {
  assert.equal(orientationOf(210, 297), 'portrait');
  assert.equal(orientationOf(297, 210), 'landscape');
  assert.equal(orientationOf(300, 300), 'square');
});

test('rejects a file that is not a PDF', async () => {
  const r = await readPdf(new TextEncoder().encode('This is a DWG, honestly'));
  assert.equal(r.ok, false);
  assert.equal(r.pageCount, 0);
  assert.match(r.warnings[0], /not a PDF/i);
});

test('rejects an empty file', async () => {
  const r = await readPdf(new Uint8Array(0));
  assert.equal(r.ok, false);
});

test('reads a single A4 portrait page', async () => {
  const r = await readPdf(makePdf([{ box: [210, 297] }]));
  assert.equal(r.ok, true);
  assert.equal(r.pageCount, 1);
  assert.equal(r.version, '1.4');
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].paper, 'A4');
  assert.equal(r.pages[0].orientation, 'portrait');
  assert.equal(r.pages[0].widthMm, 210);
});

test('reads a landscape page from its MediaBox', async () => {
  const r = await readPdf(makePdf([{ box: [841, 594] }]));
  assert.equal(r.pages[0].paper, 'A1');
  assert.equal(r.pages[0].orientation, 'landscape');
});

test('a /Rotate 90 turns a portrait MediaBox into a landscape sheet', async () => {
  const r = await readPdf(makePdf([{ box: [594, 841], rotate: 90 }]));
  assert.equal(r.pages[0].paper, 'A1');
  assert.equal(r.pages[0].orientation, 'landscape', 'missing /Rotate would report portrait');
  assert.equal(r.pages[0].rotate, 90);
});

test('/Rotate 180 leaves the orientation alone', async () => {
  const r = await readPdf(makePdf([{ box: [594, 841], rotate: 180 }]));
  assert.equal(r.pages[0].orientation, 'portrait');
});

test('a negative rotation is normalised', async () => {
  const r = await readPdf(makePdf([{ box: [594, 841], rotate: -90 }]));
  assert.equal(r.pages[0].rotate, 270);
  assert.equal(r.pages[0].orientation, 'landscape');
});

test('reads a mixed-size set page by page', async () => {
  const r = await readPdf(makePdf([
    { box: [841, 594] }, { box: [841, 594] }, { box: [420, 297] },
  ]));
  assert.equal(r.pageCount, 3);
  assert.deepEqual(r.pages.map((p) => p.paper), ['A1', 'A1', 'A3']);
  assert.deepEqual(r.pages.map((p) => p.orientation), ['landscape', 'landscape', 'landscape']);
});

test('tallies the distinct sizes with a count each', async () => {
  const r = await readPdf(makePdf([
    { box: [841, 594] }, { box: [841, 594] }, { box: [420, 297] },
  ]));
  assert.equal(r.sizes.length, 2);
  assert.deepEqual(r.sizes[0], { paper: 'A1', orientation: 'landscape', widthMm: 841, heightMm: 594, count: 2 });
  assert.equal(r.sizes[1].paper, 'A3');
  assert.equal(r.sizes[1].count, 1);
});

test('a size inherited from the page tree applies to every page', async () => {
  const r = await readPdf(makePdf([{}, {}, {}], { inheritBox: [841, 594] }));
  assert.equal(r.pageCount, 3);
  assert.equal(r.pages.length, 3);
  assert.ok(r.pages.every((p) => p.paper === 'A1' && p.orientation === 'landscape'));
});

test('reads page objects out of a Flate-compressed stream', async () => {
  const bytes = await makeCompressedPdf([
    { box: [841, 594] }, { box: [420, 297] },
  ]);
  const r = await readPdf(bytes);
  assert.equal(r.ok, true, r.warnings.join('; '));
  assert.equal(r.pageCount, 2);
  assert.deepEqual(r.pages.map((p) => p.paper), ['A1', 'A3']);
});

test('/Rotate survives decompression', async () => {
  const r = await readPdf(await makeCompressedPdf([{ box: [594, 841], rotate: 90 }]));
  assert.equal(r.pages[0].orientation, 'landscape');
});

test('says so plainly when the page tree cannot be read', async () => {
  const r = await readPdf(new TextEncoder().encode('%PDF-1.7\nnothing useful here\n%%EOF'));
  assert.equal(r.ok, false);
  assert.equal(r.pageCount, 0);
  assert.match(r.warnings[0], /page tree could not be read/i);
  assert.match(r.warnings[0], /rest of the report is unaffected/i);
});

test('reports pages found but no dimensions rather than inventing a size', async () => {
  const r = await readPdf(makePdf([{}, {}]));
  assert.equal(r.ok, false);
  assert.equal(r.pageCount, 2);
  assert.equal(r.pages.length, 0);
  assert.match(r.warnings[0], /no page dimensions/i);
});

test('/Type /Pages is not counted as a page', async () => {
  const r = await readPdf(makePdf([{ box: [210, 297] }]));
  assert.equal(r.pageCount, 1, 'the /Type /Pages node must not be counted');
});

test('warns instead of guessing when sizes and pages do not line up', async () => {
  // Two page objects but three MediaBoxes — the association is unknowable.
  const bytes = new TextEncoder().encode(
    '%PDF-1.4\n'
    + '2 0 obj << /Type /Pages /Count 2 /MediaBox [0 0 100 200] >> endobj\n'
    + `3 0 obj << /Type /Page /MediaBox [0 0 ${pt(210)} ${pt(297)}] >> endobj\n`
    + `4 0 obj << /Type /Page /MediaBox [0 0 ${pt(297)} ${pt(420)}] >> endobj\n`
    + '%%EOF\n',
  );
  const r = await readPdf(bytes);
  assert.equal(r.pageCount, 2);
  assert.equal(r.pages.length, 0);
  assert.ok(r.warnings.some((w) => /reported as a set/i.test(w)));
  assert.ok(r.sizes.length >= 2, 'the sizes are still reported');
});

test('accepts an ArrayBuffer as well as a Uint8Array', async () => {
  const bytes = makePdf([{ box: [210, 297] }]);
  const r = await readPdf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(r.ok, true);
  assert.equal(r.pages[0].paper, 'A4');
});

test('a degenerate MediaBox is ignored rather than reported as a sheet', async () => {
  const bytes = new TextEncoder().encode(
    '%PDF-1.4\n'
    + '3 0 obj << /Type /Page /MediaBox [0 0 0 0] >> endobj\n'
    + '%%EOF\n',
  );
  const r = await readPdf(bytes);
  assert.equal(r.ok, false);
  assert.match(r.warnings[0], /no page dimensions/i);
});
