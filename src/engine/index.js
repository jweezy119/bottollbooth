'use strict';

/**
 * bot-tollbooth — transparent traffic classification & business-impact engine
 * ---------------------------------------------------------------------------
 * The dependency-free open core of BotTollbooth. It models the "math and
 * algorithms" behind transparent bot traffic analytics:
 *
 *   1. Classify individual request rows into human / bot categories using
 *      weighted signals (user-agent, behavioural fingerprint, rate, TLS/JA3)
 *      and return the exact signal that produced each answer.
 *   2. Roll those classifications up into period summaries by category.
 *   3. Estimate the ad-revenue a publisher loses to bot traffic, given the
 *      site's reported RPM (revenue per 1,000 impressions) and a conservative,
 *      user-adjustable fill-scale assumption.
 *
 * This module intentionally has zero I/O — it is a pure function library so it
 * can be unit-tested in isolation and shared by the web service, a CLI, a
 * scheduled job, or an API route. See ../docs/architecture.md.
 */

const CATEGORIES = Object.freeze({
  HUMAN: 'human',
  SEARCH_ENGINE: 'search-engine',
  AI_CRAWLER: 'ai-crawler',
  SPAM: 'spam',
  MONITORING: 'monitoring',
  UNCLASSIFIED: 'unclassified',
});

/**
 * Sentinel user-agent signatures. Order matters: more specific / high-signal
 * patterns are checked first so a single UA never mis-bins.
 */
const UA_RULES = Object.freeze([
  // AI / LLM training & inference crawlers
  { category: 'ai-crawler', pattern: /\bGPTBot\b/i },
  { category: 'ai-crawler', pattern: /\bChatGPT-User\b/i },
  { category: 'ai-crawler', pattern: /\bClaudeBot\b/i },
  { category: 'ai-crawler', pattern: /\bAnthropic-AI\b/i },
  { category: 'ai-crawler', pattern: /\bGoogle-Extended\b/i },
  { category: 'ai-crawler', pattern: /\bCCBot\b/i },
  { category: 'ai-crawler', pattern: /\bPerplexityBot\b/i },
  { category: 'ai-crawler', pattern: /\bcohere-ai\b|\bCohere\b/i },
  { category: 'ai-crawler', pattern: /\bClaude-Web\b/i },
  { category: 'ai-crawler', pattern: /\bOAI-SearchBot\b/i },
  { category: 'ai-crawler', pattern: /\bMeta-ExternalAgent\b/i },
  { category: 'ai-crawler', pattern: /\bBytespider\b/i },
  { category: 'ai-crawler', pattern: /\bAmazonbot\b/i },
  { category: 'ai-crawler', pattern: /\bApplebot-Extended\b/i },
  { category: 'ai-crawler', pattern: /\bDuckAssistBot\b/i },
  // Search engines
  { category: 'search-engine', pattern: /\bGooglebot\b/i },
  { category: 'search-engine', pattern: /\bApplebot\b/i },
  { category: 'search-engine', pattern: /\bbingbot\b/i },
  { category: 'search-engine', pattern: /\bDuckDuckBot\b/i },
  { category: 'search-engine', pattern: /\bYandexBot\b/i },
  { category: 'search-engine', pattern: /\bBaiduspider\b/i },
  { category: 'search-engine', pattern: /\bsogou\b|\bYoudaoBot\b/i },
  // Monitoring / uptime
  { category: 'monitoring', pattern: /\bUptimeRobot\b/i },
  { category: 'monitoring', pattern: /\bStatusCake\b/i },
  { category: 'monitoring', pattern: /\bPingdom\b/i },
  // Disposable / headless & known scraper footprints
  { category: 'spam', pattern: /\bSemrushBot\b/i },
  { category: 'spam', pattern: /\bAhrefsBot\b/i },
  { category: 'spam', pattern: /\bMJ12bot\b/i },
  { category: 'spam', pattern: /\bcurl\/\b/i },
  { category: 'spam', pattern: /\bpython-requests\b/i },
  { category: 'spam', pattern: /\bbash-http\b/i },
  { category: 'spam', pattern: /\bwget\/\b/i },
]);

/**
 * Weighted behavioural heuristics. These complement the UA rules and matter
 * for pages where UA replay (residential proxies) defeats signature matching.
 */
const BehaviourWeights = Object.freeze({
  noJs: 3,          // a real browser always runs JS
  noCookies: 1,     // session-consistency signal
  headless: 4,      // missing dimensions / navigator.webdriver style hints
  burst: 3,         // rate far above human ceiling
  zeroDwell: 2,     // <~1s on page => no reading
  singlePage: 1,    // one hit and gone
});

