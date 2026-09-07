'use strict';

/**
 * Smoke test for the analytics service ingest + aggregate pipeline.
 * Zero-dependency: `node test/service.test.js`.
 */

const assert = require('node:assert');
const { ingest, aggregate, reportDigest } = require('../src/service/ingest.js');
const { robotTxt, optOutList, ntmDisclosure } = require('../src/engine/index.js');

const NS = 'store.example.com';

ingest(NS, [
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126 Safari/537.36' },
  { userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15' },
  { userAgent: 'GPTBot/1.0' },
  { userAgent: 'Googlebot/2.1' },
  { userAgent: 'python-requests/2.32.3' },
  { userAgent: 'UptimeRobot/2.0' },
]);

const report = aggregate(NS, 15, 50);
assert.strictEqual(report.summary.total, 6);
assert.strictEqual(report.summary.human, 2);
assert.strictEqual(report.summary.bot, 4);
assert.strictEqual(report.summary.byCategory['ai-crawler'], 1);
assert.strictEqual(report.summary.byCategory['search-engine'], 1);
assert.strictEqual(report.summary.byCategory.spam, 1);
assert.strictEqual(report.summary.byCategory.monitoring, 1);

// revenueImpact consistency: 4 bots / 1000 * 15 * 0.5 = 0.03
assert.ok(Math.abs(report.impact.recoveredMonthly - 0.03) < 1e-9);

// value exchange: GPTBot (training, ppr 1091) + Googlebot (search, ppr 5.4)
assert.strictEqual(report.valueExchange.automatedRequests, 2);
assert.strictEqual(report.valueExchange.byPurpose.training, 1);
assert.strictEqual(report.valueExchange.byPurpose.search, 1);
const expectedReturned = 1 / 1091 + 1 / 5.4;
assert.ok(Math.abs(report.valueExchange.estimatedReferralsReturned - expectedReturned) < 1e-12);

// digest is deterministic and tamper-evident
assert.ok(/^[0-9a-f]{64}$/.test(report.digest));
assert.strictEqual(reportDigest({ summary: report.summary, impact: report.impact, extra: 1 }),
  reportDigest({ extra: 1, impact: report.impact, summary: report.summary }));
assert.notStrictEqual(report.digest, reportDigest({ ...report, generatedAt: 'tampered' }));

// per-crawler counts feed the compliance/opt-out layer
assert.strictEqual(report.crawlers.GPTBot.requests, 1);
assert.strictEqual(report.crawlers.GPTBot.purpose, 'training');
assert.strictEqual(report.crawlers.Googlebot.purpose, 'search');
assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(report.window.start));
const complianceRt = robotTxt(report.crawlers, { namespace: NS });
assert.ok(complianceRt.includes('User-agent: GPTBot'));
assert.ok(!complianceRt.includes('bingbot'));
const disc = ntmDisclosure(report.crawlers, { namespace: NS, reportDigest: report.digest });
assert.ok(disc.text.includes(report.digest), 'disclosure chains the report digest');

let threw = false;
try { ingest('', []); } catch { threw = true; }
assert.ok(threw, 'ingest must require a namespace');

console.log('service.test.js: all assertions passed.');
