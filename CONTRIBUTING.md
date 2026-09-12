# Contributing

Thanks for looking. This is a small, deliberately plain project, and the
constraints below are what keep it small.

## The constraints

1. **No runtime dependencies.** Not one. The tool has to load from a static
   host, work offline, and still open in five years.
2. **No build step.** What is in the repository is what the browser runs.
3. **Nothing leaves the machine.** No uploads, no analytics, no fonts from a
   CDN. A drawing register names a client and a site; that is not data to send
   anywhere. The register is not even written to local storage.
4. **The engine stays pure.** Anything under `src/engine/` takes values and
   returns values — no DOM, no globals. That is what makes it testable.
5. **A check reports, it does not judge.** Rules return findings with a
   severity, never a pass or a fail. A gap in the numbering may be a withdrawn
   sheet; mixed paper may be a schedule. The tool flags, the reader decides.
6. **Say what was not checked.** Every report lists the checks that were
   skipped and why. A report that stays silent about them reads as a clean
   bill of health and isn't one.
7. **Never silently correct the register.** An unreadable entry is reported
   verbatim. Quietly rewriting a row in a drawing register would be worse than
   flagging it.

## Getting set up

```sh
git clone https://github.com/andreyruvi/sheet-check.git
cd sheet-check
npm test           # the whole suite, no install needed
npm run serve      # http://localhost:8080
```

There is no `npm install` because there is nothing to install. Node 20 or
newer is required for the built-in test runner.

Open the page through the server, not by double-clicking `index.html`: ES
modules do not load over `file://`.

## Tests

The tests are the specification, so a change to behaviour is a change to a
test.

```sh
npm test                                # everything
node --test test/pdf.test.js            # one file
```

What good coverage looks like here:

- **Parsing**: pin the actual parsed parts, not just that something parsed.
  `series === '2'` says more than `valid === true`.
- **Findings**: assert the severity, the wording and the sheets named. A
  finding that names the wrong sheet is worse than no finding.
- **The PDF reader**: build a fixture in the test rather than committing a
  binary. `test/pdf.test.js` writes minimal PDFs by hand, including one whose
  page objects sit inside a `CompressionStream('deflate')` stream — no
  dependency needed, and it exercises the path real CAD exports take.
- **Negative cases**: what the tool refuses to guess is as important as what
  it reports. A mixed letter/number revision scheme must come back
  *unrankable*, not ranked.
- **Markup**: if you add a `data-` hook or a named control, the contract test
  is already checking it. If you remove one, remove it from both sides.

CI runs the suite on Node 20, 22 and 24, and separately asserts that the
repository declares no dependencies, loads nothing from another host,
references no missing file, and contains no leftover `console.log`.

## Adding a check

A new rule needs four things:

1. A **category** slug, so it can be found in an exported CSV.
2. A **severity**: `error` only for something that should stop an issue,
   `warning` for something worth looking at, `note` for something worth
   knowing. Most things are warnings.
3. A **detail** sentence saying why it might matter *and* when it legitimately
   might not. Look at the existing ones — every warning admits its own
   false-positive case.
4. Either an entry in `checked` when it ran, or an entry in `skipped` with the
   reason when it did not.

Then tests: one that fires it, one that does not, and one for the case where
the information it needs is absent.

## Reporting a problem

For a wrong finding, the useful report is the register that produced it —
anonymised is fine, the shape is what matters — plus what you expected. That
is enough to write a failing test from, which is the first thing that will
happen.

For a PDF the reader cannot read, say which software exported it and what it
reported. The reader is narrow on purpose, and knowing which exporters it
misses is how it gets less narrow.

## What is out of scope

Some things are not oversights:

- **Reading text out of the PDF.** Title-block text in a CAD export means font
  subsets and custom encodings. A parser that gets it 80% right produces
  confident wrong answers about a legal document.
- **Encoding anyone's standard.** The tool checks the convention and required
  sheets you give it. Built-in standards would be wrong somewhere on day one.
- **Opening DWG or RVT files.** Those are the authoring tools' job.
- **Anything that phones home.** See constraint 3.
