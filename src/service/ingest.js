'use strict';

/**
 * bot-tollbooth — traffic ingest
 * ------------------------------
 * Site owners send their request rows here. The ingest layer normalises each
 * row, runs it through the transparent classification engine, and stores
 * (session-scoped, privacy-respecting) aggregate counts.
 *
 * Privacy by design:
 *   - Only classification *counts* by category are retained, not raw UAs.
 *   - No PII, no cookies, no device fingerprint storage.
 *   - The site owner owns the data; nothing is shared with third parties.
 *
 * Zero dependencies: uses only Node.js built-ins so it is trivially
 * self-hostable anywhere (a VPS, a Lambda/Cloud Run function, or on-prem).
 */

const crypto = require('node:crypto');
const { classify, crawlIntent, revenueImpact, valueExchange } = require('../engine/index.js');

/** In-memory store: namespace -> Array<{category, purpose, ppr, confidence, at}> */
const buckets = new Map();

/**
 * Accept a batch of raw request rows and record only their classifications.
 * @param {string} namespace - the site/customer namespace (e.g. store domain)
 * @param {Array<{userAgent?:string, behaviourScore?:number, requestsPerMin?:number}>} rows
 * @returns {{received:number, accepted:number}}
 */
function ingest(namespace, rows) {
  if (!namespace || typeof namespace !== 'string') {
    throw new TypeError('ingest: a string `namespace` is required');
  }
  const entries = buckets.get(namespace) || [];
  let accepted = 0;
  for (const row of rows) {
    const { category, confidence } = classify(row);
    const meta = crawlIntent(row.userAgent);
    entries.push({
      category,
      confidence,
      key: meta ? meta.key : null,
      label: meta ? meta.label : null,
      purpose: meta ? meta.purpose : null,
      ppr: meta && typeof meta.ppr === 'number' ? meta.ppr : null,
      at: typeof row.at === 'number' ? row.at : Date.now(),
    });
    accepted += 1;
  }
  if (entries.length > 200_000) entries.splice(0, entries.length - 200_000);
  buckets.set(namespace, entries);
  return { received: rows.length, accepted };
}

function canonical(obj) {
  if (Array.isArray(obj)) return obj.map(canonical);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.keys(obj).sort().map((k) => [k, canonical(obj[k])]),
    );
  }
  return obj;
}

function reportDigest(report) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(report)))
    .digest('hex');
}

/**
 * Produce the aggregate summary + purpose/value-exchange + revenue impact.
 * @param {string} namespace
 * @param {number} rpm - site revenue per 1,000 monetized impressions
 * @param {number} [fillScale] - 0..100, how much bot traffic monetizes (default 50)
 */
function aggregate(namespace, rpm, fillScale = 50) {
  const entries = buckets.get(namespace) || [];
  const byCategory = {};
  const crawlers = {};
  let first = null;
  let last = null;
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.key) {
      const slot = crawlers[e.key] || (crawlers[e.key] = {
        label: e.label,
        purpose: e.purpose,
        ppr: e.ppr,
        requests: 0,
        category: e.category,
      });
      slot.requests += 1;
    } else if (e.category === 'ai-crawler') {
      const slot = (crawlers['unknown-ai'] || (crawlers['unknown-ai'] = {
        label: 'Unknown AI crawler (not in registry)',
        purpose: null,
        ppr: null,
        requests: 0,
        category: 'ai-crawler',
      }));
      slot.requests += 1;
    }
    if (first === null || e.at < first) first = e.at;
    if (last === null || e.at > last) last = e.at;
  }
  const total = entries.length;
  const human = byCategory.human || 0;
  const bot = total - human;
  const summary = {
    total,
    human,
    bot,
    byCategory,
    botRate: total ? bot / total : 0,
  };
  const report = {
    summary,
    crawlers,
    window: {
      start: first ? new Date(first).toISOString() : null,
      end: last ? new Date(last).toISOString() : null,
    },
    impact: revenueImpact(summary, rpm, { botFillScale: fillScale / 100 }),
    valueExchange: valueExchange(entries),
    generatedAt: new Date().toISOString(),
  };
  return { ...report, digest: reportDigest(report) };
}

module.exports = { ingest, aggregate, reportDigest };
