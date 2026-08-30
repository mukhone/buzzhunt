# Demo Video - BuzzHunt

A pre-recorded walkthrough is included in this folder:
[`buzzhunt-complete-demo-sarah-english.mp4`](buzzhunt-complete-demo-sarah-english.mp4).
The tooling below regenerates it from scratch.

This folder records a short product demo for the open-source BuzzHunt release.
It seeds a deterministic local workspace, drives the real UI with Playwright,
records the browser viewport, and muxes one narration clip per beat into a
final MP4.

## Story

The demo shows BuzzHunt as an AI search optimization tool for marketers:

| Beat | Screen | Value shown |
|---|---|---|
| `intro` | Login page | Positioning: AI search optimization and brand visibility |
| `login` | Demo account login | Clean OSS demo workspace |
| `platforms` | Platforms dashboard | Keyword platforms and prompt platforms in one place |
| `keyword_config` | Manage keywords modal | Scheduled monitoring inputs |
| `available` | Add platform section | Extensible scraper platform model |
| `analytics_overview` | Analytics dashboard | Citations, domains, platform count, top source |
| `platform_drilldown` | Platform filter | Per-platform trends and source analysis |
| `competitors` | Competitor section | Share-of-voice and co-mention tracking |
| `history` | URL history | Auditable source output from scrapers |
| `outro` | Analytics close | Open-source value summary |

## Prerequisites

```bash
npm install
pip install playwright
playwright install chromium
# ffmpeg and ffprobe must be on PATH
```

Create `.env` in the project root from `.env.example`. MongoDB and Redis must
be reachable because the Express app initializes both.

Optional narration:

```bash
# demo/.env or project .env
DEMO_EMAIL=
DEMO_PASSWORD=
XI_KEY=
VOICE_ID=EXAVITQu4vr4xnSDxMaL
MODEL_ID=eleven_multilingual_v2
```

Without `XI_KEY`, the recorder generates silent audio clips so the MP4 still
renders with the same timing.

## Record

In terminal 1:

```bash
cd E:\automation\BuzzHunt\BuzzHunt-OSS
npm start
```

In terminal 2:

```bash
cd E:\automation\BuzzHunt\BuzzHunt-OSS
python demo\record_demo.py
```

Output:

```text
demo\buzzhunt-demo-sarah-english.mp4
```

The recorder calls `node demo/seed_demo_data.js` automatically before each take.
You can also run it manually:

```bash
node demo\seed_demo_data.js
```

The seeder creates or resets only the workspace identified by `DEMO_EMAIL`.
Existing platform records are reused as-is. To force-refresh platform display
metadata in a disposable local database, set `DEMO_FORCE_PLATFORM_UPDATE=1`.

## Notes

- The video drives the real BuzzHunt frontend and backend on `localhost:8010`.
- Demo analytics are seeded locally so the video does not depend on live scrapes
  or third-party site availability.
- Raw captures, voice caches, and marks are intermediate files and should not be
  committed.
