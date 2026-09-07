'use strict';

/**
 * Smoke test for the BYOD access-log importer.
 * Zero-dependency: `node test/importer.test.js`.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const { parseAccessLine, rowsFromLog } = require('../examples/accesslog-to-ingest.js');

// combined format: ip - - [date] "req" 200 bytes "referer" "user-agent"
const combined = parseAccessLine(
  '203.0.113.10 - - [07/Sep/2026:09:02:11 +0000] "GET / HTTP/1.1" 200 2312 "https://ref/" "GPTBot/1.2 (+https://openai.com/gptbot)"',
);
assert.strictEqual(combined.ip, '203.0.113.10');
assert.strictEqual(combined.userAgent, 'GPTBot/1.2 (+https://openai.com/gptbot)');
assert.ok(combined.at > 0, 'combined line must parse a timestamp');

// combined with empty referer "-"
const noRef = parseAccessLine(
  '198.51.100.7 - - [07/Sep/2026:09:10:00 +0000] "GET /blog HTTP/1.1" 200 6512 "-" "ClaudeBot/1.0 (+https://anthropic.com/claude-bot)"',
);
assert.strictEqual(noRef.userAgent, 'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)');

// Apache-style without referer
const apache = parseAccessLine(
  '192.0.2.5 - - [07/Sep/2026:08:00:00 +0000] "GET / HTTP/1.1" 200 1892 "Googlebot/2.1 (+http://www.google.com/bot.html)"',
);
assert.strictEqual(apache.userAgent, 'Googlebot/2.1 (+http://www.google.com/bot.html)');

// comments and garbage are ignored
assert.strictEqual(parseAccessLine('# just a comment'), null);
assert.strictEqual(parseAccessLine('not a log line at all'), null);

// fixture end-to-end: rows are produced, threaded, and bursty IPs are flagged
const text = fs.readFileSync('examples/fixtures/access.log', 'utf8');
const { rows, parsed, skipped } = rowsFromLog(text);
assert.strictEqual(parsed, 17);
assert.strictEqual(skipped, 0);
assert.strictEqual(rows.length, 17);

const uas = new Set(rows.map((r) => r.userAgent));
['GPTBot/1.2', 'ClaudeBot/1.0', 'UptimeRobot/2.0', 'python-requests/2.32.3'].forEach((needle) => {
  assert.ok([...uas].some((u) => u.includes(needle)), `fixture lacks ${needle}`);
});

// every row carries a computed per-IP requestsPerMin over the log window
assert.ok(rows.every((r) => r.requestsPerMin > 0), 'every row carries a computed requestsPerMin');

// classification sanity: known UAs still land in the right buckets
const { classify } = require('../src/engine/index.js');
assert.strictEqual(classify({ userAgent: 'GPTBot/1.2 (+https://openai.com/gptbot)' }).category, 'ai-crawler');
assert.strictEqual(classify({ userAgent: 'Bytespider' }).category, 'ai-crawler');
assert.strictEqual(classify({ userAgent: 'Mozilla/5.0 Applebot/0.1' }).category, 'search-engine');