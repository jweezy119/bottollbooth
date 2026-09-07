'use strict';

/**
 * Smoke test for the analytics service ingest + aggregate pipeline.
 * Zero-dependency: `node test/service.test.js`.
 */

const assert = require('node:assert');
const { ingest, aggregate } = require('../src/service/ingest.js');

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

let threw = false;
try { ingest('', []); } catch { threw = true; }
assert.ok(threw, 'ingest must require a namespace');

console.log('service.test.js: all assertions passed.');
