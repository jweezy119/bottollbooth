'use strict';

/**
 * Smoke test for the hosted dashboard (app.html inline script).
 * Runs the dashboard JS under a stubbed DOM + fetch and verifies the
 * workspace flows: refresh lists namespaces, ingest + report render.
 * Zero-dependency: `node test/app.test.js`.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const inline = fs
  .readFileSync(path.join(root, 'app.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

function stubEl() {
  return {
    value: '', textContent: '', innerHTML: '', dataset: {}, handlers: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(n, f) { this.handlers[n] = f; },
  };
}
const els = new Map();
const el = (id) => { if (!els.has(id)) els.set(id, stubEl()); return els.get(id); };

const reportFixture = {
  summary: { total: 300, human: 180, bot: 120, botRate: 0.4, byCategory: { human: 180, 'ai-crawler': 90 } },
  crawlers: { GPTBot: { label: 'GPTBot', purpose: 'training', requests: 60, category: 'ai-crawler' } },
  valueExchange: [{ label: '1. GPTBot — training', visitors: 0 }],
  bandwidth: { botRequests: 120, trainingRequests: 60, botMB: 293, trainingMB: 146, bandwidthCostUSD: 0.026, trainingCostUSD: 0.013 },
  window: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
  digest: 'abc123',
};

async function fakeFetch(url, opts) {
  const isClassify = /\/classify\?ua=/.test(url);
  return {
    ok: true, status: 200, statusText: 'OK',
    json: async () => {
      if (url.endsWith('/namespaces')) return { namespaces: ['shop.example.com', 'news.example.com'], audits: {} };
      if (isClassify) return { userAgent: 'x', category: 'ai-crawler', confidence: 0.92, signal: 'ua:ai-crawler' };
      if (/\/report\?/.test(url)) return reportFixture;
      if (/\/ingest$/.test(url)) return { ok: true, accepted: 400 };
      if (/\/audit$/.test(url)) return { requested: 'https://a.example', reachable: true, tls: true, overall: { grade: 'A', score: 92 }, note: null, waf: ['cloudflare'], cdn: [], robots: { ai: { GPTBot: 'blocked' } }, compliance: 'User-agent: GPTBot\nDisallow: /' };
      return {};
    },
  };
}

const sandbox = {
  console, Math, URLSearchParams,
  location: { origin: 'https://x.example', pathname: '/app' },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: fakeFetch,
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    createElement: () => ({ href: '', download: '', click() {}, classList: { add() {} } }),
    body: { appendChild() {}, removeChild() {} },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(inline, sandbox);

assert.strictEqual(typeof sandbox.APP, 'object', 'APP api exposed');
assert.strictEqual(typeof els.get('refresh').handlers.click, 'function', 'refresh button wired');

// refresh() lists workspaces
Promise.resolve().then(async () => {
  await sandbox.APP.refresh();
  assert.ok(els.get('ns-list').innerHTML.includes('shop.example.com'), 'workspace chips render');

  // select workspace + report
  sandbox.APP.state.ns = 'shop.example.com';
  const rpt = await sandbox.APP.runReport();
  assert.strictEqual(rpt.digest, 'abc123');
  assert.ok(els.get('report-ns').textContent.includes('shop.example.com'));
  assert.ok(els.get('mix').innerHTML.includes('Total requests'));
  assert.ok(els.get('vegrap').innerHTML.includes('GPTBot'));

  // classify
  const c = await sandbox.APP.classify('GPTBot/1.2');
  assert.strictEqual(c.category, 'ai-crawler');
  assert.ok(els.get('classify-out').innerHTML.includes('ai-crawler'));

  // audit (duplicate route handled by fetch stub)
  const a = await sandbox.APP.audit('https://a.example');
  assert.strictEqual(a.overall.grade, 'A');
  assert.ok(els.get('audit-out').innerHTML.includes('blocked'));

  // sample-ingest returns accepted count
  const out = await sandbox.APP.loadSample();
  assert.strictEqual(out.accepted, 400);

  console.log('app.test.js: all assertions passed.');
}).catch((err) => { console.error(err); process.exit(1); });