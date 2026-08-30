<p align="center">
  <a href="https://mukh.one">
    <img src="https://mukh.one/assets/landing%20page/1.svg" alt="Mukh.1" width="200">
  </a>
</p>

# BuzzHunt-OSS - Open-Source AI Search Optimization

<p align="center">
  <a href="https://mukh.one"><b>🌐 mukh.one</b></a>
</p>

**BuzzHunt helps you track how your brand appears across AI answers, source citations, and community discussions.**

## 🎬 Demo

<p align="center">
  <a href="https://youtu.be/RppMPMKAQWs">
    <img src="https://img.youtube.com/vi/RppMPMKAQWs/hqdefault.jpg" alt="Watch the BuzzHunt demo" width="560">
  </a>
  <br>
  <a href="https://youtu.be/RppMPMKAQWs"><b>▶ Watch the demo on YouTube</b></a>
</p>

Built by **[Mukh.1](https://mukh.one)**, BuzzHunt is an open-source starting point for AEO/GEO workflows: configure platforms, add keywords or prompts, run scheduled scrapers, receive email alerts, and analyze which domains are influencing AI search visibility.

BuzzHunt monitors both community platforms like Reddit and Quora, and AI-powered search surfaces like Perplexity, ChatGPT Search, and Google AI. Users sign up, pick platforms, enter keywords or prompts, and the system automatically scrapes those platforms on a schedule. When new mentions or citations are found, the user gets an email alert and can inspect citation trends, top source domains, and competitor co-mentions in the analytics dashboard.

## Why BuzzHunt?

Traditional SEO tools track search rankings. BuzzHunt is designed for the newer AI-search workflow:

- Track brand visibility inside AI-generated answers
- Monitor Reddit and Quora conversations for keyword opportunities
- Capture source URLs cited by AI search engines
- Compare your visibility against competitors
- Turn discovered URLs into manual, high-value engagement opportunities
- Keep your monitoring data in your own local or self-hosted stack

## Tech Stack

- **Backend**: Node.js + Express (port 8010), MongoDB (Mongoose), Bull + Redis (job queues)
- **Scrapers**: Python (Playwright), spawned via child_process from Node worker
- **Frontend**: Vanilla HTML/CSS/JS (served as static files by Express)
- **Auth**: JWT-based with bcrypt password hashing
- **Email**: Nodemailer (Gmail SMTP)

## Architecture

```
backend/
  server.js                 # Express entry point, mounts routes + static frontend
  routes/                   # API endpoints: auth, platforms, keywords, jobs, analytics
  workers/scraperWorker.js  # Bull job processor, spawns Python scrapers
  services/                 # Queue management, email, analytics calculation, cleanup
  models/                   # Mongoose models (User, Platform, UserPlatform, ScraperHistory, etc.)
  middleware/auth.js        # JWT verification

scrapers/
  reddit_scraper.py         # Reddit keyword search (Chrome-based)
  quora_scraper.py          # Quora keyword search (Chrome-based)
  linkedin_scraper.py       # LinkedIn keyword search (Chrome-based)
  medium_scraper.py         # Medium keyword search (Chrome-based)
  youtube_scraper.py        # YouTube keyword search (YouTube Data API v3)
  perplexity_sources_scraper.py  # Perplexity prompt submission, extracts source URLs
  chatgpt_sources_scraper.py     # ChatGPT prompt submission, extracts source URLs
  google_ai_sources_scraper.py   # Google AI prompt submission, extracts source URLs

frontend/
  index.html                # Login/signup page
  dashboard.html            # Platform management, keyword config, manual scrape
  analytics.html            # Citation trends, domain sources, competitor tracking
```

## Prerequisites

- Node.js 18+
- Python 3.10+
- MongoDB (Atlas or local)
- Redis
- Google Chrome (for scrapers)

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/YOUR_USERNAME/buzzhunt.git
   cd buzzhunt
   npm install
   pip install -r scrapers/requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Start Redis, then run:
   ```bash
   npm start              # Start backend (node backend/server.js)
   npm run dev            # Or start with nodemon for development
   ```

4. Open `http://localhost:8010` in your browser.

## Platform Types

| Type | Platforms | Input | Max per platform | Scrape interval |
|------|-----------|-------|------------------|-----------------|
| Keyword-based | Reddit, Quora, LinkedIn, Medium, YouTube | Keywords | 5 | Every 3-6 hours |
| Prompt-based | Perplexity, ChatGPT, Google AI | Prompts | 25 | Every 24 hours |

> YouTube uses the YouTube Data API v3 (set `YOUTUBE_API_KEY`). The other keyword and prompt platforms drive a real Chrome session via Playwright.

## Notes

- All config is via `.env` (see `.env.example`) — never hardcode credentials
- Redis must be running for job queues to work
- Python scrapers need Playwright + Chrome installed
- Scraper output is via temp JSON files, not stdout
- `TZ=UTC` env var is required for consistent scheduling
- `v0/` and `v1/` are archived old versions (gitignored)

## Contributing

Pull requests are welcome. Keep changes focused, avoid committing generated data, and never commit `.env` files, browser profiles, credentials, tokens, or scraper output.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## More from Mukh.1

This project is built and maintained by **[Mukh.1](https://mukh.one)**.

- **[AgentForge](https://agentforge.mukh1.com)** - Build AI agents in plain English
- **[VoicyAgent](https://voicyagent.mukh1.com)** - Build and deploy AI voice agents
- **[Mukh.1 Technology](https://mukh.one/technology/)** - AI agent infrastructure
- **[Demos](https://mukh.one/demos/)** - See our products in action

---

<p align="center">
  <a href="https://mukh.one"><b>mukh.one</b></a>
</p>
