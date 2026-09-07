'use strict';

/**
 * bot-tollbooth — traffic classification & ad-revenue impact engine
 * ----------------------------------------------------------------
 * The re-usable, dependency-free core of the plugin. It models the "math and
 * algorithms" behind a Bot Impact dashboard:
 *
 *   1. Classify individual request rows into human / bot categories using
 *      weighted signals (user-agent, behavioural fingerprint, rate, TLS/JA3).
 *   2. Roll those classifications up into period summaries.
 *   3. Estimate the ad-revenue that bot traffic costs a publisher, given the
 *      site's reported RPM (revenue per 1,000 impressions).
 *
 * This module intentionally has zero I/O — it is a pure function library so it
 * can be unit-tested in isolation and shared by the Cordis host half, a CLI, a
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
  // Search engines
  { category: 'search-engine', pattern: /\bGooglebot\b/i },
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
 * @typedef {object} RequestRow
 * @property {string} userAgent
 * @property {number} [behaviourScore]  0..12 raw heuristic score (optional)
 * @property {number} [requestsPerMin]
 * @property {number} [dwellMs]
 */

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

  if (!ua || ua.length < 12) {
    return { category: CATEGORIES.UNCLASSIFIED, confidence: 0.4, signal: 'ua:empty' };
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
  classify,
  summarize,
  revenueImpact,
};
