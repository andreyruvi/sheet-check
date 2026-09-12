# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-11

First release.

### Added

- **Sheet-number parsing** across the forms offices actually use — `A-101`,
  `A101`, `A-1.01`, `AD-101a`, `S-7` — splitting each into discipline, series,
  number and suffix. An unreadable number comes back marked invalid with its
  raw text intact; nothing is silently corrected, because a register is a
  record.
- **Sequence analysis** per discipline and series: gaps rendered back in the
  office's own numbering, duplicates (where `A-101a` is correctly not a
  duplicate of `A-101`), and sheets listed out of order. A series is never
  assumed to start at 1.
- **Convention patterns** described rather than coded: `@` is a letter, `#` a
  digit, `+` means one or more, `?` makes a token optional, and `custom:`
  passes a regular expression through.
- **Index parsing** that detects the delimiter (comma, tab, semicolon, pipe or
  whitespace), whether the first row is headings, and what each column means —
  by header wording *and* by sniffing the content, since a pasted column often
  has no header and export headers are localised. What it decided is always
  reported back.
- **A PDF reader with no library**: page count, each page's paper size (A0–A5,
  Letter, Legal, Tabloid, ARCH A–E) and orientation, honouring `/Rotate` and
  reading Flate-compressed object streams. It reports plainly when it cannot
  read a file instead of guessing.
- **Checks**, each returning findings with a severity rather than a verdict:
  numbering gaps, duplicates, unreadable numbers, convention breaches and
  ordering; required sheets absent from the set; blank sheet names, revisions,
  dates and scales; sheets behind the latest revision; one revision carrying
  two dates; unrankable revision schemes; unrecognisable scales; PDF page
  count against the register; mixed paper sizes and orientations.
- **Reports** as Markdown (for an email or an issue) and CSV (for a
  spreadsheet), both carrying what was found, what was checked, and what was
  *not* checked.
- **An A4 print sheet** — the report alone, black on white, with severity
  marked by a symbol as well as a colour so a photocopy still reads.
- **149 tests**, including a contract test that derives every `data-` hook,
  named control, button action and palette token from the source and checks
  them against the page and the stylesheet.
- Light and dark themes, a polite live region for status, labels bound to every
  control, a skip link, and `prefers-reduced-motion` respected.
- `npm run serve`, a dependency-free static server, because ES modules do not
  load over `file://`.

### Notes

- Nothing is uploaded. The convention and required-sheet list are remembered
  locally; the register itself is deliberately never stored.
- No runtime dependencies and no build step. What is in the repository is what
  the browser runs.
- Original work: not a fork, a template or a rebrand, and nothing vendored.
- The tool reads a register and a PDF's page geometry. It does not read the
  drawings, and a clean report is not an approval — every report says so.
