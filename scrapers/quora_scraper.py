# -*- coding: utf-8 -*-
"""
Quora Scraper - Standalone scraper for Quora keyword monitoring (search results)
Uses Playwright for browser automation.

Usage:
  python quora_scraper.py --email "<email-address>" --keywords "keyword1,keyword2,keyword3"
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from playwright.sync_api import sync_playwright, Page, BrowserContext


PROFILE_DIR_NAME = os.environ.get("QUORA_PROFILE", "chrome_profile_quora")
FORCED_SUBPROFILE = None


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [QUORA] {msg}", file=sys.stderr)


def resolve_profile_root_and_subdir(
    profile_dir_name: str,
    forced_subprofile: Optional[str] = None,
    search_depth: int = 2,
) -> Optional[Tuple[Path, str]]:
    script_dir = Path(__file__).resolve().parent
    cwd = Path.cwd()

    def valid_subprofile(root: Path, desired: Optional[str]) -> Optional[str]:
        if desired:
            if (root / desired / "Preferences").exists():
                return desired
            return None
        common = ["Default", "Profile 1", "Profile 2", "Profile 3"]
        for name in common:
            if (root / name / "Preferences").exists():
                return name
        for p in root.glob("Profile *"):
            if (p / "Preferences").exists():
                return p.name
        return None

    candidates = [
        cwd / profile_dir_name,
        script_dir / profile_dir_name,
        cwd / "profiles" / profile_dir_name,
        script_dir / "profiles" / profile_dir_name,
    ]
    for cand in candidates:
        if cand.exists() and cand.is_dir():
            sub = valid_subprofile(cand, forced_subprofile)
            if sub:
                log(f"Resolved profile root: {cand} (subprofile={sub})")
                return cand, sub

    def scan_for_profile_roots(base: Path) -> List[Tuple[Path, str]]:
        found = []
        queue = [(base, 0)]
        seen = set()
        while queue:
            current, depth = queue.pop(0)
            if current in seen or depth > search_depth:
                continue
            seen.add(current)
            sub = valid_subprofile(current, forced_subprofile)
            if sub:
                found.append((current, sub))
            if depth < search_depth:
                try:
                    for child in current.iterdir():
                        if child.is_dir():
                            queue.append((child, depth + 1))
                except Exception:
                    pass
        return found

    all_found = []
    for base in [cwd, script_dir]:
        all_found.extend(scan_for_profile_roots(base))

    matches = [x for x in all_found if x[0].name.lower() == profile_dir_name.lower()]
    if matches:
        root, sub = matches[0]
        log(f"Resolved profile root: {root} (subprofile={sub}) [matched by name]")
        return root, sub

    if len(all_found) == 1:
        root, sub = all_found[0]
        log(f"Resolved profile root: {root} (subprofile={sub}) [unique candidate]")
        return root, sub

    if all_found:
        log("Multiple profile-like directories detected; no unique match.")
    else:
        log("No Chrome profile directory detected under current/script folders.")
    return None


def build_search_url(keyword: str) -> str:
    q = urllib.parse.quote_plus(keyword)
    return f"https://www.quora.com/search?q={q}&time=day&type=question"


def gently_close_quora_modals(page: Page) -> None:
    try:
        page.evaluate(
            "document.activeElement && document.activeElement.blur && document.activeElement.blur();"
        )
        page.evaluate(
            """
            const hide = (el) => { el.style.display='none'; el.style.visibility='hidden'; el.setAttribute('aria-hidden','true'); };
            const qs = (s) => Array.from(document.querySelectorAll(s));
            qs('[role="dialog"], [data-qa*="signup" i], [class*="signup" i], [id*="signup" i]').forEach(hide);
            qs('iframe[src*="login" i], iframe[src*="signup" i]').forEach(hide);
        """
        )
    except Exception:
        pass


def clean_title(text: str) -> str:
    return " ".join((text or "").split())


def extract_results_from_document(page: Page) -> Dict[str, Dict[str, Optional[str]]]:
    found: Dict[str, Dict[str, Optional[str]]] = {}

    anchors = page.query_selector_all("a[href]")
    for a in anchors:
        try:
            href = a.get_attribute("href") or ""
            text = clean_title(a.text_content() or "")

            if not href.startswith("http"):
                continue

            if href.startswith("/"):
                href = "https://www.quora.com" + href

            bad_fragments = [
                "/about", "/contact", "/careers", "/press", "/terms",
                "/privacy", "/cookies", "/legal", "/signup", "/login",
                "/profile/", "/notifications", "/messages", "/spaces/",
            ]
            if any(b in href for b in bad_fragments):
                continue

            if not text or len(text) < 3:
                alt = a.get_attribute("aria-label") or a.get_attribute("title") or ""
                text = clean_title(alt)
                if not text or len(text) < 3:
                    continue

            if href not in found:
                found[href] = {"title": text, "age": None}
            else:
                if len(text) > len(found[href]["title"] or ""):
                    found[href]["title"] = text

        except Exception:
            continue

    selectors = [
        '[data-testid="search_result"] a[href]',
        'a[href*="/answer/"]',
        'a[href*="/question/"]',
        "div.q-box a[href]",
    ]
    for sel in selectors:
        try:
            for el in page.query_selector_all(sel):
                href = el.get_attribute("href") or ""
                title = clean_title(
                    el.text_content() or el.get_attribute("aria-label") or ""
                )
                if not href or not title:
                    continue
                if not href.startswith("http"):
                    if href.startswith("/"):
                        href = "https://www.quora.com" + href
                    else:
                        continue
                if any(b in href for b in ["/signup", "/login"]):
                    continue
                if href not in found:
                    found[href] = {"title": title, "age": None}
                else:
                    if len(title) > len(found[href]["title"] or ""):
                        found[href]["title"] = title
        except Exception:
            pass

    return found


def collect_from_static_html(path: Path) -> Dict[str, Dict[str, Optional[str]]]:
    html = path.read_text(encoding="utf-8", errors="ignore")
    dummy = f'<div id="offline-root">{html}</div>'

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir="",
            channel="chrome",
            headless=True,
            no_viewport=True,
        )
        page = context.new_page()
        try:
            page.goto("data:text/html;charset=utf-8," + urllib.parse.quote(dummy))
            return extract_results_from_document(page)
        finally:
            context.close()


def infinite_scroll(page: Page, max_scrolls: int = 5, pause: float = 1.5) -> None:
    last_height = page.evaluate("document.body.scrollHeight")
    for i in range(max_scrolls):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(pause)
        gently_close_quora_modals(page)
        new_height = page.evaluate("document.body.scrollHeight")
        if new_height == last_height:
            break
        last_height = new_height


def scrape_quora(
    keywords: List[str],
    max_scrolls: int = 5,
    html_file: Optional[str] = None,
) -> List[Dict[str, object]]:
    log(f"Starting Quora scraper for keywords: {keywords}")

    if html_file:
        log(f"Static HTML mode from: {html_file}")
        aggregated: Dict[str, Dict[str, object]] = {}
        for keyword in keywords:
            offline = collect_from_static_html(Path(html_file))
            for url, info in offline.items():
                if url not in aggregated:
                    aggregated[url] = {
                        "title": info["title"],
                        "age": None,
                        "keywords": set(),
                    }
                aggregated[url]["keywords"].add(keyword)
        results = [
            {
                "url": u,
                "title": d["title"],
                "age": d.get("age"),
                "keywords": sorted(list(d["keywords"])),
            }
            for u, d in aggregated.items()
        ]
        log(f"Static HTML extraction complete. Total unique results: {len(results)}")
        return results

    resolved = resolve_profile_root_and_subdir(
        PROFILE_DIR_NAME, forced_subprofile=FORCED_SUBPROFILE
    )

    aggregated: Dict[str, Dict[str, object]] = {}

    with sync_playwright() as p:
        if resolved:
            profile_root, subprofile = resolved
            context: BrowserContext = p.chromium.launch_persistent_context(
                user_data_dir=str(profile_root),
                channel="chrome",
                headless=False,
                no_viewport=True,
                args=[
                    f"--profile-directory={subprofile}",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                ],
            )
            log(f"Using Chrome profile: root={profile_root} subprofile={subprofile}")
        else:
            log("No profile found; falling back to headless mode (not logged-in).")
            browser = p.chromium.launch(
                channel="chrome",
                headless=False,
                args=[
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                ],
            )
            try:
                context = browser.new_context(storage_state="google_state.json")
            except FileNotFoundError:
                context = browser.new_context()

        page = context.new_page()

        try:
            for keyword in keywords:
                url = build_search_url(keyword)
                log(f"Navigating: {url}")
                page.goto(url)

                time.sleep(2.0)
                gently_close_quora_modals(page)

                infinite_scroll(page, max_scrolls=max_scrolls, pause=1.5)
                page_found = extract_results_from_document(page)

                for link, info in page_found.items():
                    if link not in aggregated:
                        aggregated[link] = {
                            "title": info["title"],
                            "age": info.get("age"),
                            "keywords": set([keyword]),
                        }
                    else:
                        aggregated[link]["keywords"].add(keyword)

        finally:
            try:
                context.close()
            except Exception:
                pass

    results = [
        {
            "url": u,
            "title": d["title"],
            "age": d.get("age"),
            "keywords": sorted(list(d["keywords"])),
        }
        for u, d in aggregated.items()
    ]
    log(f"Finished. Total unique results: {len(results)}")
    return results


def parse_args():
    p = argparse.ArgumentParser(description="Quora search scraper")
    p.add_argument(
        "--email",
        default="",
        help="User email (for logging)",
    )
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument(
        "--max-scrolls",
        type=int,
        default=10,
        help="Infinite-scroll iterations per keyword",
    )
    p.add_argument(
        "--html-file",
        default=None,
        help="Parse from a saved HTML file (offline testing)",
    )
    p.add_argument(
        "--output-file", help="Save JSON output to file in json_output_scrapper/ folder"
    )
    return p.parse_args()


def main():
    args = parse_args()

    raw = [x.strip() for x in (args.keywords or "").split(",")]
    keywords = [k for k in raw if k]
    if not keywords:
        log("Error: No keywords provided")
        sys.exit(1)

    log(f"User: {args.email}")

    try:
        results = scrape_quora(
            keywords, max_scrolls=args.max_scrolls, html_file=args.html_file
        )
        json_output = json.dumps(results, indent=2)

        if args.output_file:
            output_dir = Path(__file__).parent / "json_output_scrapper"
            output_dir.mkdir(exist_ok=True)
            output_path = output_dir / args.output_file
            output_path.write_text(json_output, encoding="utf-8")
            log(f"Results saved to: {output_path}")
        else:
            print(json_output)
    except Exception as e:
        log(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
