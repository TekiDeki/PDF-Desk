#!/usr/bin/env python3
# PDF Desk · end to end tests
# SPDX-License-Identifier: Apache-2.0
"""Drives index.html in Chromium on a desktop and on a touch tablet.

    python3 tests/ui_test.py

Starts its own static server on a free port, so no other process is needed.
Downloads are captured and opened again in the page, so the PDF that the user
would get is the one that gets checked.
"""
from __future__ import annotations

import functools
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures"
OUT = ROOT / "tests" / "out"
checks = 0


def check(condition, message):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Server:
    def __init__(self, directory: Path):
        handler = functools.partial(QuietHandler, directory=str(directory))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/index.html"


class Watcher:
    """Collects console and page errors for one page."""

    def __init__(self, page):
        self.problems = []
        page.on("console", self._console)
        page.on("pageerror", lambda error: self.problems.append("pageerror: " + str(error)))

    # pdf-lib prints its own parse complaints while it is busy refusing a file
    # that the page then reports properly. They are noise from the library, not
    # a fault of the page, so they are dropped here and nothing else is.
    NOISE = ("Trying to parse invalid object", "Invalid object ref")

    def _console(self, message):
        if message.type in ("error", "warning") and not message.text.startswith(self.NOISE):
            self.problems.append("console " + message.type + ": " + message.text)

    def quiet(self, label):
        check(not self.problems, label + " raised " + repr(self.problems))


def pages_in_file(path: Path) -> int:
    """Page count through pdf-lib, not through the app's own code path.

    pdf-lib compresses the page tree into object streams, so a regex over the
    bytes cannot see it. Node is asked instead, with the pinned library.
    """
    data = path.read_bytes()
    check(data.startswith(b"%PDF-"), f"{path.name} is not a PDF")
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "pagecount.cjs"), str(path)],
        capture_output=True, text=True, timeout=60,
    )
    check(result.returncode == 0, f"{path.name} is unreadable: {result.stderr.strip()}")
    return int(result.stdout.strip())


def open_app(context, url):
    page = context.new_page()
    page.goto(url, wait_until="load")
    page.wait_for_function("window.TDPdf && window.TD_LOCALES")
    return page, Watcher(page)


def add_files(page, names):
    page.set_input_files("#fileInput", [str(FIX / name) for name in names])
    page.wait_for_function(
        "() => document.querySelectorAll('.page').length > 0", timeout=15000
    )


def save_download(page, action, name):
    with page.expect_download(timeout=20000) as info:
        action()
    download = info.value
    target = OUT / name
    download.save_as(target)
    return target


