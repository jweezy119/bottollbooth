'use strict';

/**
 * Smoke test for the traffic classification / revenue-impact engine.
 * Zero-dependency: `node test/engine.test.js`. Keeps the repo runnable
 * without npm install (the plugin itself is dependency-free by design).
 */

const assert = require('node:assert');
const {
  classify,
  summarize,
  revenueImpact,
  CATEGORIES,
} = require('../src/host/engine.js');

const cases = [
  ['GPTBot/1.0', CATEGORIES.AI_CRAWLER],
  ['ClaudeBot/1.0', CATEGORIES.AI_CRAWLER],
  ['Googlebot/2.1', CATEGORIES.SEARCH_ENGINE],
  ['CCBot/2.0', CATEGORIES.AI_CRAWLER],
  ['UptimeRobot/2.0', CATEGORIES.MONITORING],
  ['python-requests/2.32.3', CATEGORIES.SPAM],
];

for (const [ua, expected] of cases) {
  const { category } = classify({ userAgent: ua });
  assert.strictEqual(category, expected, `expected ${expected} for ${ua}`);
}

const { userAgent: _, ...feed } = {};
const rows = [
  { userAgent: 'Chrome/126 real browser', behaviourScore: 0 },
  { userAgent: 'GPTBot/1.0' },
  { userAgent: 'python-requests/2.32.3', behaviourScore: 9 },
  { userAgent: 'Googlebot/2.1' },
  { userAgent: 'Firefox/127 human', dwellMs: 60_000 },
];

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