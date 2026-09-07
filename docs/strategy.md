# Strategy — competition, benefit analysis, north stars, and web3

This file is the deep-dive: who else is in this market, what they're good
and bad at, who BotTollbooth actually helps, the three or four "north star"
plays that move the needle, and an honest feasibility map for web3 /
blockchain additions.

Everything here is grounded in public data captured in 2026. Where a number
matters, the source is named next to it.

---

## 1. Why this moment (the market timing)

The problem BotTollbooth solves just crossed an industry line, and the
industry is disoriented:

- **Bots now outnumber humans on the open web.** Cloudflare Radar measures
  ~57.5% of HTML page traffic as automated, the first time machine traffic
  has passed human traffic (Cloudflare CEO, 2026-06-03; Radar ~57.4–57.5%).
  Imperva's 2026 Bad Bot Report independently puts automated traffic at 53%,
  up from 48% in 2024.
- **The growth is AI-driven and violently fast.** Per HUMAN Security's 2026
  State of AI Traffic report: AI-driven traffic grew ~187% in 2025; AI-agent
  / agentic-browser traffic grew ~7,851% year over year. GPTBot grew 305% in
  12 months (Cloudflare).
- **The value exchange has broken.** Crawl-to-referral ratios tell the whole
  story: ClaudeBot ~38,000 pages crawled per visitor referred back, GPTBot
  ~1,091:1, Perplexity ~195:1, Google ~5.4:1 (Cloudflare Radar / analysis
  of May 2026 data). Training crawlers take your content and return
  essentially zero business. ~52% of AI-crawler requests are for training;
  only ~2.6% are live user fetches (Radar, 28 days to 2026-06-22).
- **The worst-hit are exactly our customers' websites.** Shopping /
  e-commerce absorbs ~26% of all verified bot crawl traffic and ~32% of AI
  crawler traffic (Cloudflare Radar). Retail, software, IT, and finance are
  all heavily crawled.
- **Regulation is forcing the transparency the incumbents never offered.**
  IAB Tech Lab's CoMP (Content Monetization Protocols) initiative — rights,
  attribution/provenance, validation, and licensing APIs between content
  owners and AI systems — was finalized on 2026-04-28. The EU AI Act's
  training-data transparency and machine-readable opt-out duties took effect
  on 2026-08-02.
- **The market is agreeing the answer is transparency, not opacity.** Even
  Cloudflare now says verifiable bot self-identification and declared crawl
  intent are foundational, and is working to drive "mixed-use / undeclared
  intent" bots to zero.

Bottom line: the problem is real, it just got urgent, the incumbents' answer
(black-box scores sold at enterprise prices) is not what SMBs need, and the
regulatory calendar is aligning with exactly what we build.

---

## 2. Competitive landscape — pros and cons for the SMB buyer

### Enterprise bot management (the incumbent category)

DataDome, Kasada, Arkose Labs, HUMAN, Netacea, CHEQ, Akamai Bot Manager,
Imperva.

| Dimension | Pros | Cons for an SMB site owner |
| --- | --- | --- |
| Detection accuracy | Genuinely strong — ML + fingerprinting + real-time scoring at massive scale. | Their accuracy is what a serious competitor would feel. |
| Pricing | — | DataDome's Essentials entry point is ~$3,830/mo; the rest are quote-only. This is the scouring the SMB market is being hit with. |
| Transparency | — | Black-box scores by design: "bot score 0.3" with no verifiable signal. Customers cannot audit, so the number is whatever the vendor says. |
| Fit | — | Built for enterprise traffic volume, fraud teams, and risk stacks. Overkill and overpriced for an Adsense/Mediavine site. |
| Deployment | — | Heavy SDKs, proxies, or full reverse-proxy placement. Too much for a small site owner to operate. |

### Cloudflare (the 800-lb gorilla)

Cloudflare Bot Management + Radar AI Insights + the new **Pay Per Crawl /
AI Crawl Control** (HTTP 402 "Payment Required" with a `crawler-price`
header, paid via Stripe as merchant of record, plus Web Bot Auth
cryptographic signatures to prevent spoofed identity).

| Pros | Cons / gap |
| --- | --- |
| Best vantage point on earth — ~20% of the measurable web. | It's a **CDN/security** company: bot detection is a feature that keeps enterprises on Cloudflare. The number is a demand signal, not a business answer. |
| Published the industry's best market data (Radar, crawl-to-refer ratios). | SMB-positioned tiers are thin; its value-add is tied to being on the Cloudflare network. |
| Legitimately pushing verifiable bot identity + declared intent. | Runs its own rails (Stripe settlement, own registry), which weakens the "independent third party" position. |

We don't fight Cloudflare on detection. We stand on their public data and
coexist on the same sites. Their job is blocking and routing; ours is the
**business-facing truth** — what's real, what's driving revenue, who to
negotiate with, what's compliant.

### CAPTCHA / challenge vendors

Google reCAPTCHA (Enterprise cut its free allowance in 2025) and hCaptcha
(free tier + paid Pro).

