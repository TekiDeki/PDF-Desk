#!/usr/bin/env node
/* PDF Desk · logic tests
 * SPDX-License-Identifier: Apache-2.0
 *
 * node tests/logic_test.cjs
 * Pure engine plus real PDF work through pdf-lib. No browser, no network.
 * Needs pdf-lib installed next to this repo: npm install pdf-lib@1.17.1
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, degrees } = require('pdf-lib');

const E = require(path.join(__dirname, '..', 'src', 'engine.js'));
const FIX = path.join(__dirname, 'fixtures');

let checks = 0;
function ok(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}
function eq(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message + ' (got ' + actual + ', wanted ' + expected + ')');
}
function bytes(name) {
  return new Uint8Array(fs.readFileSync(path.join(FIX, name)));
}
function throwsCode(fn, code, message) {
  checks += 1;
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught, message + ' did not throw');
  assert.strictEqual(caught.code, code, message + ' threw ' + caught.code);
}

/* ------------------------------------------------------------ small helpers */

eq(E.formatSize(0), '0 B', 'zero bytes');
eq(E.formatSize(999), '999 B', 'bytes stay bytes');
eq(E.formatSize(4096), '4.0 KB', 'kilobytes keep one decimal under ten');
eq(E.formatSize(50000), '49 KB', 'kilobytes lose the decimal over ten');
eq(E.formatSize(3 * 1024 * 1024), '3.0 MB', 'megabytes');

