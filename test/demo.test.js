'use strict';

/**
 * Smoke test for the demo dashboard logic (index.html inline engine).
 * Runs the browser script under a stubbed DOM and verifies:
 *   - profile presets apply and drive the generator,
 *   - 2026 crawler UAs classify into the right buckets,
 *   - a shared #hash link always reproduces the identical dataset.
 * Zero-dependency: `node test/demo.test.js`.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const profiles = require(path.join(root, 'data/samples/profiles.js'));
const inline = fs
  .readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

const stubs = new Map();
function el(id) {
  if (!stubs.has(id)) {
    stubs.set(id, {
      id, _value: '', textContent: '', innerHTML: '', dataset: {}, style: {}, handlers: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(n, f) { this.handlers[n] = f; },
      get value() { return this._value; },
      set value(v) { this._value = v; },
    });
  }
  return stubs.get(id);
}

const sandbox = {
  console, Math, URLSearchParams, setTimeout,
  SAMPLE_PROFILES: profiles,
  location: { origin: 'https://example.github.io', pathname: '/bottollbooth/', hash: '' },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    createElement: () => ({ value: '', select() {}, classList: { add() {} } }),
    execCommand: () => true,
    body: { appendChild() {}, removeChild() {} },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(inline, sandbox);

const ecom = profiles.find((p) => p.id === 'ecommerce');

const rows = sandbox.generate({
  humanPct: 45, aiWeight: 12, spamWeight: 6, searchWeight: 6, monWeight: 1, count: 2500,
  pools: { ai: ecom.aiUAs, search: ecom.searchUAs, spam: ecom.spamUAs, mon: ecom.monUAs },
});
assert.strictEqual(rows.length, 2500);
const cats = {};
for (const r of rows) {
  const c = sandbox.classify(r).category;
  cats[c] = (cats[c] || 0) + 1;
}
assert.ok(cats['ai-crawler'] > 0, 'ai crawlers present in ecommerce profile');
assert.ok(cats.human > 0, 'humans present in ecommerce profile');

assert.strictEqual(sandbox.classify({ userAgent: 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)' }).category, 'ai-crawler');
assert.strictEqual(sandbox.classify({ userAgent: 'Amazonbot/0.1 (+https://developer.amazon.com/amazonbot)' }).category, 'ai-crawler');
assert.strictEqual(sandbox.classify({ userAgent: 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)' }).category, 'search-engine');

sandbox.location.hash = '#v=1&p=55&a=8&s=4&se=10&m=2&r=15&f=50&c=2000&pr=ecommerce&per=30d';
sandbox.applyHash();
assert.strictEqual(sandbox.STATE.profile, 'ecommerce');
assert.strictEqual(sandbox.STATE.aiWeight, 12);
assert.strictEqual(sandbox.STATE.rpm, 20);
sandbox.render();
const first = JSON.stringify(sandbox.STATE.rows);
sandbox.render();
const second = JSON.stringify(sandbox.STATE.rows);
assert.strictEqual(first, second, 'same hash must reproduce the identical dataset');
assert.ok(sandbox.stateParams().includes('pr=ecommerce'));
assert.ok(sandbox.stateParams().includes('per=30d'));

const ve = sandbox.valueExchange(rows);
assert.ok(ve.automatedRequests > 0, 'value exchange sees crawl requests');
assert.ok(ve.byPurpose.training > 0, 'ecommerce profile generates training crawl traffic');
assert.strictEqual(sandbox.crawlIntent('GPTBot/1.2 (+https://openai.com/gptbot)').purpose, 'training');
assert.strictEqual(sandbox.crawlIntent('Googlebot/2.1 (+http://www.google.com/bot.html)').purpose, 'search');
assert.strictEqual(sandbox.crawlIntent('Totally unknown UA/99'), null);
assert.ok(typeof ve.estimatedReferralsReturned === 'number');
assert.ok(ve.pagesPerReferral === null || ve.pagesPerReferral > 0);

console.log('demo.test.js: all assertions passed.');