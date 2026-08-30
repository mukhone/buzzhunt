"""
Medium Scraper - Keyword monitoring for Medium articles
Uses Playwright for browser automation.
No login required — public search.

Output: flat list matching backend contract:
  [{"url": "...", "title": "...", "age": null, "keywords": ["kw1"]}]
"""

import argparse
import json
import sys
import time
import urllib.parse
import datetime
from pathlib import Path
from typing import Dict, List

from playwright.sync_api import sync_playwright, Page


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [MEDIUM] {msg}", file=sys.stderr)


def build_search_url(keyword: str) -> str:
    q = urllib.parse.quote_plus(keyword)
    return f"https://medium.com/search?q={q}"


EXTRACT_JS = """
() => {
    const posts = document.querySelectorAll('article[data-testid="post-preview"]');
    const results = [];
    for (const post of posts) {
        const linkEl     = post.querySelector('div[role="link"][data-href]');
        const headingEl  = post.querySelector('h2') || post.querySelector('h3');
        const authorEl   = post.querySelector('a[href^="/@"]');

        results.push({
            url:     linkEl    ? linkEl.getAttribute('data-href') : null,
            heading: headingEl ? headingEl.textContent.trim()     : null,
        });
    }
    return results;
}
"""

COUNT_JS = """
() => document.querySelectorAll('article[data-testid="post-preview"]').length
"""

SHOW_MORE_JS = """
() => {
    const btn = [...document.querySelectorAll('button')]
                  .find(b => b.textContent.includes('Show more'));
    if (btn) { btn.click(); return true; }
    return false;
}
"""


def scrape_keyword(page: Page, keyword: str, posts_needed: int) -> List[Dict]:
    log(f"Keyword '{keyword}' -- need {posts_needed} posts")
    page.goto(build_search_url(keyword))
    time.sleep(3)

    collected: List[Dict] = []
    seen_urls = set()

    while len(collected) < posts_needed:
        raw: List[Dict] = page.evaluate(EXTRACT_JS)

        for item in raw:
            url = item.get("url")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            clean_url = url.split("?")[0] if url else url

            collected.append({
                "url": clean_url,
                "title": item.get("heading") or "",
                "age": None,
                "keywords": [keyword],
            })
            if len(collected) >= posts_needed:
                break

        log(f"  Collected {len(collected)}/{posts_needed}")

        if len(collected) >= posts_needed:
            break

        clicked = page.evaluate(SHOW_MORE_JS)
        if not clicked:
            log("  No 'Show more' button found. Stopping.")
            break

        log("  Clicked 'Show more', waiting for new posts...")
        prev_count = page.evaluate(COUNT_JS)
        for _ in range(10):
            time.sleep(1)
            new_count = page.evaluate(COUNT_JS)
            if new_count > prev_count:
                break
        else:
            log("  No new posts loaded after wait. Stopping.")
            break

    return collected[:posts_needed]


def scrape_medium(keywords: List[str], posts_per_keyword: int) -> List[Dict]:
    log(f"Keywords: {keywords} | Per keyword: {posts_per_keyword}")

    url_map: Dict[str, Dict] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=["--no-sandbox", "--disable-gpu"],
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        page = context.new_page()

        try:
            for keyword in keywords:
                log(f"--- Keyword: '{keyword}' ---")
                posts = scrape_keyword(page, keyword, posts_per_keyword)

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

                log(f"Keyword '{keyword}': {len(posts)} posts saved")
        finally:
            browser.close()

    results = [
        {
            "url": data["url"],
            "title": data["title"],
            "age": data["age"],
            "keywords": sorted(list(data["keywords"])),
        }
        for data in url_map.values()
    ]

    log(f"Finished. Total unique articles: {len(results)}")
    return results


def parse_args():
    p = argparse.ArgumentParser(description="Medium article scraper")
    p.add_argument("--email", default="", help="User email (for logging)")
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument("--posts-per-keyword", type=int, default=10, help="Posts per keyword")
    p.add_argument("--output-file", default=None, help="Output filename (saved to json_output_scrapper/)")
    return p.parse_args()


def main():
    args = parse_args()
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    if not keywords:
        log("Error: No keywords provided")
        sys.exit(1)

    log(f"User: {args.email}")

    try:
        results = scrape_medium(keywords, args.posts_per_keyword)

        json_output = json.dumps(results, indent=2, ensure_ascii=False)

        if args.output_file:
            out_dir = Path(__file__).parent / "json_output_scrapper"
            out_dir.mkdir(exist_ok=True)
            (out_dir / args.output_file).write_text(json_output, encoding="utf-8")
            log(f"Saved to {args.output_file}")
        else:
            print(json_output)
    except Exception as e:
        log(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
