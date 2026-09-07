# BotTollbooth

**Transparent traffic intelligence for the open web.**

[![tests](https://github.com/jweezy119/bottollbooth/actions/workflows/test.yml/badge.svg)](https://github.com/jweezy119/bottollbooth/actions/workflows/test.yml)
[![live demo](https://img.shields.io/badge/live%20demo-gh%20pages-blueviolet)](https://jweezy119.github.io/bottollbooth/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-green)]()
[![node](https://img.shields.io/badge/node-%3E%3D18-339933)]()

Every website owner deserves to know the truth about their traffic: who is
really visiting, what is a bot, and what is actually **driving business**
versus noise, waste, or fraud.

Enterprise platforms (DoubleVerify, Integral Ad Science) keep big publishers'
numbers honest. Small and mid-sized sites on Adsense, Mediavine, or their own
stack are stuck with opaque dashboards and inflated bot numbers they can't
act on — which quietly siphons ad revenue and distorts every marketing
decision.

BotTollbooth is the visibility layer for the rest of the internet:

- **Transparent** — every request is classified *and* shows the exact signal
  that produced the answer. No black box.
- **Honest** — revenue impact uses conservative, published assumptions, never
  marketing fluff.
- **Fair** — MIT core, runs anywhere, built for the site owners who are
  being overcharged for answers they should already have.

Zero runtime dependencies. One small engine. A demo, a CLI, and a
self-hostable API that turn your own access logs into answers **and** into
regulatory deliverables (CoMP / EU AI-act robot policies and disclosures).

![BotTollbooth live demo](docs/screenshot.png)

---

## Try it now

[Open the interactive demo](https://jweezy119.github.io/bottollbooth/) — runs
entirely in your browser. Start from a real-world profile (Local Business,
E-commerce, Editorial) built on 2026 crawler data, tune the mix and RPM, and
update four live panels:

1. **Traffic mix** — humans vs AI crawlers / search / monitors / spam.
2. **Crawl Purpose & Value Exchange** — how many visitors each crawl type
   actually returns (ClaudeBot ≈ 38,000:1, GPTBot ≈ 1,091:1, Google ≈ 5.4:1).
3. **CoMP / EU Opt-out & Disclosure** — generated `robots.txt`, opt-out list,
   and NTM disclosure, copy-paste ready.
4. **Revenue impact** — conservative, defensible ad-revenue estimates.

**Copy Report Link** reproduces the exact same dataset on any device — the
share-link encodes the traffic mix, not a screenshot.

## Quick start (no install)

```bash
npm test                          # zero-dependency test suite
node examples/demo.js --rpm 15    # CLI report for a simulated site
```

No `npm install` is required anywhere in this repo — plain Node.js (>=18).

## Score your real traffic (bring your own data)

```bash
node examples/accesslog-to-ingest.js access.log \
  --post http://localhost:8080 --namespace mysite.com

curl "http://localhost:8080/api/v1/report?namespace=mysite.com&rpm=15"
curl "http://localhost:8080/api/v1/compliance?namespace=mysite.com"
```

The importer parses Nginx/Apache combined-format logs, computes each client's
60-second burst rate, and pushes batches into the service. `site-report.js`
reads the same log directly and prints the full picture — or writes the
compliance artifacts to disk with `--write-dir`:

```bash
node examples/site-report.js access.log --namespace shop.example.com \
  --write-dir out/     # → robots.txt, opt-outs.json, disclosure.json/.txt
```

## Deploy the API

```bash
docker build -t bottollbooth .
docker run -d --name bottollbooth -p 8080:8080 bottollbooth   # or: docker compose up -d
curl http://localhost:8080/health   # {"status":"ok"}
```

The container is a Node 22 Alpine image, runs as a non-root user, and carries
a healthcheck. The dashboard is a static file (`index.html`) — it calls the
same engine in-browser, so nothing else is needed to explore.

## HTTP API

| Endpoint | What it does |
| --- | --- |
| `POST /api/v1/ingest` | Accepts request rows (`userAgent`, burst rate) for the given `?namespace=` |
| `GET /api/v1/report?namespace=x&rpm=15` | Traffic mix, value exchange, revenue impact, sha256 digest |
| `GET /api/v1/compliance?namespace=x` | Generated `robots.txt`, opt-out list, CoMP/EU disclosure |
| `GET /api/v1/classify?ua=<user-agent>` | Live lookup → `category`, `confidence`, `signal` |
| `GET /health` | Liveness probe |

## Architecture

```
  your access.log
        │  examples/accesslog-to-ingest.js  (parses + computes burst rate)
        ▼
  src/service      self-hostable Node API, zero dependencies
        ├─ POST /api/v1/ingest        ← store real requests per namespace
        ├─ GET  /api/v1/report        → mix · value exchange · revenue · digest
        ├─ GET  /api/v1/compliance    → CoMP/EU robots.txt + opt-outs + disclosure
        └─ GET  /api/v1/classify      → per-UA: category · confidence · signal
        ▲
        │  src/engine    pure functions, inlined 1:1 into the browser demo
        │                classify · purpose registry · digest · disclosure
```

The engine is a [src/engine/index.js](src/engine/index.js) single-purpose
module: explicit-priority user-agent signatures, then weighted behavioural
heuristics (headless hints, burst, zero dwell time) for bots that defeat
signature matching. Every answer returns **category, confidence, and its
source signal** — that transparency contract is the product.

Rollups feed a deliberately conservative revenue estimate
(`botVisitors / 1000 × rpm × fillScale`, fill scale defaults to 50% and is
user-adjustable). SMB owners get a defensible number instead of a scare.

## Verification

- **Zero-dependency test suite** (`npm test`) covers the engine, the log
  importer, the service pipeline, and the inlined browser demo.
- **CI** runs every commit through the tests, the full CLI end-to-end path
  (importer → report → compliance artifacts), and a real container smoke
  test with readiness polling — [see the workflow](.github/workflows/test.yml).
- **Tamper evidence** — every report carries a deterministic sha256 digest of
  the canonical JSON; tampering is detected by construction (and tested).
- The crawler registry encodes **published 2026 crawl-to-referral ratios**,
  so value-exchange claims are grounded in cited data, not vibes.

## What this showcases

| Skill | Where it lives |
| --- | --- |
| **API & data integration** | `src/service/` — ingest pipeline, aggregation, HTTP API consumed by the dashboard |
| **Identity & classification** | `src/engine/` — "who is this request, is it real, how confident are we" applied to web traffic |
| **Applied AI / regulatory engineering** | CoMP + EU AI-act compliance layer: robots.txt, opt-outs, tamper-evident NTM disclosure from raw logs |
| **Security-minded tooling** | deterministic report digests, tamper-detection, non-root container, healthchecked deployment |
| **Product & B2B framing** | revenue-impact modelling and docs aimed at non-technical site owners ([docs/monetization.md](docs/monetization.md)) |
| **Documentation & strategy** | [docs/architecture.md](docs/architecture.md), [docs/strategy.md](docs/strategy.md) — competition, north stars, web3 roadmap |

## Project docs

- [docs/architecture.md](docs/architecture.md) — how the product is built and deployed
- [docs/monetization.md](docs/monetization.md) — the honest, fair-pricing business model
- [docs/strategy.md](docs/strategy.md) — competition analysis, north stars, web3 feasibility

## Roadmap (what's next)

- **Signed, anchorable reports** — SAS-verified digests so a report can be
  notarized over time (strategy Tier 1).
- **Crawler/agent identity registry** — credentialed identities for the
  purpose metadata, opening an app-store-style trust layer.
- **Managed multi-tenant service** — flat, fair pricing for agencies running
  many client sites; single flat-rate container for everyone else.

## License & author

MIT — see [`LICENSE`](LICENSE).

Built by [Syed Jawad Hussain](https://github.com/jweezy119). Feedback,
issues, and pull requests are welcome.