/**
 * Crawler metadata: purpose + crawl-to-referral cost (pages crawled per one
 * real visitor referred back). Grounded in public 2026 data (Cloudflare Radar
 * crawl-to-referral ratios & crawler purpose splits): ClaudeBot ~38,000:1,
 * GPTBot ~1,091:1, Perplexity ~195:1, Google ~5.4:1. This is the *value
 * exchange*: how much content a crawler takes versus how much traffic it
 * gives back. `ppr: null` means no published/known return.
 */
const CRAWLERS = Object.freeze([
  // AI / LLM crawlers
  { key: 'GPTBot', re: /\bGPTBot\b/i, label: 'GPTBot (OpenAI)', purpose: 'training', ppr: 1091 },
  { key: 'ChatGPT-User', re: /\bChatGPT-User\b/i, label: 'ChatGPT-User (OpenAI)', purpose: 'user-action', ppr: null },
  { key: 'OAI-SearchBot', re: /\bOAI-SearchBot\b/i, label: 'OAI-SearchBot (OpenAI)', purpose: 'search', ppr: null },
  { key: 'ClaudeBot', re: /\bClaudeBot\b/i, label: 'ClaudeBot (Anthropic)', purpose: 'training', ppr: 38000 },
  { key: 'Claude-Web', re: /\bClaude-Web\b/i, label: 'Claude-Web (Anthropic)', purpose: 'search', ppr: null },
  { key: 'PerplexityBot', re: /\bPerplexityBot\b/i, label: 'PerplexityBot', purpose: 'search', ppr: 195 },
  { key: 'Google-Extended', re: /\bGoogle-Extended\b/i, label: 'Google-Extended', purpose: 'training', ppr: null },
  { key: 'CCBot', re: /\bCCBot\b/i, label: 'CCBot (Common Crawl)', purpose: 'training', ppr: null },
  { key: 'Applebot-Extended', re: /\bApplebot-Extended\b/i, label: 'Applebot-Extended', purpose: 'training', ppr: null },
  { key: 'Amazonbot', re: /\bAmazonbot\b/i, label: 'Amazonbot', purpose: 'mixed', ppr: null },
  { key: 'Meta-ExternalAgent', re: /\bMeta-ExternalAgent\b/i, label: 'Meta-ExternalAgent', purpose: 'user-action', ppr: null },
  { key: 'Bytespider', re: /\bBytespider\b/i, label: 'Bytespider (ByteDance)', purpose: 'training', ppr: null },
  { key: 'cohere-ai', re: /\bcohere-ai\b|\bCohere\b/i, label: 'cohere-ai', purpose: 'training', ppr: null },
  { key: 'DuckAssistBot', re: /\bDuckAssistBot\b/i, label: 'DuckAssistBot (DuckDuckGo)', purpose: 'search', ppr: null },
  // Search engines — the return side of the value exchange
  { key: 'Googlebot', re: /\bGooglebot\b/i, label: 'Googlebot (search)', purpose: 'search', ppr: 5.4 },
  { key: 'bingbot', re: /\bbingbot\b/i, label: 'bingbot (search)', purpose: 'search', ppr: 10 },
  { key: 'DuckDuckBot', re: /\bDuckDuckBot\b/i, label: 'DuckDuckBot (search)', purpose: 'search', ppr: 8 },
  { key: 'Applebot', re: /\bApplebot\b/i, label: 'Applebot (search)', purpose: 'search', ppr: 6 },
]);

/**
 * Look up a user-agent against the crawler registry.
 * @param {string} userAgent
 * @returns {{key:string,label:string,purpose:string,ppr:number|null}|null}
 */
function crawlIntent(userAgent) {
  if (!userAgent) return null;
  for (const c of CRAWLERS) {
    if (c.re.test(userAgent)) {
      return { key: c.key, label: c.label, purpose: c.purpose, ppr: c.ppr };
    }
  }
  return null;
}

/**
 * @typedef {object} RequestRow
 * @property {string} userAgent
 * @property {number} [behaviourScore]  0..12 raw heuristic score (optional)
 * @property {number} [requestsPerMin]
 * @property {number} [dwellMs]
 * @property {boolean} [webdriver]       navigator.webdriver === true (headless/automation)
 * @property {boolean} [softwareRenderer] WebGL renderer resolved to software (SwiftShader/llvmpipe)
 * @property {number} [pluginsCount]     navigator.plugins.length (0 = headless shell)
 */

