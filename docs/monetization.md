# Monetization analysis (the honest version)

This file exists because the most valuable decision made on this project was
the decision **not** to chase the flashy commercial idea first. Reproducing
that reasoning makes the repo useful and keeps it honest.

## What was originally proposed (and why it's a trap)

The first framing was a "tollbooth": charge AI companies per crawler request
(GPTBot, ClaudeBot, Google-Extended…) with tiered per-request rates and a
revenue split. The reasons that fails:

- **Detection is ~85–95% accurate at best.** Charging real money on a
  ~10% error rate means billing real humans for someone else's bots.
- **Residential proxies defeat IP-based charging.** Bot operators replay real
  browser UAs from real IPs; UA-tiering becomes a trivial spoofing exercise.
- **No enforcement layer.** How do you collect? No API key, no payment
  infra, no legal basis to bill a crawler that ignores `robots.txt`.
- **The market moved the other way.** AI companies increasingly *pay
  publishers* (licensing deals) rather than being charged for crawling.
- **Cloudflare, DoubleVerify, Integral Ad Science already own the space**
  with native or entrenched detection.
- **Cordis dynamic plugins can't hold money.** No billing, no persistence
  of user accounts, no checkout. Any "charge the site owner" path would
  require payment infra the plugin runtime doesn't provide.

## What survives the honest cut

| Idea | Verdict | Why |
| --- | --- | --- |
| Charge AI crawlers per request | ❌ Rejected | enforcement + accuracy + legal |
| Replace Cloudflare bot detection | ❌ Rejected | incumbent, free token |
| "Recover" ad revenue ourselves | ❌ Rejected | requires ad-network partnership |
| **Bot impact analytics dashboard** | ✅ **Built** | visibility is real value, low friction |
| **Affiliate CTA (Cloudflare)** | ✅ **Built** | least-friction zero-capital revenue path |

The **summarized** value proposition became:

> *"X% of your traffic is bots, costing you ~$Y / month in ad revenue."*

That's a business metric a small publisher can act on — and it's the same
information that motivates a Cloudflare Pro/Business consideration, which is
where the affiliate CTA comes in.

## Least-friction paths from zero capital (time-to-dollar)

| Path | Time to first dollar | Capital | Month-1 ceiling |
| --- | --- | --- | --- |
| Plugin affiliate (this repo, CTA) | 3–6 mo | $0 | ~$50–200 |
| **Plugin as lead-gen for a paid analysis service** | **1–4 weeks** | **$0** | **$500–2,500** |
| Consulting (your algorithms as the deliverable) | 1–2 weeks | $0 | $500–5,000 |
| Aggregated anonymized traffic insights | 3–6 mo | $0 | later B2B |

The realistic play: use the dashboard as the *demo*, sell "bot impact
analysis + mitigation recommendations" as the paid service, and let the
affiliate CTA be a passive tail. The dashboard is the lead magnet; the
algorithms are the moat.

## The math that actually matters

`revenueImpact()` in `src/host/engine.js`:

```
recoveredMonthly ≈ botVisitors / 1000 × rpm × fillScale
```

- `botVisitors` — non-human sampled visits in the period
- `rpm` — publisher's reported revenue per 1,000 monetized impressions
- `fillScale ≈ 0.5` — conservative: most bot traffic never renders a
  monetized/valid impression, so we discount the "recovered" figure

This is deliberately **conservative**. Understating recovery is a feature:
it keeps the number defensible (which is what makes it a good consulting
artifact) and avoids the over-promise-and-under-deliver trap that kills zero-
capital projects.