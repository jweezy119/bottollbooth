'use strict';

/* ------------------------------------------------------------------ *
 * BotTollbooth — HOST HALF (the `code.host` plugin function body)
 * ------------------------------------------------------------------ *
 * This is the plain-JavaScript function body passed to `cordis_define`
 * under `code.host`. It runs inside DeepSeek Harness' Cordis host runner
 * (Node.js side) and:
 *
 *   - Declares a HARD dependency on the runtime `botDetection` service
 *     via `inject` (activation blocks until it exists).
 *   - Registers two package-private JSON-RPC methods with `harness.handle`:
 *       botDetection.summary   → engine.summarize() over the feed
 *       analyticsProvider.lostRevenue → engine.revenueImpact()
 *   - Owns its effects with `ctx.on` / `ctx.effect` so stop/update tears it
 *     down cleanly (Cordis lifecycle semantics).
 *
 * Cordis plugin-body constraints (DSH enforced):
 *   - plain JS function body, NO imports/exports, no TS/JSX
 *   - the function returns a Cordis Plugin object: { inject?, apply(ctx) }
 * ------------------------------------------------------------------ */

function host() {
  // The engine is intentionally required here so the pair stays DRY; in a
  // truly self-contained dynamic package you would inline it as a single
  // function body. See src/host/engine.js for the pure algorithm.
  const { summarize, revenueImpact } = require('./engine.js');

  const feed = new Map(); // session → RequestRow[] (in-memory sample feed)

  return {
    inject: ['botDetection'],

    apply(ctx) {
      ctx.on('botDetection/classify', (row) => {
        const rows = feed.get(ctx.sessionId) || [];
        rows.push(row);
        if (rows.length > 100_000) rows.splice(0, rows.length - 100_000);
        feed.set(ctx.sessionId, rows);
      });

      ctx.harness.handle('botDetection.summary', (input) => {
        const rows = feed.get(ctx.sessionId) || [];
        const summary = summarize(rows);
        const impact = revenueImpact(summary, Number(input?.rpm) || 0);
        return { summary, impact };
      });

      ctx.harness.handle('analyticsProvider.lostRevenue', (input) => {
        const rows = feed.get(ctx.sessionId) || [];
        const summary = summarize(rows);
        const rpm = Number(input?.rpm) || 15; // default CPM ~15 USD
        return revenueImpact(summary, rpm);
      });

      ctx.effect(() => {
        const timer = setInterval(() => {
          // Nothing to poll yet: future GA4/ad-network connectors land here.
        }, 60_000);
        return () => clearInterval(timer);
      });
    },
  };
}

module.exports = host;