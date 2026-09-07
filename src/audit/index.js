'use strict';

/**
 * bot-tollbooth — external site audit (zero-dependency)
 * ------------------------------------------------------
 * An ethical, robots-respecting external audit for a site you don't control.
 * Given a URL it answers what a URL alone can honestly tell an owner:
 *
 *   1. Is it reachable, and over TLS?
 *   2. What does robots.txt permit for the AI crawlers (GPTBot, ClaudeBot,
 *      CCBot, PerplexityBot, Google-Extended, ...)?
 *   3. Which WAF / CDN / bot-manager layer sits in front (Cloudflare,
 *      DataDome, CloudFront, Fastly, Vercel, Netlify, ...)?
 *   4. Which security headers are missing?
 *   5. What a single page delivery costs in egress, extrapolated to a
 *      monthly bandwidth-cost window for common bot rates.
 *   6. A deployable robots.txt block + opt-out list, and the exact steps
 *      (probe embed, token, access-log ingest) that unlock real numbers.
 *
 * The audit probes itself like a bot — so it honours the target's robots.txt
 * for its own requests: if the target disallows the audit user-agent, the
 * audit stops after robots.txt and says so.
 *
 * Security (SSRF):
 *   - only http(s), no credentials, no exotic ports (80/443 unless
 *     `allowPrivate` is set for tests)
 *   - resolves DNS and refuses any private / loopback / link-local / CGNAT /
 *     reserved / multicast address, IPv4 and IPv6
 *   - in-process per-host throttle and connection timeouts live at the API
 *     layer (see src/service/server.js POST /api/v1/audit)
 *
 * Pure Node >=18 (global fetch); CommonJS so it joins the zero-dep SDK.
 */

const dns = require('node:dns');
const net = require('node:net');

const AI_TOKENS = Object.freeze([
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'GPT-5',
  'ClaudeBot',
  'Claude-Web',
  'Claude-Press',
  'CCBot',
  'PerplexityBot',
  'Google-Extended',
  'Meta-ExternalAgent',
  'Bytespider',
  'Amazonbot',
  'Applebot-Extended',
]);

const DEFAULT_OPTS = Object.freeze({
  allowPrivate: false,
  timeoutMs: 6000,
  maxBytes: 256 * 1024,
  maxRedirects: 3,
  costPerGB: 0.09,
  ua: 'BotTollboothAudit/1.0 (+https://github.com/jweezy119/bottollbooth)',
});

class AuditError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true;                       // loopback
  if (a === 169 && b === 254) return true;          // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192) {
    if (b === 168) return true;
    if (b === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // 192.0.0.0/24, TEST-NET-1
    if (b === 18 || b === 19) return true;          // benchmarking
  }
  if (a === 198) {
    if (b === 18 || b === 19) return true;          // 198.18.0.0/15
    if (b === 51 && parts[2] === 100) return true;  // TEST-NET-2
  }
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true;                        // multicast + reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // v4-mapped
  if (m) return isPrivateIPv4(m[1]);
  return /^f[cdef][0-9a-f]/.test(lower); // fc00::/7, fe80::/10, ff00::/8
}

function isPrivateIP(ip) {
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  return true; // unparseable → treat as unsafe
}

