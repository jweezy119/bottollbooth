# Monetization & business model — fair, not predatory

This file is the strategy behind **who pays, why, and how much** — built
around the core belief that incumbent "fraud detection" pricing is broken,
and small-business owners are the ones getting scoured.

## The market problem (why this exists)

Enterprise bot/fraud-detection platforms (DoubleVerify, Integral Ad Science)
set the industry norm: **opaque and expensive**. Their model depends on the
customer being able to verify as little as possible, so a rising bot figure
justifies a rising subscription.

The side of the internet that actually needs ground truth — **small and
mid-sized businesses** with a website, Adsense/Mediavine revenue, and
marketing budgets — gets:

- **Inflated prices** for tools built for enterprise scale they don't need.
- **Opaque metrics** that distort their marketing decisions (they optimize
  for channels that look great because bots inflated the numbers).
- **No way to verify** what these tools report, so they're captive.

BotTollbooth's position: **transparency is the product, and it should be
cheap enough that any site owner can afford it — or run it free themselves.**

## What we refuse to do

| Tempting idea | Why we reject it |
| --- | --- |
| "Charge AI companies per crawler request" | Enforcement, accuracy, and legal problems; also the market moved the other way (AI companies *pay* publishers to license content). |
| "Recover" ad revenue and take a cut | Requires ad-network partnerships and inflates our incentive to over-report. |
| Lock the detection logic behind a black box | The opposite of our positioning — kills trust. |
| Price like the incumbents | Contradicts the whole reason we exist. |

## How we actually make money (fair paths)

### 1. The open core (this repo)
MIT-licensed, self-hostable, free forever. This is our **trust engine** — it
proves we're not hiding anything. Anyone can verify every number.

### 2. Managed service (fair, flat pricing)
For owners who don't want to run infrastructure. Set up, host, and maintain
the pipeline for a **small, flat monthly fee** — a fraction of enterprise
pricing, tiered by traffic volume, with a **free tier** for small sites.

### 3. Agency layer
Many marketing agencies already manage dozens of client sites. A multi-tenant
dashboard + scheduled reports + alerting ("This client's bot rate jumped to
40%") is a genuine win for them and their clients — and agencies pay for
tools that demonstrably protect their clients' ad spend.

### 4. Growth via trust, not lock-in
Because the core is open, an owner who outgrows us can self-host and walk
away. That's unusual and it is precisely why owners/agencies trust the
numbers. **Retention comes from being the honest option.**

## Positioning vs Cloudflare

Cloudflare is a **CDN/security** company with bot detection as a feature.
BotTollbooth is a **traffic-transparency and analytics** company — it works
alongside Cloudflare, AdSense, GA4 and tells the owner the business-facing
story those platforms don't: *what is real, what is not, what drives
revenue, what doesn't.*

## The open-core economics, honestly

Open + self-hostable means our **core revenue is the managed service and
agency layer**, not licenses. That's fine: it keeps the trust engine honest
and gives us a defensible, non-predatory business. The moat is verification
and fair pricing, not secrecy.

## What this means for the author's resume

This business model demonstrates the exact skills hiring managers in
security/IAM/integrations/marketing-technology roles look for:

- **Identity & classification thinking** — "is this request real and who is
  it" applied to web traffic.
- **B2B product judgement** — rejecting a flashy-but-broken idea (charging
  bots) in favour of a defensible one.
- **Honesty as a strategy** — open core + fair pricing as a competitive
  moat, not just a value statement.
- **Marketing-tech literacy** — RPM, impression fill, bot rate, and how
  these distort marketing decisions.