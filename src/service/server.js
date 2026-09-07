'use strict';

/**
 * bot-tollbooth — analytics HTTP service (zero-dependency)
 * --------------------------------------------------------
 * A minimal, self-hostable web service that site owners wire up to:
 *
 *   POST /api/v1/ingest     → submit a batch of request rows
 *   POST /api/v1/probe      → submit a single headless/sensor probe signal
 *   GET  /api/v1/report     → get the transparent traffic + revenue-impact report
 *   GET  /api/v1/compliance → CoMP / EU robots.txt + disclosure
 *   GET  /api/v1/classify   → live per-UA lookup
 *   GET  /probe.js          → embeddable browser probe (serviced from here)
 *   GET  /health            → liveness
 *
 * Security:
 *   Set BOTTOLLBOOTH_TOKEN to require `Authorization: Bearer <token>` on all
 *   /api/v1/* endpoints.  /health and /probe.js remain open.
 *
 * Everything is in-memory and privacy-preserving by default (only category
 * counts are kept — no raw user agents, no PII). Swap the `buckets` store in
 * `ingest.js` for Postgres/Redis when you scale.
 *
 * Run:
 *   PORT=8080 node src/service/server.js
 *   BOTTOLLBOOTH_TOKEN=mysecret PORT=8080 node src/service/server.js
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { ingest, aggregate, reportDigest } = require('./ingest.js');
const {
  classify,
  robotTxt,
  optOutList,
  ntmDisclosure,
} = require('../engine/index.js');

const PORT = Number(process.env.PORT) || 8080;
const DEFAULT_RPM = Number(process.env.DEFAULT_RPM) || 15;
const AUTH_TOKEN = process.env.BOTTOLLBOOTH_TOKEN || '';

const PROBE_JS = fs.readFileSync(path.join(__dirname, '../probe/probe.js'), 'utf8');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, code, obj, headers = {}) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(JSON.stringify(obj));
}

function notFound(res) {
  send(res, 404, { error: 'not_found' });
}

function jsonBody(req) {
  return readBody(req).then((raw) => JSON.parse(raw));
}

function authed(req) {
  if (!AUTH_TOKEN) return true;
  return req.headers.authorization === `Bearer ${AUTH_TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Security headers (every response)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // GET /probe.js — embeddable browser probe, always open
    if (req.method === 'GET' && url.pathname === '/probe.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(PROBE_JS);
    }

    // GET /health — liveness, always open
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { status: 'ok' });
    }

    // From here on, /api/v1/* endpoints require Bearer token if configured
    if (!authed(req)) {
      return send(res, 401, { error: 'missing or invalid Bearer token' });
    }

    // POST /api/v1/ingest  { namespace, rows: [...] }
    if (req.method === 'POST' && url.pathname === '/api/v1/ingest') {
      const payload = await jsonBody(req);
      if (!payload.namespace || !Array.isArray(payload.rows)) {
        return send(res, 400, { error: 'body must be { namespace: string, rows: [] }' });
      }
      const out = ingest(payload.namespace, payload.rows);
      return send(res, 201, { ok: true, ...out });
    }

    // POST /api/v1/probe  { namespace, userAgent, signals?: {...} }
    if (req.method === 'POST' && url.pathname === '/api/v1/probe') {
      const payload = await jsonBody(req);
      if (!payload.namespace || !payload.userAgent) {
        return send(res, 400, { error: 'body must be { namespace: string, userAgent: string, signals?: {webdriver?, softwareRenderer?, pluginsCount?} }' });
      }
      const row = Object.assign({ userAgent: payload.userAgent, requestsPerMin: 1 }, payload.signals || {});
      const out = ingest(payload.namespace, [row]);
      return send(res, 201, { ok: true, accepted: out.accepted });
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

    return notFound(res);
  } catch (err) {
    return send(res, 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`BotTollbooth analytics service listening on :${PORT}${AUTH_TOKEN ? ' (token-protected)' : ''}`);
  console.log(`  POST /api/v1/ingest`);
  console.log(`  POST /api/v1/probe`);
  console.log(`  GET  /api/v1/report?namespace=<site>&rpm=15`);
  console.log(`  GET  /api/v1/compliance?namespace=<site>`);
  console.log(`  GET  /api/v1/classify?ua=<user-agent>`);
  console.log(`  GET  /probe.js`);
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