| Pros | Cons |
| --- | --- |
| Cheap or free; ubiquitous; simple. | They only catch the *interaction* moment — they tell you nothing about the traffic mix, the crawler category, or the revenue impact. They're a gate, not visibility. |
| Instantly deployable. | Black-box model training (Google's) and no answer to "is my analytics lying to me?" |

### Ad-fraud verification incumbents

DoubleVerify and Integral Ad Science — the vendors `docs/monetization.md`
calls out as the price-setters.

| Pros | Cons |
| --- | --- |
| Trusted by ad networks and agencies; certification standards. | Enterprise contracts, opaque methodology, and their economics depend on the customer being unable to verify the numbers themselves. |
| Broad media coverage (video, CTV, display). | Web-traffic clarity for SMB site owners is not their job; they measure ad *units*, not the *site owner's* business. |

### Self-serve / POC contestants

- **Prosopo** — publishes a full price ladder including a free tier
  (10,000 verifications/mo). Proof that transparent pricing is viable and
  that challengers exist.
- **Open-source single-purpose tools / browser extensions** — free, but
  per-request checkers with no aggregation, no revenue framing, no service.

### Implication for positioning

The incumbent business model is opacity + enterprise pricing. Every
competitor above either scores you without showing their work (enterprise),
gates you without telling you the truth (CAPTCHA), or sees your traffic only
if you put your whole site on their network (Cloudflare).

**No incumbent is selling the SMB site owner a verifiable, affordable,
business-facing answer.** That specific square is empty, and the rule-making
(CoMP, EU AI Act) is building a legal need for exactly that.

---

## 3. Benefit analysis — who we help, with what, and why it's worth money

### SMB site owners (Adsense / Mediavine / own stack)
- **Pain today:** inflated, unauditable bot numbers; wasted ad spend; no idea
  which channels drive real business; ~half their traffic is machines they
  can't explain.
- **Benefit:** a plain-language answer — *what is real, what is not, what
  drives revenue, what doesn't* — with every number auditable because the
  engine is open source.
- **What it's worth:** the wedge is the delta between enterprise pricing
  ($3,830/mo) and a fair flat fee with a free tier for small sites; plus the
  direct ad-waste avoided when spend is re-routed off bot-inflated channels.

### Marketing agencies (multi-client)
- **Pain today:** they manage dozens of client sites and report on metrics
  they themselves can't fully trust; a bot spike silently inflates or
  deflates client performance numbers and their reputation.
- **Benefit:** a multi-tenant dashboard, scheduled "your client's bot rate
  jumped to 40%" alerts, and language the client believes because the
  methodology is public and the vendor isn't selling opacity.
- **What it's worth:** agencies already pay for tools that protect client
  ad spend; ours is cheaper and comes with auditability they can hand over.

### Publishers / content owners
- **Pain today:** crawl-to-refer ratios of thousands-to-one; content feeding
  AI training with no return; no easy way to show they opted out — now a
  **legal** duty under the EU AI Act (machine-readable opt-out, effective
  2026-08-02).
- **Benefit:** a compliance + attribution report (who crawled, for what
  purpose, did they respect the opt-out) that converts an opaque liability
  into a documented, defensible position.
- **What it's worth:** this is the newest revenue line — CoMP-compatible
  compliance evidence for publishers and the agencies that serve them.

### Ad networks / programmatic buyers
- **Pain today:** their inventory quality is only as good as their
  partners' numbers.
- **Benefit:** a verifiable traffic-truth signal per site (portable, signed)
  that helps them price inventory honestly.
- **What it's worth:** a long-term partnership/valuation channel, not a
  near-term one — we build the credential now, sell its use later.

---

## 4. North-star differentiators (what actually moves the needle)

Pick the three or four plays that make BotTollbooth structurally different,
not just cheaper:

### North Star 1 — The value-exchange metric (the killer frame)
Incumbents sell "how much is a bot." We sell **"what did my traffic give
back?"** Crawl-to-referral ratio and revenue-impact-per-purpose are exactly
the numbers the market is waking up to (Cloudflare's own reports now lead
with them). Our engine already computes conservative revenue impact per
category. Productizing "value exchanged," not "threat level," is the frame
no incumbent owns. **This is the core pitch.**

### North Star 2 — A purpose-aware, verifiable crawler registry
More than a third of crawler traffic is "mixed-use/undeclared" — content
owners literally cannot tell crawl intent. Cloudflare says the fix is
verifiable self-identification + declared intent and is actively pushing it.
An **independent, open, SMB-accessible registry** (crawler or agent →
DID/identity → declared purpose → attestation of behaviour) serves that
same goal without being owned by a CDN or a payment rail. Being the neutral
registry of "who crawled me, declared as what, and did they stick to it" is
a defensible position in a brand-new standard-space (CoMP only finalized
2026-04-28).

### North Star 3 — CoMP / EU-compliance reporter
The regulatory calendar (machine-readable opt-outs + training-data
transparency, live 2026-08-02) turns crawl logging from "nice analytics"
into "compliance evidence." Publishers need a tool that proves a crawler
respected their declared rights and that they honoured their own opt-out
duty. A purpose-classified, retained, signed crawl log **is** that proof.
No challenger is productized around this yet; it's a six-month window.

### North Star 4 — Verifiable reports (signed truth)
Because the core is MIT/open and self-hostable, our numbers can be
**cryptographically signed and hash-anchored** so an owner can prove to an
agency, an investor, or an ad network that a figure genuinely came from
their traffic data and wasn't inspected or modified. Trust you can hand a
third party is the thing opacity-based incumbents structurally cannot offer.
This is also the natural, *non-hype* on-ramp to the web3 layer (section 5).

---

## 5. Web3 / blockchain additions — honest feasibility map

The brand is "honest, not hype," so the web3 layer must earn its place as a
**trust anchor for transparency** — nothing else. We rate each idea by what
it takes to build it and by what an open-source, zero-capital author can do
with existing experience (advanced Solana/Web3 and W3C Verifiable
Credentials, incl. DID + JSON-LD credential schema work).

### Tier 1 — Realistic: build these next
1. **Signed report digests (North Star 4).** Each report gets a signed
   digest; optionally anchored via the Solana Attestation Service (SAS) —
   mainnet-live since May 2025, open/permissionless, portable credentials —
   so third parties can verify provenance without trusting us. Reuses:
   hash + signature + attestation. No token, no gas-twiddling UI.
2. **DID-based identities for the crawler registry (North Star 2).**
   Issue crawlers/agents a `did:web` (or Solana DID) + a signed W3C
   Verifiable Credential describing declared purpose (training / search /
   user action / undeclared → declared). This mirrors the DID + VC + JSON
   schema work in the author's trust-engine experience, and it lines up with
   the AIR (Agent Identity Registry) model: W3C-DID-compliant, NIST L3- and
   EU-AI-Act-aligned, 0–1000 trust score across auditable dimensions.

### Tier 2 — Ambitious: 12-month horizon
3. **On-chain anchored audit log (AIR-style).** Periodically hash the crawl
   log and anchor the hash on-chain (e.g., SAS attestation or a DID-anchored
   DID document), giving tamper-evidence "as of" records for publisher
   compliance claims. Still cheap, still no token, but requires more
   pipeline care (downtime, fork/rollback, signature churn).
4. **Attribution / compensation ledger aligned with CoMP.** A ledger
   matching crawler purpose declarations against CoMP licensing/attribution
   terms — the accounting layer of "who owes what." Depends on CoMP
   adoption, which is early.

### Tier 3 — Hype: do not build (and why)
- **ZK proof-of-humanity as our own uniqueness oracle** (Worldcoin,
  Humanity Protocol, Proof of Humanity, Self, Semaphore-based builds). 
  Fascinating, but it's a supply-side identity layer others will provide;
  it doesn't make a site owner richer and it drags in hardware, liveness,
  and privacy liabilities we can't own. Watch, don't build.
- **Per-crawl cryptocurrency micropayments / our own token.** Cloudflare is
  already the merchant of record for 402-based pay-per-crawl via Stripe,
  and the earlier honest analysis in `docs/monetization.md` rejected
  charging-crawlers as a business. A token adds a court of opinion and
  destroys the neutrality that is our moat. No.
- **"Decentralized analytics" storage play.** Moving traffic logs onto a
  permanent chain/network contradicts privacy-preserving ingest
  (aggregates only) and adds cost with no buyer. No.

### The one-line version
Use SAS + DIDs + Verifiable Credentials as a **verifiability layer on top of
an already-open product** — because that is the only blockchain use case
that reinforces transparency instead of replacing substance with rails.

---

## 6. What we build next (roadmap tie-in)

- **L1 — Know your traffic (this repo).** Engine + service + demo +
  BYOD access-log ingest. Done.
- **L2 — Value-exchange products.** Crawl-to-referral framing, purpose
  breakdowns, per-client reports for agencies, signed report digests.
  Delivered: `CRAWLERS` registry (purpose + ppr per crawler), `valueExchange()`,
  `examples/site-report.js`, sha256 report digest, demo "Crawl Purpose & Value
  Exchange" panel. (North Stars 1, 4 — Tier 1 web3.)
- **L3 — Trust layer.** Crawler/agent registry with credentialed identities
  + CoMP/EU-compliance reporter + anchored audit logs.
  (North Stars 2, 3 — Tier 1/2 web3.)
  HTML-started: `recommendCrawler()`, `robotTxt()`, `optOutList()`,
  `ntmDisclosure()` in the engine, `/api/v1/compliance` in the service,
  `--write-dir` on `site-report.js`, and a "CoMP / EU Opt-out & Disclosure"
  demo panel. Remaining: credentialed registry (NS 2), anchored audit logs.
  This round also shipped the **creator/monetization frame** on the demo
  (Free / Managed API $9 / Agency $79), the **bandwidth-cost impact** layer,
  the **headless & sensor probe** (`src/probe/`), and the zero-dependency
  **SDK** (`src/sdk/`) + hardened API (Bearer-token gate, security headers).

Each layer is shipped open and self-hostable, grows the portfolio with
verifiable artifacts, and never requires asking for permission or capital.