/**
 * Rate the client-side signals gathered by the embeddable probe (src/probe/probe.js).
 * A real human browser shows webdriver=false, a hardware GPU renderer, and plugins.
 * Headless shells and virtualised scrapers trip at least one of these.
 * @param {RequestRow} row
 * @returns {{score:number, signals:string[]}}
 */
function probeHints(row) {
  const signals = [];
  if (row.webdriver === true) signals.push('webdriver');
  if (row.softwareRenderer === true) signals.push('softwareRenderer');
  if (row.pluginsCount === 0) signals.push('zeroPlugins');
  const score = signals.includes('webdriver') ? 4
    : signals.includes('softwareRenderer') ? 3
    : signals.includes('zeroPlugins') ? 2 : 0;
  return { score, signals };
}

/**
 * Classify a single request row into a category + confidence.
 * @param {RequestRow} row
 * @returns {{category: string, confidence: number, signal: string}}
 */
function classify(row) {
  const ua = row.userAgent || '';
  for (const rule of UA_RULES) {
    if (rule.pattern.test(ua)) {
      return { category: rule.category, confidence: 0.92, signal: `ua:${rule.category}` };
    }
  }

  // Behavioural fallback once UA signatures are exhausted.
  const b = row.behaviourScore ?? 0;
  const rps = row.requestsPerMin ?? 0;
  const probe = probeHints(row);

  if (!ua || ua.length < 12) {
    return { category: CATEGORIES.UNCLASSIFIED, confidence: 0.4, signal: 'ua:empty' };
  }
  if (probe.score >= 3) {
    return { category: CATEGORIES.SPAM, confidence: 0.88, signal: `probe:${probe.signals.join('+')}` };
  }
  if (b >= BehaviourWeights.zeroDwell + BehaviourWeights.singlePage + BehaviourWeights.headless) {
    return { category: CATEGORIES.SPAM, confidence: 0.85, signal: 'behav:high' };
  }
  if (rps > 60) {
    return { category: CATEGORIES.SPAM, confidence: 0.78, signal: 'rate:burst' };
  }
  return { category: CATEGORIES.HUMAN, confidence: 0.9, signal: 'behav:human' };
}

/**
 * Roll an array of request rows into a period summary.
 * @param {RequestRow[]} rows
 * @returns {{total:number, human:number, bot:number, byCategory:Record<string,number>, botRate:number}}
 */
function summarize(rows) {
  const byCategory = {};
  let human = 0;
  for (const r of rows) {
    const c = classify(r).category;
    byCategory[c] = (byCategory[c] || 0) + 1;
    if (c === CATEGORIES.HUMAN) human += 1;
  }
  const total = rows.length;
  const bot = total - human;
  return {
    total,
    human,
    bot,
    byCategory,
    botRate: total === 0 ? 0 : bot / total,
  };
}

/**
 * The value exchange: how many automated requests each crawl *purpose* sent,
 * and how many real visitors the crawlers gave back (pages / pages-per-referral).
 * Accepts raw request rows (UA present) or stored entries (privacy-shifted,
 * carrying `purpose` + `ppr` directly).
 * @param {Array<{userAgent?:string,purpose?:string,ppr?:number|null}>} rows
 * @returns {{automatedRequests:number, byPurpose:Record<string,number>, estimatedReferralsReturned:number, pagesPerReferral:number|null}}
 */
function valueExchange(rows) {
  const byPurpose = { training: 0, search: 0, 'user-action': 0, mixed: 0 };
  let automated = 0;
  let returned = 0;
  for (const r of rows) {
    const meta = r.purpose ? { purpose: r.purpose, ppr: r.ppr } : crawlIntent(r.userAgent);
    if (!meta) continue;
    automated += 1;
    byPurpose[meta.purpose] = (byPurpose[meta.purpose] || 0) + 1;
    if (typeof meta.ppr === 'number' && meta.ppr > 0) returned += 1 / meta.ppr;
  }
  return {
    automatedRequests: automated,
    byPurpose,
    estimatedReferralsReturned: returned,
    pagesPerReferral: automated > 0 && returned > 0 ? automated / returned : null,
  };
}

/**
 * The bandwidth and egress-cost impact of bot traffic.
 *
 * Model: every request = one page delivered (pageSizeKB), each GB of egress
 * costs costPerGB. Only bot requests are counted; training-crawler traffic is
 * broken out separately so a site owner sees what the AI crawlers alone cost.
 * Accepts raw request rows or stored entries (looked up by `category`).
 *
 * @param {Array<{userAgent?:string,category?:string,purpose?:string}>} rows
 * @param {object} [opts]
 * @param {number} [opts.pageSizeKB=2500] average page weight per request
 * @param {number} [opts.costPerGB=0.09] egress/CDN cost per GB
 * @returns {{requests:number,botRequests:number,botMB:number,bandwidthCostUSD:number,trainingRequests:number,trainingMB:number,trainingCostUSD:number,assumptions:string[]}}
 */
