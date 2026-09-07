'use strict';

/**
 * bot-tollbooth — external site audit CLI (zero-dependency)
 *
 *   node examples/audit-cli.js https://example.com            # human summary
 *   node examples/audit-cli.js example.com --json             # full audit JSON
 */

const { runAudit, AuditError } = require('../src/audit/index.js');

function usage() {
  console.error('usage: node examples/audit-cli.js [--json] <url>');
  process.exit(1);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const url = args.filter((a) => a !== '--json')[0];
if (!url) usage();

(async () => {
  const audit = await runAudit(url, { timeoutMs: 8000 });
  if (json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  const { overall, robots, security, egress, page, waf, cdn } = audit;
  console.log(`\nBotTollbooth audit — ${audit.requested}`);
  console.log(`  grade ${overall.grade} (${overall.score}/100) · ${audit.reachable ? 'reachable' : 'not reachable'} · ${audit.tls ? 'HTTPS' : 'HTTP'}${audit.note ? `\n  note: ${audit.note}` : ''}`);

  console.log('\n  AI crawler policy (robots.txt):');
  for (const [token, verdict] of Object.entries(robots.ai)) {
    console.log(`    ${token.padEnd(18)} ${verdict}`);
  }

  console.log('\n  platform / security:');
  console.log(`    waf:    ${waf.length ? waf.join(', ') : 'none detected'}`);
  console.log(`    cdn:    ${cdn.length ? cdn.join(', ') : 'none detected'}`);
  for (const h of security.missing) console.log(`    MISSING ${h}`);

  if (egress) {
    console.log('\n  bandwidth & cost impact:');
    console.log(`    page weight:           ${egress.pageSizeKB} KB`);
    console.log(`    egress per request:    ${egress.egressPerRequestKB} KB`);
    for (const w of egress.monthlyWindows) {
      console.log(`    ${w.label.padEnd(26)} ${w.egressGBPerMonth} GB/mo · $${w.costUSDPerMonth}/mo`);
    }
  }

  console.log('\n  deployable opt-out block (add to robots.txt):');
  console.log('  ' + audit.compliance.trim().split('\n').join('\n  ') + '\n');
})().catch((err) => {
  if (err instanceof AuditError) {
    console.error(`audit failed: ${err.code} — ${err.message}`);
    process.exit(2);
  }
  throw err;
});