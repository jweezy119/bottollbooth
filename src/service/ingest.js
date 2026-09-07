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

const { classify, revenueImpact } = require('../engine/index.js');

/** In-memory store: namespace -> Array<{category, confidence, at}> */
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
    entries.push({ category, confidence, at: Date.now() });
    accepted += 1;
  }
  if (entries.length > 200_000) entries.splice(0, entries.length - 200_000);
  buckets.set(namespace, entries);
  return { received: rows.length, accepted };
}

/**
 * Produce the aggregate summary + revenue impact for a namespace.
 * @param {string} namespace
 * @param {number} rpm - site revenue per 1,000 monetized impressions
 * @param {number} [fillScale] - 0..100, how much bot traffic monetizes (default 50)
 */
function aggregate(namespace, rpm, fillScale = 50) {
  const entries = buckets.get(namespace) || [];
  const byCategory = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] || 0) + 1;
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
  return {
    summary,
    impact: revenueImpact(summary, rpm, { botFillScale: fillScale / 100 }),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { ingest, aggregate };