function bandwidthImpact(rows, opts = {}) {
  const pageSizeKB = opts.pageSizeKB ?? 2500;
  const costPerGB = opts.costPerGB ?? 0.09;
  const isEntry = rows.length > 0 && typeof rows[0].category === 'string';
  let botRequests = 0;
  let trainingRequests = 0;
  for (const r of rows) {
    const category = isEntry ? r.category : classify(r).category;
    if (category === CATEGORIES.HUMAN) continue;
    botRequests += 1;
    const purpose = r.purpose || (crawlIntent(r.userAgent) || {}).purpose;
    if (purpose === 'training') trainingRequests += 1;
  }
  const mb = (n) => (n * pageSizeKB) / 1024;
  const usd = (m) => (m / 1024) * costPerGB;
  const botMB = mb(botRequests);
  const trainingMB = mb(trainingRequests);
  const round2 = (n) => Math.round(n * 100) / 100;
  const round4 = (n) => Math.round(n * 10000) / 10000;
  return {
    requests: rows.length,
    botRequests,
    botMB: round2(botMB),
    bandwidthCostUSD: round4(usd(botMB)),
    trainingRequests,
    trainingMB: round2(trainingMB),
    trainingCostUSD: round4(usd(trainingMB)),
    assumptions: [
      `page ~${pageSizeKB} KB delivered per request`,
      `egress cost ~$${costPerGB} per GB`,
      'each request = one page delivered',
    ],
  };
}

/**
 * Public notes for well-known crawlers with non-obvious controls.
 */
const CRAWLER_NOTES = Object.freeze({
  'Google-Extended': 'also control via Google Search Console (Gemini extensions setting)',
  'Applebot-Extended': 'blocking does not affect Siri/Spotlight indexing',
  'Amazonbot': 'blocking also disables Amazon shopping-assistant price comparisons',
  'CCBot': 'Common Crawl mirrors the public web; robots.txt is the control',
  'cohere-ai': 'used for model training corpora',
  'DuckAssistBot': 'DuckDuckGo AI search assistant',
});

/**
 * Verdict for a single crawler, derived transparently from its purpose.
 * training -> opt-out (takes content, sends no visitors back)
 * search   -> allow (indexes and returns real visitors)
 * anything else -> review (on-demand/mixed use is a business decision)
 * @param {{key:string,purpose?:string}|null} meta - as returned by crawlIntent
 * @returns {{verdict:string, reason:string, mechanism:string}}
 */
function recommendCrawler(meta) {
  if (!meta || !meta.purpose) {
    return {
      verdict: 'review',
      reason: 'Unidentified automated system — confirm the user-agent in your access logs',
      mechanism: 'manual',
    };
  }
  if (meta.purpose === 'training') {
    return {
      verdict: 'opt-out',
      reason: 'AI training crawler: copies content, returns no visitors',
      mechanism: 'robots.txt',
    };
  }
  if (meta.purpose === 'search') {
    return {
      verdict: 'allow',
      reason: 'Search crawler: indexes content and sends real visitors back',
      mechanism: 'none',
    };
  }
  return {
    verdict: 'review',
    reason: 'On-demand/mixed crawler: decide whether AI tools may read content on request',
    mechanism: 'robots.txt',
  };
}

function crawlerOrderedKeys(crawlers) {
  const seen = {};
  const keys = [];
  for (const c of CRAWLERS) {
    if (crawlers[c.key] && !seen[c.key]) { seen[c.key] = 1; keys.push(c.key); }
  }
  if (crawlers['unknown-ai'] && !seen['unknown-ai']) {
    keys.push('unknown-ai');
  }
  return keys;
}

/**
 * robots.txt block covering the AI training crawlers actually observed.
 * @param {Record<string,{label:string,purpose:string,requests:number}>} crawlers
 * @param {{namespace?:string}} [opts]
 * @returns {string}
 */
