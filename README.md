# BotTollbooth

**Transparent traffic intelligence for the open web.**

Every website owner deserves to know the truth about their traffic: who is
really visiting, what is a bot, and — most importantly — what is actually
**driving business** versus what is just noise, waste, or fraud.

Big publishers can afford enterprise fraud-detection platforms
(DoubleVerify, Integral Ad Science) that keep their numbers honest. Small and
mid-sized business owners running sites on Adsense, Mediavine, or their own
stack are left with opaque dashboards and inflated bot-traffic numbers they
can't act on — which quietly **scourges their ad revenue** and distorts every
marketing decision they make.

BotTollbooth is the visibility layer for the rest of the internet:

- **Transparent** — it separates real traffic from bot traffic and shows you
  the actual mix, category by category (AI crawlers, search engines,
  scrapers, monitors, humans).
- **Honest** — it shows you the revenue impact with conservative assumptions
  and gives you the source of every classification, not a black box.
- **Fair** — built for the marketers and SMB owners who are being overcharged
  for answers they should already have, not for incumbents protecting opaque
  pricing.

This repo is the open core: the classification engine, a runnable demo, and
the architecture for a real, installable web service.

---

## The problem, plainly

- Most site owners don't know **what fraction of their traffic is real**.
- Tools that answer this are either confusing to non-technical owners, or
  priced out of reach for small business.
- Incumbent "fraud detection" is sold partly on **opacity** — the less you
  can verify, the more a subscription is worth.
- Marketing teams waste budget optimizing for metric inflation that bots
  cause, while believing their channels perform better than they do.

The result: small business owners are scoured by inflated prices for answers
that should be simple, transparent facts.

## What BotTollbooth does

1. **Classifies every request** — your own site's traffic, split by category
   and confidence, with the exact signal that produced each answer (no
   black box).
2. **Quantifies what's real** — human vs bot, and which bots are benign
   (search engines drive discovery) vs. wasteful (scrapers) vs. suspicious
   (fraud-adjacent).
3. **Shows the business impact** — conservative, defensible revenue numbers,
   not marketing fluff.
4. **Stays open and self-hostable** — the classification core is MIT-licensed
   and runs anywhere, so anyone can verify it.

---

## Get started

### Run the demo locally (no install)

```bash
node test/engine.test.js             # smoke-test the classifier
node examples/demo.js --rpm 15        # CLI demo of the revenue impact
```

### Try the live dashboard

Open the [interactive demo](https://jweezy119.github.io/bottollbooth/): adjust
your traffic mix, RPM, and fill assumptions, and see the whole picture update
in real time. It runs entirely in your browser.

### Deploy the service

**Easiest: run the container** (Node 22 Alpine, non-root, healthcheck built in):

```bash
docker build -t bottollbooth .
docker run -d --name bottollbooth -p 8080:8080 bottollbooth
# or, one command with the bundled compose file:
docker compose up -d

curl http://localhost:8080/health     # {"status":"ok"}
```

The container is just the zero-dependency analytics service; the dashboard
stays a browser file (`index.html`). If port 8080 is taken, change only the
host side: `docker run -p 8081:8080 bottollbooth`.

**Or run directly** — point any Node.js (>=18) host at this repo;
`src/service/` is the analytics ingestion + aggregation service that site
owners wire up (`PORT=8080 npm start`).

---

## The classification engine (`src/engine/`)

Two layers, both transparent:

1. **Signature layer** — user-agent rules in explicit priority order so a
   single UA is never mis-binned: AI crawlers (`GPTBot`, `ClaudeBot`,
   `Google-Extended`, `CCBot`, `PerplexityBot`), search engines, uptime
   monitors, disposable scrapers (`python-requests`, `curl`).
2. **Behavioural layer** — weighted heuristics (headless hints, burst rates,
   zero dwell time, empty UAs) that catch replay and residential-proxy bots
   that defeat signature matching.

Every classification returns a **category, confidence, and the signal that
produced it** — that's the transparency contract. Rollups feed a conservative
revenue-impact estimate:

```
recoveredMonthly ≈ botVisitors / 1000 × rpm × fillScale
```

`fillScale` defaults to 50% and is user-adjustable, because honesty about
assumptions matters more than a big number.

---

## Repo layout

```
Dockerfile                  Container image for the analytics service
docker-compose.yml          One-command hosting setup for any box with Docker
index.html                  The interactive dashboard demo (browser only)
src/engine/                 Pure classification + revenue-impact engine
src/service/                The installable analytics service (ingest + aggregate)
examples/demo.js            Standalone CLI demo of the engine
test/                       Smoke tests (zero-dependency)
docs/architecture.md        How the product is built and deployed
docs/monetization.md        The honest, fair-pricing business model
docs/strategy.md            Competition, benefit analysis, north stars, web3
```

---

## What this showcases (for the author's resume)

| Skill | Where it lives |
| --- | --- |
| **API / data integration** | `src/service/` — ingest endpoints, aggregation, JSON responses for the dashboard |
| **Identity & classification** | `src/engine/` — modelling "who is this request, is it real, how confident are we" (identity analytics applied to web traffic) |
| **B2B / marketing value framing** | revenue-impact metrics and documentation aimed at non-technical SMB owners |
| **Documentation & onboarding** | walkthrough oriented at a site owner, not just a developer |
| **Product judgement** | the honest business-model analysis in `docs/monetization.md` |

---

## License

MIT — see [`LICENSE`](LICENSE).