function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new AuditError('missing_url', 'no URL provided');
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { throw new AuditError('invalid_url', `invalid URL: ${raw}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuditError('unsupported_scheme', `only http(s) can be audited, got ${url.protocol}`);
  }
  if (url.username || url.password) throw new AuditError('no_credentials', 'URLs with embedded credentials are refused');
  if (url.hash) url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return { url, host: url.hostname, requested: raw };
}

function allowedPort(url, allowPrivate) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return port === 80 || port === 443 || (allowPrivate && port >= 1024);
}

async function assertPublic(url, allowPrivate) {
  if (!allowedPort(url, allowPrivate)) throw new AuditError('blocked_ssrf', 'refusing non-audit port (80/443 only)');
  if (/^local/i.test(url.hostname)) {
    if (!allowPrivate) throw new AuditError('blocked_ssrf', 'refusing private host');
    return;
  }
  const addresses = [];
  if (net.isIP(url.hostname)) {
    addresses.push(url.hostname);
  } else {
    let resolved;
    try { resolved = await dns.promises.lookup(url.hostname, { all: true, verbatim: true }); }
    catch { throw new AuditError('dns_failed', `could not resolve ${url.hostname}`); }
    for (const r of resolved) addresses.push(r.address);
  }
  for (const ip of addresses) {
    if (isPrivateIP(ip) && !allowPrivate) {
      throw new AuditError('blocked_ssrf', `${url.hostname} resolves to private address ${ip}`);
    }
  }
}

async function fetchCapped(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': opts.ua, accept: '*/*' },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new AuditError('timeout', `timed out fetching ${url}`);
    throw new AuditError('unreachable', `${url} is unreachable: ${err.message}`);
  }
  try {
    const contentLength = Number(res.headers.get('content-length') || 0);
    let body = '';
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (!done) {
          body += decoder.decode(chunk.value, { stream: true });
          if (body.length >= opts.maxBytes) { await reader.cancel(); break; }
        }
      }
      body += decoder.decode();
    }
    clearTimeout(timer);
    const bytes = body.length || contentLength;
    return {
      status: res.status,
      ok: res.ok,
      finalUrl: res.url,
      headers: Object.fromEntries(res.headers.entries()),
      text: body.slice(0, opts.maxBytes),
      bytes,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof AuditError) throw err;
    throw new AuditError('unreachable', `read failed: ${err.message}`);
  }
}

function groupTokens(line) {
  const token = (line.match(/^user-agent:\s*(.+)/i) || [])[1];
  return token ? token.split(/\s+/).filter(Boolean) : [];
}

function parseRobots(text) {
  const sitemaps = [];
  let current = null;
  const groups = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const hash = rawLine.indexOf('#');
    const clean = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    if (!clean) continue;
    const tokens = groupTokens(clean);
    if (tokens.length) {
      const fresh = !current || current.allow.length || current.disallow.length || current.crawlDelay;
      if (fresh) {
        current = { tokens, allow: [], disallow: [], crawlDelay: 0 };
        groups.push(current);
      } else {
        current.tokens.push(...tokens);
      }
      continue;
    }
    if (!current) continue;
    if (/^sitemap:/i.test(clean)) sitemaps.push(clean.replace(/^sitemap:/i, '').trim());
    else if (/^allow:/i.test(clean)) current.allow.push(clean.replace(/^allow:/i, '').trim());
    else if (/^disallow:/i.test(clean)) current.disallow.push(clean.replace(/^disallow:/i, '').trim());
    else if (/^crawl-delay:/i.test(clean)) current.crawlDelay = Number(clean.replace(/^crawl-delay:/i, '').trim()) || 0;
  }
  return { groups, sitemaps };
}

function groupVerdict(group) {
  const allowsAll = group.allow.includes('/');
  const disallowsAll = group.disallow.some((p) => p === '/' || p === '/*');
  if (allowsAll) return 'allowed';
  if (disallowsAll) return 'blocked';
  if (group.disallow.length || group.allow.length) return 'partial';
  return 'allowed';
}

function matchGroup(token, groups) {
  return groups.find((g) => g.tokens.includes(token)) || groups.find((g) => g.tokens.includes('*'));
}

function robotsVerdict(parse) {
  const ai = {};
  for (const token of AI_TOKENS) {
    const g = matchGroup(token, parse.groups);
    ai[token] = g ? groupVerdict(g) : 'unlisted';
  }
  return {
    ai,
    auditUa: (() => {
      const g = matchGroup('BotTollboothAudit', parse.groups);
      return g ? groupVerdict(g) : 'allowed';
    })(),
  };
}

const PLATFORM_SIGNATURES = Object.freeze([
  { id: 'cloudflare', test: (h) => h['cf-ray'] || h['cf-cache-status'] || h['cf-colo'] || /cloudflare/i.test(h.server || '') },
  { id: 'datadome', test: (h) => h['x-datadome'] || h['set-cookie']?.includes('datadome') },
  { id: 'akamai', test: (h) => h['x-akamai-transformed'] || /akamai/i.test(h.server || '') },
  { id: 'aws-cloudfront', test: (h) => h['x-amz-cf-id'] || h['x-amz-cf-pop'] },
  { id: 'fastly', test: (h) => h['x-served-by'] || /fastly/i.test(h.server || '') },
  { id: 'vercel', test: (h) => h['x-vercel-id'] || /vercel/i.test(h.server || '') },
  { id: 'netlify', test: (h) => /netlify/i.test(h.server || '') },
  { id: 'nginx', test: (h) => /nginx/i.test(h.server || '') },
  { id: 'apache', test: (h) => /apache/i.test(h.server || '') },
]);

function detector(headers) {
  const platforms = PLATFORM_SIGNATURES.filter((p) => {
    try { return p.test(headers); } catch { return false; }
  }).map((p) => p.id);
  const security = {
    present: [
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ].filter((k) => headers[k.toLowerCase()]),
    missing: [
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ].filter((k) => !headers[k.toLowerCase()]),
  };
  const waf = platforms.filter((p) => ['cloudflare', 'datadome', 'akamai'].includes(p));
  const cdn = platforms.filter((p) => ['aws-cloudfront', 'fastly', 'vercel', 'netlify'].includes(p));
  return { platforms, security, waf, cdn };
}

function egressTable(bytes, opts) {
  const perKB = bytes / 1024;
  const windowRow = (dailyRequests, botRate) => ({
    label: `${dailyRequests.toLocaleString('en-US')} req/day at ${Math.round(botRate * 100)}%`,
    botRequestsPerDay: Math.round(dailyRequests * botRate),
    egressGBPerMonth: round((dailyRequests * 30 * botRate * perKB) / 1048576, 2),
    costUSDPerMonth: round(((dailyRequests * 30 * botRate * perKB) / 1073741824) * opts.costPerGB, 2),
  });
  return {
    pageSizeKB: round(bytes / 1024, 1),
    egressPerRequestKB: round(perKB, 1),
    costPerRequestUSD: round((perKB / 1073741824) * 1024 * 1024 * opts.costPerGB / 1024, 6),
    assumptions: [`${opts.costPerGB} USD/GB egress`, 'page weight measured once from a single request'],
    monthlyWindows: [windowRow(100000, 0.05), windowRow(100000, 0.15), windowRow(1000000, 0.10), windowRow(1000000, 0.25)],
  };
}

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

function auditScore(a) {
  let score = 100;
  if (!a.tls) score -= 12;
  if (a.reachable) {
    if (a.security.missing.includes('Strict-Transport-Security')) score -= 8;
    if (a.security.missing.includes('Content-Security-Policy')) score -= 6;
    if (a.security.missing.includes('X-Content-Type-Options')) score -= 4;
    if (a.security.missing.includes('X-Frame-Options')) score -= 4;
    if (a.security.missing.includes('Referrer-Policy')) score -= 2;
    if (a.security.missing.includes('Permissions-Policy')) score -= 2;
  }
  const ents = Object.entries(a.robots.ai || {});
  const allowCount = ents.filter(([, v]) => v === 'allowed').length;
  if (allowCount >= 8) score -= 14;
  else if (allowCount >= 3) score -= 10;
  else if (allowCount > 0) score -= 5;
  if (ents.filter(([, v]) => v === 'blocked').length >= 8) score += 8;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F',
  };
}

function buildCompliancePack(host, robots) {
  const allowedAIs = Object.entries(robots.ai || {})
    .filter(([, v]) => v === 'allowed' || v === 'unlisted' || v === 'partial')
    .map(([token]) => token);
  return [
    `# BotTollbooth audit of ${host} — AI crawler opt-out block (deployable)`,
    '# Add this to your robots.txt if you do not want your content scraped for training.',
    ...allowedAIs.map((t) => `User-agent: ${t}`),
    'Disallow: /',
    '',
    'User-agent: *',
    'Allow: /',
    '',
  ].join('\n');
}

