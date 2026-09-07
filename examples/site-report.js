#!/usr/bin/env node
'use strict';

/**
 * bot-tollbooth — one-command site report
 * ---------------------------------------
 * The value layer end to end: point this at a real access log and it returns
 * the three numbers a site owner actually cares about —
 *   1. Traffic mix      (bots by category, human share)
 *   2. Value exchange   (per crawl purpose; crawlers give back ≈ traffic)
 *   3. Tamper-evidence  (sha256 digest over the report)
 *
 * Everything runs in-process — no server, no network, no dependencies.
 *
 *   node examples/site-report.js examples/fixtures/access.log
 *   node examples/site-report.js access.log --namespace shop.com
 *   node examples/site-report.js access.log --rpm 15 --fill-scale 50
 *
 * The module is require-able ({ buildReport }), so scheduled jobs can produce
 * daily reports from rotating logs and archive the JSON next to the digest.
 */

const fs = require('node:fs');
const { rowsFromLog, parseAccessLine } = require('./accesslog-to-ingest.js');
const { ingest, aggregate } = require('../src/service/ingest.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const VALUED = new Set(['--namespace', '--rpm', '--fill-scale']);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (VALUED.has(a)) i += 1;
      continue;
    }
    positional.push(a);
  }
  return {
    file: positional[0],
    namespace: opt('--namespace') || 'site',
    rpm: Number(opt('--rpm') || 15),
    fillScale: Number(opt('--fill-scale') || 50),
  };
}

const PURPOSE_COPY = {
  training: 'AI training corpora (takes content, sends no visitors)',
  search: 'Search indexing (sends visitors back — the good kind)',
  'user-action': 'On-demand live answers (little/no measurable return)',
  mixed: 'Mixed purpose (vendor uses content for several things)',
};

function buildReport(file, { namespace = 'site', rpm = 15, fillScale = 50 } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const { rows } = rowsFromLog(text);
  const ts = text
    .split(/\r?\n/)
    .map(parseAccessLine)
    .map((h) => (h ? h.at : null))
    .filter((t) => t !== null)
    .sort((a, b) => a - b);
  const span = ts.length ? ((ts[ts.length - 1] - ts[0]) / 1000).toFixed(0) : '-';

  ingest(namespace, rows);
  const report = aggregate(namespace, rpm, fillScale);

  const vx = report.valueExchange;
  const ratio = vx.pagesPerReferral
    ? `${vx.pagesPerReferral.toFixed(1)} pages crawled per real visitor returned`
    : 'no published return ratio';

  const lines = [];
  lines.push('BotTollbooth site report');
  lines.push('========================');
  lines.push(`file:      ${file}`);
  lines.push(`namespace: ${namespace}`);
  lines.push(`window:    ${rows.length} requests over ~${span}s`);
  lines.push('');
  lines.push('1. Traffic mix');
  lines.push('--------------');
  for (const [cat, count] of Object.entries(report.summary.byCategory)) {
    lines.push(`  ${(cat + ':').padEnd(20)} ${String(count).padStart(5)}  ${(100 * count / report.summary.total).toFixed(1)}%`);
  }
  lines.push(`  human share           ${(100 * report.summary.human / report.summary.total).toFixed(1)}%`);
  lines.push('');
  lines.push('2. Value exchange');
  lines.push('-----------------');
  lines.push(`  automated requests with known purpose: ${vx.automatedRequests}`);
  for (const [purpose, count] of Object.entries(vx.byPurpose)) {
    if (!count) continue;
    lines.push(`  ${(purpose + ':').padEnd(20)} ${String(count).padStart(5)}  ${(PURPOSE_COPY[purpose] || '')}`);
  }
  lines.push(`  estimated visitors returned: ${vx.estimatedReferralsReturned.toFixed(3)}`);
  lines.push(`  ratio:                       ${ratio}`);
  lines.push('');
  lines.push('3. Revenue impact (if this traffic were monetized)');
  lines.push('--------------------------------------------------');
  lines.push(`  bots, last window:     ${report.impact.botVisitors}`);
  lines.push(`  monthly recovered @rpm ${rpm} (fill ${fillScale}%): $${report.impact.recoveredMonthly.toFixed(3)}`);
  lines.push('');
  lines.push(`digest: sha256 ${report.digest}`);
  return { text: lines.join('\n'), report };
}

if (require.main === module) {
  const { file, namespace, rpm, fillScale } = parseArgs();
  if (!file) {
    console.error('usage: node examples/site-report.js access.log [--namespace ns] [--rpm 15] [--fill-scale 50]');
    process.exit(1);
  }
  const { text } = buildReport(file, { namespace, rpm, fillScale });
  console.log(text);
}

module.exports = { buildReport, PURPOSE_COPY };