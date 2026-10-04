'use strict';
// JSON file store with atomic writes, plus AES-256-GCM encryption for API keys and secrets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

/* ---------- Encryption ---------- */
function loadMasterKey() {
  if (process.env.MASTER_KEY) {
    const k = Buffer.from(process.env.MASTER_KEY, 'base64');
    if (k.length !== 32) throw new Error('MASTER_KEY must be 32 random bytes, base64-encoded. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    return k;
  }
  const f = path.join(DATA_DIR, 'master.key');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    console.warn('[security] Generated a new encryption key at ' + f + '. Back it up: without it, saved API keys cannot be decrypted. For production, set MASTER_KEY in the environment instead.');
  }
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
}
const MK = loadMasterKey();

function encrypt(text) {
  if (text == null || text === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', MK, iv);
  const e = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), e.toString('base64')].join('.');
}
function decrypt(s) {
  if (!s) return '';
  const [v, iv, tag, e] = s.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', MK, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e, 'base64')), d.final()]).toString('utf8');
}
const hint = secret => secret ? '••••' + String(secret).slice(-4) : '';

/* ---------- Database ---------- */
const DEFAULT_SETTINGS = {
  baseCurrency: 'USD',
  fx: {
    mode: 'live',            // live | custom | manual
    refreshHours: 12,
    customUrl: '', customKeyEnc: '', customKeyHeader: '', customKeyQuery: '', customRatesPath: 'rates', customBase: 'USD',
    manual: {},              // overrides: units of currency per 1 USD
    fetched: {}, updatedAt: null, provider: null, error: null
  },
  risk: {
    velSec: 3, velMin: 20, dupWin: 120, fanIn: 8, fanOut: 6,
    largeTxn: 10000,         // in base currency
    structPct: 10, roundMin: 5000, outlierZ: 3, failMin: 3,
    newBenLarge: 5000,       // first payment to a new beneficiary at or above this (base currency)
    pendingAgeMins: 30,
    highRiskCountries: ['KP', 'IR', 'MM']
  },
  orgName: 'FinTrack Analytics'
};

let db;
function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = { users: [], sources: [], sessions: {}, audit: [], settings: {} };
  }
  // merge defaults so upgrades get new settings
  db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
  db.settings.fx = Object.assign({}, DEFAULT_SETTINGS.fx, db.settings.fx);
  db.settings.risk = Object.assign({}, DEFAULT_SETTINGS.risk, db.settings.risk);
  db.users ||= []; db.sources ||= []; db.sessions ||= {}; db.audit ||= [];
  return db;
}
let saveTimer = null;
function save(now) {
  const write = () => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, DB_FILE);
  };
  if (now) { clearTimeout(saveTimer); return write(); }
  if (!saveTimer) saveTimer = setTimeout(write, 300);
}
function audit(user, action, detail, ip) {
  db.audit.push({ at: Date.now(), uid: user ? user.id : null, username: user ? user.username : 'system', action, detail: detail || '', ip: ip || '' });
  if (db.audit.length > 10000) db.audit.splice(0, db.audit.length - 10000);
  save();
}

/* ---------- Transaction cache ---------- */
const cache = new Map();
function cacheFile(id) { return path.join(CACHE_DIR, id.replace(/[^a-z0-9_-]/gi, '') + '.json'); }
function getCache(id) {
  if (cache.has(id)) return cache.get(id);
  const f = cacheFile(id);
  if (fs.existsSync(f)) { try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); cache.set(id, c); return c; } catch (e) { /* ignore corrupt cache */ } }
  return null;
}
function setCache(id, data) {
  cache.set(id, data);
  const tmp = cacheFile(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, cacheFile(id));
}
function dropCache(id) { cache.delete(id); try { fs.unlinkSync(cacheFile(id)); } catch (e) { /* none */ } }

const newId = (p = '') => p + crypto.randomBytes(8).toString('hex');

module.exports = { load, save, audit, encrypt, decrypt, hint, getCache, setCache, dropCache, newId, get db() { return db; }, DEFAULT_SETTINGS };