function robotTxt(crawlers, opts = {}) {
  const out = ['# bot-tollbooth — generated robots.txt'];
  if (opts.namespace) out.push(`# site: ${opts.namespace}`);
  out.push('# Opt-out for the AI training crawlers observed in this traffic,');
  out.push('# generated from your traffic answers. Search crawlers are not blocked.');
  let any = false;
  for (const key of crawlerOrderedKeys(crawlers)) {
    if (recommendCrawler(crawlers[key]).verdict !== 'opt-out') continue;
    any = true;
    out.push('', `User-agent: ${key}`, 'Disallow: /');
  }
  if (!any) out.push('', '# No known AI training crawlers observed — nothing to block.');
  out.push('');
  return out.join('\n');
}

/**
 * Machine-readable opt-out list, one entry per observed crawler.
 * @param {Record<string,{label:string,purpose:string,requests:number}>} crawlers
 * @returns {Array<{key:string,label:string,purpose:string,requests:number,verdict:string,reason:string,mechanism:string,note?:string}>}
 */
function optOutList(crawlers) {
  const list = [];
  for (const key of crawlerOrderedKeys(crawlers)) {
    const c = crawlers[key];
    const rec = recommendCrawler(c);
    const entry = {
      key,
      label: c.label,
      purpose: c.purpose || 'unknown',
      requests: c.requests,
      verdict: rec.verdict,
      reason: rec.reason,
      mechanism: rec.mechanism,
    };
    const note = CRAWLER_NOTES[key];
    if (note) entry.note = note;
    list.push(entry);
  }
  return list;
}

/**
 * NTM / EU AI Act transparency disclosure built from the same answers.
 * Pair it with `reportDigest` so the disclosure is chained to the report.
 * @param {Record<string,{label:string,purpose:string,requests:number}>} crawlers
 * @param {{namespace:string,start?:string,end?:string,reportDigest?:string}} [opts]
 * @returns {{text:string,json:object}}
 */
function ntmDisclosure(crawlers, opts = {}) {
  const list = optOutList(crawlers);
  const window = opts.start && opts.end ? `${opts.start} – ${opts.end}` : 'sampled window';
  const lines = [];
  lines.push(`NTM / AI-training disclosure — ${opts.namespace || 'site'}`);
  lines.push(`Window: ${window}`);
  lines.push('');
  lines.push('AI systems that accessed this site:');
  for (const e of list) {
    lines.push(`  - ${e.label} (${e.key}) — ${e.requests} requests — ${e.purpose} — ${e.verdict}`);
    if (e.note) lines.push(`      note: ${e.note}`);
  }
  lines.push('');
  lines.push('Basis: training crawlers are opted out via robots.txt; search indexing is');
  lines.push('permitted and returns visitors; on-demand/mixed crawls remain at the site');
  lines.push('owner\'s discretion.');
  lines.push('Bias: purpose labels are vendor-declared — verify against vendor documentation.');
  if (opts.reportDigest) lines.push(`Report digest: sha256 ${opts.reportDigest}`);
  const json = {
    schemaVersion: 1,
    namespace: opts.namespace || 'site',
    window: { start: opts.start || null, end: opts.end || null },
    crawlers: list,
    basis: 'training crawlers opted out via robots.txt; search indexing permitted; on-demand/mixed at owner discretion',
    bias: 'purpose labels are vendor-declared',
  };
  return { text: lines.join('\n'), json };
}

/**
 * Estimate ad-revenue lost to bot traffic.
 *
 * @param {{total:number, botRate:number}} summary - output of summarize()
 * @param {number} rpm - publisher revenue per 1,000 monetised impressions
 * @param {object} [opts]
 * @param {number} [opts.botFillScale] - bots rarely render the ad at full value.
 * @returns {{monthlyVisitors:number, botVisitors:number, lostMonthlyRpm:number, recoveredMonthly:number}}
 */
function revenueImpact(summary, rpm, opts = {}) {
  const fillScale = opts.botFillScale ?? 0.5; // conservative: bots monetise ~50%
  const monthlyVisitors = summary.total;
  const botVisitors = summary.bot;
  const botMille = botVisitors / 1000;
  // What the publisher WOULD earn if that blocked bot traffic had been filled
  // by real, ad-eligible humans at the same RPM:
  const recoveredMonthly = botMille * rpm * fillScale;
  return {
    monthlyVisitors,
    botVisitors,
    botRate: summary.botRate,
    lostMonthlyRpm: rpm,
    recoveredMonthly,
  };
}

module.exports = {
  CATEGORIES,
  UA_RULES,
  BehaviourWeights,
  CRAWLERS,
  CRAWLER_NOTES,
  classify,
  crawlIntent,
  probeHints,
  summarize,
  valueExchange,
  bandwidthImpact,
  recommendCrawler,
  robotTxt,
  optOutList,
  ntmDisclosure,
  revenueImpact,
};
