# -*- coding: utf-8 -*-
"""
ChatGPT Sources Scraper
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

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

DEFAULT_PROFILE_DIR_NAME = os.environ.get("CHATGPT_PROFILE", "chrome_profile_chatgpt")


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [CHATGPT] {msg}", file=sys.stderr)


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


def _fetch_page_title(url: str, timeout: int = 10) -> str:
    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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


def _type_into_chatgpt_composer(page, text: str, timeout: int = 90, add_search_prefix: bool = True) -> None:
    if add_search_prefix and not text.lower().startswith("search:"):
        text = f"Search: {text}"
        log("Prepended 'Search: ' to trigger web search")

    log(f"Typing into ChatGPT composer: {text[:100]}...")

    selectors = [
        "div.ProseMirror#prompt-textarea[contenteditable='true']",
        "div#prompt-textarea[contenteditable='true']",
        "div.ProseMirror[contenteditable='true']",
        "[contenteditable='true'][role='textbox']",
        "textarea[placeholder*='Message']",
        "textarea#prompt-textarea",
        "[data-testid='composer-input']",
        "[data-testid='message-input']",
    ]

    editor_locator = None
    for sel in selectors:
        try:
            page.wait_for_selector(sel, timeout=5000)
            editor_locator = page.locator(sel).first
            log(f"Found composer with selector: {sel}")
            break
        except PlaywrightTimeoutError:
            continue

    if editor_locator is None:
        raise PlaywrightTimeoutError("Could not find ChatGPT composer")

    editor_locator.scroll_into_view_if_needed()
    time.sleep(0.3)

    success = editor_locator.evaluate(
        """
        (editor, text) => {
            try {
                editor.focus();
                const selectAll = new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true
                });
                editor.dispatchEvent(selectAll);
                document.execCommand('selectAll', false, null);
                const inserted = document.execCommand('insertText', false, text);
                return inserted ? (editor.innerText || editor.textContent || '').trim() : '';
            } catch (e) {
                return '';
            }
        }
        """,
        text,
    )

    time.sleep(0.5)
    text_content = success.strip() if success else ""

    if not text_content:
        log("[WARN] execCommand injection failed, trying fallback method...")
        time.sleep(0.5)
        success = editor_locator.evaluate(
            """
            (editor, text) => {
                try {
                    editor.focus();
                    editor.innerHTML = '';
                    document.execCommand('insertText', false, text);
                    return (editor.innerText || editor.textContent || '').trim();
                } catch(e) {
                    return '';
                }
            }
            """,
            text,
        )
        text_content = success.strip() if success else ""
        if not text_content:
            raise RuntimeError("Failed to inject text into composer after retry")

    log(f"[OK] Text entered: {len(text_content)} chars")


def _click_send(page, timeout: int = 10) -> bool:
    send_selectors = [
        "button#composer-submit-button",
        "button[data-testid='send-button']",
        "button[data-testid='composer-send-button']",
        "button[aria-label*='Send']",
        "button[type='submit']:not([disabled])",
    ]

    for sel in send_selectors:
        try:
            btn = page.locator(sel).first
            if btn.is_enabled():
                btn.click()
                log(f"Clicked Send button using: {sel}")
                return True
        except Exception:
            continue

    try:
        result = page.evaluate(
            """
            () => {
                const forms = document.querySelectorAll('form');
                for (let form of forms) {
                    const buttons = form.querySelectorAll('button');
                    if (buttons.length > 0) {
                        const lastBtn = buttons[buttons.length - 1];
                        if (!lastBtn.disabled) {
                            lastBtn.click();
                            return true;
                        }
                    }
                }
                return false;
            }
            """
        )
        if result:
            log("Clicked Send via JavaScript")
            return True
    except Exception:
        pass

    try:
        editor = page.locator("[contenteditable='true']").first
        editor.press("Enter")
        log("Pressed Enter as fallback")
        return True
    except Exception:
        pass

    log("WARNING: Could not click Send button")
    return False


def _extract_response_text(page) -> str:
    response_selectors = [
        "xpath=//div[contains(@class, 'markdown')]//p",
        "xpath=//div[@data-message-author-role='assistant']",
        "xpath=//div[contains(@class, 'response')]",
        "xpath=//div[contains(@class, 'prose')]",
        "xpath=//article//p",
        "xpath=//main//div[contains(@class, 'text-')]//p",
    ]

    response_text = ""
    for selector in response_selectors:
        try:
            elements = page.locator(selector).all()
            if elements:
                texts = []
                for el in elements:
                    try:
                        text = el.inner_text().strip()
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
            response_text = page.evaluate(
                """
                () => {
                    const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                    if (messages.length > 0) {
                        const lastMsg = messages[messages.length - 1];
                        return lastMsg.innerText || lastMsg.textContent || '';
                    }
                    return '';
                }
                """
            )
        except Exception:
            pass

    log(f"Extracted response text: {len(response_text)} characters")
    return response_text


def _wait_for_sources_button(page, max_wait: int = 60) -> bool:
    log("Waiting for Sources button to appear...")

    for i in range(max_wait):
        try:
            sources_btn = page.evaluate(
                """
                () => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => {
                        const label = b.getAttribute('aria-label');
                        const text = b.textContent;
                        return (label && label.includes('Sources')) ||
                               (text && text.includes('Sources'));
                    }) || null;
                }
                """
            )
            if sources_btn:
                log("Sources button detected!")
                return True

            stop_btn = page.evaluate(
                """
                () => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => {
                        const label = b.getAttribute('aria-label');
                        return label && label.includes('Stop');
                    }) || null;
                }
                """
            )

            if not stop_btn:
                time.sleep(2)
                sources_check = page.evaluate(
                    """
                    () => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        return buttons.some(b => {
                            const label = b.getAttribute('aria-label');
                            const text = b.textContent;
                            return (label && label.includes('Sources')) ||
                                   (text && text.includes('Sources'));
                        });
                    }
                    """
                )
                if sources_check:
                    log("Sources button available")
                    return True

        except Exception as e:
            log(f"Error checking for Sources: {e}")

        time.sleep(1)
        if i % 5 == 0:
            log(f"Still waiting for Sources button... ({i}s)")

    log("WARNING: Sources button did not appear")
    return False


def _click_sources_button(page) -> bool:
    try:
        result = page.evaluate(
            """
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const sourcesBtn = buttons.find(b => {
                    const label = b.getAttribute('aria-label');
                    const text = b.textContent;
                    return (label && label.includes('Sources')) ||
                           (text && text.includes('Sources'));
                });
                if (sourcesBtn) { sourcesBtn.click(); return true; }
                return false;
            }
            """
        )
        if result:
            log("Successfully clicked Sources button")
            time.sleep(2)
            return True
    except Exception as e:
        log(f"Error clicking Sources: {e}")
    return False


def _extract_sources_comprehensive(page, max_sources: int = 50) -> List[dict]:
    log("Extracting sources from page...")
    urls = []

    try:
        panel_urls = page.evaluate(
            """
            () => {
                const sources = [];
                const listLinks = Array.from(document.querySelectorAll('li > a[href^="http"]'));
                listLinks.forEach(a => {
                    let href = a.href;
                    if (href.includes('?utm_source=')) href = href.split('?utm_source=')[0];
                    if (!href.includes('chatgpt.com') && !href.includes('openai.com')) {
                        sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                    }
                });
                const headers = Array.from(document.querySelectorAll('h2, h3, li'));
                for (let header of headers) {
                    if (header.textContent.includes('Citations') || header.textContent.includes('Sources') || header.textContent === 'More') {
                        let sibling = header.nextElementSibling;
                        while (sibling && sibling.tagName !== 'UL') sibling = sibling.nextElementSibling;
                        if (sibling) {
                            sibling.querySelectorAll('a[href]').forEach(a => {
                                let href = a.href;
                                if (href.includes('?utm_source=')) href = href.split('?utm_source=')[0];
                                if (href.startsWith('http') && !href.includes('chatgpt.com')) {
                                    sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                                }
                            });
                        }
                    }
                }
                return sources;
            }
            """
        )
        if panel_urls:
            urls.extend(panel_urls)
            log(f"Found {len(panel_urls)} sources in Sources panel")
    except Exception as e:
        log(f"Panel extraction error: {e}")

    try:
        pill_urls = page.evaluate(
            """
            () => {
                const sources = [];
                document.querySelectorAll('[data-testid*="citation"], [class*="citation"], a[href]').forEach(elem => {
                    if (elem.tagName === 'A') {
                        let href = elem.href;
                        if (href.includes('?utm_source=')) href = href.split('?utm_source=')[0];
                        if (href.startsWith('http') && !href.includes('chatgpt.com') && !href.includes('openai.com')) {
                            sources.push({ url: href, title: (elem.innerText || elem.textContent || '').trim() });
                        }
                    } else {
                        elem.querySelectorAll('a[href]').forEach(a => {
                            let href = a.href;
                            if (href.includes('?utm_source=')) href = href.split('?utm_source=')[0];
                            if (href.startsWith('http') && !href.includes('chatgpt.com')) {
                                sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                            }
                        });
                    }
                });
                return sources;
            }
            """
        )
        if pill_urls:
            urls.extend(pill_urls)
            log(f"Found {len(pill_urls)} sources in citation pills")
    except Exception as e:
        log(f"Pills extraction error: {e}")

    if not urls:
        try:
            all_urls = page.evaluate(
                """
                () => {
                    const sources = [];
                    document.querySelectorAll('a[href^="http"]').forEach(a => {
                        let href = a.href;
                        if (href.includes('?utm_source=')) href = href.split('?utm_source=')[0];
                        if (!href.includes('chatgpt.com') && !href.includes('openai.com')) {
                            sources.push({ url: href, title: (a.innerText || a.textContent || '').trim() });
                        }
                    });
                    return sources;
                }
                """
            )
            if all_urls:
                urls.extend(all_urls)
                log(f"Found {len(all_urls)} external sources as fallback")
        except Exception as e:
            log(f"Fallback extraction error: {e}")

    deduped = _dedupe(urls)
    log(f"Total unique sources found: {len(deduped)}")
    return deduped[:max_sources] if max_sources else deduped


def live_run(
    question: str,
    headless: bool,
    timeout: int,
    max_sources: int,
    profile_dir_name: str,
    forced_subprofile: Optional[str],
    add_search_prefix: bool = True,
) -> Tuple[List[str], str]:
    log("Starting live run...")
    log(f"Question: {question}")

    resolved = resolve_profile_root_and_subdir(profile_dir_name, forced_subprofile)

    with sync_playwright() as p:
        context = None

        try:
            if resolved and not headless:
                root, sub = resolved
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(root),
                    channel="chrome",
                    headless=False,
                    no_viewport=True,
                    args=[f"--profile-directory={sub}"],
                )
                log(f"Using Chrome profile: {root} / {sub}")
            else:
                log("Using temporary Chrome profile")
                context = p.chromium.launch_persistent_context(
                    user_data_dir="",
                    channel="chrome",
                    headless=headless,
                    no_viewport=True,
                )

            page = context.new_page()

            log("Navigating to ChatGPT...")
            page.goto("https://chatgpt.com/")
            time.sleep(3.0)

            current_url = page.url
            if "auth" in current_url.lower() or "login" in current_url.lower():
                log("WARNING: Not logged in to ChatGPT. Cannot proceed in subprocess mode.")
                raise RuntimeError("Not logged in to ChatGPT")

            _type_into_chatgpt_composer(
                page, question, timeout=timeout, add_search_prefix=add_search_prefix
            )

            time.sleep(1.5)

            if not _click_send(page, timeout=timeout):
                raise RuntimeError("Could not submit the question")

            sources_available = _wait_for_sources_button(page, max_wait=60)
            response_text = _extract_response_text(page)

            if sources_available:
                _click_sources_button(page)
            urls = _extract_sources_comprehensive(page, max_sources=max_sources)

            log(f"Collected {len(urls)} unique sources")
            return urls, response_text

        except Exception as e:
            log(f"Error during execution: {e}")
            raise

        finally:
            try:
                if context:
                    context.close()
            except Exception:
                pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="ChatGPT Sources Scraper")
    ap.add_argument("--question", default="What is Perplexity AI?", help="Question to ask ChatGPT")
    ap.add_argument("--headless", action="store_true", help="Run in headless mode")
    ap.add_argument("--timeout", type=int, default=90, help="Timeout in seconds")
    ap.add_argument("--max-sources", type=int, default=50, help="Maximum sources to extract")
    ap.add_argument("--html-file", type=str, help="Extract from saved HTML file instead of live run")
    ap.add_argument("--profile-dir-name", type=str, default=DEFAULT_PROFILE_DIR_NAME)
    ap.add_argument("--forced-subprofile", type=str, help="Force specific Chrome subprofile")
    ap.add_argument("--no-search-prefix", action="store_true", help="Don't add 'Search:' prefix")
    ap.add_argument("--output-file", help="Save JSON output to file in json_output_scrapper/ folder")

    args = ap.parse_args()
    t0 = time.time()

    if args.html_file:
        from bs4 import BeautifulSoup
        p = Path(args.html_file)
        if not p.exists():
            print(f"Error: HTML file not found: {p}", file=sys.stderr)
            sys.exit(1)
        urls = []
        result = {
            "mode": "offline-html",
            "file": str(p),
            "question": args.question,
            "response": "",
            "sources": urls,
            "count": len(urls),
            "elapsed_sec": round(time.time() - t0, 3),
        }
    else:
        try:
            urls, response_text = live_run(
                args.question,
                args.headless,
                args.timeout,
                args.max_sources,
                args.profile_dir_name,
                args.forced_subprofile,
                add_search_prefix=not args.no_search_prefix,
            )
            result = {
                "mode": "live",
                "question": args.question,
                "response": response_text,
                "sources": urls,
                "count": len(urls),
                "elapsed_sec": round(time.time() - t0, 3),
            }
        except Exception as e:
            result = {
                "mode": "live",
                "error": str(e),
                "question": args.question,
                "response": "",
                "sources": [],
                "count": 0,
                "elapsed_sec": round(time.time() - t0, 3),
            }

    json_output = json.dumps(result, indent=2)

    if args.output_file:
        output_dir = Path(__file__).parent / "json_output_scrapper"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / args.output_file
        output_path.write_text(json_output, encoding="utf-8")
        log(f"Results saved to: {output_path}")
    else:
        print(json_output)
