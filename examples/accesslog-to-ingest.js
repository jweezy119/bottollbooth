#!/usr/bin/env node
'use strict';

/**
 * bot-tollbooth — bring-your-own-data importer (access logs)
 * ----------------------------------------------------------
 * Turn a real Nginx/Apache access log into /api/v1/ingest rows so the
 * analytics service can score *your actual traffic* — not a simulation.
 *
 * Supports the combined log format (with referer + user agent), which is
 * what Nginx and Apache ship by default:
 *
 *   127.0.0.1 - - [09/Sep/2026:14:02:11 +0000] "GET / HTTP/1.1" 200 2312
 *     "https://ref.example.com/" "Mozilla/5.0 (Windows NT 10.0) Chrome/126"
 *
 * It also matches an Apache-style combined log with an empty referer "-".
 *
 * Per-IP request rate is computed as the densest 60-second window per client
 * and passed as `requestsPerMin`, so a residential-proxy blast (one IP firing
 * dozens of requests in a few seconds) earns a rate-based classification
 * instead of hiding as human.
 *
 * CLI usage:
 *   node examples/accesslog-to-ingest.js access.log
 *   node examples/accesslog-to-ingest.js access.log --namespace shop.com
 *   node examples/accesslog-to-ingest.js access.log --post http://localhost:8080
 *   cat access.log | node examples/accesslog-to-ingest.js --post http://localhost:8080
 *
 * The module is also require-able so tests and scheduled jobs can reuse the
 * parser: { parseAccessLine, rowsFromLog }.
 */

const fs = require('node:fs');
const http = require('node:http');

// Combined log format (Nginx default "combined", Apache default):
//   host ident authuser [date] "request" status bytes "referer" "user-agent"
const COMBINED = /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\S+\s+\S+\s+"([^"]*)"\s+"([^"]*)"\s*$/;
// Apache-style combined without a referer:
//   host ident authuser [date] "request" status bytes "user-agent"
const WITHOUT_REFERER = /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\S+\s+\S+\s+"([^"]*)"\s*$/;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(raw) {
  const m = /^\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\]/.exec(raw);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]);
  if (mon < 0) return null;
  const tz = m[7];
  const sign = tz[0] === '-' ? -1 : 1;
  const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const utc = Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  return utc - offMin * 60000;
}

/**
 * Parse one access-log line.
 * @param {string} line
 * @returns {{ip:string, at:number|null, userAgent:string|null, status:string|null}|null}
 */
function parseAccessLine(line) {
  if (!line || /^#/.test(line)) return null;
  let m = COMBINED.exec(line);
  let userAgent = null;
  let ip = null;
  if (m) {
    // combined: group 2 = referer, group 3 = user-agent
    ip = m[1];
    userAgent = m[3] === '-' || m[3] === '' ? null : m[3];
  } else {
    m = WITHOUT_REFERER.exec(line);
    if (m) {
      ip = m[1];
      userAgent = m[2] === '-' || m[2] === '' ? null : m[2];
    } else {
      return null;
    }
  }
  const dm = /\[[^\]]+\]/.exec(line);
  const at = dm ? parseDate(dm[0]) : null;
  const sm = /"\s+(\d{3})\s+/.exec(line);
  return { ip, at, userAgent, status: sm ? sm[1] : null };
}

/**
 * Convert access-log text into /ingest request rows.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.limit] - cap rows (for spot checks)
 * @returns {{rows:Array<{userAgent:string, requestsPerMin?:number}>, parsed:number, skipped:number}}
 */
function rowsFromLog(text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (const line of lines) {
    const p = parseAccessLine(line);
    if (!p || !p.userAgent) continue;
    hits.push(p);
  }
  const parsed = hits.length;

  // Per-IP burst rate: the most requests one IP fired inside any 60-second
  // window. Catches residential-proxy scrapers that hammer a few pages in a
  // few seconds but stay quiet for the rest of the log window.
  const byIp = {};
  for (const h of hits) {
    if (h.at === null) continue;
    (byIp[h.ip] || (byIp[h.ip] = [])).push(h.at);
  }
  const ipRpm = {};
  for (const ip of Object.keys(byIp)) {
    const ts = byIp[ip].sort((a, b) => a - b);
    let best = 1;
    for (let i = 0; i < ts.length; i++) {
      let c = 1;
      for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= 60_000; j++) c++;
      if (c > best) best = c;
    }
    ipRpm[ip] = best;
  }

  let rows = hits.map((h) => ({
    userAgent: h.userAgent,
    requestsPerMin: ipRpm[h.ip] || 1,
  }));

  if (typeof opts.limit === 'number' && opts.limit > 0 && rows.length > opts.limit) {
    rows = rows.slice(0, opts.limit);
  }
  return { rows, parsed, skipped: lines.filter((l) => l && !/^#/.test(l)).length - parsed };
}

function postBatch(url, namespace, rows) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify({ namespace, rows });
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: '/api/v1/ingest',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => {
          try { resolve(JSON.parse(out)); } catch { resolve({ received: 0, accepted: 0 }); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function readInput() {
  const file = process.argv[2];
  if (file === undefined) return fs.readFileSync(0, 'utf8'); // stdin
  return fs.readFileSync(file, 'utf8');
}

function waitForInput() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve();
    resolve('');
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const namespace = opt('--namespace') || 'site';
  const postUrl = opt('--post');
  const limit = Number(opt('--limit') || 0);

  const text = await readInput();
  if (!text.trim()) {
    console.error('no input — pass a log file or pipe one in');
    if (postUrl) console.error('  $ node examples/accesslog-to-ingest.js access.log --post http://localhost:8080');
    process.exitCode = 1;
    return;
  }

  const { rows, parsed, skipped } = rowsFromLog(text, { limit });
  console.log(`parsed ${parsed} request lines (skipped ${skipped})`);

  if (!rows.length) {
    console.error('no usable user-agent rows found (is this combined log format?)');
    process.exitCode = 1;
    return;
  }

  if (postUrl) {
    const BATCH = 1000;
    let sent = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const r = await postBatch(postUrl, namespace, chunk);
      sent += r.accepted || 0;
    }
    console.log(`ingested ${sent}/${rows.length} rows into ${postUrl} as namespace "${namespace}"`);
  } else {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  }
}

if (require.main === module) {
  waitForInput().then(main);
}

module.exports = { parseAccessLine, rowsFromLog };