'use strict';

/**
 * bot-tollbooth — tiny JSON-file store (zero-dependency)
 * ------------------------------------------------------
 * Gives the service restart-persistence without pulling in a database:
 *   - one JSON file per namespace holding the classified request entries
 *   - one shared `audits.json` map host → latest external audit
 *
 * Writes are atomic (tmp file + rename) so a crash never corrupts a file.
 * Namespaces are sanitised to [a-z0-9._-] to rule out path traversal.
 */

const fs = require('node:fs');
const path = require('node:path');

let dir = null;

function sanitize(name) {
  if (typeof name !== 'string') throw new TypeError('store: namespace must be a string');
  const s = name.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/.test(s)) {
    throw new TypeError(`store: namespace ${JSON.stringify(name)} is not allowed`);
  }
  return s;
}

function init(dataDir) {
  dir = dataDir;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'namespaces'), { recursive: true });
  return dir;
}

function namespaceFile(ns) {
  return path.join(dir, 'namespaces', `${sanitize(ns)}.json`);
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function persist(ns, entries) {
  if (!dir) throw new Error('store: init(dir) first');
  atomicWrite(namespaceFile(ns), entries);
}

function loadAll() {
  if (!dir) throw new Error('store: init(dir) first');
  const out = new Map();
  if (!fs.existsSync(path.join(dir, 'namespaces'))) return out;
  for (const f of fs.readdirSync(path.join(dir, 'namespaces'))) {
    if (!f.endsWith('.json')) continue;
    const ns = f.slice(0, -'.json'.length);
    try {
      out.set(ns, JSON.parse(fs.readFileSync(path.join(dir, 'namespaces', f), 'utf8')));
    } catch { /* skip corrupt file */ }
  }
  return out;
}

function auditsFile() {
  return path.join(dir, 'audits.json');
}

function saveAudit(host, audit) {
  if (!dir) throw new Error('store: init(dir) first');
  const file = auditsFile();
  let all = {};
  if (fs.existsSync(file)) {
    try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { all = {}; }
  }
  all[host] = {
    requested: audit.requested,
    auditedAt: audit.auditedAt,
    overall: audit.overall,
    note: audit.note,
    robots: audit.robots,
    reachable: audit.reachable,
  };
  atomicWrite(file, all);
}

function listAudits() {
  if (!dir || !fs.existsSync(auditsFile())) return {};
  try { return JSON.parse(fs.readFileSync(auditsFile(), 'utf8')); } catch { return {}; }
}

module.exports = { init, sanitize, persist, loadAll, saveAudit, listAudits };