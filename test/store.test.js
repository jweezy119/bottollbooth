'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/service/store.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btb-store-'));

store.init(dir);

// sanitize
assert.strictEqual(store.sanitize('Shop.Example.COM'), 'shop.example.com');
for (const bad of ['../evil', 'a/b', 'a\\b', '', 42, 'a b', '..', '.hidden']) {
  assert.throws(() => store.sanitize(bad), TypeError, `should reject ${JSON.stringify(bad)}`);
}

// persist + loadAll round-trip
const entries = [
  { category: 'human', confidence: 0.9, key: null, label: null, purpose: null, ppr: null, at: 1 },
  { category: 'ai-crawler', confidence: 0.92, key: 'GPTBot', label: 'GPTBot', purpose: 'training', ppr: 1091, at: 2 },
];
store.persist('shop.example.com', entries);
store.persist('news.example.com', []);
const all = store.loadAll();
assert.deepStrictEqual(all.get('shop.example.com'), entries);
assert.deepStrictEqual(all.get('news.example.com'), []);

// atomic write leaves no tmp litter
const tmp = fs.readdirSync(path.join(dir, 'namespaces')).filter((f) => f.endsWith('.tmp'));
assert.strictEqual(tmp.length, 0);

// audits round-trip
store.saveAudit('a.example', { requested: 'https://a.example', auditedAt: 'x', overall: { grade: 'B', score: 70 }, note: null, robots: { ai: {} }, reachable: true });
store.saveAudit('b.example', { requested: 'https://b.example', auditedAt: 'y', overall: { grade: 'A', score: 90 }, note: null, robots: { ai: {} }, reachable: true });
const audits = store.listAudits();
assert.strictEqual(Object.keys(audits).length, 2);
assert.strictEqual(audits['b.example'].overall.grade, 'A');

// survives a fresh process (re-init same dir)
const store2 = require('../src/service/store.js');
store2.init(dir);
assert.deepStrictEqual(store2.loadAll().get('shop.example.com'), entries);

fs.rmSync(dir, { recursive: true, force: true });
console.log('store.test.js: all assertions passed.');