async function runAudit(input, userOpts = {}) {
  const opts = Object.assign({}, DEFAULT_OPTS, userOpts);
  const { url, host } = normalizeUrl(input);
  await assertPublic(url, opts.allowPrivate);

  const robotsUrl = new URL(url);
  robotsUrl.pathname = '/robots.txt';
  const robotsFetch = await fetchCapped(robotsUrl.href, opts);
  const parse = robotsFetch.status === 404 ? { groups: [], sitemaps: [] } : parseRobots(robotsFetch.text);
  const robots = robotsVerdict(parse);

  let page = null;
  if (robots.auditUa !== 'blocked') {
    try {
      page = await fetchCapped(url.href, opts);
    } catch (err) {
      if (err instanceof AuditError) page = { error: err.code };
      else throw err;
    }
  }

  const reachable = !!page && !page.error && page.ok;
  const headers = reachable ? page.headers : robotsFetch.headers;
  const det = detector(headers);

  return {
    requested: url.href,
    host,
    auditedAt: new Date().toISOString(),
    tls: url.protocol === 'https:',
    robotsUrl: robotsUrl.href,
    robots: {
      fetchStatus: robotsFetch.status,
      auditUa: robots.auditUa,
      ai: robots.ai,
      sitemaps: parse.sitemaps.slice(0, 3),
    },
    reachable,
    page: page && (reachable || page.error)
      ? { status: reachable ? page.status : null, error: reachable ? null : page.error, finalUrl: reachable ? page.finalUrl : null, server: headers.server || null, contentType: reachable ? headers['content-type'] || null : null, redirect: reachable && page.finalUrl !== url.href ? page.finalUrl : null, bytes: reachable ? page.bytes : null }
      : null,
    platforms: det.platforms,
    waf: det.waf,
    cdn: det.cdn,
    security: det.security,
    egress: reachable ? egressTable(page.bytes, opts) : null,
    compliance: buildCompliancePack(host, robots),
    note: (() => {
      if (!reachable) {
        if (robots.auditUa === 'blocked') return 'page not fetched — the audit user-agent is disallowed by robots.txt (audit respected it)';
        if (page && page.error) return `page not fetched (${page.error})`;
        return 'page unreachable from the audit vantage point';
      }
      return null;
    })(),
    overall: auditScore({ tls: url.protocol === 'https:', reachable, security: det.security, robots }),
  };
}

module.exports = {
  AuditError,
  AI_TOKENS,
  DEFAULT_OPTS,
  normalizeUrl,
  isPrivateIP,
  assertPublic,
  parseRobots,
  robotsVerdict,
  detector,
  egressTable,
  buildCompliancePack,
  auditScore,
  runAudit,
};