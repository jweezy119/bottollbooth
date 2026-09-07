'use strict';

/**
 * bot-tollbooth — log parser (zero dependencies)
 * -----------------------------------------------
 * Turn Nginx/Apache combined-format access log lines into rows the ingest
 * endpoint or SDK `score()` can consume.  Also compute per-IP 60-second
 * burst rates (the densest 60s window per client IP) so residential-proxy
 * scrapers earn a rate-based flag instead of hiding as "human".
 *
 * Exports (browser-safe, no fs / http):
 *   parseAccessLine(line)
 *   rowsFromLog(text, { limit })
 */

const COMBINED =
  /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\S+\s+\S+\s+"([^"]*)"\s+"([^"]*)"\s*$/;
const WITHOUT_REFERER =
  /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\S+\s+\S+\s+"([^"]*)"\s*$/;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(raw) {
  const m = /^\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\]/.exec(raw);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]);
  if (mon < 0) return null;
  const tz = m[7];
  const sign = tz[0] === '-' ? -1 : 1;
  const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const utc = Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  return utc - offMin * 60000;
}

/**
 * Parse one access-log line.
 * @param {string} line
 * @returns {{ip:string, at:number|null, userAgent:string|null, status:string|null}|null}
 */
function parseAccessLine(line) {
  if (!line || /^#/.test(line)) return null;
  let m = COMBINED.exec(line);
  let userAgent = null;
  let ip = null;
  if (m) {
    ip = m[1];
    userAgent = m[3] === '-' || m[3] === '' ? null : m[3];
  } else {
    m = WITHOUT_REFERER.exec(line);
    if (m) {
      ip = m[1];
      userAgent = m[2] === '-' || m[2] === '' ? null : m[2];
    } else {
      return null;
    }
  }
  const dm = /\[[^\]]+\]/.exec(line);
  const at = dm ? parseDate(dm[0]) : null;
  const sm = /"\s+(\d{3})\s+/.exec(line);
  return { ip, at, userAgent, status: sm ? sm[1] : null };
}

/**
 * Convert access-log text into /ingest request rows.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.limit] - cap rows (for spot checks)
 * @returns {{rows:Array<{userAgent:string, requestsPerMin?:number, at?:number}>, parsed:number, skipped:number}}
 */
function rowsFromLog(text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (const line of lines) {
    const p = parseAccessLine(line);
    if (!p || !p.userAgent) continue;
    hits.push(p);
  }
  const parsed = hits.length;

  const byIp = {};
  for (const h of hits) {
    if (h.at === null) continue;
    (byIp[h.ip] || (byIp[h.ip] = [])).push(h.at);
  }
  const ipRpm = {};
  for (const ip of Object.keys(byIp)) {
    const ts = byIp[ip].sort((a, b) => a - b);
    let best = 1;
    for (let i = 0; i < ts.length; i++) {
      let c = 1;
      for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= 60_000; j++) c++;
      if (c > best) best = c;
    }
    ipRpm[ip] = best;
  }

  let rows = hits.map((h) => ({
    userAgent: h.userAgent,
    at: h.at,
    requestsPerMin: ipRpm[h.ip] || 1,
  }));

  if (typeof opts.limit === 'number' && opts.limit > 0 && rows.length > opts.limit) {
    rows = rows.slice(0, opts.limit);
  }
  return { rows, parsed, skipped: lines.filter((l) => l && !/^#/.test(l)).length - parsed };
}

module.exports = { parseAccessLine, rowsFromLog };