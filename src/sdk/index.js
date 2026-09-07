'use strict';

/**
 * bot-tollbooth — zero-dependency SDK
 * ------------------------------------
 * Wrap the engine + log parser into a single importable module.
 *
 * Usage (Node >= 18):
 *   const bt = require('bottollbooth/src/sdk');
 *   const { rows } = bt.parseLog(logText);
 *   const report = bt.score(rows, { rpm: 15 });
 *   console.log(report.bandwidth);   // bot MB, cost USD
 *   const compliance = bt.compliance(report.crawlers);
 *   console.log(compliance.robotsTxt);
 *
 * Browser (after inlining the engine):
 *   botTollbooth.score(rows);          // works identically (no fs/http)
 */

const {
  CATEGORIES, CRAWLERS, CRAWLER_NOTES,
  classify, crawlIntent, probeHints, summarize,
  valueExchange, bandwidthImpact, revenueImpact,
  recommendCrawler, robotTxt, optOutList, ntmDisclosure,
} = require('../engine/index.js');

const { parseLog, rowsFromLog } = require('../logparse/index.js');

/**
 * Build the per-crawler counts map from raw request rows.
 * Unknown AI crawlers (ai-crawler category but no registry match) land in
 * "unknown-ai" — same bucket the API service uses.
 */
function _buildCrawlers(rows) {
  const crawlers = {};
  for (const r of rows) {
    const c = classify(r);
    const meta = crawlIntent(r.userAgent);
    if (meta) {
      const slot = crawlers[meta.key] || (crawlers[meta.key] = {
        label: meta.label,
        purpose: meta.purpose,
        ppr: meta.ppr,
        requests: 0,
        category: c.category,
      });
      slot.requests += 1;
    } else if (c.category === 'ai-crawler') {
      const slot = crawlers['unknown-ai'] || (crawlers['unknown-ai'] = {
        label: 'Unknown AI crawler (not in registry)',
        purpose: null,
        ppr: null,
        requests: 0,
        category: 'ai-crawler',
      });
      slot.requests += 1;
    }
  }
  return crawlers;
}

/**
 * Score an array of raw request rows.
 * @param {Array<{userAgent:string,requestsPerMin?:number,webdriver?:boolean,...}>} rows
 * @param {object} [opts]
 * @param {number} [opts.rpm=15] publisher revenue per 1,000 impressions
 * @param {number} [opts.fillScale=50] % of bot impressions that monetize
 * @param {number} [opts.pageSizeKB=2500] average served page weight
 * @param {number} [opts.costPerGB=0.09] CDN/egress cost per GB
 * @returns {{summary:object, crawlers:object, valueExchange:object, bandwidth:object, impact:object}}
 */
function score(rows, opts = {}) {
  const summary = summarize(rows);
  const crawlers = _buildCrawlers(rows);
  return {
    summary,
    crawlers,
    valueExchange: valueExchange(rows),
    bandwidth: bandwidthImpact(rows, {
      pageSizeKB: opts.pageSizeKB,
      costPerGB: opts.costPerGB,
    }),
    impact: revenueImpact(summary, opts.rpm ?? 15, {
      botFillScale: (opts.fillScale ?? 50) / 100,
    }),
  };
}

/**
 * Generate compliance artifacts (robots.txt + opt-out list + NTM disclosure)
 * from a crawlers map (as returned by score().crawlers).
 * @param {Record<string,{label:string,purpose:string,requests:number}>} crawlers
 * @param {object} [opts]
 * @param {string} [opts.namespace]
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @returns {{robotsTxt:string, optOuts:Array, disclosure:{text:string,json:object}}}
 */
function compliance(crawlers, opts = {}) {
  const disclosure = ntmDisclosure(crawlers, opts);
  return {
    robotsTxt: robotTxt(crawlers, { namespace: opts.namespace }),
    optOuts: optOutList(crawlers),
    disclosure,
  };
}

module.exports = {
  CATEGORIES, CRAWLERS, CRAWLER_NOTES,
  classify, crawlIntent, probeHints, summarize,
  valueExchange, bandwidthImpact, revenueImpact,
  recommendCrawler, robotTxt, optOutList, ntmDisclosure,
  parseLog: rowsFromLog,
  score,
  compliance,
};