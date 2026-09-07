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
const path = require('node:path');
const { rowsFromLog, parseAccessLine } = require('./accesslog-to-ingest.js');
const {
  ingest,
  aggregate,
  reportDigest,
} = require('../src/service/ingest.js');
const { robotTxt, optOutList, ntmDisclosure } = require('../src/engine/index.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const VALUED = new Set(['--namespace', '--rpm', '--fill-scale', '--write-dir', '--page-kb', '--cost-per-gb']);
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
    pageSizeKB: Number(opt('--page-kb') || 2500),
    costPerGB: Number(opt('--cost-per-gb') || 0.09),
    writeDir: opt('--write-dir'),
  };
}

const PURPOSE_COPY = {
  training: 'AI training corpora (takes content, sends no visitors)',
  search: 'Search indexing (sends visitors back — the good kind)',
  'user-action': 'On-demand live answers (little/no measurable return)',
  mixed: 'Mixed purpose (vendor uses content for several things)',
};

function buildReport(file, { namespace = 'site', rpm = 15, fillScale = 50, pageSizeKB = 2500, costPerGB = 0.09 } = {}) {
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
  const report = aggregate(namespace, rpm, fillScale, { pageSizeKB, costPerGB });

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
  lines.push('4. Compliance (CoMP / EU AI-act opt-outs)');
  lines.push('----------------------------------------');
  for (const entry of optOutList(report.crawlers)) {
    lines.push(`  ${(entry.key + ':').padEnd(20)} ${entry.verdict.padEnd(8)} ${String(entry.requests).padStart(4)} req  ${entry.reason}`);
  }
  lines.push(`  robots.txt: ${robotTxt(report.crawlers, { namespace }).split('\n').length - 1} lines generated (${optOutList(report.crawlers).filter((e) => e.verdict === 'opt-out').length} opt-outs)`);
  const disclosure = ntmDisclosure(report.crawlers, {
    namespace,
    start: report.window.start,
    end: report.window.end,
    reportDigest: report.digest,
  });
  disclosure.json.digest = reportDigest(disclosure.json);
  lines.push(`  disclosure digest: sha256 ${disclosure.json.digest}`);
  lines.push('');
  const bw = report.bandwidth;
  lines.push('5. Bandwidth & cost impact');
  lines.push('-------------------------');
  lines.push(`  bot requests served:      ${bw.botRequests} (${bw.botMB.toFixed(1)} MB delivered)`);
  lines.push(`  estimated egress cost:     $${bw.bandwidthCostUSD.toFixed(4)}`);
  lines.push(`  training crawler traffic:  ${bw.trainingRequests} requests (${bw.trainingMB.toFixed(1)} MB)`);
  lines.push(`  training cost (egress):    $${bw.trainingCostUSD.toFixed(4)}`);
  for (const a of bw.assumptions) lines.push(`    - ${a}`);
  lines.push('');
  lines.push(`digest: sha256 ${report.digest}`);
  return { text: lines.join('\n'), report, compliance: { robotsTxt: robotTxt(report.crawlers, { namespace }), optOuts: optOutList(report.crawlers), disclosure } };
}

function writeArtifacts(dir, compliance, namespace) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'robots.txt': compliance.robotsTxt,
    'opt-outs.json': JSON.stringify(compliance.optOuts, null, 2),
    'disclosure.json': JSON.stringify(compliance.disclosure.json, null, 2),
    'disclosure.txt': compliance.disclosure.text,
  };
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
    console.log(`wrote ${path.join(dir, name)}`);
  }
}

if (require.main === module) {
  const { file, namespace, rpm, fillScale, pageSizeKB, costPerGB, writeDir } = parseArgs();
  if (!file) {
    console.error('usage: node examples/site-report.js access.log [--namespace ns] [--rpm 15] [--fill-scale 50] [--page-kb 2500] [--cost-per-gb 0.09] [--write-dir out]');
    process.exit(1);
  }
  const { text, compliance } = buildReport(file, { namespace, rpm, fillScale, pageSizeKB, costPerGB });
  console.log(text);
  if (writeDir) writeArtifacts(writeDir, compliance, namespace);
}

module.exports = { buildReport, PURPOSE_COPY };