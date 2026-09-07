# Architecture — a transparent traffic-intelligence service

BotTollbooth is a **self-hosted web service** that a site owner wires into
their website (or hosting provider / CDN) to get transparent answers about
their traffic. This design is deliberately boring and cheap:

- **Zero server-side dependencies** — only Node.js built-ins. Deployable to a
  $5 VPS, Cloud Run, Lambda, Fly.io, or on-prem with no lock-in.
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
   (`{ userAgent, behaviourScore?, requestsPerMin?, dwellMs? }`).
2. **Classify** — `src/engine/index.js` classifies each row into a category
   (`human`, `ai-crawler`, `search-engine`, `spam`, `monitoring`,
   `unclassified`) with a confidence and the signal that produced it.
3. **Store counts only** — for privacy and cost, we persist
   `{ category, confidence, at }` and nothing else. A production build swaps
   the in-memory `Map` for Postgres/Redis with the same shape.
4. **Aggregate** — `aggregate(namespace, rpm, fillScale)` rolls counts up into
   a period summary and a revenue-impact estimate.

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

## Deployment options

| Target | How |
| --- | --- |
| Local / dev | `npm start` |
| Cloud Run / Fly.io / VPS | run `src/service/server.js` with `PORT` env; add a reverse proxy |
| Function (Lambda / Workers) | wrap `ingest()` / `aggregate()` in the framework handler of your choice |
| Edge / CDN | the same endpoint handed off to Cloudflare Workers or a CDN worker |

## Todo / roadmap (real integrations)

- Postgres/Redis store behind the same `buckets` interface.
- Adapter for common inputs: Google Analytics 4 export, Cloudflare logs, raw
  Nginx/Apache access logs, a drop-in JS snippet.
- Scheduled period rollups and a simple alerting hook ("bot rate > 40%").
- Multi-namespace admin webbook for agencies managing many client sites.