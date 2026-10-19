/* PDF Desk interface. */
(function () {
  "use strict";

  var E = window.TDPdf;
  var LOCALES = window.TD_LOCALES || {};
  var DEFAULT_NAME = "pdf-desk";
  var LANG_KEY = "pdfdesk.lang";
  var PREFS_KEY = "pdfdesk.prefs";
  var MAX_TILES = 400;

  var state = {
    lang: "en",
    files: [],
    history: [],
    outName: DEFAULT_NAME,
    pageSize: "a4",
    busy: false
  };

  var el = {};
  var uid = 0;

  /* ------------------------------------------------------------ language */

  function detectLang() {
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (error) { saved = null; }
    if (saved && LOCALES[saved]) return saved;
    var nav = (navigator.language || "en").toLowerCase();
    if (nav.indexOf("ro") === 0) return "ro";
    if (nav.indexOf("sr") === 0) return nav.indexOf("cyrl") >= 0 ? "sr-cyrl" : "sr-latn";
    return "en";
  }

  function t(key, vars) {
    var pack = LOCALES[state.lang] || LOCALES.en || {};
    var text = pack[key];
    if (text === undefined) text = (LOCALES.en || {})[key];
    if (text === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.title = t("docTitle");

    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (node) {
      node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
    });
    el.langSelect.value = state.lang;
    render();
  }

  function savePrefs() {
    try {
      localStorage.setItem(LANG_KEY, state.lang);
      localStorage.setItem(PREFS_KEY, JSON.stringify({ outName: state.outName, pageSize: state.pageSize }));
    } catch (error) { /* private mode, nothing to do */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (prefs && typeof prefs.outName === "string" && prefs.outName.trim()) state.outName = prefs.outName;
      if (prefs && (prefs.pageSize === "a4" || prefs.pageSize === "letter" || prefs.pageSize === "fit")) {
        state.pageSize = prefs.pageSize;
      }
    } catch (error) { /* ignore a broken pref */ }
  }

  /* ------------------------------------------------------------ ui bits */

  function toast(message, isError) {
    el.toast.textContent = message || "";
    el.toast.classList.toggle("err", !!isError);
  }

  function snapshot() {
    state.history.push({
      files: state.files.map(function (file) {
        return {
          id: file.id,
          name: file.name,
          kind: file.kind,
          mime: file.mime,
          bytes: file.bytes,
          size: file.size,
          pages: file.pages.map(function (page) { return { src: page.src, rot: page.rot }; })
        };
      })
    });
    if (state.history.length > 20) state.history.shift();
  }

  function undo() {
    if (!state.history.length) return;
    var last = state.history.pop();
    state.files = last.files;
    toast("");
    render();
  }

  function totalPages() {
    return state.files.reduce(function (sum, file) { return sum + file.pages.length; }, 0);
  }

  function totalBytes() {
    return state.files.reduce(function (sum, file) { return sum + (file.size || 0); }, 0);
  }

  /* ------------------------------------------------------------ rendering */

  function render() {
    renderFiles();
    renderPages();
    renderSummary();
    var empty = !state.files.length;
    el.filesEmpty.hidden = !empty;
    el.pagesEmpty.hidden = !empty;
    el.mergeBtn.disabled = empty || state.busy;
    el.splitBtn.disabled = empty || state.busy;
    el.undoBtn.disabled = !state.history.length || state.busy;
    el.resetBtn.disabled = empty || state.busy;
  }

  function renderFiles() {
    el.fileList.innerHTML = "";
    state.files.forEach(function (file, index) {
      var item = document.createElement("li");
      item.className = "file";
      item.dataset.id = file.id;

      var left = document.createElement("div");
      var name = document.createElement("div");
      name.className = "file-name";
      name.textContent = file.name;
      name.title = file.name;

      var meta = document.createElement("div");
      meta.className = "file-meta";
      var count = document.createElement("span");
      count.textContent = file.pages.length === 1
        ? t("filePage")
        : t("filePages", { n: file.pages.length });
      meta.appendChild(count);
      if (file.kind === "image") {
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = t("fileImage");
        meta.appendChild(tag);
      }

      left.appendChild(name);
      left.appendChild(meta);

      var tools = document.createElement("div");
      tools.className = "file-tools";
      tools.appendChild(iconButton("up", "\u2191", t("moveUp"), index === 0, function () {
        snapshot();
        state.files = E.moveItem(state.files, index, index - 1);
        render();
      }));
      tools.appendChild(iconButton("down", "\u2193", t("moveDown"), index === state.files.length - 1, function () {
        snapshot();
        state.files = E.moveItem(state.files, index, index + 1);
        render();
      }));
      tools.appendChild(iconButton("del", "\u00d7", t("remove"), false, function () {
        snapshot();
        state.files = state.files.filter(function (other) { return other.id !== file.id; });
        toast("");
        render();
      }));

      item.appendChild(left);
      item.appendChild(tools);
      el.fileList.appendChild(item);
    });
  }

  function iconButton(kind, glyph, label, disabled, handler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn" + (kind === "del" ? " del" : "");
    button.textContent = glyph;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.disabled = !!disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function renderPages() {
    el.pageGrid.innerHTML = "";
    var shown = 0;
    state.files.forEach(function (file, fileIndex) {
      file.pages.forEach(function (page, pageIndex) {
        if (shown >= MAX_TILES) return;
        shown += 1;
        el.pageGrid.appendChild(pageTile(file, fileIndex, page, pageIndex));
      });
    });
    var hidden = totalPages() - shown;
    el.pagesCap.hidden = hidden <= 0;
    if (hidden > 0) el.pagesCap.textContent = t("pagesCap", { n: MAX_TILES });
  }

  function pageTile(file, fileIndex, page, pageIndex) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "page";
    tile.dataset.rot = String(page.rot || 0);
    tile.dataset.file = String(fileIndex);
    tile.setAttribute("aria-label", t("pageLabel", { n: page.src + 1 }) + ", " + file.name);
    tile.title = t("rotate");

    var bar = document.createElement("span");
    bar.className = "src";
    bar.style.background = colorFor(fileIndex);

    var num = document.createElement("span");
    num.className = "num";
    num.textContent = String(page.src + 1);

    tile.appendChild(bar);
    tile.appendChild(num);

    if (page.rot) {
      var deg = document.createElement("span");
      deg.className = "deg";
      deg.textContent = page.rot + "\u00b0";
      tile.appendChild(deg);
    }

    tile.addEventListener("click", function () {
      snapshot();
      page.rot = E.nextRotation(page.rot);
      render();
    });

    var del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "\u00d7";
    del.setAttribute("aria-label", t("deletePage"));
    del.title = t("deletePage");
    del.addEventListener("click", function (event) {
      event.stopPropagation();
      snapshot();
      file.pages.splice(pageIndex, 1);
      if (!file.pages.length) {
        state.files = state.files.filter(function (other) { return other.id !== file.id; });
      }
      toast("");
      render();
    });
    tile.appendChild(del);

    return tile;
  }

  function colorFor(index) {
    var palette = ["#56b2ba", "#e3a548", "#8ab17d", "#c08552", "#7d8cc4", "#c98b9b"];
    return palette[index % palette.length];
  }

  function renderSummary() {
    var pages = totalPages();
    if (!pages) {
      el.summary.textContent = "";
      return;
    }
    el.summary.textContent = pages === 1
      ? t("summaryOne", { size: E.formatSize(totalBytes()) })
      : t("summary", { pages: pages, size: E.formatSize(totalBytes()) });
  }

  /* ------------------------------------------------------------ files */

  async function addFiles(list) {
    var incoming = Array.prototype.slice.call(list || []);
    if (!incoming.length) return;
    toast(t("working"));
    state.busy = true;
    render();

    var added = [];
    for (var i = 0; i < incoming.length; i++) {
      var file = incoming[i];
      try {
        var entry = await readFile(file);
        if (entry) added.push(entry);
      } catch (error) {
        state.busy = false;
        render();
        toast(t(E.isEncryptedError(error) ? "errEncrypted" : "errInvalid"), true);
        return;
      }
    }

    if (added.length) {
      snapshot();
      state.files = state.files.concat(added);
      if (state.outName === DEFAULT_NAME || !state.outName.trim()) {
        state.outName = E.safeName(added[0].name.replace(/\.[^.]+$/, "") + "-merged");
        el.outName.value = state.outName;
        savePrefs();
      }
      toast("");
    }
    state.busy = false;
    render();
  }

  async function readFile(file) {
    var name = file.name || "file";
    var isPdf = /\.pdf$/i.test(name) || file.type === "application/pdf";
    var isPng = /\.png$/i.test(name) || file.type === "image/png";
    var isJpg = /\.jpe?g$/i.test(name) || file.type === "image/jpeg";
    if (!isPdf && !isPng && !isJpg) throw new Error("unsupported");

    var bytes = new Uint8Array(await file.arrayBuffer());
    if (isPdf) {
      if (!E.looksLikePdf(bytes)) throw new Error("not a pdf");
      var count = await E.countPages(bytes);
      if (!count) throw new Error("no pages");
      return {
        id: "f" + (++uid),
        name: name,
        kind: "pdf",
        mime: "application/pdf",
        bytes: bytes,
        size: file.size || bytes.length,
        pages: Array.from({ length: count }, function (_, index) {
          return { src: index, rot: 0 };
        })
      };
    }

    return {
      id: "f" + (++uid),
      name: name,
      kind: "image",
      mime: isPng ? "image/png" : "image/jpeg",
      bytes: bytes,
      size: file.size || bytes.length,
      pages: [{ src: 0, rot: 0 }]
    };
  }

  /* ------------------------------------------------------------ output */

  async function buildMerged() {
    return E.mergeFiles(state.files, { pageSize: state.pageSize });
  }

  function download(bytes, name) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = E.safeName(name) + ".pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function runMerge() {
    if (!state.files.length || state.busy) return;
    state.busy = true;
    toast(t("working"));
    render();
    try {
      var bytes = await buildMerged();
      download(bytes, el.outName.value || state.outName);
      toast(t("doneMerge"));
    } catch (error) {
      toast(t(pickError(error)), true);
    }
    state.busy = false;
    render();
  }

  async function runExtract() {
    if (!state.files.length || state.busy) return;
    var pages = totalPages();
    var indexes;
    try {
      indexes = E.parseRange(el.splitInput.value, pages);
    } catch (error) {
      toast(t(error.code === "empty" ? "errEmptyRange" : "errRange", { n: pages }), true);
      return;
    }

    state.busy = true;
    toast(t("working"));
    render();
    try {
      var merged = await buildMerged();
      var bytes = await E.extractPages(merged, indexes);
      download(bytes, (el.outName.value || state.outName) + "-pages");
      toast(t("doneExtract"));
    } catch (error) {
      toast(t(pickError(error)), true);
    }
    state.busy = false;
    render();
  }

  function pickError(error) {
    if (E.isEncryptedError(error)) return "errEncrypted";
    if (error && error.code === "range") return "errRange";
    if (error && error.code === "empty") return "errNoPages";
    var message = String((error && error.message) || "");
    if (/memory|allocation/i.test(message)) return "errBig";
    if (/range/i.test(message)) return "errRange";
    return "errInvalid";
  }

  /* ------------------------------------------------------------ wiring */

  function boot() {
    el.drop = document.getElementById("drop");
    el.fileInput = document.getElementById("fileInput");
    el.chooseBtn = document.getElementById("chooseBtn");
    el.fileList = document.getElementById("fileList");
    el.filesEmpty = document.getElementById("filesEmpty");
    el.pageGrid = document.getElementById("pageGrid");
    el.pagesEmpty = document.getElementById("pagesEmpty");
    el.pagesCap = document.getElementById("pagesCap");
    el.summary = document.getElementById("summary");
    el.outName = document.getElementById("outName");
    el.pageSize = document.getElementById("pageSize");
    el.mergeBtn = document.getElementById("mergeBtn");
    el.splitBtn = document.getElementById("splitBtn");
    el.splitInput = document.getElementById("splitInput");
    el.undoBtn = document.getElementById("undoBtn");
    el.resetBtn = document.getElementById("resetBtn");
    el.langSelect = document.getElementById("langSelect");
    el.toast = document.getElementById("toast");

    state.lang = detectLang();
    loadPrefs();
    el.outName.value = state.outName;
    el.pageSize.value = state.pageSize;

    el.langSelect.addEventListener("change", function () {
      state.lang = el.langSelect.value;
      savePrefs();
      applyLang();
    });

    el.chooseBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      el.fileInput.click();
    });
    el.drop.addEventListener("click", function () { el.fileInput.click(); });
    el.drop.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.fileInput.click();
      }
    });

    el.fileInput.addEventListener("change", function () {
      addFiles(el.fileInput.files);
      el.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach(function (name) {
      el.drop.addEventListener(name, function (event) {
        event.preventDefault();
        el.drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      el.drop.addEventListener(name, function (event) {
        event.preventDefault();
        el.drop.classList.remove("over");
      });
    });
    el.drop.addEventListener("drop", function (event) {
      if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
    });

    el.outName.addEventListener("input", function () {
      state.outName = el.outName.value;
      savePrefs();
    });
    el.pageSize.addEventListener("change", function () {
      state.pageSize = el.pageSize.value;
      savePrefs();
    });

    el.mergeBtn.addEventListener("click", runMerge);
    el.splitBtn.addEventListener("click", runExtract);
    el.undoBtn.addEventListener("click", undo);
    el.resetBtn.addEventListener("click", function () {
      if (!state.files.length) return;
      snapshot();
      state.files = [];
      toast("");
      render();
    });

    applyLang();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
