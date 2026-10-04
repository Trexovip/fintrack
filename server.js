'use strict';
const path = require('path');
const fs = require('fs');
// minimal .env loader (no extra dependency)
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { /* no .env */ }

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('./lib/store');
const ingest = require('./lib/ingest');
const fx = require('./lib/fx');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_HOURS = +process.env.SESSION_HOURS || 12;
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';
store.load();
const db = () => store.db;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
});

/* ---------------- Sessions ---------------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function setSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db().sessions[sha(token)] = { uid: user.id, exp: Date.now() + SESSION_HOURS * 3600e3 };
  store.save();
  res.set('Set-Cookie', `ft_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${SECURE_COOKIE ? '; Secure' : ''}`);
}
function currentUser(req) {
  const t = cookies(req).ft_session; if (!t) return null;
  const s = db().sessions[sha(t)];
  if (!s || s.exp < Date.now()) return null;
  const u = db().users.find(x => x.id === s.uid && x.active !== false);
  return u || null;
}
function pruneSessions() { const now = Date.now(); for (const [k, s] of Object.entries(db().sessions)) if (s.exp < now) delete db().sessions[k]; }
const ip = req => req.ip || req.socket.remoteAddress || '';

// CSRF defence: state-changing requests must be JSON with a custom header (browsers cannot send this cross-site without CORS)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.get('X-Requested-With') !== 'fintrack') return res.status(403).json({ error: 'Missing request header.' });
  next();
});
const auth = (role) => (req, res, next) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  if (role === 'admin' && u.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  req.user = u; next();
};
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active !== false, sources: u.sources || ['*'], createdAt: u.createdAt, lastLogin: u.lastLogin, mustChange: !!u.mustChange });
const validPassword = p => typeof p === 'string' && p.length >= 10 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
const PASSWORD_RULE = 'Use at least 10 characters with letters and numbers.';

// Amount thresholds are stored in the base currency; rescale them when the base currency changes.
const AMOUNT_KEYS = ['largeTxn', 'newBenLarge', 'roundMin'];
const nice = v => { if (!(v > 0)) return 0; const m = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; };
function rescaleRisk(from, to) {
  const r = fx.effectiveRates().rates; if (!r[from] || !r[to] || from === to) return false;
  for (const k of AMOUNT_KEYS) db().settings.risk[k] = nice(db().settings.risk[k] / r[from] * r[to]);
  return true;
}

/* ---------------- Setup & auth ---------------- */
app.get('/api/setup-status', (req, res) => res.json({ needsSetup: db().users.length === 0, orgName: db().settings.orgName }));
app.post('/api/setup', (req, res) => {
  if (db().users.length) return res.status(400).json({ error: 'Setup is already complete.' });
  const { username, name, password, orgName, baseCurrency, addDemo } = req.body || {};
  if (!/^[a-z0-9._-]{3,40}$/i.test(username || '')) return res.status(400).json({ error: 'Username must be 3–40 letters, numbers, dots, dashes or underscores.' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const u = { id: store.newId('u_'), username: username.toLowerCase(), name: name || username, role: 'admin', passHash: bcrypt.hashSync(password, 12), active: true, sources: ['*'], createdAt: Date.now() };
  db().users.push(u);
  if (orgName) db().settings.orgName = String(orgName).slice(0, 80);
  if (baseCurrency) { const to = String(baseCurrency).toUpperCase().slice(0, 3); rescaleRisk('USD', to); db().settings.baseCurrency = to; }
  if (addDemo) db().sources.push(defaultSource({ name: 'Demo data (sample)', type: 'demo', refreshMins: 0 }));
  store.save(true);
  store.audit(u, 'setup', 'Initial admin created', ip(req));
  setSession(res, u);
  res.json({ user: publicUser(u) });
  if (addDemo) syncSource(db().sources[db().sources.length - 1], u).catch(() => {});
  fx.refresh().catch(() => {});
});
const attempts = new Map();
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const key = ip(req) + '|' + String(username || '').toLowerCase();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const u = db().users.find(x => x.username === String(username || '').toLowerCase());
  const ok = u && u.active !== false && await bcrypt.compare(String(password || ''), u.passHash);
  if (!ok) {
    a.n++; if (a.n >= 8) { a.until = Date.now() + 15 * 60e3; a.n = 0; } attempts.set(key, a);
    store.audit(u || null, 'login_failed', 'Username: ' + String(username || '').slice(0, 40), ip(req));
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  attempts.delete(key);
  u.lastLogin = Date.now(); pruneSessions();
  setSession(res, u);
  store.audit(u, 'login', '', ip(req));
  res.json({ user: publicUser(u) });
});
app.post('/api/logout', (req, res) => {
  const t = cookies(req).ft_session; if (t) { delete db().sessions[sha(t)]; store.save(); }
  res.set('Set-Cookie', 'ft_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', auth(), (req, res) => res.json({ user: publicUser(req.user), orgName: db().settings.orgName }));
app.post('/api/me/password', auth(), async (req, res) => {
  const { current, next } = req.body || {};
  if (!await bcrypt.compare(String(current || ''), req.user.passHash)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (!validPassword(next)) return res.status(400).json({ error: PASSWORD_RULE });
  req.user.passHash = bcrypt.hashSync(next, 12); req.user.mustChange = false;
  // end other sessions
  const t = sha(cookies(req).ft_session || '');
  for (const [k, s] of Object.entries(db().sessions)) if (s.uid === req.user.id && k !== t) delete db().sessions[k];
  store.save(); store.audit(req.user, 'password_changed', '', ip(req));
  res.json({ ok: true });
});

/* ---------------- Data sources (admin) ---------------- */
function defaultSource(o = {}) {
  return Object.assign({
    id: store.newId('src_'), name: 'New source', type: 'api', url: '', method: 'GET',
    authType: 'bearer', authHeaderName: 'x-api-key', authQueryName: 'api_key', username: '', secretEnc: '', secretHint: '',
    extraHeadersEnc: '', extraHeaderNames: [], body: '', recordsPath: '', pageParam: '', pageSizeParam: '', pageSize: '', startPage: 1, maxPages: 1,
    defaultCurrency: '', mapping: {}, durUnit: 'ms', refreshMins: 15, timeoutMs: 30000, enabled: true, demoSize: 8000,
    createdAt: Date.now(), lastSync: null
  }, o);
}
function publicSource(s) {
  const c = store.getCache(s.id);
  const { secretEnc, extraHeadersEnc, ...rest } = s;
  return Object.assign(rest, { secretSet: !!secretEnc, rows: c ? c.rows.length : 0, detectedKeys: c ? c.keys : [], appliedMap: c ? c.map : {} });
}
const SRC_FIELDS = ['name', 'type', 'url', 'method', 'authType', 'authHeaderName', 'authQueryName', 'username', 'body', 'recordsPath', 'pageParam', 'pageSizeParam', 'pageSize', 'startPage', 'maxPages', 'defaultCurrency', 'mapping', 'durUnit', 'refreshMins', 'timeoutMs', 'enabled', 'demoSize'];
function applySourceInput(s, b) {
  for (const k of SRC_FIELDS) if (b[k] !== undefined) s[k] = b[k];
  s.name = String(s.name || 'Untitled').slice(0, 80);
  s.method = s.method === 'POST' ? 'POST' : 'GET';
  s.defaultCurrency = String(s.defaultCurrency || '').toUpperCase().slice(0, 3);
  ['startPage', 'maxPages', 'refreshMins', 'timeoutMs', 'demoSize'].forEach(k => s[k] = Math.max(0, +s[k] || 0));
  s.timeoutMs = Math.min(Math.max(s.timeoutMs || 30000, 2000), 120000);
  s.maxPages = Math.max(1, Math.min(1000, s.maxPages || 1));
  if (s.type === 'api' && s.url) { const u = new URL(s.url); if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs are supported.'); }
  if (b.secret !== undefined && b.secret !== '') { s.secretEnc = store.encrypt(b.secret); s.secretHint = store.hint(b.secret); }
  if (b.clearSecret) { s.secretEnc = ''; s.secretHint = ''; }
  if (b.extraHeaders !== undefined && b.extraHeaders !== '') {
    s.extraHeadersEnc = store.encrypt(b.extraHeaders);
    s.extraHeaderNames = String(b.extraHeaders).split('\n').map(l => l.split(':')[0].trim()).filter(Boolean);
  }
  if (b.clearExtraHeaders) { s.extraHeadersEnc = ''; s.extraHeaderNames = []; }
  if (s.mapping && typeof s.mapping === 'object') for (const k of Object.keys(s.mapping)) if (!s.mapping[k]) delete s.mapping[k];
  return s;
}
const syncing = new Set();
async function syncSource(s, user) {
  if (syncing.has(s.id)) throw new Error('A sync for this source is already running.');
  syncing.add(s.id);
  const t0 = Date.now();
  try {
    const recs = await ingest.fetchRecords(s);
    const norm = ingest.normalize(recs, s);
    store.setCache(s.id, { at: Date.now(), cols: ingest.COLS, rows: norm.rows, keys: norm.keys, map: norm.map });
    s.lastSync = { at: Date.now(), ok: true, count: norm.rows.length, ms: Date.now() - t0, error: null };
    store.save();
    store.audit(user, 'source_synced', `${s.name}: ${norm.rows.length} transactions`);
    return s.lastSync;
  } catch (e) {
    s.lastSync = Object.assign({}, s.lastSync, { at: Date.now(), ok: false, ms: Date.now() - t0, error: e.message });
    store.save();
    store.audit(user, 'source_sync_failed', `${s.name}: ${e.message}`);
    throw e;
  } finally { syncing.delete(s.id); }
}
const findSource = (req, res) => { const s = db().sources.find(x => x.id === req.params.id); if (!s) res.status(404).json({ error: 'Data source not found.' }); return s; };

app.get('/api/admin/sources', auth('admin'), (req, res) => res.json({ sources: db().sources.map(publicSource), fields: ingest.FIELDS.map(([k, l]) => ({ k, l })) }));
app.post('/api/admin/sources', auth('admin'), (req, res) => {
  try {
    const s = applySourceInput(defaultSource(), req.body || {});
    db().sources.push(s); store.save();
    store.audit(req.user, 'source_created', s.name + (req.body.secret ? ' (key saved, encrypted)' : ''), ip(req));
    res.json({ source: publicSource(s) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/sources/:id', auth('admin'), (req, res) => {
  const s = findSource(req, res); if (!s) return;
  try {
    const keyChanged = !!req.body.secret || !!req.body.clearSecret;
    applySourceInput(s, req.body || {}); store.save();
    store.audit(req.user, 'source_updated', s.name + (keyChanged ? ' (API key changed)' : ''), ip(req));
    // re-apply mapping on cached raw is not possible (raw not kept) so trigger a sync in background
    res.json({ source: publicSource(s) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/sources/:id', auth('admin'), (req, res) => {
  const s = findSource(req, res); if (!s) return;
  db().sources = db().sources.filter(x => x.id !== s.id);
  db().users.forEach(u => { if (Array.isArray(u.sources)) u.sources = u.sources.filter(x => x !== s.id); });
  store.dropCache(s.id); store.save();
  store.audit(req.user, 'source_deleted', s.name, ip(req));
  res.json({ ok: true });
});
// Test a configuration without saving. If id is given, unsaved fields are merged over the saved source (so the stored key is reused).
app.post('/api/admin/sources/test', auth('admin'), async (req, res) => {
  try {
    const saved = req.body.id ? db().sources.find(x => x.id === req.body.id) : null;
    const s = applySourceInput(Object.assign(defaultSource(), saved ? JSON.parse(JSON.stringify(saved)) : {}), req.body || {});
    const t0 = Date.now();
    const recs = await ingest.fetchRecords(s, { sample: true });
    const norm = ingest.normalize(recs.slice(0, 500), s);
    const flat = ingest.flatten(recs[0] || {});
    // mask anything that looks sensitive in the preview
    const preview = Object.fromEntries(Object.entries(flat).slice(0, 40).map(([k, v]) => [k, /pass|secret|token|card|pan|cvv|iban/i.test(k) ? '••••' : v]));
    store.audit(req.user, 'source_tested', s.name + ': ' + recs.length + ' records', ip(req));
    res.json({ ok: true, count: recs.length, ms: Date.now() - t0, keys: norm.keys, map: norm.map, preview });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/sources/:id/sync', auth('admin'), async (req, res) => {
  const s = findSource(req, res); if (!s) return;
  try { res.json({ ok: true, lastSync: await syncSource(s, req.user), source: publicSource(s) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message, source: publicSource(s) }); }
});

/* ---------------- Users (admin) ---------------- */
app.get('/api/admin/users', auth('admin'), (req, res) => res.json({ users: db().users.map(publicUser) }));
app.post('/api/admin/users', auth('admin'), (req, res) => {
  const { username, name, role, password, sources } = req.body || {};
  if (!/^[a-z0-9._-]{3,40}$/i.test(username || '')) return res.status(400).json({ error: 'Username must be 3–40 letters, numbers, dots, dashes or underscores.' });
  if (db().users.some(u => u.username === username.toLowerCase())) return res.status(400).json({ error: 'That username is taken.' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const u = { id: store.newId('u_'), username: username.toLowerCase(), name: String(name || username).slice(0, 80), role: role === 'admin' ? 'admin' : 'staff', passHash: bcrypt.hashSync(password, 12), active: true, sources: Array.isArray(sources) && sources.length ? sources : ['*'], createdAt: Date.now(), mustChange: true };
  db().users.push(u); store.save();
  store.audit(req.user, 'user_created', `${u.username} (${u.role})`, ip(req));
  res.json({ user: publicUser(u) });
});
app.put('/api/admin/users/:id', auth('admin'), (req, res) => {
  const u = db().users.find(x => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  const b = req.body || {};
  const admins = db().users.filter(x => x.role === 'admin' && x.active !== false);
  const losingAdmin = u.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === false);
  if (losingAdmin && admins.length <= 1) return res.status(400).json({ error: 'There must be at least one active admin.' });
  if (b.name !== undefined) u.name = String(b.name).slice(0, 80);
  if (b.role) u.role = b.role === 'admin' ? 'admin' : 'staff';
  if (b.active !== undefined) u.active = !!b.active;
  if (Array.isArray(b.sources)) u.sources = b.sources.length ? b.sources : ['*'];
  if (b.password) {
    if (!validPassword(b.password)) return res.status(400).json({ error: PASSWORD_RULE });
    u.passHash = bcrypt.hashSync(b.password, 12); u.mustChange = true;
  }
  if (b.password || b.active === false) for (const [k, s] of Object.entries(db().sessions)) if (s.uid === u.id) delete db().sessions[k];
  store.save();
  store.audit(req.user, 'user_updated', u.username + (b.password ? ' (password reset)' : '') + (b.active === false ? ' (disabled)' : ''), ip(req));
  res.json({ user: publicUser(u) });
});
app.delete('/api/admin/users/:id', auth('admin'), (req, res) => {
  const u = db().users.find(x => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (u.role === 'admin' && db().users.filter(x => x.role === 'admin').length <= 1) return res.status(400).json({ error: 'There must be at least one admin.' });
  db().users = db().users.filter(x => x.id !== u.id);
  for (const [k, s] of Object.entries(db().sessions)) if (s.uid === u.id) delete db().sessions[k];
  store.save(); store.audit(req.user, 'user_deleted', u.username, ip(req));
  res.json({ ok: true });
});

/* ---------------- Settings & FX (admin) ---------------- */
function publicSettings() {
  const s = db().settings; const { customKeyEnc, fetched, ...fxRest } = s.fx;
  const eff = fx.effectiveRates();
  return { orgName: s.orgName, baseCurrency: s.baseCurrency, risk: s.risk, fx: Object.assign(fxRest, { customKeySet: !!customKeyEnc, fetchedCount: Object.keys(fetched || {}).length }), rates: eff.rates, rateSource: eff.sourceOf, currencyNames: fx.NAMES };
}
app.get('/api/admin/settings', auth('admin'), (req, res) => res.json(publicSettings()));
app.put('/api/admin/settings', auth('admin'), (req, res) => {
  const s = db().settings, b = req.body || {}, changes = [];
  if (b.orgName !== undefined) { s.orgName = String(b.orgName).slice(0, 80); changes.push('organisation name'); }
  if (b.baseCurrency) {
    const to = String(b.baseCurrency).toUpperCase().slice(0, 3);
    if (to !== s.baseCurrency) { if (!b.risk && rescaleRisk(s.baseCurrency, to)) changes.push('amount thresholds converted to ' + to); s.baseCurrency = to; changes.push('base currency ' + to); }
  }
  if (b.risk) {
    const r = b.risk;
    for (const k of Object.keys(store.DEFAULT_SETTINGS.risk)) if (r[k] !== undefined) s.risk[k] = k === 'highRiskCountries' ? (Array.isArray(r[k]) ? r[k] : String(r[k]).split(/[\s,]+/)).map(x => x.trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x)) : Math.max(0, +r[k] || 0);
    changes.push('risk thresholds');
  }
  if (b.fx) {
    const f = b.fx;
    for (const k of ['mode', 'refreshHours', 'customUrl', 'customKeyHeader', 'customKeyQuery', 'customRatesPath', 'customBase']) if (f[k] !== undefined) s.fx[k] = f[k];
    if (!['live', 'custom', 'manual'].includes(s.fx.mode)) s.fx.mode = 'live';
    if (f.customKey) s.fx.customKeyEnc = store.encrypt(f.customKey);
    if (f.clearCustomKey) s.fx.customKeyEnc = '';
    if (f.manual && typeof f.manual === 'object') s.fx.manual = Object.fromEntries(Object.entries(f.manual).map(([k, v]) => [k.toUpperCase().slice(0, 3), +v]).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && v > 0));
    changes.push('exchange rate settings');
  }
  store.save(); store.audit(req.user, 'settings_updated', changes.join(', '), ip(req));
  res.json(publicSettings());
});
app.post('/api/admin/fx/refresh', auth('admin'), async (req, res) => {
  const r = await fx.refresh();
  store.audit(req.user, 'fx_refreshed', r.ok ? (r.skipped ? 'manual mode' : r.count + ' rates') : 'failed: ' + r.error, ip(req));
  res.status(r.ok ? 200 : 400).json(Object.assign(r, publicSettings()));
});
app.get('/api/admin/audit', auth('admin'), (req, res) => res.json({ audit: db().audit.slice(-3000).reverse() }));

/* ---------------- Analytics data (staff + admin) ---------------- */
function allowedSources(u) {
  const all = db().sources.filter(s => s.enabled !== false);
  if (u.role === 'admin' || !u.sources || u.sources.includes('*')) return all;
  return all.filter(s => u.sources.includes(s.id));
}
app.get('/api/sources', auth(), (req, res) => res.json({ sources: allowedSources(req.user).map(s => ({ id: s.id, name: s.name, lastSync: s.lastSync })) }));
app.get('/api/data', auth(), (req, res) => {
  const allowed = allowedSources(req.user);
  const want = req.query.sources ? String(req.query.sources).split(',') : null;
  const list = want ? allowed.filter(s => want.includes(s.id)) : allowed;
  const rows = [];
  for (const s of list) { const c = store.getCache(s.id); if (c) for (const r of c.rows) rows.push(r); }
  const eff = fx.effectiveRates();
  const st = db().settings;
  res.json({
    cols: ingest.COLS, rows,
    sources: list.map(s => ({ id: s.id, name: s.name, lastSync: s.lastSync, mapped: Object.keys((store.getCache(s.id) || {}).map || {}) })),
    fx: { rates: eff.rates, sourceOf: eff.sourceOf, updatedAt: st.fx.updatedAt, provider: st.fx.mode === 'manual' ? 'manual' : st.fx.provider, error: st.fx.error, names: fx.NAMES },
    baseCurrency: st.baseCurrency, risk: st.risk, orgName: st.orgName,
    generatedAt: Date.now()
  });
});
app.post('/api/sources/:id/refresh', auth(), async (req, res) => {
  const s = allowedSources(req.user).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Data source not found.' });
  if (s.lastSync && s.lastSync.at > Date.now() - 60e3) return res.json({ ok: true, lastSync: s.lastSync, note: 'Synced less than a minute ago.' });
  try { res.json({ ok: true, lastSync: await syncSource(s, req.user) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/audit', auth(), (req, res) => {
  const { action, detail } = req.body || {};
  if (!['export', 'print'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
  store.audit(req.user, action, String(detail || '').slice(0, 200), ip(req));
  res.json({ ok: true });
});

/* ---------------- Static ---------------- */
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error.' }); });

/* ---------------- Schedulers ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const s of db().sources) {
    if (s.enabled === false || !s.refreshMins || syncing.has(s.id)) continue;
    if (!s.lastSync || now - s.lastSync.at >= s.refreshMins * 60e3) syncSource(s, null).catch(e => console.warn('[sync]', s.name, e.message));
  }
  const f = db().settings.fx;
  if (f.mode !== 'manual' && (!f.updatedAt || now - f.updatedAt > (f.refreshHours || 12) * 3600e3) && (!f.lastAttempt || now - f.lastAttempt > 15 * 60e3)) fx.refresh().catch(() => {});
  pruneSessions();
}, 60e3).unref();

app.listen(PORT, HOST, () => {
  console.log(`FinTrack Analytics running at http://localhost:${PORT}`);
  if (!db().users.length) console.log('Open it in your browser to create the first admin account.');
  // sync any source that has never synced
  for (const s of db().sources) if (s.enabled !== false && !store.getCache(s.id)) syncSource(s, null).catch(() => {});
});
