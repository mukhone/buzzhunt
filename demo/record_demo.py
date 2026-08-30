"""Record the BuzzHunt open-source demo video with Playwright.

Prereqs:
  npm install
  pip install playwright
  playwright install chromium
  ffmpeg on PATH
  .env configured for MongoDB, JWT, and Redis

Run:
  node demo/seed_demo_data.js
  npm start
  python demo/record_demo.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from collections import OrderedDict
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
import _vo


ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
WEB = os.environ.get("DEMO_WEB", "http://localhost:8010")
W, H = 1440, 900

LOGIN = {
    "email": os.environ["DEMO_EMAIL"],
    "password": os.environ["DEMO_PASSWORD"],
}

VOICES = OrderedDict([("sarah", "EXAVITQu4vr4xnSDxMaL")])
TAKES = OrderedDict([("sarah-english", ("sarah", "en", "eleven_multilingual_v2"))])

NARR = OrderedDict(
    [
        (
            "intro",
            "BuzzHunt is an open-source AI search optimization dashboard. It tracks where your brand appears across AI answers and community platforms, then turns those citations into analytics.",
        ),
        (
            "login",
            "For the demo, we sign into a seeded workspace for a brand team monitoring BuzzHunt itself.",
        ),
        (
            "platforms",
            "The Platforms view separates keyword monitoring from prompt monitoring. Reddit tracks search terms; Perplexity tracks questions that buyers ask inside AI search.",
        ),
        (
            "keyword_config",
            "Open a platform to manage the exact keywords or prompts. These become scheduled scraper inputs, with last run and next run visible to the user.",
        ),
        (
            "available",
            "Adding another platform is a one-click workflow. The same pattern works for ChatGPT Search, Google AI, Quora, and future scrapers.",
        ),
        (
            "analytics_overview",
            "Analytics shows the value: total citations, unique domains, active AI platforms, and the top source driving visibility.",
        ),
        (
            "platform_drilldown",
            "Filter by one AI platform to drill into trends, top citing domains, source authority, and every discovered citation URL.",
        ),
        (
            "competitors",
            "Competitor intelligence tracks where alternatives appear beside your brand. This helps marketers spot share-of-voice gaps inside AI-generated answers.",
        ),
        (
            "history",
            "Recent citations and URL history make the scraper output auditable. You can see the prompt, source domain, date, and link for each finding.",
        ),
        (
            "outro",
            "That is the open-source value: configure monitoring, collect citations, analyze source authority, and track competitors across AI search surfaces.",
        ),
    ]
)


def api_health():
    try:
        with urllib.request.urlopen(f"{WEB}/api/health", timeout=3) as response:
            return response.status == 200
    except Exception:
        return False


def run_seed():
    subprocess.run(["node", "demo/seed_demo_data.js"], cwd=ROOT, check=True)


def wait_visible(page, selector, timeout=30000):
    page.locator(selector).first.wait_for(state="visible", timeout=timeout)


def hold_factory(page, marks, durations, t0):
    def hold(name, extra=0.6):
        while time.monotonic() - t0 < marks[name] + durations[name] + extra:
            page.wait_for_timeout(120)

    return hold


def record_take(take_name, voice_name, lang, model_id):
    print(f"\n=== {take_name.upper()} ===")

    print("  [1/4] seed demo data")
    run_seed()

    if not api_health():
        raise RuntimeError(
            f"BuzzHunt is not reachable at {WEB}. Start it with `npm start` before recording."
        )

    print("  [2/4] voice clips")
    vo_dir = HERE / f"vo_{take_name}"
    durations = _vo.gen_vo(NARR, vo_dir, VOICES[voice_name], model_id)

    print("  [3/4] browser recording")
    marks = OrderedDict()

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            record_video_dir=str(HERE),
            record_video_size={"width": W, "height": H},
        )
        page = ctx.new_page()
        t0 = time.monotonic()

        def mark(name):
            marks[name] = time.monotonic() - t0

        hold = hold_factory(page, marks, durations, t0)

        page.goto(WEB, wait_until="domcontentloaded", timeout=60000)
        mark("intro")
        hold("intro")

        mark("login")
        page.fill("#loginEmail", LOGIN["email"])
        page.wait_for_timeout(300)
        page.fill("#loginPassword", LOGIN["password"])
        page.wait_for_timeout(300)
        page.click('button[type="submit"]')
        page.wait_for_url("**/dashboard.html", timeout=30000)
        wait_visible(page, "#platformsContainer .platform-card")
        page.wait_for_timeout(1000)
        hold("login")

        mark("platforms")
        page.locator(".platform-card").first.hover()
        page.wait_for_timeout(700)
        page.locator(".platform-card").nth(1).hover()
        page.wait_for_timeout(900)
        hold("platforms")

        mark("keyword_config")
        manage_buttons = page.locator('button:has-text("Manage")')
        manage_buttons.first.click()
        wait_visible(page, "#keywordModal .modal-content")
        page.wait_for_timeout(900)
        page.locator("#newKeyword").fill("product led growth communities")
        page.wait_for_timeout(900)
        page.locator("#keywordModal .close").click()
        page.wait_for_timeout(600)
        hold("keyword_config")

        mark("available")
        page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })")
        page.wait_for_timeout(1200)
        available = page.locator(".available-platform")
        if available.count():
            available.first.hover()
            page.wait_for_timeout(700)
        hold("available")

        mark("analytics_overview")
        page.goto(f"{WEB}/analytics.html", wait_until="domcontentloaded", timeout=60000)
        wait_visible(page, "#analyticsContent")
        page.wait_for_timeout(1300)
        hold("analytics_overview")

        mark("platform_drilldown")
        platform_filter = page.locator('#platformFilters .filter-btn:not([data-platform="all"])').first
        if platform_filter.count():
            platform_filter.click()
            page.wait_for_timeout(2200)
        page.evaluate("window.scrollTo({ top: 520, behavior: 'smooth' })")
        page.wait_for_timeout(1200)
        hold("platform_drilldown")

        mark("competitors")
        page.evaluate("window.scrollTo({ top: 320, behavior: 'smooth' })")
        page.wait_for_timeout(900)
        configure = page.locator("#configureCompetitorsBtn")
        if configure.count():
            configure.click()
            page.wait_for_timeout(900)
            page.locator("#competitorModal .btn-secondary").click()
            page.wait_for_timeout(600)
        hold("competitors")

        mark("history")
        page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })")
        page.wait_for_timeout(1200)
        page.fill("#domainSearchFilter", "semrush.com")
        page.click("#applyHistoryFilters")
        page.wait_for_timeout(1200)
        hold("history")

        mark("outro")
        page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })")
        page.wait_for_timeout(1200)
        hold("outro")

        video_path = page.video.path()
        ctx.close()
        browser.close()

    raw = HERE / f"_raw_{take_name}.webm"
    raw.unlink(missing_ok=True)
    Path(video_path).replace(raw)
    (HERE / f"marks_{take_name}.json").write_text(json.dumps(marks, indent=2), encoding="utf-8")
    print("  marks:", {key: round(value, 1) for key, value in marks.items()})

    print("  [4/4] mux")
    out = HERE / f"buzzhunt-demo-{take_name}.mp4"
    _vo.mux(raw, marks, list(NARR.keys()), vo_dir, out, W)
    raw.unlink(missing_ok=True)
    return out


if __name__ == "__main__":
    picked = sys.argv[1:] or list(TAKES)
    made = []
    for name in picked:
        if name not in TAKES:
            print(f"unknown take {name!r}; known: {', '.join(TAKES)}")
            continue
        made.append(record_take(name, *TAKES[name]))

    print("\nDone:")
    for movie in made:
        print(f"  {movie.name} ({_vo.probe_dur(movie):.0f}s)")
