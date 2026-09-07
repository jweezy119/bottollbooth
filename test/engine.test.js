'use strict';

/**
 * Smoke test for the traffic classification / revenue-impact engine.
 * Zero-dependency: `node test/engine.test.js`. Keeps the repo runnable
 * without npm install (the plugin itself is dependency-free by design).
 */

const assert = require('node:assert');
const {
  classify,
  crawlIntent,
  summarize,
  valueExchange,
  revenueImpact,
  CATEGORIES,
} = require('../src/engine/index.js');

const cases = [
  ['GPTBot/1.0', CATEGORIES.AI_CRAWLER],
  ['ClaudeBot/1.0', CATEGORIES.AI_CRAWLER],
  ['Googlebot/2.1', CATEGORIES.SEARCH_ENGINE],
  ['CCBot/2.0', CATEGORIES.AI_CRAWLER],
  ['UptimeRobot/2.0', CATEGORIES.MONITORING],
  ['python-requests/2.32.3', CATEGORIES.SPAM],
  ['Mozilla/5.0 Meta-ExternalAgent/1.0', CATEGORIES.AI_CRAWLER],
  ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', CATEGORIES.AI_CRAWLER],
  ['Amazonbot/0.1 (+https://developer.amazon.com/amazonbot)', CATEGORIES.AI_CRAWLER],
  ['Applebot-Extended/1.0', CATEGORIES.AI_CRAWLER],
  ['OAI-SearchBot/1.0', CATEGORIES.AI_CRAWLER],
  ['Claude-Web', CATEGORIES.AI_CRAWLER],
  ['Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', CATEGORIES.SEARCH_ENGINE],
];

for (const [ua, expected] of cases) {
  const { category } = classify({ userAgent: ua });
  assert.strictEqual(category, expected, `expected ${expected} for ${ua}`);
}

const intent = (ua) => crawlIntent(ua);
assert.strictEqual(intent('ClaudeBot/1.0 (anthropic)').purpose, 'training');
assert.strictEqual(intent('Claude-Web').purpose, 'search');
assert.strictEqual(intent('GPTBot/1.0').purpose, 'training');
assert.strictEqual(intent('PerplexityBot/1.0').purpose, 'search');
assert.strictEqual(intent('Googlebot/2.1').purpose, 'search');
assert.strictEqual(intent('Googlebot/2.1').ppr, 5.4);
assert.strictEqual(intent('Applebot-Extended/1.0').purpose, 'training'); // first-match beats search Applebot
assert.strictEqual(intent('Mozilla/5.0 Firefox/127' ), null);
assert.strictEqual(intent(undefined), null);

const rows = [
  { userAgent: 'Chrome/126 real browser', behaviourScore: 0 },
  { userAgent: 'GPTBot/1.0' },
  { userAgent: 'python-requests/2.32.3', behaviourScore: 9 },
  { userAgent: 'Googlebot/2.1' },
  { userAgent: 'Firefox/127 human', dwellMs: 60_000 },
];

const exchange = valueExchange(rows);
assert.strictEqual(exchange.automatedRequests, 2); // GPTBot + Googlebot
assert.strictEqual(exchange.byPurpose.training, 1);
assert.strictEqual(exchange.byPurpose.search, 1);
const expectedReturned = 1 / 1091 + 1 / 5.4;
assert.ok(Math.abs(exchange.estimatedReferralsReturned - expectedReturned) < 1e-12);
// returns are dominated by search referrals: 1 GPTBot training page returns ~0.001 visitors
assert.ok(exchange.estimatedReferralsReturned < 1);
assert.ok(exchange.pagesPerReferral < 100);
assert.strictEqual(valueExchange([]).automatedRequests, 0);

const summary = summarize(rows);
assert.strictEqual(summary.total, 5);
assert.strictEqual(summary.bot, 3);
assert.strictEqual(summary.human, 2);
assert.ok(Math.abs(summary.botRate - 0.6) < 1e-9);

const impact = revenueImpact(summary, 15);
assert.strictEqual(impact.botVisitors, 3);
// 3 bots / 1000 * 15 rpm * 0.5 fill scale = 0.0225
assert.ok(Math.abs(impact.recoveredMonthly - 0.0225) < 1e-9);

console.log('engine.test.js: all assertions passed.');