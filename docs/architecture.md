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

## Compliance layer: CoMP / EU AI-act opt-outs and disclosure

CoMP finalized 2026-04-28 and the EU AI-act transparency duties went live
2026-08-02 — site owners now need to *publish* their crawl policy, not just
enforce it. BotTollbooth turns the classified traffic directly into those
documents, so the disclosure is derived from each site's real answers:

1. **Verdicts** — `recommendCrawler(crawler)` classifies every observed
   crawler: `training` → `opt-out` (block via robots.txt), `search` → `allow`
   (keep indexing, they send visitors back), `mixed`/unknown → `review` (the
   site owner decides; on-demand tools are flagged rather than hidden).
2. **`robots.txt`** — `robotTxt(crawlers, { namespace })` emits a minimal,
   deterministic blocklist containing *only* the observed opt-out crawlers,
   in registry order (unknown crawlers last). Search crawlers are never
   blocked.
3. **Opt-out list** — `optOutList(crawlers)` returns the per-crawler table
   (`key`, `label`, `purpose`, `requests`, `verdict`, `reason`) so an agency
   or owner sees exactly what will be blocked and why.
4. **NTM/CoMP disclosure** — `ntmDisclosure(crawlers, opts)` generates the
   honest disclosure text + JSON for the "networked/automated traffic" note:
   which AI systems accessed the site, how often, and the basis (training
   opted out, search permitted). The disclosure JSON chains the report digest
   and is itself digest-ed, so published disclosures are tamper-evident.

The service exposes it as `GET /api/v1/compliance?namespace=<site>` (returns
`robotsTxt`, `optOuts`, and the signed `disclosure`); `examples/site-report.js`
has a `--write-dir` flag that drops `robots.txt`, `opt-outs.json`,
`disclosure.json`, and `disclosure.txt` ready to publish. The demo shows the
same output as the **CoMP / EU Opt-out & Disclosure** panel with one-click
copy.

## Bandwidth & cost impact

The frames a site owner needs are **revenue** (what bots steal) and **cost**
(what bots cost). `bandwidthImpact(rows, opts)` adds the cost side:

```
botMB  = botRequests × pageSizeKB / 1024
cost   = botMB / 1024 × costPerGB
```

Defaults (`pageSizeKB: 2500`, `costPerGB: 0.09`) are published assumptions,
overridable via `--page-kb` / `--cost-per-gb` on `site-report.js` or the
`aggregate(namespace, rpm, fillScale, { pageSizeKB, costPerGB })` options.
Training-crawler traffic is broken out so the "AI crawlers' bill" is visible
separately. The bandwidth block rides in every report and digest.

## Headless & sensor detection (probe)

Access-log UAs miss the client side, so `src/probe/probe.js` is an
embeddable IIFE that reports the signals separating real browsers from
headless shells: `navigator.webdriver`, the WebGL renderer string (software
fallbacks = SwiftShader/llvmpipe point to headless / VM / CI), plugin count,
and Generic Sensor / Battery API presence. The engine folds these into
`classify()` via `probeHints(row)` — so `POST /api/v1/probe` yields the same
transparent `category` + `signal` answers as any UA (`probe:webdriver`,
`probe:softwareRenderer`), ready for escalation rather than a black-box ban.

## SDK & log parsing

`src/logparse/` owns the combined-format parser and per-IP 60s burst
computation (moved out of the CLI so library users can reuse it).
`src/sdk/index.js` wraps engine + parser into `bt.parseLog`, `bt.score`, and
`bt.compliance`, mirroring the service report shape — the demo and CLI use
the same pure functions, only inlined.

## External site audit (`src/audit/`)

The no-logs path: an owner hands you a competitor's (or their own) URL and
BotTollbooth probes it externally. `runAudit(url, opts)` does exactly two
requests — `robots.txt`, then one page *only if the target's own robots.txt
permits our agent*. `parseRobots` implements the 2026 robots spec subset we
care about (per-token groups with multi-`User-agent:` collapsing and `*`
fallback) and renders a verdict per AI token. `detector()` lifts WAF/CDN and
security-header facts from the response. `egressTable()` turns one page
weight into a monthly egress USD window. `buildCompliancePack()` emits a
deployable opt-out block.

SSRF hardening lives in `assertPublic()`: scheme allow-list (http(s)), no
credentials, port allow-list (80/443), and every resolved DNS answer is
checked against the private/loopback/link-local/CGNAT/reserved ranges before
any fetch; the API adds a per-host throttle. Tests exercise the full crawl
against a local stub via `allowPrivate: true`, plus deterministic guard
checks. Exposed as `POST /api/v1/audit` and the hosted page `GET /audit`
(`audit.html`).

## Security posture

- `BOTTOLLBOOTH_TOKEN` gates every `/api/v1/*` endpoint (write and read) via
  `Authorization: Bearer <token>`; `/health` and `/probe.js` stay open.
- Every response carries `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and `Referrer-Policy: same-origin`.
- The demo ships with a CSP meta tag and zero network calls.
- No PII is stored (classification counts only), so a breach leaks no data,
  and the container runs as a non-root user.

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