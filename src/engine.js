/* PDF Desk engine. Pure functions plus the two PDF operations.
   Loaded as a plain script in the browser, required directly in Node tests. */
(function (root) {
  "use strict";

  var A4 = [595.28, 841.89];
  var LETTER = [612, 792];
  var MARGIN = 24;

  function lib() {
    if (typeof PDFLib !== "undefined") return PDFLib;
    if (typeof require === "function") return require("pdf-lib");
    throw new Error("pdf library missing");
  }

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  /* ------------------------------------------------------------ text and numbers */

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function safeName(raw) {
    var name = String(raw || "").trim().replace(/\.pdf$/i, "");
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
    if (!name) name = "pdf-desk";
    return name.slice(0, 80);
  }

  function nextRotation(value) {
    return ((Number(value) || 0) + 90) % 360;
  }

  function moveItem(list, from, to) {
    if (from === to) return list.slice();
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list.slice();
    var copy = list.slice();
    var item = copy.splice(from, 1)[0];
    copy.splice(to, 0, item);
    return copy;
  }

  /* "1-3, 5, 8-10" becomes zero based page indexes. Order is kept as written,
     and repeats are allowed on purpose: the same page twice is a real request. */
  function parseRange(text, total) {
    var raw = String(text || "").trim();
    if (!raw) throw fail("empty", "empty range");
    var pieces = raw.split(/[,;]+/).map(function (piece) {
      return piece.trim();
    }).filter(Boolean);
    if (!pieces.length) throw fail("empty", "empty range");

    var out = [];
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      var match = piece.match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) {
        var from = parseInt(match[1], 10);
        var to = parseInt(match[2], 10);
        if (from > to) { var swap = from; from = to; to = swap; }
        if (from < 1 || to > total) throw fail("range", "out of range");
        for (var n = from; n <= to; n++) out.push(n - 1);
        continue;
      }
      if (/^\d+$/.test(piece)) {
        var single = parseInt(piece, 10);
        if (single < 1 || single > total) throw fail("range", "out of range");
        out.push(single - 1);
        continue;
      }
      throw fail("range", "not a page number");
    }
    if (!out.length) throw fail("empty", "empty range");
    if (out.length > 2000) throw fail("range", "too many pages");
    return out;
  }

  /* ------------------------------------------------------------ geometry */

  function pageBox(kind, imageWidth, imageHeight) {
    if (kind === "fit") {
      var scale = Math.min(1, 1600 / Math.max(imageWidth, imageHeight, 1));
      return { width: imageWidth * scale, height: imageHeight * scale, margin: 0 };
    }
    var base = kind === "letter" ? LETTER : A4;
    return { width: base[0], height: base[1], margin: MARGIN };
  }

  function fitRect(imageWidth, imageHeight, boxWidth, boxHeight, margin) {
    var pad = margin || 0;
    var usableWidth = Math.max(1, boxWidth - pad * 2);
    var usableHeight = Math.max(1, boxHeight - pad * 2);
    var scale = Math.min(usableWidth / imageWidth, usableHeight / imageHeight);
    var width = imageWidth * scale;
    var height = imageHeight * scale;
    return {
      x: (boxWidth - width) / 2,
      y: (boxHeight - height) / 2,
      width: width,
      height: height
    };
  }

  /* ------------------------------------------------------------ pdf work */

  function looksLikePdf(bytes) {
    var head = new Uint8Array(bytes.slice(0, 5));
    return String.fromCharCode.apply(null, head) === "%PDF-";
  }

  async function countPages(bytes) {
    var PDFLib = lib();
    var doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount();
  }

  async function pageSizes(bytes) {
    var PDFLib = lib();
    var doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPages().map(function (page) {
      var size = page.getSize();
      return { width: size.width, height: size.height, rotation: page.getRotation().angle };
    });
  }

  async function mergeFiles(files, options) {
    var PDFLib = lib();
    var opts = options || {};
    var out = await PDFLib.PDFDocument.create();

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.kind === "image") {
        var image = file.mime === "image/png"
          ? await out.embedPng(file.bytes)
          : await out.embedJpg(file.bytes);
        var box = pageBox(opts.pageSize || "a4", image.width, image.height);
        var page = out.addPage([box.width, box.height]);
        var rect = fitRect(image.width, image.height, box.width, box.height, box.margin);
        page.drawImage(image, rect);
        continue;
      }

      var source = await PDFLib.PDFDocument.load(file.bytes, { updateMetadata: false });
      var order = file.pages.map(function (page) { return page.src; });
      if (!order.length) continue;
      var copied = await out.copyPages(source, order);
      for (var c = 0; c < copied.length; c++) {
        var turn = file.pages[c].rot || 0;
        if (turn) {
          copied[c].setRotation(PDFLib.degrees((copied[c].getRotation().angle + turn) % 360));
        }
        out.addPage(copied[c]);
      }
    }

    if (!out.getPageCount()) throw fail("empty", "no pages");
    out.setCreator("PDF Desk by TekiDeki");
    return out.save();
  }

  async function extractPages(bytes, indexes) {
    var PDFLib = lib();
    if (!indexes || !indexes.length) throw fail("empty", "no pages");
    var source = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    var total = source.getPageCount();
    indexes.forEach(function (index) {
      if (index < 0 || index >= total) throw fail("range", "out of range");
    });
    var out = await PDFLib.PDFDocument.create();
    var copied = await out.copyPages(source, indexes);
    copied.forEach(function (page) { out.addPage(page); });
    out.setCreator("PDF Desk by TekiDeki");
    return out.save();
  }

  function isEncryptedError(error) {
    var message = String((error && error.message) || "");
    return /encrypt|password/i.test(message);
  }

  var api = {
    A4: A4,
    LETTER: LETTER,
    MARGIN: MARGIN,
    formatSize: formatSize,
    safeName: safeName,
    nextRotation: nextRotation,
    moveItem: moveItem,
    parseRange: parseRange,
    pageBox: pageBox,
    fitRect: fitRect,
    looksLikePdf: looksLikePdf,
    countPages: countPages,
    pageSizes: pageSizes,
    mergeFiles: mergeFiles,
    extractPages: extractPages,
    isEncryptedError: isEncryptedError
  };

  root.TDPdf = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