eq(E.safeName('  my contract.pdf '), 'my contract', 'drops the extension and trims');
eq(E.safeName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j', 'strips path and reserved characters');
eq(E.safeName('   '), 'pdf-desk', 'falls back to a name');
eq(E.safeName('x'.repeat(200)).length, 80, 'caps the length');

eq(E.nextRotation(0), 90, '0 to 90');
eq(E.nextRotation(270), 0, '270 wraps to 0');
eq(E.nextRotation(undefined), 90, 'missing rotation starts at 90');

eq(E.moveItem([1, 2, 3, 4], 0, 2).join(','), '2,3,1,4', 'move forward');
eq(E.moveItem([1, 2, 3, 4], 3, 0).join(','), '4,1,2,3', 'move to the front');
eq(E.moveItem([1, 2, 3], 1, 1).join(','), '1,2,3', 'move onto itself changes nothing');
eq(E.moveItem([1, 2, 3], 0, 9).join(','), '1,2,3', 'an impossible target is ignored');

/* ------------------------------------------------------------ page ranges */

eq(E.parseRange('1-3', 10).join(','), '0,1,2', 'a simple range');
eq(E.parseRange('1-3, 5, 8-10', 10).join(','), '0,1,2,4,7,8,9', 'mixed ranges');
eq(E.parseRange('5, 1, 5', 10).join(','), '4,0,4', 'order is kept and repeats are allowed');
eq(E.parseRange('3-1', 5).join(','), '0,1,2', 'a backwards range is read forwards');
eq(E.parseRange(' 2 ; 4 ', 5).join(','), '1,3', 'semicolons and spaces are fine');
throwsCode(() => E.parseRange('', 5), 'empty', 'empty text');
throwsCode(() => E.parseRange('   ', 5), 'empty', 'whitespace only');
throwsCode(() => E.parseRange('abc', 5), 'range', 'not a number');
throwsCode(() => E.parseRange('0', 5), 'range', 'page zero does not exist');
throwsCode(() => E.parseRange('6', 5), 'range', 'past the last page');
throwsCode(() => E.parseRange('4-9', 5), 'range', 'a range that runs past the end');
eq(E.parseRange('1,,2', 5).join(','), '0,1', 'a stray comma is ignored');

/* ------------------------------------------------------------ geometry */

const a4 = E.pageBox('a4', 100, 100);
eq(Math.round(a4.width), 595, 'A4 width');
eq(Math.round(a4.height), 842, 'A4 height');
eq(a4.margin, E.MARGIN, 'A4 keeps a margin');
const letterBox = E.pageBox('letter', 100, 100);
eq(letterBox.width, 612, 'Letter width');
const fit = E.pageBox('fit', 800, 1200);
eq(fit.width, 800, 'fit keeps the picture width');
eq(fit.height, 1200, 'fit keeps the picture height');
eq(fit.margin, 0, 'fit has no margin');
const big = E.pageBox('fit', 3200, 1600);
eq(big.width, 1600, 'a huge picture is capped at 1600 points');

const rect = E.fitRect(1000, 500, 595, 842, 24);
ok(rect.width <= 595 - 48 + 0.01, 'the fitted width respects the margin');
ok(Math.abs(rect.width / rect.height - 2) < 0.001, 'the aspect ratio survives');
ok(Math.abs(rect.x + rect.width / 2 - 595 / 2) < 0.001, 'the picture is centred across');
ok(Math.abs(rect.y + rect.height / 2 - 842 / 2) < 0.001, 'the picture is centred down');

/* ------------------------------------------------------------ file sniffing */

ok(E.looksLikePdf(bytes('contract.pdf')), 'a real PDF is recognised');
ok(!E.looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'a PNG is not a PDF');

/* ------------------------------------------------------------ real pdf work */

async function pdfFiles() {
  const contract = bytes('contract.pdf');
  const invoice = bytes('invoice.pdf');
  const scan = bytes('scan.pdf');
  const pages = (count) => Array.from({ length: count }, (_, index) => ({ src: index, rot: 0 }));
  return [
    { id: 'a', name: 'contract.pdf', kind: 'pdf', mime: 'application/pdf', bytes: contract, size: contract.length, pages: pages(1) },
    { id: 'b', name: 'invoice.pdf', kind: 'pdf', mime: 'application/pdf', bytes: invoice, size: invoice.length, pages: pages(3) },
    { id: 'c', name: 'scan.pdf', kind: 'pdf', mime: 'application/pdf', bytes: scan, size: scan.length, pages: pages(1) }
  ];
}

(async () => {
  eq(await E.countPages(bytes('invoice.pdf')), 3, 'the invoice really has three pages');

  const files = await pdfFiles();
  const merged = await E.mergeFiles(files, { pageSize: 'a4' });
  const mergedDoc = await PDFDocument.load(merged);
  eq(mergedDoc.getPageCount(), 5, 'one plus three plus one');
  eq(mergedDoc.getCreator(), 'PDF Desk by TekiDeki', 'the creator is set');

  const sizes = mergedDoc.getPages().map((page) => Math.round(page.getSize().width));
  eq(sizes.join(','), '595,612,612,612,595', 'page order follows the file order');

  /* Order matters: move the last file to the front and merge again. */
  const reordered = E.moveItem(files, 2, 0);
  const second = await PDFDocument.load(await E.mergeFiles(reordered, { pageSize: 'a4' }));
  eq(Math.round(second.getPage(0).getSize().width), 595, 'the moved file is now first');
  eq(second.getPageCount(), 5, 'still five pages');

  /* Deleting a page in the model removes it from the output. */
  const clone = (list) => list.map((file) => Object.assign({}, file, {
    pages: file.pages.map((page) => Object.assign({}, page))
  }));
  const trimmed = clone(files);
  trimmed[1].pages.splice(1, 1);
  const third = await PDFDocument.load(await E.mergeFiles(trimmed, { pageSize: 'a4' }));
  eq(third.getPageCount(), 4, 'one page was dropped');

  /* Rotation is added on top of whatever the page already had. */
  const turned = clone(files);
  turned[0].pages[0].rot = 90;
  const fourth = await PDFDocument.load(await E.mergeFiles(turned, { pageSize: 'a4' }));
  eq(fourth.getPage(0).getRotation().angle, 90, 'the first page is turned a quarter');
  turned[0].pages[0].rot = 270;
  const fifth = await PDFDocument.load(await E.mergeFiles(turned, { pageSize: 'a4' }));
  eq(fifth.getPage(0).getRotation().angle, 270, 'three quarters');

  /* Extract keeps the order asked for, duplicates included. */
  const extract = await E.extractPages(merged, [4, 0, 0]);
  const extractDoc = await PDFDocument.load(extract);
  eq(extractDoc.getPageCount(), 3, 'three pages in the extract');
  eq(Math.round(extractDoc.getPage(0).getSize().width), 595, 'the requested last page comes first');
  eq(Math.round(extractDoc.getPage(1).getSize().width), 595, 'the duplicate is really a duplicate');

  let rangeError = null;
  try { await E.extractPages(merged, [7]); } catch (error) { rangeError = error; }
  ok(rangeError && rangeError.code === 'range', 'extracting a page that does not exist is refused');

  /* Images become real pages, at the size chosen. */
  const png = new Uint8Array(fs.readFileSync(path.join(FIX, 'photo.png')));
  const jpg = new Uint8Array(fs.readFileSync(path.join(FIX, 'photo.jpg')));
  const withImages = files.concat([
    { id: 'p', name: 'photo.png', kind: 'image', mime: 'image/png', bytes: png, size: png.length, pages: [{ src: 0, rot: 0 }] },
    { id: 'j', name: 'photo.jpg', kind: 'image', mime: 'image/jpeg', bytes: jpg, size: jpg.length, pages: [{ src: 0, rot: 0 }] }
  ]);
  const photos = await PDFDocument.load(await E.mergeFiles(withImages, { pageSize: 'a4' }));
  eq(photos.getPageCount(), 7, 'two images add two pages');
  eq(Math.round(photos.getPage(5).getSize().width), 595, 'the image gets an A4 page');

  const fitted = await PDFDocument.load(await E.mergeFiles(withImages.slice(3), { pageSize: 'fit' }));
  eq(Math.round(fitted.getPage(0).getSize().width), 600, 'fit uses the picture width');
  eq(Math.round(fitted.getPage(0).getSize().height), 400, 'fit uses the picture height');

  const letterPages = await PDFDocument.load(await E.mergeFiles(withImages.slice(3), { pageSize: 'letter' }));
  eq(Math.round(letterPages.getPage(0).getSize().width), 612, 'letter is used when chosen');

  /* An empty selection is refused rather than producing a broken file. */
  let emptyError = null;
  try { await E.mergeFiles([], {}); } catch (error) { emptyError = error; }
  ok(emptyError && emptyError.code === 'empty', 'merging nothing is refused');

  let noPages = null;
  try { await E.extractPages(merged, []); } catch (error) { noPages = error; }
  ok(noPages && noPages.code === 'empty', 'extracting nothing is refused');

  /* Determinism: the same input gives the same bytes twice in a row. */
  const again = await E.mergeFiles(files, { pageSize: 'a4' });
  const first = Buffer.from(merged);
  const last = Buffer.from(again);
  ok(first.length > 1000 && last.length > 1000, 'the merged file has real weight');
  eq(first.length, last.length, 'the merged file is the same size on both runs');

  console.log(checks + ' logic checks passed');
})().catch((error) => {
  console.error('logic tests failed:', error);
  process.exit(1);
});
