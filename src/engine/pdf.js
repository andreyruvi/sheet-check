/**
 * Reading paper sizes out of a PDF, with no library.
 *
 * This is deliberately a *narrow* reader. It does not extract text, fonts or
 * geometry — only the page count and each page's MediaBox, which is what a
 * paper-size and orientation check needs. A full PDF parser is a large piece
 * of software, and pretending to be one would produce confident wrong answers
 * on the CAD exports this tool is aimed at.
 *
 * The two things it does handle properly:
 *  - Flate-compressed object streams (PDF 1.5+), which is how most modern CAD
 *    exporters write the page tree. Without this the reader finds nothing.
 *  - /Rotate, which swaps a page's effective orientation without changing its
 *    MediaBox — miss it and every rotated landscape sheet reads as portrait.
 *
 * Where it cannot be sure which size belongs to which page, it says so rather
 * than guessing: `pages` is filled in only when the MediaBox count matches the
 * page count, and `sizes` always reports the distinct sizes it found.
 */

const PT_TO_MM = 25.4 / 72;

/** Named paper sizes in millimetres, portrait. */
export const PAPER_SIZES = Object.freeze([
  { name: 'A0', w: 841, h: 1189 },
  { name: 'A1', w: 594, h: 841 },
  { name: 'A2', w: 420, h: 594 },
  { name: 'A3', w: 297, h: 420 },
  { name: 'A4', w: 210, h: 297 },
  { name: 'A5', w: 148, h: 210 },
  { name: 'Letter', w: 216, h: 279 },
  { name: 'Legal', w: 216, h: 356 },
  { name: 'Tabloid', w: 279, h: 432 },
  { name: 'ARCH A', w: 229, h: 305 },
  { name: 'ARCH B', w: 305, h: 457 },
  { name: 'ARCH C', w: 457, h: 610 },
  { name: 'ARCH D', w: 610, h: 914 },
  { name: 'ARCH E1', w: 762, h: 1067 },
  { name: 'ARCH E', w: 914, h: 1219 },
]);

/** Name a size from its millimetre dimensions, or describe it if unnamed. */
export function namePaper(widthMm, heightMm, tolerance = 2.5) {
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  for (const p of PAPER_SIZES) {
    if (Math.abs(short - p.w) <= tolerance && Math.abs(long - p.h) <= tolerance) return p.name;
  }
  return `${Math.round(widthMm)}×${Math.round(heightMm)} mm`;
}

export function orientationOf(widthMm, heightMm) {
  if (Math.abs(widthMm - heightMm) < 1) return 'square';
  return widthMm > heightMm ? 'landscape' : 'portrait';
}

/** Inflate a raw deflate/zlib stream. Returns null when it cannot be inflated. */
async function inflate(bytes) {
  const tryFormat = async (format) => {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  };
  return (await tryFormat('deflate')) || (await tryFormat('deflate-raw'));
}

function latin1(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return out;
}

/** Every `/MediaBox [a b c d]` in a string, as width/height in points. */
function findMediaBoxes(text) {
  const out = [];
  const re = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
  let m = re.exec(text);
  while (m) {
    const [x0, y0, x1, y1] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    if (w > 1 && h > 1) out.push({ widthPt: w, heightPt: h, at: m.index });
    m = re.exec(text);
  }
  return out;
}

/** Page objects, in the order they appear, with any /Rotate that applies. */
function findPageObjects(text) {
  const out = [];
  // `/Type /Page` but not `/Type /Pages`.
  const re = /\/Type\s*\/Page(?![s\w])/g;
  let m = re.exec(text);
  while (m) {
    // Look at a window around the key for the dictionary's own entries.
    const from = Math.max(0, m.index - 700);
    const window = text.slice(from, m.index + 700);
    const rotate = window.match(/\/Rotate\s+(-?\d+)/);
    out.push({ at: m.index, rotate: rotate ? ((Number(rotate[1]) % 360) + 360) % 360 : 0 });
    m = re.exec(text);
  }
  return out;
}

/**
 * Decompress every Flate stream in the file and return the text of each.
 *
 * Finding the exact end of the stream data matters more than it looks. The
 * spec allows an EOL between the data and the `endstream` keyword, and
 * DecompressionStream refuses a stream with even one trailing byte — so
 * searching for `endstream` and stopping there silently fails on
 * spec-conformant files. `/Length` is the authoritative answer when it is a
 * literal number; the keyword search, with the EOL trimmed off, is the
 * fallback for the indirect-length case.
 */
