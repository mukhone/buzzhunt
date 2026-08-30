"""
Reddit Scraper - Standalone scraper for Reddit keyword monitoring
Usage:
  python reddit_scraper.py --email "<email-address>" --keywords "keyword1,keyword2,keyword3"
"""

import argparse
import json
import sys
import time
import urllib.parse
import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright


def log(msg):
    print(
        f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [REDDIT] {msg}",
        file=sys.stderr,
    )


def nice_age(dt_iso: str) -> str:
    try:
        post_dt = datetime.datetime.fromisoformat(dt_iso.replace("Z", "+00:00"))
        delta = datetime.datetime.utcnow() - post_dt.replace(tzinfo=None)
    except Exception:
        return None

    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{secs}s ago"
    mins = secs // 60
    if mins < 60:
        return f"{mins}m ago"
    hrs = mins // 60
    if hrs < 24:
        return f"{hrs}h ago"
    days = hrs // 24
    if days < 7:
        return f"{days}d ago"
    weeks = days // 7
    return f"{weeks}w ago"


def collect_urls_for_keyword(page, keyword, max_scrolls=5, pause=2):
    q = urllib.parse.quote_plus(keyword)
    url = f"https://www.reddit.com/search/?q={q}&type=posts&sort=new"

    log(f"Searching: {url}")
    page.goto(url)
    page.wait_for_timeout(3000)

    found = {}
    last_count = 0

    for scroll in range(max_scrolls):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(pause * 1000)

        anchors = page.query_selector_all(
            "xpath=//a[contains(@href,'/comments/')][contains(@href,'/r/')]"
        )

        for anchor in anchors:
            href = anchor.get_attribute("href")
            title = anchor.inner_text().strip()
            age = None

            try:
                iso = anchor.evaluate(
                    """el => {
                        const times = document.querySelectorAll('time');
                        let closest = null;
                        for (let t of times) {
                            if (el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING) {
                                closest = t;
                            }
                        }
                        return closest ? closest.getAttribute('datetime') : null;
                    }"""
                )
                age = nice_age(iso) if iso else None
            except Exception:
                pass

            if href and title:
                if href.startswith("/"):
                    href = "https://www.reddit.com" + href
                found[href] = {"title": title, "age": age}

        if len(found) == last_count:
            log(f"No new results after scroll {scroll + 1}, stopping")
            break

        last_count = len(found)

    log(f"Found {len(found)} posts for keyword '{keyword}'")
    return found


def scrape_reddit(keywords, max_scrolls=5):
    log(f"Starting Reddit scraper for keywords: {keywords}")

    url_map = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-gpu",
                "--window-size=1920,1080",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        page = context.new_page()

        try:
            for keyword in keywords:
                found = collect_urls_for_keyword(page, keyword, max_scrolls=max_scrolls)

                for url, info in found.items():
                    if url not in url_map:
                        url_map[url] = {
                            "title": info["title"],
                            "age": info.get("age"),
                            "keywords": set(),
                        }
                    url_map[url]["keywords"].add(keyword)

        except Exception as e:
            log(f"Error during scraping: {e}")
            raise
        finally:
            browser.close()
            log("Browser closed")

    results = [
        {
            "url": url,
            "title": data["title"],
            "age": data.get("age"),
            "keywords": sorted(list(data["keywords"])),
        }
        for url, data in url_map.items()
    ]

    log(f"Scraping complete. Total unique posts: {len(results)}")
    return results


def main():
    parser = argparse.ArgumentParser(description="Reddit Scraper")
    parser.add_argument("--email", required=True, help="User email (for logging)")
    parser.add_argument("--keywords", required=True, help="Comma-separated keywords")
    parser.add_argument(
        "--max-scrolls", type=int, default=10, help="Max scroll iterations per keyword"
    )
    parser.add_argument(
        "--output-file", help="Save JSON output to file in json_output_scrapper/ folder"
    )

    args = parser.parse_args()

    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    if not keywords:
        log("Error: No keywords provided")
        sys.exit(1)

    log(f"User: {args.email}")

    try:
        results = scrape_reddit(keywords, max_scrolls=args.max_scrolls)

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
