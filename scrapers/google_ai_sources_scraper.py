# -*- coding: utf-8 -*-
"""
Google AI Search Sources Scraper
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
from typing import List, Optional, Tuple

from playwright.sync_api import sync_playwright, Page, BrowserContext

try:
    import psutil
    import win32gui
    import win32con
    import win32process
    FOREGROUND_FORCING_AVAILABLE = True
except ImportError:
    FOREGROUND_FORCING_AVAILABLE = False

DEFAULT_AI_MODE_URL = (
    "https://www.google.com/search?udm=50&aep=46&source=25q2-US-SearchSites-Site-CTA"
)
DEFAULT_PROFILE_DIR_NAME = os.environ.get("GOOGLEAI_PROFILE", "chrome_profile_googleai")


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [GAI] {msg}", file=sys.stderr)


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
                log(f"Using Chrome profile: {cand} / {sub}")
                return cand, sub
    return None


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
        browser = page.context.browser
        browser_pid = browser.process.pid if browser.process else None
        if browser_pid is None:
            return False
        chrome_pid = None
        try:
            parent = psutil.Process(browser_pid)
            for child in parent.children(recursive=True):
                if "chrome" in child.name().lower():
                    chrome_pid = child.pid
                    break
        except psutil.Error:
            pass
        if chrome_pid is None:
            chrome_pid = browser_pid
        target_hwnd = None

        def enum_handler(hwnd, _):
            nonlocal target_hwnd
            if not win32gui.IsWindowVisible(hwnd):
                return True
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid == chrome_pid:
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


def _strip_tracking(source) -> dict:
    try:
        if isinstance(source, dict):
            u = source.get("url", "")
            title = source.get("title", "")
        else:
            u = source
            title = ""
        base = u.split("?utm_")[0]
        if "/url?" in u and "google.com" in u:
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(u).query)
            if "q" in qs and qs["q"]:
                base = qs["q"][0]
        return {"url": base, "title": title}
    except Exception:
        if isinstance(source, dict):
            return source
        return {"url": source, "title": ""}


def _fetch_page_title(url: str, timeout: int = 10) -> str:
    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "html.parser")
        t = soup.find("title")
        if t and t.text:
            title = t.text.strip().replace("\n", " ").replace("\r", " ")
            return (title[:197] + "...") if len(title) > 200 else title
        return f"Source: {urlparse(url).netloc}"
    except Exception:
        try:
            from urllib.parse import urlparse
            return f"Source: {urlparse(url).netloc}"
        except Exception:
            return url


def _type_into_google_ai_prompt(page: Page, text: str, timeout: int = 60) -> None:
    log("Locating AI prompt box...")
    selectors = [
        "textarea[placeholder='Ask anything']",
        "textarea[aria-label='Ask anything']",
        "main textarea",
        "form textarea",
        "[contenteditable='true'][role='textbox']",
        "main [contenteditable='true']",
        "textarea",
    ]

    editor = None
    for sel in selectors:
        try:
            el = page.wait_for_selector(sel, timeout=5000)
            if el and el.is_visible():
                editor = el
                log(f"Found editor via: {sel}")
                break
        except Exception:
            continue

    if not editor:
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            for sel in selectors:
                try:
                    el = frame.wait_for_selector(sel, timeout=2000)
                    if el and el.is_visible():
                        editor = el
                        log(f"Found editor in frame via: {sel}")
                        break
                except Exception:
                    continue
            if editor:
                break

    if not editor:
        handle = page.evaluate_handle(
            """() => {
            const vis = el => el && el.offsetParent !== null;
            const matchBox = (el) => {
                const ph = (el.getAttribute('placeholder') || '').toLowerCase();
                const al = (el.getAttribute('aria-label') || '').toLowerCase();
                return ph.includes('ask anything') || al.includes('ask anything');
            };
            let cand = Array.from(document.querySelectorAll('textarea')).find(t => matchBox(t))
                    || document.querySelector('[contenteditable="true"][role="textbox"]')
                    || document.querySelector('main [contenteditable="true"]')
                    || document.querySelector('textarea');
            if (cand && vis(cand)) return cand;
            return null;
        }"""
        )
        if handle:
            editor = handle.as_element()

    if not editor:
        raise RuntimeError("Could not find the AI prompt box")

    tag = editor.evaluate("el => el.tagName.toLowerCase()")
    if tag in ("textarea", "input"):
        editor.fill(text)
    else:
        editor.click()
        page.keyboard.press("Control+a")
        time.sleep(0.1)
        page.keyboard.press("Delete")
        time.sleep(0.1)
        editor.press_sequentially(text)

    log(f"Typed prompt: {text}")


def _click_ask_submit(page: Page, timeout: int = 30) -> bool:
    log("Submitting the prompt...")
    selectors = [
        "button[aria-label*='Send']",
        "button[aria-label*='Submit']",
        "button[aria-label*='Ask']",
        "button[type='submit']",
        "button.submit-button",
        "main button[aria-label]",
        "form button",
    ]
    for sel in selectors:
        try:
            btn = page.wait_for_selector(sel, timeout=3000)
            if btn and btn.is_visible():
                btn.click()
                log(f"Clicked submit via: {sel}")
                return True
        except Exception:
            continue

    try:
        page.keyboard.press("Enter")
        log("Submitted via Enter key")
        return True
    except Exception:
        pass

    try:
        result = page.evaluate(
            """() => {
            const btns = Array.from(document.querySelectorAll('button'));
            for (const b of btns) {
                const al = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || '').toLowerCase();
                if (al.includes('send') || al.includes('submit') || al.includes('ask') ||
                    txt.includes('send') || txt.includes('submit') || txt.includes('ask')) {
                    b.click();
                    return true;
                }
            }
            return false;
        }"""
        )
        if result:
            log("Clicked submit via JS")
            return True
    except Exception:
        pass

    log("WARN: Could not find submit button.")
    return False


def _wait_for_ai_response(page: Page, max_wait: int = 90) -> None:
    log("Waiting for AI response to complete...")
    start = time.time()
    last_content_length = 0
    stable_count = 0
    min_response_length = 300

    time.sleep(2)

    while time.time() - start < max_wait:
        try:
            result = page.evaluate(
                """() => {
                const threadDiv = document.querySelector('div[data-session-thread-id]');
                if (!threadDiv) return { found: false, length: 0 };
                const parentDiv = threadDiv.parentElement;
                if (!parentDiv) return { found: false, length: 0 };
                const text = parentDiv.innerText || '';
                const lines = text.split('\\n');
                const validLines = [];
                for (let line of lines) {
                    if (!line.trim()) continue;
                    if (line.includes('Ask anything') || line.includes('Free local events') ||
                        line.includes('Make a table comparing') || line.includes('How do I get started')) continue;
                    validLines.push(line);
                }
                const cleanText = validLines.join(' ');
                const isComplete = parentDiv.querySelector('[data-complete="true"]') !== null;
                const hasSources = text.toLowerCase().includes('sources') || text.toLowerCase().includes('learn more');
                const links = parentDiv.querySelectorAll('a[href^="http"]');
                const externalLinks = Array.from(links).filter(a => !a.href.includes('google.com')).length;
                return { found: true, length: cleanText.length, complete: isComplete, hasSources: hasSources, externalLinks: externalLinks };
            }"""
            )

            if result and result["found"]:
                current_length = result["length"]
                is_complete = result["complete"]
                has_sources = result["hasSources"]
                external_links = result["externalLinks"]

                if current_length > last_content_length:
                    log(f"Response loading: {current_length} chars, {external_links} links")
                    stable_count = 0
                elif current_length == last_content_length and current_length >= min_response_length:
                    stable_count += 1

                last_content_length = current_length

                if ((is_complete and current_length >= min_response_length) or
                    (stable_count >= 3 and current_length >= min_response_length) or
                    (has_sources and external_links >= 3 and current_length >= min_response_length)):
                    log(f"[OK] AI response complete: {current_length} chars, {external_links} links")
                    time.sleep(1)
                    return
        except Exception as e:
            log(f"Error checking response: {e}")

        time.sleep(1)

    log("Max wait reached - proceeding with extraction")


def _extract_response_text(page: Page) -> str:
    log("Extracting AI response text...")
    response_text = ""

    try:
        response_data = page.evaluate(
            """() => {
            const threadDiv = document.querySelector('div[data-session-thread-id]');
            if (!threadDiv) return { success: false, text: '' };
            const parentDiv = threadDiv.parentElement;
            if (!parentDiv) return { success: false, text: '' };
            let responseText = '';
            const contentSelectors = ['div[data-subtree="aimc"]', 'div.Zkbeff', 'div[jscontroller][data-ved]', 'div[data-complete="true"]'];
            for (let selector of contentSelectors) {
                const contentDivs = parentDiv.querySelectorAll(selector);
                for (let div of contentDivs) {
                    const text = div.innerText || '';
                    if (text.length > responseText.length && text.length > 100) {
                        const hasRealContent = text.includes('.') || text.includes('!') || text.includes('?');
                        const linkCount = div.querySelectorAll('a').length;
                        if (hasRealContent && (linkCount < 20 || text.length / linkCount > 30)) {
                            responseText = text;
                        }
                    }
                }
            }
            if (!responseText || responseText.length < 200) {
                const getAllText = (node) => {
                    let text = '';
                    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return '';
                    if (node.nodeType === Node.TEXT_NODE) text = node.textContent || '';
                    else if (node.nodeType === Node.ELEMENT_NODE) {
                        for (let child of node.childNodes) text += getAllText(child) + ' ';
                    }
                    return text;
                };
                responseText = getAllText(parentDiv);
            }
            if (responseText) {
                responseText = responseText.replace(/\\s+/g, ' ').trim();
                const noisePatterns = [/Ask anything[\\s\\S]{0,100}$/gi, /Sources?\\s*$/gi, /Learn more\\s*$/gi, /Show all\\s*$/gi, /Feedback\\s*$/gi, /Share\\s*$/gi, /Save\\s*$/gi];
                for (let pattern of noisePatterns) responseText = responseText.replace(pattern, '');
                responseText = responseText.replace(/\\s+/g, ' ').trim();
            }
            return { success: true, text: responseText, length: responseText.length };
        }"""
        )

        if response_data and response_data["success"] and response_data["text"]:
            response_text = response_data["text"]
            log(f"Extracted {response_data['length']} chars from response container")
    except Exception as e:
        log(f"JavaScript extraction error: {e}")

    if not response_text or len(response_text) < 200:
        selectors = ['div[data-subtree="aimc"]', "div.Zkbeff", "div[jscontroller][data-ved]", 'div[data-complete="true"]']
        for selector in selectors:
            try:
                elements = page.query_selector_all(selector)
                for element in elements:
                    text = (element.text_content() or "").strip()
                    if text and len(text) > len(response_text):
                        if "." in text or "?" in text or "!" in text or len(text) > 50:
                            response_text = text
                            break
            except Exception:
                continue

    if response_text:
        response_text = " ".join(response_text.split())
        log(f"Final extracted response: {len(response_text)} characters")
    else:
        log("[WARN] No response text extracted")

    return response_text


def _scroll_to_show_all_and_click(page: Page) -> None:
    try:
        result = page.evaluate(
            """() => {
            const btns = Array.from(document.querySelectorAll('button, [role="button"], span[tabindex="0"], div[role="button"]'));
            for (const b of btns) {
                const txt = (b.innerText || '').toLowerCase();
                const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                if (txt.includes('show all') || txt.includes('see more') || txt.includes('show more') || txt.includes('view all') ||
                    ariaLabel.includes('show all') || ariaLabel.includes('see more')) {
                    b.scrollIntoView({behavior: 'smooth', block: 'center'});
                    b.click();
                    return true;
                }
            }
            return false;
        }"""
        )
        if result:
            log("Clicked 'Show all' button")
            time.sleep(2)
    except Exception:
        pass


def _wait_for_sources_links(page: Page, min_links: int = 3, max_wait: int = 45) -> None:
    log(f"Waiting for at least {min_links} source links...")
    start = time.time()
    while time.time() - start < max_wait:
        try:
            count = page.evaluate(
                """() => {
                const links = Array.from(document.querySelectorAll('a[href^="http"]'));
                return links.filter(a => {
                    const href = a.getAttribute('href') || '';
                    return !href.includes('google.com') && !href.includes('webcache.googleusercontent.com');
                }).length;
            }"""
            )
            if count >= min_links:
                log(f"Found {count} external links, proceeding.")
                return
        except Exception:
            pass
        time.sleep(1)
    log("Max wait reached. Proceeding with extraction.")


def _extract_sources_from_dom(page: Page, max_sources: int = 200) -> List[dict]:
    log("Extracting sources from DOM...")
    urls = []

    try:
        extracted = page.evaluate(
            """() => {
            const sidePanel = document.querySelector('[data-container-id="rhs-col"]') ||
                              document.querySelector('[data-container-id*="rhs"]') ||
                              document.querySelector('div[role="complementary"]');
            if (!sidePanel) return null;
            let sources = [];
            const semanticLinks = Array.from(sidePanel.querySelectorAll('a[aria-label][href^="http"], a[data-ved][href^="http"]'));
            if (semanticLinks.length > 0) {
                sources = semanticLinks.map(a => ({ url: a.getAttribute('href'), title: (a.innerText || a.textContent || a.getAttribute('aria-label') || '').trim() }));
            }
            if (sources.length === 0) {
                sources = Array.from(sidePanel.querySelectorAll('li > a[href^="http"]')).map(a => ({ url: a.getAttribute('href'), title: (a.innerText || '').trim() }));
            }
            if (sources.length === 0) {
                sources = Array.from(sidePanel.querySelectorAll('a[target="_blank"][href^="http"]')).map(a => ({ url: a.getAttribute('href'), title: (a.innerText || '').trim() }));
            }
            return sources.filter(s => s.url && !s.url.includes('google.com') && !s.url.includes('webcache.googleusercontent.com') && !s.url.includes('gstatic.com'));
        }"""
        )
        if extracted and len(extracted) > 0:
            urls = extracted
            log(f"Extracted {len(urls)} sources from side panel")
    except Exception as e:
        log(f"Side panel extraction error: {e}")

    if not urls:
        try:
            extracted = page.evaluate(
                """() => {
                const links = Array.from(document.querySelectorAll('a[href^="http"]'));
                return links.filter(a => {
                    const href = a.getAttribute('href') || '';
                    return !href.includes('google.com') && !href.includes('webcache.googleusercontent.com') && !href.includes('gstatic.com');
                }).map(a => ({ url: a.getAttribute('href'), title: (a.innerText || '').trim() }));
            }"""
            )
            if extracted:
                urls = extracted
                log(f"Extracted {len(urls)} sources via DOM-wide search")
        except Exception as e:
            log(f"DOM-wide extraction error: {e}")

    cleaned = [_strip_tracking(u) for u in urls if u]
    deduped = _dedupe(cleaned)
    log(f"Total unique sources after cleaning: {len(deduped)}")
    return deduped[:max_sources] if max_sources else deduped


def live_run(
    question: str,
    headless: bool = False,
    timeout: int = 90,
    max_sources: int = 200,
    ai_mode_url: str = DEFAULT_AI_MODE_URL,
    profile_dir_name: str = DEFAULT_PROFILE_DIR_NAME,
    forced_subprofile: Optional[str] = None,
    min_sources: int = 3,
) -> Tuple[List[dict], str]:
    log("Starting Google AI Mode scraper.")
    log(f"Question: {question}")

    resolved = resolve_profile_root_and_subdir(profile_dir_name, forced_subprofile)

    with sync_playwright() as p:
        if resolved:
            root, sub = resolved
            context: BrowserContext = p.chromium.launch_persistent_context(
                user_data_dir=str(root),
                channel="chrome",
                headless=headless,
                no_viewport=True,
                args=[f"--profile-directory={sub}", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US,en"],
            )
            log(f"Using Chrome profile: {root} / {sub}")
        else:
            context: BrowserContext = p.chromium.launch_persistent_context(
                user_data_dir="",
                channel="chrome",
                headless=headless,
                no_viewport=True,
                args=["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US,en"],
            )

        page = context.new_page()

        try:
            log(f"Navigating to: {ai_mode_url}")
            page.goto(ai_mode_url)
            page.wait_for_load_state("domcontentloaded")
            time.sleep(2)

            if not headless:
                bring_browser_to_front(page)

            if "accounts.google.com" in page.url.lower():
                log("WARNING: Not logged in to Google. Cannot proceed in subprocess mode.")
                raise RuntimeError("Not logged in to Google")

            if not headless:
                bring_browser_to_front(page)

            _type_into_google_ai_prompt(page, question, timeout=timeout)

            if not headless:
                bring_browser_to_front(page)

            ok = _click_ask_submit(page, timeout=timeout // 3)
            if not ok:
                raise RuntimeError("Could not submit the question to AI mode")

            _wait_for_ai_response(page, max_wait=timeout)
            response_text = _extract_response_text(page)
            _scroll_to_show_all_and_click(page)
            _wait_for_sources_links(page, min_links=min_sources, max_wait=max(20, timeout // 2))
            urls = _extract_sources_from_dom(page, max_sources=max_sources)

            log(f"Completed: {len(response_text)} chars response, {len(urls)} source URLs")
            return urls, response_text

        finally:
            try:
                context.close()
            except Exception:
                pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Google AI Mode scraper")
    ap.add_argument("--question", required=False, default="What is Google AI Overview?")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--max-sources", type=int, default=200)
    ap.add_argument("--ai-mode-url", type=str, default=DEFAULT_AI_MODE_URL)
    ap.add_argument("--html-file", type=str, default=None)
    ap.add_argument("--profile-dir-name", type=str, default=DEFAULT_PROFILE_DIR_NAME)
    ap.add_argument("--forced-subprofile", type=str, default=None)
    ap.add_argument("--min-sources", type=int, default=3)
    ap.add_argument("--output-file")
    args = ap.parse_args()

    t0 = time.time()

    if args.html_file:
        from bs4 import BeautifulSoup
        urls_raw = []
        html = Path(args.html_file).read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("http") and "google.com" not in href and "googleusercontent.com" not in href:
                urls_raw.append(_strip_tracking(href))
        deduped = _dedupe(urls_raw)[:args.max_sources]
        json_output = json.dumps({"mode": "offline-html", "question": args.question, "sources": deduped, "count": len(deduped), "elapsed_sec": round(time.time() - t0, 3)}, indent=2)
        if args.output_file:
            output_dir = Path(__file__).parent / "json_output_scrapper"
            output_dir.mkdir(exist_ok=True)
            (output_dir / args.output_file).write_text(json_output, encoding="utf-8")
        else:
            print(json_output)
        sys.exit(0)

    urls, response_text = live_run(
        question=args.question, headless=args.headless, timeout=args.timeout,
        max_sources=args.max_sources, ai_mode_url=args.ai_mode_url,
        profile_dir_name=args.profile_dir_name, forced_subprofile=args.forced_subprofile,
        min_sources=args.min_sources,
    )

    json_output = json.dumps({"mode": "live", "question": args.question, "response": response_text, "sources": urls, "count": len(urls), "elapsed_sec": round(time.time() - t0, 3)}, indent=2)

    if args.output_file:
        output_dir = Path(__file__).parent / "json_output_scrapper"
        output_dir.mkdir(exist_ok=True)
        (output_dir / args.output_file).write_text(json_output, encoding="utf-8")
        log(f"Results saved to: {args.output_file}")
    else:
        print(json_output)