async function inflatedSections(bytes, text) {
  const sections = [];
  const re = /\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/g;
  let m = re.exec(text);
  while (m) {
    const streamAt = text.indexOf('stream', m.index);
    if (streamAt !== -1 && streamAt - m.index < 900) {
      let start = streamAt + 'stream'.length;
      if (text[start] === '\r') start += 1;
      if (text[start] === '\n') start += 1;

      // The dictionary this stream belongs to starts before the /Filter key.
      const dictFrom = Math.max(0, m.index - 900);
      const dict = text.slice(dictFrom, streamAt);
      const lengthMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);

      let end = -1;
      if (lengthMatch) {
        const candidate = start + Number(lengthMatch[1]);
        if (candidate <= bytes.length) end = candidate;
      }
      if (end === -1) {
        end = text.indexOf('endstream', start);
        // Trim the EOL the spec permits between the data and the keyword.
        while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
      }

      if (end > start) {
        const inflated = await inflate(bytes.subarray(start, end));
        if (inflated) sections.push(latin1(inflated));
      }
    }
    m = re.exec(text);
  }
  return sections;
}

/**
 * Read a PDF's page count and paper sizes.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {Promise<{ok:boolean, pageCount:number, pages:Array, sizes:Array, warnings:string[], version:string|null}>}
 */
export async function readPdf(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const warnings = [];

  if (bytes.length < 8 || latin1(bytes.subarray(0, 5)) !== '%PDF-') {
    return { ok: false, pageCount: 0, pages: [], sizes: [], warnings: ['This is not a PDF file.'], version: null };
  }

  const head = latin1(bytes.subarray(0, 16));
  const version = (head.match(/%PDF-(\d\.\d)/) || [null, null])[1];
  const text = latin1(bytes);

  let pageObjects = findPageObjects(text);
  let mediaBoxes = findMediaBoxes(text);

  // Modern exporters put the page tree inside compressed object streams, where
  // none of the above is visible in the raw bytes.
  if (!pageObjects.length || !mediaBoxes.length) {
    const sections = await inflatedSections(bytes, text);
    for (const section of sections) {
      if (!pageObjects.length) pageObjects = pageObjects.concat(findPageObjects(section));
      if (!mediaBoxes.length) mediaBoxes = mediaBoxes.concat(findMediaBoxes(section));
    }
  }

  const pageCount = pageObjects.length;
  if (!pageCount) {
    return {
      ok: false, pageCount: 0, pages: [], sizes: [], version,
      warnings: ['The page tree could not be read from this PDF. Paper-size checks are skipped; the rest of the report is unaffected.'],
    };
  }
  if (!mediaBoxes.length) {
    return {
      ok: false, pageCount, pages: [], sizes: [], version,
      warnings: [`Found ${pageCount} pages but no page dimensions, so paper size cannot be checked.`],
    };
  }

  const describe = (widthPt, heightPt, rotate = 0) => {
    const swap = rotate === 90 || rotate === 270;
    const wPt = swap ? heightPt : widthPt;
    const hPt = swap ? widthPt : heightPt;
    const widthMm = Math.round(wPt * PT_TO_MM * 10) / 10;
    const heightMm = Math.round(hPt * PT_TO_MM * 10) / 10;
    return {
      widthPt: Math.round(wPt * 10) / 10,
      heightPt: Math.round(hPt * 10) / 10,
      widthMm,
      heightMm,
      rotate,
      orientation: orientationOf(widthMm, heightMm),
      paper: namePaper(widthMm, heightMm),
    };
  };

  const pages = [];
  if (mediaBoxes.length === pageCount) {
    for (let i = 0; i < pageCount; i += 1) {
      pages.push({ index: i + 1, ...describe(mediaBoxes[i].widthPt, mediaBoxes[i].heightPt, pageObjects[i].rotate) });
    }
  } else if (mediaBoxes.length === 1) {
    // One MediaBox on the page tree, inherited by every page.
    const rotates = new Set(pageObjects.map((p) => p.rotate));
    if (rotates.size === 1) {
      for (let i = 0; i < pageCount; i += 1) {
        pages.push({ index: i + 1, ...describe(mediaBoxes[0].widthPt, mediaBoxes[0].heightPt, pageObjects[0].rotate) });
      }
    } else {
      warnings.push('Every page shares one size but their rotations differ, so orientation is reported per size rather than per page.');
    }
  } else {
    warnings.push(`Found ${pageCount} pages but ${mediaBoxes.length} page sizes, so sizes are reported as a set rather than per page.`);
  }

  // The distinct sizes present, with how many pages use each.
  const tally = new Map();
  const source = pages.length ? pages : mediaBoxes.map((b) => describe(b.widthPt, b.heightPt, 0));
  for (const p of source) {
    const key = `${p.paper}|${p.orientation}`;
    if (!tally.has(key)) tally.set(key, { paper: p.paper, orientation: p.orientation, widthMm: p.widthMm, heightMm: p.heightMm, count: 0 });
    tally.get(key).count += 1;
  }
  const sizes = [...tally.values()].sort((a, b) => b.count - a.count);

  return { ok: true, pageCount, pages, sizes, warnings, version };
}
