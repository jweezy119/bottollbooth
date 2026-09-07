#!/usr/bin/env node
'use strict';

/**
 * bot-tollbooth — demo CLI
 * ------------------------
 * Standalone demo of the Transparent Traffic Classification + Ad-Revenue
 * Impact engine. No server required: run the exact same algorithm the
 * analytics service uses, so anyone can verify the math on their own box.
 *
 * Usage:
 *   node examples/demo.js                  # run with a built-in sample feed
 *   node examples/demo.js --rpm 25         # tune publisher RPM
 */

const { summarize, revenueImpact, classify } = require('../src/engine/index.js');

const SAMPLE_FEED = [
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15' },
  { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148' },
  { userAgent: 'GPTBot/1.0 (+https://openai.com/gptbot)' },
  { userAgent: 'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)', behaviourScore: 2 },
  { userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
  { userAgent: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)' },
  { userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)', requestsPerMin: 120 },
  { userAgent: 'python-requests/2.32.3', behaviourScore: 7, dwellMs: 200 },
  { userAgent: '', behaviourScore: 0 },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0', behaviourScore: 1, dwellMs: 42_000 },
  { userAgent: 'UptimeRobot/2.0', requestsPerMin: 1 },
  { userAgent: 'PerplexityBot/1.0 (+https://perplexity.ai/bot)', behaviourScore: 0 },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126 Safari/537.36', dwellMs: 88_000 },
];

const rpm = process.argv.includes('--rpm')
  ? Number(process.argv[process.argv.indexOf('--rpm') + 1])
  : 15;

const summary = summarize(SAMPLE_FEED);
const impact = revenueImpact(summary, rpm);

console.log('\n  Bot Traffic Classification (sample feed stack)');
console.log('  ' + '-'.repeat(46));
console.log('  Total sampled visits      :', summary.total);
console.log('  Human                     :', summary.human);
console.log('  Bot                       :', summary.bot, `(${Math.round(summary.botRate * 100)}%)`);
console.log('\n  By category:');
for (const [cat, n] of Object.entries(summary.byCategory)) {
  console.log('   -', cat.padEnd(15), String(n).padStart(3));
}
console.log('\n  Dashboards render at time T=0.3s after host aggregate.');

// per-request classification detail, useful for debugging heuristics
console.log('\n  Per-request classification:');
for (const row of SAMPLE_FEED) {
  const { category, confidence, signal } = classify(row);
  console.log(
    '   -',
    (row.userAgent || '(empty)').slice(0, 48).padEnd(50),
    String(category).padEnd(14),
    `${(confidence * 100).toFixed(0)}%`,
    signal,
  );
}

console.log('\n  Ad-Revenue Impact (conservative bot fill ~50%)');
console.log('  ' + '-'.repeat(46));
console.log('  Publisher RPM           : $', rpm, '/ 1k monitizable impressions');
console.log('  Bot visits / mo         :', impact.botVisitors);
console.log('  Recoverable revenue/mo  :', '$' + impact.recoveredMonthly.toFixed(2));
console.log();