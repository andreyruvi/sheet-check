/**
 * Sheet numbers.
 *
 * Every office numbers sheets slightly differently — `A-101`, `A101`,
 * `A-1.01`, `AD-101a` — so the parser is deliberately permissive about the
 * shape and strict about what it reports. It never silently "corrects" a
 * number: an unparseable one comes back marked invalid, with the raw text
 * intact, because a drawing register is a legal record and quietly rewriting
 * an entry in it would be worse than flagging it.
 */

/**
 * Split a sheet number into its parts.
 *
 * @param {string} text
 * @returns {{
 *   raw: string, valid: boolean, discipline: string|null, body: string|null,
 *   series: string|null, number: number|null, suffix: string|null,
 *   normalised: string|null, reason: string|null
 * }}
 */
export function parseSheetNumber(text) {
  const raw = String(text ?? '');
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, ' ');

  const miss = (reason) => ({
    raw, valid: false, discipline: null, body: null, series: null,
    number: null, suffix: null, normalised: null, reason,
  });

  if (!cleaned) return miss('empty');

  // Discipline letters, an optional separator, digits (possibly dotted), an
  // optional short alphabetic suffix for an inserted sheet.
  const match = cleaned.match(/^([A-Z]{1,3})[\s\-_.]?(\d{1,4}(?:\.\d{1,3})*)([A-Z]{1,2})?$/);
  if (!match) return miss('does not look like <letters><digits>');

  const [, discipline, body, suffixRaw] = match;
  const parts = body.split('.');

  let series = null;
  let number = null;
  if (parts.length >= 2) {
    // A-1.01 — the series is written out explicitly.
    series = parts[0];
    number = Number(parts[1]);
  } else if (parts[0].length >= 3) {
    // A-101 — by long convention the leading digit is the series.
    series = parts[0][0];
    number = Number(parts[0].slice(1));
  } else {
    // A-1 or A-01 — no series in the number at all.
    number = Number(parts[0]);
  }

  if (!Number.isFinite(number)) return miss('digits could not be read');

  const suffix = suffixRaw || null;
  return {
    raw,
    valid: true,
    discipline,
    body,
    series,
    number,
    suffix,
    normalised: `${discipline}-${body}${suffix || ''}`,
    reason: null,
  };
}

/** The group a sheet belongs to for sequence purposes: discipline plus series. */
export function seriesKey(parsed) {
  if (!parsed.valid) return null;
  return parsed.series === null ? parsed.discipline : `${parsed.discipline}-${parsed.series}`;
}

/**
 * Turn a friendly convention template into a matcher.
 *
 * `@` is one letter and `@+` one or more; `#` is one digit and `#+` one or
 * more; `?` makes the preceding token optional; everything else is literal.
 * A template is used rather than a raw regex because the people who need this
 * check are drafters, not programmers — but `custom:` passes a regex straight
 * through for anyone who wants one.
 */
export function conventionToRegex(template) {
  const text = String(template ?? '').trim();
  if (!text) return null;
  if (text.startsWith('custom:')) {
    try {
      return new RegExp(`^${text.slice(7)}$`, 'i');
    } catch {
      return null;
    }
  }

  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const plus = text[i + 1] === '+';
    const optional = text[plus ? i + 2 : i + 1] === '?';
    let token;
    if (ch === '@') token = plus ? '[A-Za-z]+' : '[A-Za-z]';
    else if (ch === '#') token = plus ? '\\d+' : '\\d';
    else token = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (optional) token = `(?:${token})?`;
    out += token;
    if (plus) i += 1;
    if (optional) i += 1;
  }
  return new RegExp(`^${out}$`, 'i');
}

export const CONVENTION_PRESETS = Object.freeze([
  { label: 'A-101', template: '@+-###', note: 'discipline, dash, three digits' },
  { label: 'A101', template: '@+###', note: 'no separator' },
  { label: 'A-1.01', template: '@+-#.##', note: 'series and number separated by a dot' },
  { label: 'A-101a', template: '@+-###@?', note: 'three digits, optional inserted-sheet letter' },
]);

/**
 * Find gaps, duplicates and out-of-order numbers within each series.
 *
 * A "gap" is a missing number between the lowest and highest in that series —
 * the tool never assumes a series should start at 1, because plenty of sets
 * legitimately begin at A-101 or A-110.
 */
export function analyseSequence(parsedList) {
  const groups = new Map();
  for (const p of parsedList) {
    const key = seriesKey(p);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const result = [];
  for (const [key, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const numbers = members.map((m) => m.number);
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const lowest = unique[0];
    const highest = unique[unique.length - 1];

    const gaps = [];
    for (let n = lowest + 1; n < highest; n += 1) {
      if (!unique.includes(n)) gaps.push(n);
    }

    // A duplicate only counts when the whole number, suffix included, repeats:
    // A-101 and A-101a are two legitimate sheets.
    const seen = new Map();
    const duplicates = [];
    for (const m of members) {
      const id = m.normalised;
      if (seen.has(id)) { if (!duplicates.includes(id)) duplicates.push(id); }
      else seen.set(id, m);
    }

    result.push({
      key,
      discipline: members[0].discipline,
      series: members[0].series,
      count: members.length,
      lowest,
      highest,
      gaps,
      duplicates,
      // Rendered back into the office's own numbering, so the report says
      // "A-103 is missing" rather than "number 3 is missing".
      missingLabels: gaps.map((n) => renderNumber(members[0], n)),
    });
  }
  return result;
}

/** Render a number back in the same shape as its neighbours. */
export function renderNumber(sample, number) {
  const { discipline, series, body } = sample;
  if (series === null) {
    const width = body.length;
    return `${discipline}-${String(number).padStart(width, '0')}`;
  }
  if (body.includes('.')) {
    const width = body.split('.')[1].length;
    return `${discipline}-${series}.${String(number).padStart(width, '0')}`;
  }
  const width = body.length - String(series).length;
  return `${discipline}-${series}${String(number).padStart(width, '0')}`;
}

/** Are the sheets listed in the order their numbers imply? */
export function findOutOfOrder(parsedList) {
  const out = [];
  for (let i = 1; i < parsedList.length; i += 1) {
    const prev = parsedList[i - 1];
    const cur = parsedList[i];
    if (!prev.valid || !cur.valid) continue;
    if (seriesKey(prev) !== seriesKey(cur)) continue;
    if (cur.number < prev.number) {
      out.push({ after: prev.normalised, sheet: cur.normalised, position: i });
    }
  }
  return out;
}
