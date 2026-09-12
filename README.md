# Sheet Check

Read the register before the set goes out.

[![CI](https://github.com/andreyruvi/sheet-check/actions/workflows/ci.yml/badge.svg)](https://github.com/andreyruvi/sheet-check/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**[Open the tool →](https://andreyruvi.github.io/sheet-check/)**

The drawings are finished, the set is going out in an hour, and the things
that actually come back are never the drawings: it's A-103 that nobody
exported, two sheets both numbered A-104, a title block with no scale in it,
and three sheets still sitting at revision B while everything else went to C.

Paste your sheet list, drop the PDF, and get those back as a list you can work
through. Nothing is uploaded — the register names a client and a site, so the
only sensible place to check one is your own machine.

## What it checks

**Numbering**

- Gaps in the sequence, reported in your own numbering (`A-103 is missing`,
  not `number 3`). Series are kept apart, so a gap in the elevations is not
  confused with the plans.
- Numbers used twice — and `A-101a` is correctly *not* a duplicate of `A-101`.
- Numbers it cannot read, quoted exactly as written with their line number.
  Nothing is silently corrected: a register is a record.
- Conformance to your own convention, which you describe rather than code:
  `@+-###` matches `A-101` and `AD-101`, `@+-###@?` also allows `A-101a`, and
  anything stranger can be a regular expression.
- Sheets listed out of sequence.

**Completeness**

- Required sheets that are not in the set. Matched however they are written,
  so `A101` and `A-101` count as the same sheet.
- The PDF's page count against the register's row count — the check that
  catches the sheet that never got exported.

**Title blocks**

- Blank sheet names, revisions, revision dates and scales. Only for columns
  your register actually has: an absent column is not an empty field.
- Scales that are not in a recognisable form, in case a field holds a note.

**Revisions**

- Sheets left behind the latest revision in the set.
- One revision carrying two different dates, which usually means a sheet was
  re-issued without its revision being bumped.
- Letter and number revisions mixed together: reported as unrankable rather
  than guessed at.

**Paper, read straight out of the PDF**

- Page count, each page's paper size (A0–A5, Letter, Legal, Tabloid, ARCH A–E)
  and its orientation, with `/Rotate` honoured — miss that and every rotated
  landscape sheet reads as portrait.
- Mixed paper sizes, and mixed orientation within one size.

## What it does not do

This matters more than the list above.

- **It does not read the drawings.** It reads a register and a PDF's page
  geometry. It cannot tell you whether a dimension is right, whether a
  detail is coordinated, or whether the sheet is the right sheet.
- **A clean report is not an approval.** Every report says which checks ran
  *and which did not*, because a report that lists six findings and stays
  silent about the eight checks it skipped reads like a clean bill of health.
- **It does not extract text from the PDF.** Only the page tree and each
  page's MediaBox. Pulling title-block text out of a CAD export means font
  encodings and custom subsets, and a parser that gets it 80% right produces
  confident wrong answers — so it is not attempted.
- **It does not know your ordinance.** It checks the convention and the
  required sheets *you* give it. It does not encode anybody's standard, and
  it should not start pretending to.
- **A gap is not automatically a mistake.** A withdrawn sheet leaves one. The
  tool flags it; the judgement is yours.

## Use it

Nothing to install — [open the hosted version](https://andreyruvi.github.io/sheet-check/),
paste, and read. Your convention and required-sheet list are remembered
between visits; **the register itself is never stored**, because it is the
confidential part.

To run it locally:

```sh
git clone https://github.com/andreyruvi/sheet-check.git
cd sheet-check
npm run serve      # then open http://localhost:8080
```

Use the server rather than opening `index.html` directly. The page is built
from ES modules, and browsers refuse to load a module over `file://` — you get
a CORS error and a blank tool. `npm run serve` is thirty lines of `node:http`
with no dependencies.

## Getting a sheet list out of your software

| | How |
| --- | --- |
| **Revit** | View → Schedules → Sheet List, then Export → Reports → Schedule. Any columns work; Sheet Number, Sheet Name, Current Revision and Current Revision Date are recognised by name. |
| **ArchiCAD** | Navigator → Layout Book → publish the Layout list, or copy the layout names straight out of the Navigator. |
| **AutoCAD** | Sheet Set Manager → Publish → Sheet List Table, or paste the sheet-number column out of a spreadsheet. |
| **Anything else** | Paste the numbers, one per line. That alone gets you the gap, duplicate and convention checks. |

The separator, the heading row and the meaning of each column are all worked
out for you — and the report says what it assumed, so you can see when it
guessed wrong.

## Development

```sh
npm test           # 149 tests, no dependencies
npm run serve      # local static server on :8080
```

The tests are the specification.

```
src/engine/numbering.js      sheet numbers, sequences, convention patterns
src/engine/index-parser.js   delimiter, heading and column detection
src/engine/pdf.js            page count and paper sizes, with no library
src/engine/checks.js         the rules, each returning findings not verdicts
src/engine/report.js         CSV and Markdown exports
src/ui/render.js             the report, as real document text
src/ui/files.js              drop, read, download, remember settings
src/main.js                  wiring
```

The PDF reader is the part worth reading. It handles Flate-compressed object
streams, because that is how most modern CAD exporters write the page tree and
without it the reader finds nothing; and it honours `/Length` when locating
stream data, because the spec permits an EOL before `endstream` and
`DecompressionStream` refuses a stream with even one trailing byte. It has
been checked against PDFs from two different generators, with and without
object streams, and it says so plainly when it cannot read a file rather than
guessing a page size.

`test/markup.test.js` checks the contract between the page and the scripts:
every `data-` hook the JavaScript queries has to exist in `index.html`, every
named control has to be read, every button action has to have a handler, every
severity needs a dark-theme colour, and the print sheet has to mark severity
with a symbol as well as a colour. A rename that would blank a panel fails the
suite instead of silently blanking it in someone's browser.

## Accessibility

The report is document text, not a picture of one — selectable, printable and
readable by a screen reader. Status messages go through a polite live region,
every control has a bound label, there is a skip link to the report, and the
page respects `prefers-reduced-motion` and `prefers-color-scheme`. In print,
severity is marked with a symbol as well as a colour, so a black-and-white
copy still says which findings matter.

## Provenance

Sheet Check is original work. It is not a fork, a template or a rebrand: no
third-party code, no dependencies, nothing vendored. If you find something in
here that you believe is yours, please
[open an issue](https://github.com/andreyruvi/sheet-check/issues) and it will
be addressed properly.

## Licence

[MIT](LICENSE) © 2026 Duong L.