def desktop_run(pw, url):
    browser = pw.chromium.launch()
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page, watch = open_app(context, url)

    check("PDF Desk" in page.title(), "the title names the app")
    check(page.locator(".claims li").count() == 4, "four claims under the intro")
    check(page.locator("#filesEmpty").is_visible(), "the empty state is shown first")
    check(page.locator("#mergeBtn").is_disabled(), "merge is disabled with no files")
    check(page.locator("#splitBtn").is_disabled(), "extract is disabled with no files")
    check(page.locator("#undoBtn").is_disabled(), "undo is disabled at the start")

    add_files(page, ["contract.pdf", "invoice.pdf"])
    check(page.locator(".file").count() == 2, "two files are listed")
    check(page.locator(".page").count() == 4, "one plus three pages are shown")
    check(not page.locator("#filesEmpty").is_visible(), "the empty state is gone")
    summary = page.locator("#summary").inner_text()
    check("4" in summary, "the summary counts four pages: " + summary)
    check(not page.locator("#mergeBtn").is_disabled(), "merge is now enabled")

    # Rotate the first page a quarter.
    first = page.locator(".page").first
    first.click()
    check(first.get_attribute("data-rot") == "90", "a click turns the page a quarter")
    first.click()
    check(first.get_attribute("data-rot") == "180", "a second click turns it again")
    page.locator("#undoBtn").click()
    check(page.locator(".page").first.get_attribute("data-rot") == "90", "undo goes back one turn")

    # Move the second file above the first.
    page.locator(".file").nth(1).locator('[aria-label="Move up"]').click()
    names = page.locator(".file-name").all_inner_texts()
    check(names[0] == "invoice.pdf", "the invoice is now first: " + repr(names))

    # Delete a page, then undo the delete.
    page.locator(".page").nth(1).locator(".del").click()
    check(page.locator(".page").count() == 3, "the page is gone")
    page.locator("#undoBtn").click()
    check(page.locator(".page").count() == 4, "undo brings the page back")

    # Merge and check the real file.
    merged = save_download(page, lambda: page.locator("#mergeBtn").click(), "merged.pdf")
    check(pages_in_file(merged) == 4, "the merged file has four pages")
    check("done" in page.locator("#toast").inner_text().lower() or
          "gata" in page.locator("#toast").inner_text().lower(), "the app says it is done")

    # Extract pages 2-3.
    page.fill("#splitInput", "2-3")
    extract = save_download(page, lambda: page.locator("#splitBtn").click(), "extract.pdf")
    check(pages_in_file(extract) == 2, "the extract has two pages")

    # A bad range is refused, and nothing is downloaded.
    page.fill("#splitInput", "9-12")
    page.locator("#splitBtn").click()
    page.wait_for_timeout(300)
    check(page.locator("#toast").get_attribute("class").find("err") >= 0, "a bad range is an error")
    check(page.locator(".page").count() == 4, "a bad range changes nothing")

    # Reset clears everything, undo brings it back.
    page.locator("#resetBtn").click()
    check(page.locator(".page").count() == 0, "reset empties the board")
    check(page.locator("#mergeBtn").is_disabled(), "merge is disabled again")
    page.locator("#undoBtn").click()
    check(page.locator(".page").count() == 4, "undo restores the whole board")

    # An image becomes a page.
    add_files(page, ["photo.png"])
    check(page.locator(".page").count() == 5, "the image adds a page")
    tagged = page.locator(".tag").all_inner_texts()
    check(len(tagged) >= 1, "the image is marked as an image")
    with_image = save_download(page, lambda: page.locator("#mergeBtn").click(), "with-image.pdf")
    check(pages_in_file(with_image) == 5, "the image is really in the merged file")

    # A password protected file is refused, and the page stays usable after.
    page.set_input_files("#fileInput", [str(FIX / "encrypted.pdf")])
    page.wait_for_timeout(900)
    message = page.locator("#toast").inner_text().lower()
    check("password" in message or "parola" in message or "parolă" in message or "lozink" in message,
          "an encrypted file is explained, got: " + message)
    check(page.locator(".page").count() == 5, "the encrypted file added no pages")
    check(not page.locator("#mergeBtn").is_disabled(), "the page is still usable afterwards")

    # Language switch and persistence.
    page.select_option("#langSelect", "ro")
    check(page.get_attribute("html", "lang") == "ro", "the html lang follows the switch")
    check("Unește" in page.locator("#mergeBtn").inner_text(), "the button is in Romanian")
    page.select_option("#langSelect", "sr-cyrl")
    check("Споји" in page.locator("#mergeBtn").inner_text(), "the button is in Cyrillic")
    page.reload(wait_until="load")
    page.wait_for_function("window.TDPdf")
    check(page.get_attribute("html", "lang") == "sr-cyrl", "the language survives a reload")
    page.select_option("#langSelect", "en")
    check("Merge" in page.locator("#mergeBtn").inner_text(), "back to English")

    watch.quiet("desktop")
    context.close()
    browser.close()


def tablet_run(pw, url):
    browser = pw.chromium.launch()
    context = browser.new_context(
        viewport={"width": 820, "height": 1180},
        has_touch=True,
        is_mobile=False,
        accept_downloads=True,
    )
    page, watch = open_app(context, url)

    check(page.locator("#chooseBtn").is_visible(), "the tablet sees the choose button")
    box = page.locator("#drop").bounding_box()
    check(box and box["width"] > 300, "the drop area is wide enough to tap")

    add_files(page, ["invoice.pdf"])
    check(page.locator(".page").count() == 3, "three pages on the tablet")

    page.locator(".page").first.tap()
    check(page.locator(".page").first.get_attribute("data-rot") == "90", "a tap turns the page")

    merged = save_download(page, lambda: page.locator("#mergeBtn").tap(), "tablet-merged.pdf")
    check(pages_in_file(merged) == 3, "the tablet merge has three pages")

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check(overflow <= 1, f"the tablet page does not scroll sideways ({overflow}px)")

    watch.quiet("tablet")
    context.close()
    browser.close()


def phone_run(pw, url):
    browser = pw.chromium.launch()
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        has_touch=True,
        is_mobile=True,
        device_scale_factor=3,
        accept_downloads=True,
    )
    page, watch = open_app(context, url)

    add_files(page, ["invoice.pdf", "photo.jpg"])
    check(page.locator(".page").count() == 4, "three pages plus the photo on a phone")

    page.locator(".page").first.tap()
    check(page.locator(".page").first.get_attribute("data-rot") == "90", "a tap turns the page on a phone")

    merged = save_download(page, lambda: page.locator("#mergeBtn").tap(), "phone-merged.pdf")
    check(pages_in_file(merged) == 4, "the phone merge keeps every page")

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check(overflow <= 1, f"the phone page does not scroll sideways ({overflow}px)")

    # every control the user needs is at least 32 px tall
    for selector in ("#mergeBtn", "#splitBtn", "#chooseBtn", "#undoBtn"):
        box = page.locator(selector).bounding_box()
        check(box and box["height"] >= 32, selector + " is tall enough to tap")

    watch.quiet("phone")
    context.close()
    browser.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with Server(ROOT) as server:
        with sync_playwright() as pw:
            desktop_run(pw, server.url)
            tablet_run(pw, server.url)
            phone_run(pw, server.url)
    print(f"{checks} ui checks passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print("ui tests failed:", error)
        sys.exit(1)
