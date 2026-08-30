# -*- coding: utf-8 -*-
"""
Perplexity AI Sources Scraper
Uses Playwright for browser automation.

Output when called via --question/--output-file:
  {"mode": "live", "question": "...", "response": "...", "sources": [...], "count": N}
"""

import argparse
import json
import os
import sys
import time
import datetime
from pathlib import Path
from typing import List, Optional, Tuple, Set

from playwright.sync_api import sync_playwright, Page, BrowserContext

try:
    import psutil
    import win32gui
    import win32con
    import win32process
    FOREGROUND_FORCING_AVAILABLE = True
except ImportError:
    FOREGROUND_FORCING_AVAILABLE = False

DEFAULT_PROFILE_DIR_NAME = os.environ.get("PERPLEXITY_PROFILE", "chrome_profile_perplexity")
DEFAULT_FORCED_SUBPROFILE = None


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [PPLX] {msg}", file=sys.stderr)


def resolve_profile_root_and_subdir(
    profile_dir_name: str, forced_subprofile: Optional[str] = None
) -> Optional[Tuple[Path, str]]:
    script_dir = Path(__file__).resolve().parent
    cwd = Path.cwd()

    def valid_subprofile(root: Path, desired: Optional[str]) -> Optional[str]:
        if desired and (root / desired / "Preferences").exists():
            return desired
        for name in ["Default", "Profile 1", "Profile 2", "Profile 3"]:
            if (root / name / "Preferences").exists():
                return name
        for p in root.glob("Profile *"):
            if (p / "Preferences").exists():
                return p.name
        return None

    for cand in [
        cwd / profile_dir_name,
        script_dir / profile_dir_name,
        cwd / "profiles" / profile_dir_name,
        script_dir / "profiles" / profile_dir_name,
    ]:
        if cand.exists():
            sub = valid_subprofile(cand, forced_subprofile)
            if sub:
                return cand, sub
    return None


def _safe_click(el) -> bool:
    try:
        el.click()
        return True
    except Exception:
        try:
            el.evaluate("el => el.click()")
            return True
        except Exception:
            return False


def _dedupe(sources: List[dict]) -> List[dict]:
    seen, out = set(), []
    for source in sources:
        url = source.get("url", "") if isinstance(source, dict) else source
        if url and url.startswith("http") and url not in seen:
            seen.add(url)
            out.append(source)
    return out


