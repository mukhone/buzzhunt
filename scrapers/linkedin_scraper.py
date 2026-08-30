"""
LinkedIn Scraper - Keyword monitoring for LinkedIn posts
Uses Playwright for browser automation.

Output: flat list matching backend contract:
  [{"url": "...", "title": "...", "age": null, "keywords": ["kw1"]}]
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


PROFILE_DIR_NAME = os.environ.get("LINKEDIN_PROFILE", "chrome_profile_linkedin")
FORCED_SUBPROFILE = None

RETRY_ATTEMPTS = 3
RETRY_DELAY = 1.0


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [LINKEDIN] {msg}", file=sys.stderr)


def resolve_profile_root_and_subdir(
    profile_dir_name: str,
    forced_subprofile: Optional[str] = None,
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
                log(f"Profile resolved: {cand} (sub={sub})")
                return cand, sub

    log("No profile found. Headless mode.")
    return None


def build_search_url(keyword: str) -> str:
    q = urllib.parse.quote_plus(keyword)
    return (
        "https://www.linkedin.com/search/results/content/"
        f"?keywords={q}&origin=FACETED_SEARCH"
    )


def get_post_text(item) -> Optional[str]:
    for attempt in range(RETRY_ATTEMPTS):
        try:
            result = item.evaluate(
                """el => {
                const box = el.querySelector('[data-testid="expandable-text-box"]');
                if (!box) return null;
                return box.innerText.trim();
            }"""
            )
            return result
        except Exception as e:
            log(f"  post_text attempt {attempt+1} failed: {e}")
            time.sleep(RETRY_DELAY)
    return None


def get_post_url_from_urn(item) -> str:
    """Extract post URL from data-urn attribute (fast, no popup needed)."""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            urn = item.evaluate(
                """el => {
                const urnEl = el.closest('[data-urn]') || el.querySelector('[data-urn]');
                return urnEl ? urnEl.getAttribute('data-urn') : '';
            }"""
            )
            if urn and "urn:li:activity:" in urn:
                return f"https://www.linkedin.com/feed/update/{urn}/"
        except Exception as e:
            log(f"  urn extraction attempt {attempt+1} failed: {e}")
            time.sleep(RETRY_DELAY)
    return ""


ITEM_SEL = 'div[role="listitem"][componentkey^="expanded"]'


def extract_posts_flat(page: Page, keyword: str, desired_count: int, max_scrolls: int) -> List[Dict]:
    posts: List[Dict] = []
    seen_urls: set = set()
    processed_idx: set = set()
    bottom_scrolls: int = 0

    try:
        page.wait_for_selector(ITEM_SEL, timeout=15_000)
    except Exception:
        log("No post items appeared.")
        return posts

    while len(posts) < desired_count and bottom_scrolls <= max_scrolls:
        all_items = page.query_selector_all(ITEM_SEL)
        new_items = [
            (i, el) for i, el in enumerate(all_items) if i not in processed_idx
        ]

        if not new_items:
            prev_count = len(all_items)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            bottom_scrolls += 1
            log(f"  Scrolled to bottom (attempt {bottom_scrolls})")
            try:
                page.wait_for_function(
                    f"""document.querySelectorAll('{ITEM_SEL}').length > {prev_count}""",
                    timeout=10_000,
                )
            except Exception:
                log("No new posts loaded after scroll. Stopping.")
                break
            continue

        for idx, item in new_items:
            if len(posts) >= desired_count:
                break

            processed_idx.add(idx)

            post_text = get_post_text(item)
            if post_text is None:
                continue

            post_url = get_post_url_from_urn(item)
            if not post_url or post_url in seen_urls:
                continue
            seen_urls.add(post_url)

            title = post_text[:280] if post_text else ""

            posts.append({
                "url": post_url,
                "title": title,
                "age": None,
                "keywords": [keyword],
            })
            log(f"  Saved post {len(posts)}/{desired_count}")

            try:
                page.evaluate(
                    """el => {
                    const rect = el.getBoundingClientRect();
                    window.scrollBy({ top: rect.height, behavior: 'smooth' });
                }""",
                    item,
                )
                time.sleep(1.0)
            except Exception:
                page.evaluate("window.scrollBy(0, 700)")
                time.sleep(1.0)

    log(f"Collected {len(posts)}/{desired_count} posts for '{keyword}'")
    return posts


def scrape_linkedin(keywords: List[str], posts_per_keyword: int, max_scrolls: int) -> List[Dict]:
    log(f"Starting: {keywords}")

    resolved = resolve_profile_root_and_subdir(PROFILE_DIR_NAME, FORCED_SUBPROFILE)
    url_map: Dict[str, Dict] = {}

    with sync_playwright() as p:
        if resolved:
            profile_root, subprofile = resolved
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(profile_root),
                channel="chrome",
                headless=False,
                no_viewport=True,
                args=[f"--profile-directory={subprofile}"],
            )
            log("Profile mode")
        else:
            browser = p.chromium.launch(channel="chrome", headless=False)
            context = browser.new_context()

        page = context.new_page()

        try:
            for keyword in keywords:
                log(f"--- Keyword: '{keyword}' ---")
                page.goto(build_search_url(keyword))
                time.sleep(3)

                if "/uas/login" in page.url or "login" in page.url:
                    log("Not logged in to LinkedIn. Returning empty results.")
                    continue

                posts = extract_posts_flat(page, keyword, posts_per_keyword, max_scrolls)

                for post in posts:
                    url = post["url"]
                    if url not in url_map:
                        url_map[url] = {
                            "url": url,
                            "title": post["title"],
                            "age": None,
                            "keywords": set(),
                        }
                    url_map[url]["keywords"].add(keyword)
        finally:
            context.close()

    results = [
        {
            "url": data["url"],
            "title": data["title"],
            "age": data["age"],
            "keywords": sorted(list(data["keywords"])),
        }
        for data in url_map.values()
    ]

    log(f"Finished. Total unique posts: {len(results)}")
    return results


def parse_args():
    p = argparse.ArgumentParser(description="LinkedIn post scraper")
    p.add_argument("--email", default="", help="User email (for logging)")
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument(
        "--posts-per-keyword", type=int, default=10, help="Max posts per keyword"
    )
    p.add_argument(
        "--max-scrolls", type=int, default=1, help="Max bottom-of-page scrolls"
    )
    p.add_argument(
        "--output-file",
        default=None,
        help="Output filename (saved to json_output_scrapper/)",
    )
    return p.parse_args()


def main():
    args = parse_args()
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    if not keywords:
        log("Error: No keywords provided")
        sys.exit(1)

    log(f"User: {args.email}")

    try:
        results = scrape_linkedin(
            keywords,
            args.posts_per_keyword,
            args.max_scrolls,
        )

        json_output = json.dumps(results, indent=2, ensure_ascii=False)

        if args.output_file:
            out_dir = Path(__file__).parent / "json_output_scrapper"
            out_dir.mkdir(exist_ok=True)
            (out_dir / args.output_file).write_text(json_output, encoding="utf-8")
            log(f"Results saved to: {args.output_file}")
        else:
            print(json_output)
    except Exception as e:
        log(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
