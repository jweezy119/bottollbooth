'use strict';

/**
 * bot-tollbooth — analytics HTTP service (zero-dependency)
 * --------------------------------------------------------
 * A minimal, self-hostable web service that site owners wire up to:
 *
 *   POST /api/v1/ingest  → submit a batch of request rows
 *   GET  /api/v1/report  → get the transparent traffic + revenue-impact report
 *
 * Everything is in-memory and privacy-preserving by default (only category
 * counts are kept — no raw user agents, no PII). Swap the `buckets` store in
 * `ingest.js` for Postgres/Redis when you scale.
 *
 * Run:
 *   PORT=8080 node src/service/server.js
 *
 * There is intentionally no framework or dependency: one file, Node built-ins
 * only, trivially deployable to Cloud Run, Lambda, Fly.io, or a $5 VPS — the
 * whole point is fair, low-cost infrastructure for small businesses.
 */

const http = require('node:http');
const { ingest, aggregate, reportDigest } = require('./ingest.js');
const {
  classify,
  CATEGORIES,
  robotTxt,
  optOutList,
  ntmDisclosure,
} = require('../engine/index.js');

const PORT = Number(process.env.PORT) || 8080;
const DEFAULT_RPM = Number(process.env.DEFAULT_RPM) || 15;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function notFound(res) {
  send(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // POST /api/v1/ingest  { namespace, rows: [...] }
    if (req.method === 'POST' && url.pathname === '/api/v1/ingest') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);
      if (!payload.namespace || !Array.isArray(payload.rows)) {
        return send(res, 400, { error: 'body must be { namespace: string, rows: [] }' });
      }
      const out = ingest(payload.namespace, payload.rows);
      return send(res, 201, { ok: true, ...out });
    }

    // GET /api/v1/report?namespace=x&rpm=15&fillScale=50
    if (req.method === 'GET' && url.pathname === '/api/v1/report') {
      const namespace = url.searchParams.get('namespace');
      if (!namespace) return send(res, 400, { error: 'missing ?namespace=' });
      const rpm = Number(url.searchParams.get('rpm') || DEFAULT_RPM);
      const fillScale = Number(url.searchParams.get('fillScale') || 50);
      const report = aggregate(namespace, rpm, fillScale);
      return send(res, 200, report);
    }

    // GET /api/v1/compliance?namespace=x
    if (req.method === 'GET' && url.pathname === '/api/v1/compliance') {
      const namespace = url.searchParams.get('namespace');
      if (!namespace) return send(res, 400, { error: 'missing ?namespace=' });
      const report = aggregate(namespace, DEFAULT_RPM, 50);
      const disclosure = ntmDisclosure(report.crawlers, {
        namespace,
        start: report.window.start,
        end: report.window.end,
        reportDigest: report.digest,
      });
      disclosure.json.digest = reportDigest(disclosure.json);
      return send(res, 200, {
        namespace,
        robotsTxt: robotTxt(report.crawlers, { namespace }),
        optOuts: optOutList(report.crawlers),
        disclosure,
        generatedAt: report.generatedAt,
      });
    }

    // GET /api/v1/classify?ua=...
    if (req.method === 'GET' && url.pathname === '/api/v1/classify') {
      const ua = url.searchParams.get('ua') || '';
      if (!ua) return send(res, 400, { error: 'missing ?ua=' });
      const verdict = classify({ userAgent: ua });
      return send(res, 200, { userAgent: ua, ...verdict });
    }

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { status: 'ok' });
    }

    return notFound(res);
  } catch (err) {
    return send(res, 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`BotTollbooth analytics service listening on :${PORT}`);
  console.log(`  POST /api/v1/ingest`);
  console.log(`  GET  /api/v1/report?namespace=<site>&rpm=15`);
  console.log(`  GET  /api/v1/compliance?namespace=<site>`);
  console.log(`  GET  /api/v1/classify?ua=<user-agent>`);
  console.log(`  GET  /health`);
});

function shutdown(signal) {
  console.log(`${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
