'use strict';

const assert = require('node:assert');
const http = require('node:http');
const A = require('../src/audit/index.js');

// --- SSRF / URL / IP guards ------------------------------------------------
assert.throws(() => A.normalizeUrl(''), (e) => e.code === 'missing_url');
assert.throws(() => A.normalizeUrl('ftp://example.com/file'), (e) => e.code === 'unsupported_scheme');
assert.throws(() => A.normalizeUrl('https://user:pass@example.com'), (e) => e.code === 'no_credentials');
assert.strictEqual(A.normalizeUrl('example.com').url.protocol, 'https:');
assert.strictEqual(A.normalizeUrl('http://Example.COM:80').url.hostname, 'example.com');

for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.4', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
  assert.strictEqual(A.isPrivateIP(ip), true, `${ip} should be private`);
}
for (const ip of ['54.1.2.3', '8.8.8.8', '104.16.0.1', '172.32.1.1', '192.169.1.1']) {
  assert.strictEqual(A.isPrivateIP(ip), false, `${ip} should be public`);
}
assert.strictEqual(A.isPrivateIP('::1'), true);
assert.strictEqual(A.isPrivateIP('::ffff:127.0.0.1'), true);
assert.strictEqual(A.isPrivateIP('fd00::1'), true);
assert.strictEqual(A.isPrivateIP('fe80::1'), true);
assert.strictEqual(A.isPrivateIP('2606:4700::1111'), false);

// --- robots.txt parser fixture ---------------------------------------------
const robotics = [
  'User-agent: *',
  'Disallow: /private/',
  '',
  'User-agent: GPTBot',
  'User-agent: ChatGPT-User',
  'Disallow: /',
  '',
  'User-agent: ClaudeBot',
  'Disallow: /search',
  '',
  'User-agent: CCBot',
  'Disallow: /',
  '',
  'User-agent: Googlebot',
  'Disallow: /',
  'Sitemap: https://www.example.com/sitemap.xml',
].join('\n');

{
  const p = A.parseRobots(robotics);
  const v = A.robotsVerdict(p);
  assert.strictEqual(v.ai['GPTBot'], 'blocked');
  assert.strictEqual(v.ai['ClaudeBot'], 'partial');
  assert.strictEqual(v.ai['CCBot'], 'blocked');
  assert.strictEqual(v.ai['PerplexityBot'], 'partial'); // '*' group disallows /private/ → root crawlable
  assert.strictEqual(v.ai['Google-Extended'], 'partial');
  assert.deepStrictEqual(p.sitemaps, ['https://www.example.com/sitemap.xml']);
}

{
  const p = A.parseRobots('User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /');
  const v = A.robotsVerdict(p);
  assert.strictEqual(v.ai['GPTBot'], 'blocked');
}

// --- detector fixtures -----------------------------------------------------
{
  const d = A.detector({
    server: 'cloudflare',
    'cf-ray': 'a1b2c3',
    'strict-transport-security': 'max-age=63072000',
    'content-security-policy': "default-src 'self'",
  });
  assert.ok(d.platforms.includes('cloudflare'));
  assert.ok(d.security.present.includes('Strict-Transport-Security'));
  assert.ok(d.security.missing.includes('X-Frame-Options'));
  assert.ok(d.waf.includes('cloudflare'));
}
{
  const d = A.detector({ 'x-by-akamai': 'squid' });
  assert.strictEqual(d.platforms.includes('akamai'), false); // wrong key shape is a negative control
}

// --- egress math -----------------------------------------------------------
{
  const e = A.egressTable(2500 * 1024, { costPerGB: 0.09 });
  assert.strictEqual(e.pageSizeKB, 2500);
  assert.ok(Math.abs(e.egressPerRequestKB - 2500) < 1e-9);
  const high = e.monthlyWindows.find((w) => w.label.includes('1,000,000') && w.label.includes('25%'));
  assert.strictEqual(high.botRequestsPerDay, 250000);
}

// --- score ------------------------------------------------------------------
{
  const s = A.auditScore({
    tls: true,
    reachable: true,
    robots: { ai: { GPTBot: 'allowed', ClaudeBot: 'allowed', CCBot: 'allowed', Bytespider: 'allowed' } },
    security: { missing: ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'] },
  });
  assert.ok(s.score >= 55 && s.score <= 75, `mid-band score, got ${s.score}`);
  const g = A.auditScore({ tls: true, reachable: true, robots: { ai: { GPTBot: 'blocked', ClaudeBot: 'blocked', CCBot: 'blocked' } }, security: { missing: [] } });
  assert.ok(g.score > 90, `clean + blocked-everything score, got ${g.score}`);
}

// --- live crawl against local stubs (allowPrivate: true for tests) ----------
const SECRET = 'shhh';
const stub = (onReq) => http.createServer((req, res) => onReq(req, res));

const server = stub((req, res) => {
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain', server: 'nginx', 'X-Content-Type-Options': 'nosniff' });
    res.end('User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /');
    return;
  }
  const html = `<html>${SECRET}</html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'content-length': String(Buffer.byteLength(html)),
    'cf-ray': 'ci-proxy-ray',
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  const clear = await A.runAudit(url, { allowPrivate: true, timeoutMs: 3000 });
  assert.strictEqual(clear.reachable, true);
  assert.strictEqual(clear.robots.ai['GPTBot'], 'blocked');
  assert.strictEqual(clear.robots.ai['PerplexityBot'], 'allowed');
  assert.strictEqual(clear.platforms.includes('cloudflare'), true, 'stub exposes cf-ray');
  assert.deepStrictEqual(clear.security.missing, ['Content-Security-Policy', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']);
  assert.strictEqual(clear.page.bytes, Buffer.byteLength(`<html>${SECRET}</html>`));
  assert.strictEqual(clear.egress.pageSizeKB, Math.round((clear.page.bytes / 1024) * 10) / 10);
  assert.strictEqual(clear.overall.grade.length, 1);
  assert.ok(clear.compliance.includes('User-agent: PerplexityBot')); // unlisted → offered for opt-out
    assert.ok(!clear.compliance.includes('User-agent: GPTBot'));    // already blocked → not repeated

  const blocking = stub((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nDisallow: /'); return; }
    res.end('should not be fetched');
  });
  await new Promise((r) => blocking.listen(0, '127.0.0.1', r));
  const blocked = await A.runAudit(`http://127.0.0.1:${blocking.address().port}`, { allowPrivate: true, timeoutMs: 3000 });
  assert.strictEqual(blocked.page, null);
  assert.strictEqual(blocked.reachable, false);
  assert.ok(blocked.note.includes('robots.txt'), `note: ${blocked.note}`);

  server.close();
  blocking.close();
  console.log('audit.test.js: all assertions passed.');
})().catch((err) => { console.error(err); process.exit(1); });