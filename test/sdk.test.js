'use strict';

/**
 * Smoke test for the zero-dependency SDK (src/sdk/index.js).
 * Verifies:
 *   - score() turns raw rows into summary + valueExchange + bandwidth + impact
 *   - compliance() produces robots.txt / opt-outs / disclosure from crawlers
 *   - the high-level exports match the engine's
 * Zero-dependency: `node test/sdk.test.js`.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const bt = require('../src/sdk/index.js');

const root = path.join(__dirname, '..');
const rows = bt.parseLog(
  fs.readFileSync(path.join(root, 'examples/fixtures/access.log'), 'utf8'),
).rows;
assert.ok(rows.length > 0, 'parseLog produces rows from the fixture');

const report = bt.score(rows, { rpm: 15 });
assert.ok(report.summary.total > 0);
assert.ok(report.summary.bot > 0, 'score detects bots');
assert.ok(report.valueExchange.automatedRequests > 0);
assert.strictEqual(typeof report.bandwidth.bandwidthCostUSD, 'number');
assert.ok(report.bandwidth.trainingRequests > 0, 'score buckets AI training bandwidth');
assert.ok(report.impact.recoveredMonthly > 0);

const compliance = bt.compliance(report.crawlers);
assert.ok(compliance.robotsTxt.includes('User-agent: GPTBot'));
assert.ok(!compliance.robotsTxt.includes('bingbot'));
assert.ok(compliance.optOuts.length > 0);
assert.ok(compliance.disclosure.text.includes('NTM'));
assert.ok(compliance.disclosure.json.crawlers.length > 0);

// engine-level transparency exports exposed
assert.strictEqual(typeof bt.classify, 'function');
assert.strictEqual(typeof bt.probeHints, 'function');
assert.strictEqual(typeof bt.bandwidthImpact, 'function');
assert.strictEqual(bt.CRAWLERS.length > 10, true);

console.log('sdk.test.js: all assertions passed.');
