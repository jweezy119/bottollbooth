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
  bandwidthImpact,
  probeHints,
  recommendCrawler,
  robotTxt,
  optOutList,
  ntmDisclosure,
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

// Compliance decision core
assert.strictEqual(recommendCrawler({ key: 'GPTBot', purpose: 'training' }).verdict, 'opt-out');
assert.strictEqual(recommendCrawler({ key: 'Googlebot', purpose: 'search' }).verdict, 'allow');
assert.strictEqual(recommendCrawler({ key: 'Amazonbot', purpose: 'mixed' }).verdict, 'review');
assert.strictEqual(recommendCrawler(null).verdict, 'review');

const crawlers = {
  GPTBot: { label: 'GPTBot (OpenAI)', purpose: 'training', ppr: 1091, requests: 3 },
  bingbot: { label: 'bingbot (search)', purpose: 'search', ppr: 10, requests: 2 },
};
const rt = robotTxt(crawlers, { namespace: 'shop.example.com' });
assert.ok(rt.includes('User-agent: GPTBot'), 'robots.txt opts out training crawlers');
assert.ok(rt.includes('Disallow: /'));
assert.ok(!rt.includes('User-agent: bingbot'), 'robots.txt must not block search');
assert.ok(rt.includes('shop.example.com'));

const outs = optOutList(crawlers);
assert.strictEqual(outs.length, 2);
assert.strictEqual(outs[0].key, 'GPTBot'); // CRAWLERS-order deterministic
assert.strictEqual(outs[0].verdict, 'opt-out');
assert.strictEqual(outs[1].verdict, 'allow');

const disc = ntmDisclosure(crawlers, { namespace: 'shop.example.com' });
assert.ok(disc.text.includes('NTM / AI-training disclosure'));
assert.ok(disc.text.includes('GPTBot'));
assert.strictEqual(disc.json.namespace, 'shop.example.com');
assert.strictEqual(disc.json.crawlers[0].verdict, 'opt-out');
assert.ok(disc.json.basis.length > 20);

// bandwidth + cost impact
const bwRows = [
  { userAgent: 'GPTBot/1.0' },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126 Safari/537.36' },
  { userAgent: 'python-requests/2.32.3' },
  { userAgent: 'Googlebot/2.1' },
];
const bw = bandwidthImpact(bwRows, { pageSizeKB: 1000, costPerGB: 0.1 });
assert.strictEqual(bw.botRequests, 3);
assert.ok(Math.abs(bw.botMB - (3 * 1000) / 1024) < 0.001);
assert.strictEqual(bw.trainingRequests, 1); // only GPTBot is training
assert.ok(bw.assumptions.length === 3);

// probe / headless client signals
assert.strictEqual(probeHints({ webdriver: true }).score, 4);
assert.strictEqual(probeHints({ softwareRenderer: true }).score, 3);
assert.strictEqual(probeHints({ pluginsCount: 0 }).score, 2);
assert.strictEqual(probeHints({ webdriver: false, pluginsCount: 22 }).score, 0);
const headless = classify({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/999.0.0.0 Safari/537.36',
  webdriver: true,
});
assert.strictEqual(headless.category, CATEGORIES.SPAM);
assert.ok(headless.signal.startsWith('probe:'));

console.log('engine.test.js: all assertions passed.');