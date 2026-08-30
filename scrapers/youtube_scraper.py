"""
YouTube Scraper - Keyword monitoring via YouTube Data API v3
No browser needed — pure HTTP API.

Output: flat list matching backend contract:
  [{"url": "...", "title": "...", "age": "2d ago", "keywords": ["kw1"]}]

Requires YOUTUBE_API_KEY env var.
Get one at: https://console.cloud.google.com/apis/credentials
"""

import argparse
import json
import os
import sys
import datetime
from pathlib import Path
from typing import Dict, List, Optional

import requests


API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
BASE_URL = "https://www.googleapis.com/youtube/v3/search"


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [YOUTUBE] {msg}", file=sys.stderr)


def nice_age(dt_iso: str) -> Optional[str]:
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


def fetch_page(keyword: str, max_results: int, order: str, page_token: Optional[str] = None) -> dict:
    if not API_KEY:
        log("ERROR: YOUTUBE_API_KEY environment variable not set")
        return {}

    params = {
        "part": "snippet",
        "q": keyword,
        "type": "video",
        "maxResults": min(max_results, 50),
        "order": order,
        "regionCode": "US",
        "relevanceLanguage": "en",
        "key": API_KEY,
    }
    if page_token:
        params["pageToken"] = page_token

    response = requests.get(BASE_URL, params=params)
    if response.status_code == 403:
        log(f"API quota exceeded or key invalid: {response.text[:100]}")
        return {}
    if response.status_code != 200:
        log(f"API error {response.status_code}: {response.text[:100]}")
        return {}
    return response.json()


def scrape_keyword(keyword: str, videos_needed: int, order: str) -> List[Dict]:
    log(f"Keyword '{keyword}' -- need {videos_needed} videos | order={order}")

    collected: List[Dict] = []
    seen_ids = set()
    page_token = None

    while len(collected) < videos_needed:
        remaining = videos_needed - len(collected)
        data = fetch_page(keyword, min(remaining, 50), order, page_token)

        if not data or "items" not in data:
            log("  No items in response. Stopping.")
            break

        for item in data["items"]:
            vid_id = item.get("id", {}).get("videoId")
            if not vid_id or vid_id in seen_ids:
                continue
            seen_ids.add(vid_id)
            collected.append({
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "title": item["snippet"]["title"],
                "age": nice_age(item["snippet"]["publishedAt"]),
                "keywords": [keyword],
            })
            if len(collected) >= videos_needed:
                break

        log(f"  Collected {len(collected)}/{videos_needed}")

        if len(collected) >= videos_needed:
            break

        page_token = data.get("nextPageToken")
        if not page_token:
            log("  No more pages. Stopping.")
            break

    return collected[:videos_needed]


def scrape_youtube(keywords: List[str], videos_per_keyword: int, order: str) -> List[Dict]:
    log(f"Keywords: {keywords} | Per keyword: {videos_per_keyword} | Order: {order}")

    if not API_KEY:
        log("FATAL: YOUTUBE_API_KEY not set. Set it in .env or environment.")
        return []

    url_map: Dict[str, Dict] = {}

    for keyword in keywords:
        log(f"--- Keyword: '{keyword}' ---")
        videos = scrape_keyword(keyword, videos_per_keyword, order)

        for video in videos:
            url = video["url"]
            if url not in url_map:
                url_map[url] = {
                    "url": url,
                    "title": video["title"],
                    "age": video["age"],
                    "keywords": set(),
                }
            url_map[url]["keywords"].add(keyword)

        log(f"Keyword '{keyword}': {len(videos)} videos saved")

    results = [
        {
            "url": data["url"],
            "title": data["title"],
            "age": data["age"],
            "keywords": sorted(list(data["keywords"])),
        }
        for data in url_map.values()
    ]

    log(f"Finished. Total unique videos: {len(results)}")
    return results


def parse_args():
    p = argparse.ArgumentParser(description="YouTube video scraper via API")
    p.add_argument("--email", default="", help="User email (for logging)")
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument("--videos-per-keyword", type=int, default=10, help="Videos per keyword")
    p.add_argument("--order", default="date", help="relevance | date | viewCount | rating")
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
        results = scrape_youtube(keywords, args.videos_per_keyword, args.order)

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