def bring_browser_to_front(page: Page) -> bool:
    if not FOREGROUND_FORCING_AVAILABLE:
        return False
    try:
        target_hwnd = None

        def enum_handler(hwnd, _):
            nonlocal target_hwnd
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = win32gui.GetWindowText(hwnd)
            if "chrome" in title.lower() or "perplexity" in title.lower():
                target_hwnd = hwnd
                return False
            return True

        win32gui.EnumWindows(enum_handler, None)
        if target_hwnd:
            win32gui.ShowWindow(target_hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(target_hwnd)
            log("[OK] Browser brought to foreground")
            return True
        return False
    except Exception:
        return False


def _fetch_page_title(url: str, timeout: int = 10) -> str:
    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        title_tag = soup.find("title")
        if title_tag and title_tag.string:
            title = title_tag.string.strip().replace("\n", " ").replace("\r", "")
            if len(title) > 200:
                title = title[:197] + "..."
            return title
        return f"Source from {urlparse(url).netloc}"
    except Exception:
        try:
            from urllib.parse import urlparse
            return f"Source from {urlparse(url).netloc}"
        except Exception:
            return url


def _type_into_perplexity_editor(page: Page, text: str, timeout: int = 40) -> None:
    log(f"Typing question into editor: {text}")
    for _ in range(3):
        try:
            editor = page.wait_for_selector(
                "div[contenteditable='true'][id*='ask'], div[contenteditable='true'][role='textbox']",
                timeout=timeout * 1000,
            )
            page.evaluate(
                "el => { el.scrollIntoView({block:'center'}); el.focus(); }", editor
            )
            page.evaluate("el => { el.textContent = ''; }", editor)
            editor.click()
            editor.type(text)
            page.evaluate(
                "el => el.dispatchEvent(new InputEvent('input', {bubbles: true}))",
                editor,
            )
            time.sleep(3)
            return
        except Exception as e:
            log(f"Retrying editor detection due to {e}")
            time.sleep(2)
    raise Exception("Could not find Perplexity text editor.")


def _click_search_button_strict(page: Page, timeout: int = 15) -> bool:
    log("Attempting to click Search button (strict mode)")

    try:
        search_mode_btn = page.query_selector("[data-testid='search-mode-search']")
        if search_mode_btn:
            page.evaluate("el => el.click()", search_mode_btn)
            log("Clicked search mode button")
            time.sleep(0.3)
    except Exception:
        pass

    submit_selectors = ["button[aria-label='Submit']", "button[data-state='closed']"]
    for selector in submit_selectors:
        try:
            btn = page.wait_for_selector(selector, timeout=3000)
            if btn:
                page.evaluate("el => el.scrollIntoView({block:'center'})", btn)
                for _ in range(10):
                    if not btn.get_attribute("disabled"):
                        break
                    time.sleep(0.15)
                page.evaluate("el => el.click()", btn)
                log(f"Clicked Search button using selector: {selector}")
                return True
        except Exception:
            continue

    strict_xpaths = [
        "button:has(div:text-is('Search'))",
        "span > button:has(div:text-is('Search'))",
    ]
    for sel in strict_xpaths:
        try:
            btn = page.wait_for_selector(sel, timeout=timeout * 1000)
            if btn:
                page.evaluate("el => el.scrollIntoView({block:'center'})", btn)
                for _ in range(8):
                    if not btn.get_attribute("disabled"):
                        break
                    time.sleep(0.15)
                page.evaluate("el => el.click()", btn)
                log("Clicked Search button (CSS has-text)")
                return True
        except Exception:
            continue

    js = """
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const buttons = Array.from(document.querySelectorAll('button'));
    const exact = buttons.find(b => isVisible(b) && b.innerText.trim() === 'Search');
    if (exact) { exact.scrollIntoView({block:'center'}); exact.click(); return true; }
    return false;
    """
    try:
        ok = page.evaluate(js)
        if ok:
            log("Clicked Search button via JS")
            return True
    except Exception:
        pass

    return False


def _js_click_first_search_button(page: Page) -> bool:
    js = """
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const btns = Array.from(document.querySelectorAll('button, span button'));
    const cand = btns.find(b => isVisible(b) && /\\bsearch\\b/i.test(b.innerText));
    if (cand) { cand.scrollIntoView({block:'center'}); cand.click(); return true; }
    const submit = btns.find(b => isVisible(b) && (b.getAttribute('data-testid') === 'submit-button' || /submit/i.test(b.getAttribute('aria-label')||'')) && !b.disabled);
    if (submit) { submit.scrollIntoView({block:'center'}); submit.click(); return true; }
    return false;
    """
    try:
        return bool(page.evaluate(js))
    except Exception:
        return False


def _click_search_button(page: Page, timeout: int = 15) -> bool:
    log("Attempting to click Search button (fallback mode)")

    try:
        search_mode_btn = page.query_selector("[data-testid='search-mode-search']")
        if search_mode_btn:
            page.evaluate("el => el.click()", search_mode_btn)
            time.sleep(0.3)
    except Exception:
        pass

    text_selectors = [
        "button:has(div:text('Search'))",
        "span > button:has(div:text('Search'))",
    ]
    for sel in text_selectors:
        try:
            btn = page.wait_for_selector(sel, timeout=timeout * 1000)
            if btn:
                for _ in range(4):
                    if not btn.get_attribute("disabled"):
                        break
                    time.sleep(0.2)
                if _safe_click(btn):
                    log("Clicked Search button via CSS text selector")
                    return True
        except Exception:
            continue

    try:
        submit_btn = page.query_selector("[data-testid='submit-button']")
        if submit_btn and not submit_btn.get_attribute("disabled"):
            if _safe_click(submit_btn):
                log("Clicked submit button")
                return True
    except Exception:
        pass

    if _js_click_first_search_button(page):
        log("Clicked Search button via JS fallback")
        return True

    try:
        editor = page.query_selector(
            "[id='ask-input'][contenteditable='true'][data-lexical-editor='true']"
        )
        if editor:
            editor.click()
            editor.press("Enter")
            log("Pressed Enter in editor as fallback")
            return True
    except Exception:
        return False


def _wait_for_response(page: Page, timeout: int = 60) -> bool:
    log("Waiting for response to complete...")
    sources_button_found = False

    try:
        page.wait_for_function(
            """() => {
        const prose = document.querySelector('[class*="prose"]');
        return prose && prose.innerText && prose.innerText.trim().length > 100;
    }""",
            timeout=timeout * 1000,
        )
        log("Initial response detected")
    except Exception:
        log("Timeout waiting for initial response")
        return False

    try:
        log("Waiting for sources button with count to appear...")
        page.wait_for_function(
            """() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.some(b => /\\d+\\s+sources?/i.test(b.innerText || b.textContent || ''));
            }""",
            timeout=30000,
        )
        log("Sources button with count detected")
        sources_button_found = True
    except Exception:
        log("Sources button with count not found, continuing anyway...")

    time.sleep(2 if sources_button_found else 3)
    return True


def _click_sources_tab(page: Page) -> bool:
    try:
        sources_btn = page.evaluate_handle(
            """() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => /\\d+\\s+sources?/i.test(b.innerText || b.textContent || '')) || null;
        }"""
        )
        if sources_btn:
            el = sources_btn.as_element()
            if el:
                page.evaluate(
                    "el => { el.scrollIntoView({block:'center'}); el.click(); }", el
                )
                log("Clicked Sources button with count")
                time.sleep(1.5)
                return True
    except Exception:
        pass

    sources_selectors = [
        "[data-testid='sources-switcher-button']",
        "[role='tab']:has-text('sources')",
        "button:has-text('sources')",
        "[class*='source'] button",
    ]
    for selector in sources_selectors:
        try:
            el = page.query_selector(selector)
            if el:
                page.evaluate(
                    "el => { el.scrollIntoView({block:'center'}); el.click(); }", el
                )
                log("Clicked Sources tab/button (fallback)")
                time.sleep(1.5)
                return True
        except Exception:
            continue

    log("Could not find Sources tab (may already be expanded)")
    return False


def _extract_response_text(page: Page) -> str:
    log("Extracting AI response text...")

    response_selectors = [
        "[class*='prose']",
        "[class*='answer']",
        "[data-testid='answer']",
        "main [class*='markdown']",
        "[class*='response'] p",
    ]

    response_text = ""
    for selector in response_selectors:
        try:
            elements = page.query_selector_all(selector)
            if elements:
                texts = []
                for el in elements:
                    try:
                        text = (el.text_content() or "").strip()
                        if text:
                            texts.append(text)
                    except Exception:
                        continue
                if texts:
                    response_text = " ".join(texts)
                    break
        except Exception:
            continue

    if not response_text:
        try:
            paragraphs = page.query_selector_all("main p")
            texts = []
            for p_el in paragraphs:
                try:
                    text = (p_el.text_content() or "").strip()
                    if text:
                        texts.append(text)
                except Exception:
                    continue
            if texts:
                response_text = " ".join(texts)
        except Exception:
            pass

    if response_text:
        log(f"Extracted response text: {len(response_text)} characters")
    else:
        log("Could not extract response text")

    return response_text


def _extract_sources_from_dom(page: Page, max_sources: int) -> List[dict]:
    log("Extracting sources from page...")
    sources: List[dict] = []

    _click_sources_tab(page)
    time.sleep(1)

    try:
        extracted = page.evaluate(
            """() => {
            const sources = [];
            const specificLinks = document.querySelectorAll('a[rel="noopener"][target="_blank"][href^="http"]');
            specificLinks.forEach(a => {
                const href = a.href;
                if (href && !href.includes('perplexity.ai') && !href.includes('perplexity.com')) {
                    sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                }
            });
            if (sources.length === 0) {
                const genericLinks = document.querySelectorAll('a[target="_blank"][href^="http"]');
                genericLinks.forEach(a => {
                    const href = a.href;
                    if (href && !href.includes('perplexity.ai') && !href.includes('perplexity.com')) {
                        sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                    }
                });
            }
            return sources;
        }"""
        )
        if extracted:
            sources.extend(extracted)
            log(f"JavaScript extraction found {len(extracted)} sources")
    except Exception as e:
        log(f"JavaScript extraction failed: {e}")

    if not sources:
        css_selectors = [
            "a[rel='noopener'][href^='http']",
            "[data-testid='sources'] a[href]",
            "[class*='sources'] a[href]",
            "[class*='source-card'] a[href]",
            "[class*='citation'] a[href]",
        ]
        for sel in css_selectors:
            try:
                links = page.query_selector_all(sel)
                for a in links:
                    try:
                        href = a.get_attribute("href") or ""
                        if href.startswith("http") and "perplexity.ai" not in href.lower():
                            sources.append({"url": href, "title": ""})
                    except Exception:
                        continue
                if sources:
                    break
            except Exception:
                continue

    if not sources:
        citation_selectors = ["sup a[href]", "[class*='citation'] a[href]"]
        for sel in citation_selectors:
            try:
                links = page.query_selector_all(sel)
                for a in links:
                    try:
                        href = a.get_attribute("href") or ""
                        if href.startswith("http") and "perplexity.ai" not in href.lower():
                            sources.append({"url": href, "title": ""})
                    except Exception:
                        continue
            except Exception:
                continue

    if not sources:
        try:
            answer_links = page.query_selector_all("main a[href]")
            for a in answer_links:
                try:
                    href = a.get_attribute("href") or ""
                    if href.startswith("http") and "perplexity.ai" not in href.lower():
                        sources.append({"url": href, "title": ""})
                except Exception:
                    continue
        except Exception:
            pass

    deduped = _dedupe(sources)
    log(f"Total sources found: {len(deduped)}")
    return deduped[:max_sources] if max_sources else deduped


def live_run(
    question: str,
    headless: bool,
    timeout: int,
    max_sources: int,
    profile_dir_name: str,
    forced_subprofile: Optional[str],
):
    log("Starting live run...")

    resolved = resolve_profile_root_and_subdir(profile_dir_name, forced_subprofile)

    with sync_playwright() as p:
        if resolved:
            root, sub = resolved
            context: BrowserContext = p.chromium.launch_persistent_context(
                user_data_dir=str(root),
                channel="chrome",
                headless=headless,
                no_viewport=True,
                args=[
                    f"--profile-directory={sub}",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--lang=en-US,en",
                ],
            )
            log(f"Using Chrome profile: {root} / {sub}")
        else:
            log("No Chrome profile resolved; proceeding without persistent session.")
            context = p.chromium.launch_persistent_context(
                user_data_dir="",
                channel="chrome",
                headless=headless,
                no_viewport=True,
                args=[
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                ],
            )

        page = context.new_page()

        try:
            log("Navigating to Perplexity.ai...")
            page.goto("https://www.perplexity.ai/")
            time.sleep(5)

            if not headless:
                bring_browser_to_front(page)

            _type_into_perplexity_editor(page, question, timeout=timeout)

            if not headless:
                bring_browser_to_front(page)

            if not _click_search_button_strict(page, timeout=timeout):
                _click_search_button(page, timeout=timeout)

            log("Waiting for navigation after submit...")
            try:
                page.wait_for_url("**/search/**", timeout=30000)
                log(f"Navigated to: {page.url}")
            except Exception:
                log(f"URL did not change to /search/. Current URL: {page.url}")

            page.wait_for_load_state("domcontentloaded")
            time.sleep(3)

            _wait_for_response(page, timeout=timeout)

            response_text = _extract_response_text(page)
            urls = _extract_sources_from_dom(page, max_sources=max_sources)

            return urls, response_text

        finally:
            try:
                context.close()
            except Exception:
                pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Scrape sources from Perplexity.ai search results")
    ap.add_argument("--question", default="What is Perplexity AI?")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--max-sources", type=int, default=25)
    ap.add_argument("--html-file", type=str, default=None)
    ap.add_argument("--profile-dir-name", type=str, default=DEFAULT_PROFILE_DIR_NAME)
    ap.add_argument("--forced-subprofile", type=str, default=DEFAULT_FORCED_SUBPROFILE)
    ap.add_argument("--output-file")
    args = ap.parse_args()

    t0 = time.time()

    if args.html_file:
        from bs4 import BeautifulSoup
        html_path = Path(args.html_file)
        html = html_path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        sources = []
        for a in soup.find_all("a", href=True):
            href = a.get("href") or ""
            if href.startswith("http") and "perplexity.ai" not in href:
                sources.append(href)
        seen, out = set(), []
        for u in sources:
            if u not in seen:
                seen.add(u)
                out.append(u)
        json_output = json.dumps(
            {
                "mode": "offline-html",
                "question": args.question,
                "sources": out,
                "count": len(out),
                "elapsed_sec": round(time.time() - t0, 3),
            },
            indent=2,
        )
        if args.output_file:
            output_dir = Path(__file__).parent / "json_output_scrapper"
            output_dir.mkdir(exist_ok=True)
            (output_dir / args.output_file).write_text(json_output, encoding="utf-8")
        else:
            print(json_output)
        sys.exit(0)

    urls, response_text = live_run(
        args.question,
        args.headless,
        args.timeout,
        args.max_sources,
        args.profile_dir_name,
        args.forced_subprofile,
    )
    json_output = json.dumps(
        {
            "mode": "live",
            "question": args.question,
            "response": response_text,
            "sources": urls,
            "count": len(urls),
            "elapsed_sec": round(time.time() - t0, 3),
        },
        indent=2,
    )

    if args.output_file:
        output_dir = Path(__file__).parent / "json_output_scrapper"
        output_dir.mkdir(exist_ok=True)
        (output_dir / args.output_file).write_text(json_output, encoding="utf-8")
        log(f"Results saved to: {args.output_file}")
    else:
        print(json_output)
