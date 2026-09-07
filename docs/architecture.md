# Architecture — a transparent traffic-intelligence service

BotTollbooth is a **self-hosted web service** that a site owner wires into
their website (or hosting provider / CDN) to get transparent answers about
their traffic. This design is deliberately boring and cheap:

- **Zero server-side dependencies** — only Node.js built-ins. Deployable to a
  $5 VPS, Cloud Run, Lambda, Fly.io, or on-prem with no lock-in.
- **Container-first** — ships a ready Docker image (Node 22 Alpine, non-root
  user, healthcheck) so any owner or agency self-hosts it in one command on
  any box, with no framework and no lock-in.
- **Privacy-preserving by default** — only classification *counts by
  category* are retained, never raw user agents, never PII, no cookies, no
  fingerprint storage.
- **Transparent at every layer** — the classification engine returns the
  exact signal that produced each answer, and the revenue math spells out its
  assumptions (RPM, fill scale) instead of hiding them in a black box.

## Components

```
┌──────────────────────────────────────────────────────────────┐
│  Site owners (your website / CDN / server logs)               │
│        │                                                      │
│        ▼  POST /api/v1/ingest   { namespace, rows }           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  src/service/ingest.js                               │    │
│  │   • normalise each request row                        │    │
│  │   • classify via src/engine/index.js                  │    │
│  │   • keep only category counts (privacy)               │    │
│  └─────────────────────────┬────────────────────────────┘    │
│                            │                                  │
│                            ▼  GET /api/v1/report              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  src/service/server.js                              │    │
│  │   • aggregates per-namespace summary                 │    │
│  │   • computes conservative revenue-impact estimate    │    │
│  └──────────────────────────────────────────────────────┘    │
│        │                                                      │
│        ▼  JSON → dashboard (index.html) / SMB owner           │
└──────────────────────────────────────────────────────────────┘
```

## Data flow

1. **Ingest** — the site sends a batch of request rows
   (`{ userAgent, behaviourScore?, requestsPerMin?, dwellMs? }`), or an
   operator pipes a real access log through the BYOD importer
   (`examples/accesslog-to-ingest.js`).
2. **Classify** — `src/engine/index.js` classifies each row into a category
   (`human`, `ai-crawler`, `search-engine`, `spam`, `monitoring`,
   `unclassified`) with a confidence and the signal that produced it.
3. **Store counts only** — for privacy and cost, we persist
   `{ category, confidence, at }` and nothing else. A production build swaps
   the in-memory `Map` for Postgres/Redis with the same shape.
4. **Aggregate** — `aggregate(namespace, rpm, fillScale)` rolls counts up into
   a period summary and a revenue-impact estimate.
5. **Lookup** — `GET /api/v1/classify?ua=...` exposes the engine's verdict
   (category, confidence, signal) for any single user-agent — useful to audit
   a UA you just saw in your logs.

## The revenue math (honest by construction)

```
recoveredMonthly ≈ botVisitors / 1000 × rpm × fillScale
```

- `botVisitors` — non-human sampled visits in the period.
- `rpm` — the owner's revenue per 1,000 monetized impressions.
- `fillScale` — the fraction of that revenue bot traffic actually earns.
  Defaults to **50%** and is user-adjustable, because most bot traffic never
  renders a valid, monetized impression. We understate rather than overstate —
  a defensible number beats a hype number every time.

## Why self-hosted + MIT core

The incumbents sell *opacity*: the less a customer can verify, the more a
subscription is worth. BotTollbooth inverts that. Because the core is open
and self-hostable, any owner — or their agency — can see exactly how a number
was produced. That position is the product: **transparency as the moat**.

## Bring your own data

The service only becomes useful once it sees *your* traffic. The demo ships
real-world profiles built from 2026 industry data (`data/samples/profiles.js`)
and a deterministic share-link feature, but real numbers come from real logs:

```bash
node examples/accesslog-to-ingest.js access.log --post http://localhost:8080 --namespace mysite.com
```

The importer (`examples/accesslog-to-ingest.js`) is a zero-dependency CLI
that:

- parses Nginx/Apache **combined-format** access logs (referer + user-agent);
- computes each client IP's burst rate as the **densest 60-second window**,
  so residential-proxy scrapers that blast a few pages in seconds classify as
  bots instead of hiding behind a human UA;
- POSTs batches to `/api/v1/ingest` (or prints JSON rows for piping), with
  `--namespace`, `--limit`, and `stdin` support.

Feed the output of any log pipeline you already run (Nginx, Cloudflare
logs, ELK) straight into the same endpoint.

## Value layer: purpose and value exchange

A second pass over the classified traffic produces the three numbers a site
owner actually cares about:

1. **Crawl purpose** — each known AI/search user-agent is resolved to a
   declared purpose (`training`, `search`, `user-action`, `mixed`) via the
   crawler metadata registry (`CRAWLERS` in `src/engine/index.js`). The
   registry also carries a `pagesPerReferral` ratio grounded in public 2026
   crawl-to-referral data (ClaudeBot ≈ 38,000:1, GPTBot ≈ 1,091:1,
   Perplexity ≈ 195:1, Google ≈ 5.4:1) so we can estimate how many real
   visitors a crawl type actually gives back.
2. **Value exchange** — `valueExchange(rows)` counts crawl requests by purpose
   and estimates how many visitors each purpose returned (`1/ppr` per entry).
   The headline ratio — pages crawled per real visitor returned — is the
   transparency answer to "are these crawlers worth hosting?"
3. **Tamper-evident digest** — every aggregate report is wrapped in a
   deterministic sha256 digest (canonical sorted JSON). The digest lets a site
   owner, agency, or auditor prove a report hasn't been edited after the fact,
   and forms the anchor for the SAS/VC layer described in `docs/strategy.md`.

The demo surfaces this as the **Crawl Purpose & Value Exchange** panel;
`examples/site-report.js` produces the same numbers as a standalone CLI
report (`node examples/site-report.js access.log`).

## The container

`Dockerfile` builds on `node:22-alpine` — **no build step and no `npm
install`**, because the service genuinely has zero dependencies. The image
contains only `src/` and `package.json`, runs as the unprivileged `node`
user (never root), listens on `PORT` (default `8080`), and ships a
`/health` healthcheck so orchestrators and compose can detect a dead
container. `docker-compose.yml` wraps it for one-command hosting:

```bash
docker compose up -d     # builds, maps 8080:8080, restarts on failure
```

**Persistence note:** the store is an in-memory `Map`, so a container
restart resets the aggregates — deliberate (privacy) and fine for a demo or
per-batch analytics. A production build swaps `buckets` for Postgres/Redis
behind the same interface (`src/service/ingest.js`) with no API change.

## Deployment options

| Target | How |
| --- | --- |
| Any box with Docker | `docker compose up -d` (port `8080`, env `PORT`) |
| Local / dev | `npm start` |
| Cloud Run / Fly.io / VPS | run the image or `src/service/server.js` with `PORT` env; add a reverse proxy |
| Function (Lambda / Workers) | wrap `ingest()` / `aggregate()` in the framework handler of your choice |
| Edge / CDN | the same endpoint handed off to Cloudflare Workers or a CDN worker |

## Todo / roadmap (real integrations)

- Postgres/Redis store behind the same `buckets` interface.
- Adapter for common inputs: Google Analytics 4 export and Cloudflare logs
  (Nginx/Apache access logs are already supported via
  `examples/accesslog-to-ingest.js`), plus a drop-in JS snippet.
- Scheduled period rollups and a simple alerting hook ("bot rate > 40%").
- Multi-namespace admin webbook for agencies managing many client sites.