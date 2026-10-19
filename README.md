# PDF Desk

Merge, split, rotate and reorder PDF pages in the browser. Nothing is uploaded,
nothing is installed, and the page works offline once it has loaded.

Live: <https://freehtml.dev/pdf> · Source: <https://github.com/TekiDeki/PDF-Desk>

## What it does

- **Merge** any number of PDFs, JPGs and PNGs into one file, in the order you choose.
- **Reorder** files, and reorder pages inside them.
- **Rotate** a page a quarter at a time. Rotation is added on top of whatever the
  page already had, so a scan that was sideways in the original comes out straight.
- **Delete** pages you do not want in the result.
- **Extract** a page range, in your own order, with repeats if you want them,
  for example `1-3, 5, 8-10` or `4, 1, 1`.
- **Turn images into pages**: one image per page, on A4, on Letter, or at the
  picture's own size.
- **Undo**, twenty steps back, for anything done to the page list.

Everything happens in the tab. There is no server, no account and no analytics.

## What it does not do

- No password removal. Encrypted PDFs are refused, not cracked.
- No text editing. Pages are moved and turned, never rewritten.
- No OCR. A scan stays a picture.

These are limits, not bugs. They are also on the page itself, so nobody is
surprised after the work is done.

## Using it

1. Drop PDFs or images on the box, or press *Choose files*.
2. Fix the order: arrows on each file, click a page to turn it, cross to delete it.
3. Press *Merge and download*. Or write a range and press *Download these pages*.

The merge and the extract both start from the page list you see on screen, so
the extract can be used to save a corrected copy without downloading the whole
document first.

## Development

```bash
python3 build.py                  # writes index.html, single file, deterministic
node tests/logic_test.cjs         # 68 checks: engine and real PDF work, no browser
python3 tests/ui_test.py          # 63 checks: desktop, touch tablet and touch phone
```

`tests/logic_test.cjs` needs the library installed next to the repo:

```bash
npm install pdf-lib@1.17.1
```

The UI test starts its own static server, so nothing else has to be running.

## Files

| Path | What it is |
|---|---|
| `src/template.html` | the page skeleton, with the three script slots |
| `src/styles.css` | all the styling, no framework |
| `src/engine.js` | pure functions plus the two PDF operations, no DOM |
| `src/app.js` | the interface: files, pages, language, downloads |
| `src/vendor/pdf-lib.min.js` | pdf-lib 1.17.1, MIT, inlined at build time |
| `src/i18n/locales.json` | EN, RO and SR Latin; SR Cyrillic is generated |
| `build.py` | inlines everything into `index.html` and checks the rules |
| `index.html` | the built page, committed, served by GitHub Pages |
| `sw.js` | offline shell |
| `tests/fixtures/` | PDFs and images used by the tests, including one encrypted and one corrupted on purpose |

## Languages

Four: English, Romanian, Serbian Latin and Serbian Cyrillic. Romanian and
Serbian Latin are written by hand; Serbian Cyrillic is produced by the build
from the Latin one, so the two can never disagree. The build refuses a missing
key, a placeholder that does not match between languages, an em dash, an en
dash or a byte order mark.

Language detection uses `navigator.language`, the choice is remembered in
`localStorage`, and the page name is kept there too.

## Limits worth knowing

- A very large PDF can run out of memory on a phone. The page says so instead of
  failing quietly. Measured on this build: three 20 page scans of 4.7 MB each
  (14.1 MB of output, 60 pages) merge in about 0.4 s in a phone sized window.
- The page shows the first 400 pages as tiles. Every page is kept in the file,
  the cap is only about drawing them.
- Images are placed whole, without cropping or margins control.

## Licence

Apache-2.0. The bundled pdf-lib is MIT, by Andrew Dillon; its notice is in
`src/vendor/`.

Built by [TekiDeki](https://freehtml.dev). Free, no account, no tracking.
If it saved you some time: <https://paypal.me/TekiDeki>
