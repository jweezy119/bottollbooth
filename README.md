# BotTollbooth

**Bot traffic classification & ad-revenue impact analytics** for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) agent
framework — a dynamic Cordis plugin that answers the question every small
publisher actually cares about:

> *"How much bot traffic am I getting, and how much ad revenue is it costing me?"*

Built as a **dynamic Cordis plugin** (host half + browser client half), this
repo contains the pure algorithm core, the two plugin bodies exactly as they
are defined against DSH's `cordis_define` tool contract, a dependency-free CLI
demo, and a smoke test. No build step, no TypeScript, no bundler — the whole
thing is vanilla JS by design, because that is what the DSH Cordis runtime
installs: plain function bodies that return a Cordis plugin.

### **[Live Demo →](https://jweezy119.github.io/bottollbooth/)**

Interactive browser demo with adjustable RPM, sample feed generator, and real-time category breakdown. Zero install, zero server.

---

## Why this exists

Existing options for understanding bot traffic are either too technical
(Cloudflare dashboards, GA4 bot filtering), too expensive (third-party fraud
detectors like DoubleVerify / Integral Ad Science), or not ad-revenue-aware.
BotTollbooth is a **visibility layer**: it classifies traffic, quantifies the
revenue a publisher loses to non-human visitors, and renders that as a simple
embedded dashboard — using **existing detection signals**, not a reinvention
of bot-detection infrastructure.

The project was deliberately scoped *down* to be honest about what it does
well. It does **not** try to charge AI companies directly (enforcement,
legal, and proxy-evasion problems make that a trap), and it does **not** try
to replace Cloudflare/AdSense filters. It surfaces the numbers for a site
owner, and — as a monetization experiment — carries a single affiliate CTA
(Cloudflare) as the least-friction revenue path from a zero-capital position.

---

## Repo layout

```
index.html                Live interactive demo (GitHub Pages — run entirely in the browser)
src/host/engine.js        Pure traffic-classification + revenue-impact engine
src/host/plugin.host.js   The Cordis HOST-half plugin body (JSON-RPC handlers)
src/client/plugin.client.js The Cordis CLIENT-half plugin body (dashboard UI)
examples/demo.js          Standalone CLI demo (no DSH required)
test/engine.test.js       Zero-dependency smoke test
docs/architecture.md      How the host/client halves communicate
docs/api-contracts.md     cordis_define / cordis_run tool schemas (as shipped)
docs/monetization.md      The honest cost-benefit analysis of each revenue path
```

---

## Run it (no install needed)

```bash
node test/engine.test.js   # smoke test the algorithms
node examples/demo.js             # demo feed, default $15 RPM
node examples/demo.js --rpm 25    # tune publisher revenue per 1k views
```

## Run it inside DeepSeek Harness (the real target)

The two plugin bodies are meant to be submitted through DSH's
self-referential Cordis toolset (`cordis_define` → `cordis_run`). The exact,
shipped schemas are documented in [`docs/api-contracts.md`](docs/api-contracts.md).

```js
// Host half: classification aggregation + "lost revenue" RPC handlers
function host() { /* returns { inject: ['botDetection'], apply(ctx) { ... } } */ }
// Client half: dashboard UI mounted at the tool.view.cordis slot
function client() { /* returns { inject: ['slots', 'theme', 'host'], apply(ctx) { ... } } */ }
```

The dynamic plugin lifecycle (define → approval → run → stop → update →
rollback) is fully handled by the harness; this repo contributes the code and
the reasoning behind it.

---

## The algorithm (`src/host/engine.js`)

Two layers of classification:

1. **Signature layer** — user-agent rules with an explicit priority order so a
   single UA never mis-bins (AI crawlers e.g. `GPTBot`, `ClaudeBot`,
   `Google-Extended`, `CCBot`, `PerplexityBot`; search engines; uptime
   monitors; disposable scrapers like `python-requests`/`curl`).
2. **Behavioural layer** — weighted heuristics (headless hints, burst rates,
   zero dwell time, empty UAs) that catch replay/residential-proxy bots that
   defeat signature matching.

Rollups feed a `revenueImpact()` estimate: bot visitors ×
publisher RPM × a conservative fill scale (~50%), i.e. the revenue that
*filled, human* traffic would have earned.

A larger conversation about the *business* value of quantification — and the
honest gaps in "charging AI crawlers" — is in
[`docs/monetization.md`](docs/monetization.md).

---

## What this showcases

This project demonstrates the skills on the author's resume in a *visible,
product-shaped* way:

| Skill | Where in the repo |
| --- | --- |
| **REST / JSON-RPC API integration** | Host half exposes `botDetection.summary` & `analyticsProvider.lostRevenue` RPC handlers; client calls them over DSH's JSON-RPC bridge (`host.call`) |
| **API authentication & credential flows** | See `docs/architecture.md` — requests are session-scoped, and dynamic client code is gated behind approval |
| **Webhooks / worker automation** | Host `ctx.on('botDetection/classify')` event hook + `ctx.effect` polling scaffold for future GA4/ad-network connectors (`src/host/plugin.host.js`) |
| **Low-code integration (n8n/Zapier mindset)** | The "slot" model: a business view injected at `tool.view.cordis` with `key: 'self'`, exactly like registering a module into a workflow |
| **Documentation & onboarding-first thinking** | `docs/` walks a reader from zero to running, including exact tool schemas — swap-in-ready for a customer-facing doc set |
| **B2B value framing** | `revenueImpact()` is a business metric (dollars), not just a technical metric (counts); the monetization doc is honest about the limits |

---

## License

MIT — see [`LICENSE`](LICENSE).