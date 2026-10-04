'use strict';
/* =========================================================================
   FinTrack Analytics — front end
   ========================================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  me: null, data: null, txns: [], base: [], f: [], rep: 'USD', baseCur: 'USD', rates: {}, rateSrc: {}, names: {},
  ben: new Map(), usr: new Map(), flags: [], charts: {}, tab: 'overview', dirty: new Set(), selBen: null, selUser: null, tbl: {},
  risk: {}, mode: 'analytics', unconverted: 0,
  admin: { tab: 'sources', sources: [], fields: [], users: [], settings: null, audit: [] }
};
const ATABS = ['overview', 'growth', 'bens', 'users', 'fx', 'corr', 'fees', 'ops', 'risk', 'txns'];
const COMMON_CUR = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'INR', 'PKR', 'PHP', 'EGP', 'BDT', 'CNY', 'JPY', 'SGD', 'HKD', 'CHF', 'CAD', 'AUD', 'ZAR', 'NGN', 'KES', 'TRY'];
const COUNTRY = { AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait', BH: 'Bahrain', OM: 'Oman', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal', PH: 'Philippines', ID: 'Indonesia', MY: 'Malaysia', TH: 'Thailand', VN: 'Vietnam', CN: 'China', HK: 'Hong Kong', SG: 'Singapore', JP: 'Japan', KR: 'South Korea', EG: 'Egypt', JO: 'Jordan', LB: 'Lebanon', TR: 'Türkiye', IL: 'Israel', GB: 'United Kingdom', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands', CH: 'Switzerland', IE: 'Ireland', RU: 'Russia', UA: 'Ukraine', PL: 'Poland', NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana', ZA: 'South Africa', MA: 'Morocco', ET: 'Ethiopia', AU: 'Australia', NZ: 'New Zealand', IR: 'Iran', KP: 'North Korea', MM: 'Myanmar', SY: 'Syria', AF: 'Afghanistan', YE: 'Yemen', IQ: 'Iraq', SD: 'Sudan' };
const cname = c => c ? (COUNTRY[c] ? `${COUNTRY[c]} (${c})` : c) : '—';

/* ---------------- Formatting ---------------- */
const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf2v = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const nfr = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
const nfc = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const isNum = v => v != null && !isNaN(v) && isFinite(v);
const money = v => isNum(v) ? nf2.format(v) : '–';
const moneyC = v => isNum(v) ? (Math.abs(v) >= 100000 ? nfc.format(v) : nf0.format(v)) : '–';
const cm = v => isNum(v) ? `${moneyC(v)} ${S.rep}` : '–';
const int = v => isNum(v) ? nf0.format(v) : '–';
const pct = v => isNum(v) ? (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%' : '–';
const bps = v => isNum(v) ? nf0.format(v * 10000) + ' bps' : '–';
const growth = v => isNum(v) ? `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v * 100).toFixed(1)}%</span>` : '<span class="muted">no prior data</span>';
const dur = ms => { if (!isNum(ms)) return '–'; if (ms < 1000) return Math.round(ms) + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s'; if (ms < 3600000) return (ms / 60000).toFixed(1) + ' min'; if (ms < 86400000) return (ms / 3600000).toFixed(1) + ' h'; return (ms / 86400000).toFixed(1) + ' d'; };
const dt = ts => ts == null || !isFinite(ts) ? '–' : new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dtShort = ts => ts == null || !isFinite(ts) ? '–' : new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ago = ts => { if (!ts) return 'never'; const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' days ago'; };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const iso = v => v == null || !isFinite(v) ? '' : new Date(v).toISOString();

/* ---------------- API ---------------- */
async function api(path, opt = {}) {
  const r = await fetch(path, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fintrack' }, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: 'same-origin' });
  let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401 && !opt.quiet401) { showAuth('login'); throw new Error(j.error || 'Please sign in.'); }
  if (!r.ok) { const e = new Error(j.error || ('Request failed (' + r.status + ')')); e.data = j; throw e; }
  return j;
}
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = '', bad ? 6000 : 3000); }

/* ---------------- Modal ---------------- */
function openModal(html, onReady) {
  const d = $('#modal'); $('#modal-body').innerHTML = html;
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  if (!d.open) d.showModal();
  if (onReady) onReady(d);
  return d;
}
const closeModal = () => $('#modal').close();
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    openModal(`<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></div><p>${text}</p>
      <div class="modal-foot"><button class="btn btn-line" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cf-ok">${esc(okLabel)}</button></div>`, d => {
      let ok = false;
      $('#cf-ok').onclick = () => { ok = true; d.close(); };
      d.addEventListener('close', () => res(ok), { once: true });
    });
  });
}

/* ---------------- Boot & auth ---------------- */
async function boot() {
  try {
    const st = await api('/api/setup-status');
    $('#auth-org').textContent = st.orgName || 'FinTrack Analytics';
    if (st.needsSetup) return showAuth('setup');
    const me = await api('/api/me', { quiet401: true }).catch(() => null);
    if (!me) return showAuth('login');
    start(me.user, me.orgName);
  } catch (e) { $('#boot').textContent = 'Could not reach the server: ' + e.message; }
}
function showAuth(which) {
  $('#boot').hidden = true; $('#shell').hidden = true; $('#auth').hidden = false;
  $('#login-form').hidden = which !== 'login'; $('#setup-form').hidden = which !== 'setup';
  if (which === 'setup') { $('#su-cur').innerHTML = COMMON_CUR.map(c => `<option>${c}</option>`).join(''); $('#su-user').focus(); }
  else $('#li-user').focus();
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#li-err').textContent = '';
  try { const r = await api('/api/login', { method: 'POST', body: { username: $('#li-user').value, password: $('#li-pass').value }, quiet401: true }); $('#li-pass').value = ''; start(r.user); }
  catch (err) { $('#li-err').textContent = err.message; }
});
$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#su-err').textContent = '';
  try {
    const r = await api('/api/setup', { method: 'POST', body: { orgName: $('#su-org').value, username: $('#su-user').value, name: $('#su-name').value, password: $('#su-pass').value, baseCurrency: $('#su-cur').value, addDemo: $('#su-demo').checked } });
    start(r.user, $('#su-org').value);
    if ($('#su-demo').checked) setTimeout(() => loadData(), 2500);
  } catch (err) { $('#su-err').textContent = err.message; }
});
function start(user, orgName) {
  S.me = user;
  $('#auth').hidden = true; $('#boot').hidden = true; $('#shell').hidden = false;
  $('#user-name').textContent = user.name || user.username;
  $('#user-role').textContent = user.role === 'admin' ? 'Admin' : 'Staff';
  $('#admin-btn').hidden = user.role !== 'admin';
  if (orgName) { $('#org-name').textContent = orgName; document.title = orgName; }
  setMode('analytics');
  loadData();
  if (user.mustChange) setTimeout(() => passwordModal(true), 400);
}
$('#user-btn').onclick = e => { e.stopPropagation(); const m = $('#user-menu'); m.hidden = !m.hidden; $('#user-btn').setAttribute('aria-expanded', !m.hidden); };
document.addEventListener('click', () => { $('#user-menu').hidden = true; });
$('#logout-btn').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.data = null; showAuth('login'); };
$('#pw-btn').onclick = () => passwordModal(false);
function passwordModal(forced) {
  openModal(`<div class="modal-head"><h2>${forced ? 'Set a new password' : 'Change password'}</h2>${forced ? '' : '<button class="x" data-close aria-label="Close">×</button>'}</div>
    ${forced ? '<p class="muted">An admin set a temporary password for you. Choose your own to continue.</p>' : ''}
    <label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password">
    <label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password">
    <p class="field-hint">At least 10 characters with letters and numbers.</p>
    <p class="form-err" id="pw-err"></p>
    <div class="modal-foot">${forced ? '' : '<button class="btn btn-line" data-close>Cancel</button>'}<button class="btn btn-primary" id="pw-save">Save password</button></div>`, d => {
    if (forced) d.addEventListener('cancel', e => e.preventDefault(), { once: true });
    $('#pw-save').onclick = async () => {
      try { await api('/api/me/password', { method: 'POST', body: { current: $('#pw-cur').value, next: $('#pw-new').value } }); S.me.mustChange = false; d.close(); toast('Password changed.'); }
      catch (e) { $('#pw-err').textContent = e.message; }
    };
  });
}
function setMode(m) {
  if (m === 'admin' && S.me.role !== 'admin') m = 'analytics';
  S.mode = m;
  $$('#mode-nav button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  $('#view-analytics').hidden = m !== 'analytics'; $('#view-admin').hidden = m !== 'admin';
  $('.cur-pick').hidden = m !== 'analytics';
  if (m === 'admin') adminLoad(); else render();
}
$$('#mode-nav button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

/* ---------------- Data loading & conversion ---------------- */
async function loadData() {
  try {
    const src = $('#f-source').value;
    const d = await api('/api/data' + (src ? '?sources=' + encodeURIComponent(src) : ''));
    S.data = d; S.rates = d.fx.rates; S.rateSrc = d.fx.sourceOf; S.names = d.fx.names || {}; S.baseCur = d.baseCurrency; S.risk = d.risk;
    if (d.orgName) { $('#org-name').textContent = d.orgName; }
    // currency picker
    const curSel = $('#rep-cur'), keep = curSel.value || localStorage.getItem('ft-rep') || d.baseCurrency;
    const used = [...new Set(d.rows.map(r => r[6]).filter(Boolean))];
    const list = [...new Set([d.baseCurrency, ...COMMON_CUR, ...used])].filter(c => S.rates[c]).sort();
    curSel.innerHTML = list.map(c => `<option value="${c}">${c}${S.names[c] ? ' – ' + esc(S.names[c]) : ''}</option>`).join('');
    curSel.value = list.includes(keep) ? keep : d.baseCurrency;
    S.rep = curSel.value;
    // source picker
    const fs = $('#f-source'), sv = fs.value;
    const all = await api('/api/sources');
    fs.innerHTML = '<option value="">All my sources</option>' + all.sources.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    fs.value = all.sources.some(s => s.id === sv) ? sv : '';
    $('#src-status').innerHTML = d.sources.map(s => `<div><span class="dot ${s.lastSync ? (s.lastSync.ok ? 'ok' : 'bad') : 'off'}"></span>${esc(s.name)}: ${s.lastSync ? (s.lastSync.ok ? int(s.lastSync.count) + ' txns, ' + ago(s.lastSync.at) : 'last sync failed') : 'not synced yet'}</div>`).join('') || 'No data sources available to you.';
    buildTxns();
    fillFilterOptions();
    applyFilters();
  } catch (e) { if (S.me) toast(e.message, true); }
}
function outcome(s) {
  if (/succ|complet|settl|approv|paid|^ok$|done|captur|credited|posted/.test(s)) return 'ok';
  if (/fail|declin|reject|error|cancel|revers|refus|timeout|expired|denied/.test(s)) return 'fail';
  if (/pend|process|init|queue|hold|progress|wait/.test(s)) return 'pending';
  return 'other';
}
function conv(amount, from, to) { const a = S.rates[from], b = S.rates[to]; if (!a || !b || !isNum(amount)) return null; return amount / a * b; }
function buildTxns() {
  const d = S.data, ix = Object.fromEntries(d.cols.map((c, i) => [c, i]));
  const srcName = Object.fromEntries(d.sources.map(s => [s.id, s.name]));
  S.txns = d.rows.map((r, i) => {
    const t = { i, src: r[ix.src], srcName: srcName[r[ix.src]] || '', id: r[ix.id], user: r[ix.user], ben: r[ix.ben], benName: r[ix.benName] || '', amount: r[ix.amount], cur: r[ix.cur] || '', ts: r[ix.ts], dur: r[ix.dur], status: r[ix.status] || 'unknown', reason: r[ix.reason] || '', channel: r[ix.channel] || '', fee: r[ix.fee], sc: r[ix.sc] || '', bc: r[ix.bc] || '', bank: r[ix.bank] || '' };
    t.oc = t.status === 'unknown' ? 'other' : outcome(t.status);
    t.cross = t.sc && t.bc ? t.sc !== t.bc : null;
    t.vb = t.cur ? conv(t.amount, t.cur, S.baseCur) : null;
    return t;
  });
  S.has = {
    status: S.txns.some(t => t.status !== 'unknown'), dur: S.txns.some(t => t.dur != null), fee: S.txns.some(t => t.fee != null),
    country: S.txns.some(t => t.sc || t.bc), cur: S.txns.some(t => t.cur), channel: S.txns.some(t => t.channel), reason: S.txns.some(t => t.reason), bank: S.txns.some(t => t.bank)
  };
  convertAll();
}
function convertAll() {
  let un = 0;
  for (const t of S.txns) {
    const v = t.cur ? conv(t.amount, t.cur, S.rep) : (S.has.cur ? null : t.amount);
    t.v = v; if (v == null) un++;
    t.fv = t.fee == null ? null : (t.cur ? conv(t.fee, t.cur, S.rep) : t.fee);
  }
  S.unconverted = un;
}
$('#rep-cur').onchange = () => { S.rep = $('#rep-cur').value; try { localStorage.setItem('ft-rep', S.rep); } catch (e) { /* ignore */ } convertAll(); applyFilters(); };
$('#f-source').onchange = () => loadData();
$('#reload-btn').onclick = async () => {
  const b = $('#reload-btn'); b.disabled = true; b.textContent = 'Refreshing…';
  try {
    const ids = $('#f-source').value ? [$('#f-source').value] : S.data.sources.map(s => s.id);
    const results = await Promise.allSettled(ids.map(id => api('/api/sources/' + id + '/refresh', { method: 'POST' })));
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) toast(failed[0].reason.message, true);
    await loadData();
  } finally { b.disabled = false; b.textContent = 'Reload data'; }
};
function fillFilterOptions() {
  const keep = (sel, vals, label = x => x) => { const el = $(sel), v = el.value; el.innerHTML = '<option value="">All</option>' + vals.map(x => `<option value="${esc(x)}">${esc(label(x))}</option>`).join(''); if (vals.includes(v)) el.value = v; };
  const u = k => [...new Set(S.txns.map(t => t[k]).filter(Boolean))].sort();
  keep('#f-status', u('status')); keep('#f-channel', u('channel')); keep('#f-cur', u('cur'));
  keep('#f-sc', u('sc'), cname); keep('#f-bc', u('bc'), cname);
}

/* ---------------- Filtering ---------------- */
function dateRange() {
  const from = $('#f-from').value ? new Date($('#f-from').value).getTime() : null;
  const to = $('#f-to').value ? new Date($('#f-to').value).getTime() : null;
  return { from, to };
}
function applyFilters() {
  if (!S.data) return;
  const { from, to } = dateRange();
  const fu = $('#f-user').value.trim().toLowerCase(), fb = $('#f-ben').value.trim().toLowerCase();
  const mn = $('#f-min').value !== '' ? +$('#f-min').value : null, mx = $('#f-max').value !== '' ? +$('#f-max').value : null;
  const fs = $('#f-status').value, fc = $('#f-channel').value, fcur = $('#f-cur').value, fsc = $('#f-sc').value, fbc = $('#f-bc').value, scope = $('#f-scope').value;
  const q = $('#f-q').value.trim().toLowerCase();
  // S.base = everything except the date window (used for growth comparisons and first-seen logic)
  S.base = S.txns.filter(t => {
    if (fu && !t.user.toLowerCase().includes(fu)) return false;
    if (fb && !(t.ben.toLowerCase().includes(fb) || t.benName.toLowerCase().includes(fb) || t.bank.toLowerCase().includes(fb))) return false;
    if (mn != null && (t.v == null || t.v < mn)) return false;
    if (mx != null && (t.v == null || t.v > mx)) return false;
    if (fs && t.status !== fs) return false;
    if (fc && t.channel !== fc) return false;
    if (fcur && t.cur !== fcur) return false;
    if (fsc && t.sc !== fsc) return false;
    if (fbc && t.bc !== fbc) return false;
    if (scope === 'cross' && t.cross !== true) return false;
    if (scope === 'dom' && t.cross !== false) return false;
    if (q && ![t.id, t.user, t.ben, t.benName, t.status, t.reason, t.channel, t.bank, t.cur, t.sc, t.bc].some(v => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  S.f = S.base.filter(t => !((from != null && (t.ts == null || t.ts < from)) || (to != null && (t.ts == null || t.ts > to))));
  aggregate(); computeFlags();
  Object.values(S.tbl).forEach(t => t.page = 0);
  let mnT = Infinity, mxT = -Infinity; for (const t of S.f) if (t.ts != null) { if (t.ts < mnT) mnT = t.ts; if (t.ts > mxT) mxT = t.ts; }
  S.span = { min: mnT, max: mxT };
  $('#subtitle').textContent = `${int(S.f.length)} of ${int(S.txns.length)} transactions · ${isFinite(mnT) ? dtShort(mnT) + ' to ' + dtShort(mxT) : 'no dates'} · amounts shown in ${S.rep}`;
  $('#amt-hint').textContent = 'In ' + S.rep;
  const hi = S.flags.filter(f => f.sev === 'high').length; const rc = $('#risk-count'); rc.hidden = !hi; rc.textContent = hi;
  fxNote();
  const empty = !S.txns.length;
  $('#a-empty').hidden = !empty; $('#a-work').hidden = empty;
  if (empty) $('#a-empty').innerHTML = S.me.role === 'admin'
    ? `<h2>No transactions yet</h2><p>Add an API data source with its key in the admin panel, then sync it. Data appears here for you and the staff you give access to.</p><button class="btn btn-primary" id="go-admin">Open admin panel</button>`
    : `<h2>No transactions available</h2><p>No data source has been shared with you yet, or it has not synced. Ask an admin to give you access.</p>`;
  if (empty && $('#go-admin')) $('#go-admin').onclick = () => setMode('admin');
  S.dirty = new Set(ATABS);
  render();
}
function fxNote() {
  const fx = S.data.fx, el = $('#fx-note');
  const parts = [];
  if (S.unconverted) parts.push(`${int(S.unconverted)} transactions use a currency with no exchange rate, so they are left out of ${S.rep} totals. An admin can add the rate under Currencies & FX.`);
  if (fx.error) parts.push('The last exchange-rate update failed, so older or built-in rates are in use.');
  else if (!fx.updatedAt && fx.provider !== 'manual') parts.push('Exchange rates are approximate built-in values until an admin refreshes them.');
  el.innerHTML = parts.length ? `<div class="note">${parts.map(esc).join(' ')}</div>` : '';
}
let ft;
['#f-from', '#f-to', '#f-user', '#f-ben', '#f-min', '#f-max', '#f-status', '#f-channel', '#f-cur', '#f-sc', '#f-bc', '#f-scope', '#f-q'].forEach(s => $(s).addEventListener('input', () => {
  if (s === '#f-from' || s === '#f-to') $$('#quick-range button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  clearTimeout(ft); ft = setTimeout(applyFilters, 250);
}));
$$('#quick-range button').forEach(b => b.onclick = () => {
  $$('#quick-range button').forEach(x => x.setAttribute('aria-pressed', x === b));
  const days = +b.dataset.r;
  const fmt = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  if (!days) { $('#f-from').value = ''; $('#f-to').value = ''; }
  else { let end = -Infinity; for (const t of S.txns) if (t.ts != null && t.ts > end) end = t.ts; if (!isFinite(end)) end = Date.now(); $('#f-from').value = fmt(end - days * 86400e3); $('#f-to').value = fmt(end + 60e3); }
  applyFilters();
});
$('#f-reset').onclick = () => {
  ['#f-from', '#f-to', '#f-user', '#f-ben', '#f-min', '#f-max', '#f-q'].forEach(s => $(s).value = '');
  ['#f-status', '#f-channel', '#f-cur', '#f-sc', '#f-bc', '#f-scope'].forEach(s => $(s).value = '');
  $$('#quick-range button').forEach(x => x.setAttribute('aria-pressed', x.dataset.r === '0'));
  applyFilters();
};

/* ---------------- Aggregation ---------------- */
const V = t => t.v || 0;
function aggregate() {
  const ben = new Map(), usr = new Map();
  for (const t of S.f) {
    let b = ben.get(t.ben);
    if (!b) { b = { key: t.ben, name: t.benName, bank: t.bank, cc: t.bc, total: 0, n: 0, ok: 0, payers: new Map(), max: 0, first: Infinity, last: -Infinity, list: [] }; ben.set(t.ben, b); }
    b.total += V(t); b.n++; b.list.push(t); if (t.oc === 'ok') b.ok++; if (V(t) > b.max) b.max = V(t);
    if (!b.name && t.benName) b.name = t.benName; if (!b.bank && t.bank) b.bank = t.bank; if (!b.cc && t.bc) b.cc = t.bc;
    if (t.ts != null) { if (t.ts < b.first) b.first = t.ts; if (t.ts > b.last) b.last = t.ts; }
    let p = b.payers.get(t.user); if (!p) { p = { user: t.user, total: 0, n: 0, last: -Infinity }; b.payers.set(t.user, p); }
    p.total += V(t); p.n++; if (t.ts != null && t.ts > p.last) p.last = t.ts;
    let u = usr.get(t.user);
    if (!u) { u = { key: t.user, cc: t.sc, total: 0, n: 0, ok: 0, fail: 0, fees: 0, bens: new Map(), ts: [], durSum: 0, durN: 0, max: 0, list: [], curs: new Set() }; usr.set(t.user, u); }
    u.total += V(t); u.n++; u.list.push(t); if (V(t) > u.max) u.max = V(t); if (t.cur) u.curs.add(t.cur);
    if (t.oc === 'ok') u.ok++; if (t.oc === 'fail') u.fail++; if (t.fv) u.fees += t.fv;
    let bb = u.bens.get(t.ben); if (!bb) { bb = { ben: t.ben, name: t.benName, cc: t.bc, total: 0, n: 0, last: -Infinity }; u.bens.set(t.ben, bb); }
    bb.total += V(t); bb.n++; if (t.ts != null && t.ts > bb.last) bb.last = t.ts;
    if (t.ts != null) u.ts.push(t.ts); if (t.dur != null) { u.durSum += t.dur; u.durN++; }
  }
  for (const u of usr.values()) {
    u.ts.sort((a, b) => a - b);
    let peak = 0, cur = 0, prev = null;
    for (const x of u.ts) { const s = Math.floor(x / 1000); if (s === prev) cur++; else { cur = 1; prev = s; } if (cur > peak) peak = cur; }
    let j = 0, pm = 0; for (let i = 0; i < u.ts.length; i++) { while (u.ts[i] - u.ts[j] >= 60000) j++; if (i - j + 1 > pm) pm = i - j + 1; }
    let gs = 0; for (let i = 1; i < u.ts.length; i++) gs += u.ts[i] - u.ts[i - 1];
    u.peakSec = peak; u.peakMin = pm; u.avgGap = u.ts.length > 1 ? gs / (u.ts.length - 1) : null;
    const span = u.ts.length > 1 ? u.ts[u.ts.length - 1] - u.ts[0] : 0;
    u.rate = span > 0 ? u.ts.length / (span / 1000) : null;
    u.avgDur = u.durN ? u.durSum / u.durN : null; u.avg = u.n ? u.total / u.n : 0;
    u.benN = u.bens.size; u.okRate = S.has.status && u.n ? u.ok / u.n : null; u.curList = [...u.curs].join(', ');
    u.days = new Set(u.ts.map(x => new Date(x).toDateString())).size;
  }
  for (const b of ben.values()) { b.avg = b.n ? b.total / b.n : 0; b.payerN = b.payers.size; }
  S.ben = ben; S.usr = usr;
}
function quant(sorted, p) { if (!sorted.length) return null; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
function perSecond(list) { const m = new Map(); for (const t of list) { if (t.ts == null) continue; const s = Math.floor(t.ts / 1000); m.set(s, (m.get(s) || 0) + 1); } return m; }
function throughput(list) {
  const ps = perSecond(list); let peak = 0, peakAt = null;
  for (const [s, c] of ps) if (c > peak) { peak = c; peakAt = s * 1000; }
  const ts = list.map(t => t.ts).filter(x => x != null).sort((a, b) => a - b);
  const span = ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / 1000 : 0;
  let j = 0, pm = 0, pmAt = null; for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] >= 60000) j++; if (i - j + 1 > pm) { pm = i - j + 1; pmAt = ts[j]; } }
  const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  return { peak, peakAt, avg: span > 0 ? ts.length / span : null, activeAvg: ps.size ? ts.length / ps.size : null, peakMin: pm, peakMinAt: pmAt, avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null };
}
function groupBy(list, keyFn) { const m = new Map(); for (const t of list) { const k = keyFn(t); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return m; }
function stats(arr) {
  const n = arr.length, value = arr.reduce((s, t) => s + V(t), 0), ok = arr.filter(t => t.oc === 'ok'), fail = arr.filter(t => t.oc === 'fail').length;
  const d = arr.map(t => t.dur).filter(x => x != null).sort((a, b) => a - b);
  const fees = arr.reduce((s, t) => s + (t.fv || 0), 0), okValue = ok.reduce((s, t) => s + V(t), 0);
  return { n, value, avg: n ? value / n : 0, okRate: S.has.status && n ? ok.length / n : null, failRate: S.has.status && n ? fail / n : null, fail, avgDur: d.length ? d.reduce((a, b) => a + b, 0) / d.length : null, p50: quant(d, .5), p95: quant(d, .95), max: d.length ? d[d.length - 1] : null, fees, take: okValue ? fees / okValue : null, users: new Set(arr.map(t => t.user)).size, bens: new Set(arr.map(t => t.ben)).size };
}

/* ---------------- Risk & compliance flags ---------------- */
function computeFlags() {
  const c = S.risk, F = [], B = S.baseCur, VB = t => t.vb || 0;
  const hr = new Set(c.highRiskCountries || []);
  for (const u of S.usr.values()) {
    if (u.peakSec >= c.velSec) F.push({ type: 'Velocity burst', sev: u.peakSec >= c.velSec * 2 ? 'high' : 'med', kind: 'user', subj: u.key, detail: `${u.peakSec} transactions within one second`, amt: u.total });
    if (u.peakMin >= c.velMin) F.push({ type: 'High frequency', sev: 'med', kind: 'user', subj: u.key, detail: `${u.peakMin} transactions within 60 seconds`, amt: u.total });
    if (S.has.status && u.fail >= c.failMin && u.fail / u.n >= 0.3) F.push({ type: 'Repeated failures', sev: 'med', kind: 'user', subj: u.key, detail: `${u.fail} of ${u.n} failed (${pct(u.fail / u.n)})`, amt: u.total });
    const L = u.list.filter(t => t.ts != null).sort((a, b) => a.ts - b.ts);
    const cnt = new Map(); let j = 0, best = 0;
    for (let i = 0; i < L.length; i++) {
      cnt.set(L[i].ben, (cnt.get(L[i].ben) || 0) + 1);
      while (L[i].ts - L[j].ts > 3600000) { const k = L[j].ben, v = cnt.get(k) - 1; if (v) cnt.set(k, v); else cnt.delete(k); j++; }
      if (cnt.size > best) best = cnt.size;
    }
    if (best >= c.fanOut) F.push({ type: 'Fan-out', sev: best >= c.fanOut * 2 ? 'high' : 'med', kind: 'user', subj: u.key, detail: `Paid ${best} different beneficiaries within one hour`, amt: u.total });
    const lo = c.largeTxn * (1 - c.structPct / 100);
    const st = u.list.filter(t => t.vb != null && t.vb >= lo && t.vb < c.largeTxn);
    if (st.length >= 2) F.push({ type: 'Possible structuring', sev: st.length >= 4 ? 'high' : 'med', kind: 'user', subj: u.key, detail: `${st.length} payments just under the ${int(c.largeTxn)} ${B} reporting threshold`, amt: st.reduce((a, t) => a + V(t), 0) });
    const big = u.list.filter(t => t.vb != null && t.vb >= c.largeTxn);
    if (big.length) F.push({ type: 'Large transaction', sev: 'low', kind: 'user', subj: u.key, detail: `${big.length} payment(s) at or above ${int(c.largeTxn)} ${B} (may need reporting)`, amt: big.reduce((a, t) => a + V(t), 0) });
    const rd = u.list.filter(t => VB(t) >= c.roundMin && t.amount % 1000 === 0);
    if (rd.length >= 3) F.push({ type: 'Round-amount pattern', sev: 'low', kind: 'user', subj: u.key, detail: `${rd.length} large round-number payments`, amt: rd.reduce((a, t) => a + V(t), 0) });
    if (u.n >= 5) {
      const vals = u.list.map(VB), mean = vals.reduce((a, b) => a + b, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, x) => a + (x - mean) ** 2, 0) / vals.length);
      if (sd > 0) {
        const out = u.list.filter(t => (VB(t) - mean) / sd > c.outlierZ);
        if (out.length) { const mx = Math.max(...out.map(VB)); F.push({ type: 'Unusual amount', sev: mx >= 10 * mean && mx >= c.largeTxn ? 'high' : mx >= 5 * mean ? 'med' : 'low', kind: 'user', subj: u.key, detail: `${out.length} payment(s) far above this user's normal (largest ${moneyC(conv(mx, B, S.rep))} vs average ${moneyC(conv(mean, B, S.rep))} ${S.rep})`, amt: out.reduce((a, t) => a + V(t), 0) }); }
      }
    }
    const hrT = u.list.filter(t => hr.has(t.bc) || hr.has(t.sc));
    if (hrT.length) F.push({ type: 'High-risk jurisdiction', sev: 'high', kind: 'user', subj: u.key, detail: `${hrT.length} payment(s) involving ${[...new Set(hrT.flatMap(t => [t.sc, t.bc]).filter(x => hr.has(x)))].map(cname).join(', ')}`, amt: hrT.reduce((a, t) => a + V(t), 0) });
  }
  // first payment from a user to a beneficiary that is already large (uses all dates so "first" is real)
  const firstPair = new Map();
  for (const t of S.base.filter(t => t.ts != null).sort((a, b) => a.ts - b.ts)) { const k = t.user + '\u0001' + t.ben; if (!firstPair.has(k)) firstPair.set(k, t); }
  const inF = new Set(S.f.map(t => t.i)); const nb = new Map();
  for (const t of firstPair.values()) if (inF.has(t.i) && t.vb != null && t.vb >= c.newBenLarge) { const a = nb.get(t.user) || { n: 0, amt: 0 }; a.n++; a.amt += V(t); nb.set(t.user, a); }
  for (const [u, a] of nb) F.push({ type: 'Large first payment to new beneficiary', sev: a.n >= 3 ? 'high' : 'med', kind: 'user', subj: u, detail: `${a.n} first-time payment(s) to a new beneficiary at or above ${int(c.newBenLarge)} ${B}`, amt: a.amt });
  // duplicates
  const sorted = S.f.filter(t => t.ts != null).slice().sort((a, b) => a.user < b.user ? -1 : a.user > b.user ? 1 : a.ben < b.ben ? -1 : a.ben > b.ben ? 1 : a.amount - b.amount || a.ts - b.ts);
  const dup = new Map();
  for (let i = 1; i < sorted.length; i++) { const a = sorted[i - 1], b = sorted[i]; if (a.user === b.user && a.ben === b.ben && a.amount === b.amount && a.cur === b.cur && b.ts - a.ts <= c.dupWin * 1000) { const d = dup.get(a.user) || { n: 0, amt: 0 }; d.n++; d.amt += V(b); dup.set(a.user, d); } }
  for (const [u, d] of dup) F.push({ type: 'Possible duplicate', sev: d.n >= 3 ? 'high' : 'med', kind: 'user', subj: u, detail: `${d.n} repeat payment(s) of the same amount to the same beneficiary within ${c.dupWin}s`, amt: d.amt });
  // payer spike
  for (const b of S.ben.values()) {
    const L = b.list.filter(t => t.ts != null).sort((x, y) => x.ts - y.ts); if (L.length < c.fanIn) continue;
    const hours = new Set(L.map(t => Math.floor(t.ts / 3600e3))).size, base = L.length / hours;
    const cnt = new Map(); let j = 0, best = 0, at = null;
    for (let i = 0; i < L.length; i++) {
      cnt.set(L[i].user, (cnt.get(L[i].user) || 0) + 1);
      while (L[i].ts - L[j].ts > 3600000) { const k = L[j].user, v = cnt.get(k) - 1; if (v) cnt.set(k, v); else cnt.delete(k); j++; }
      if (cnt.size > best) { best = cnt.size; at = L[j].ts; }
    }
    if (best >= c.fanIn && best >= 4 * base) F.push({ type: 'Payer spike (fan-in)', sev: best >= c.fanIn * 2 ? 'high' : 'med', kind: 'ben', subj: b.key, detail: `${best} different users paid ${b.name || 'this beneficiary'} within one hour from ${dtShort(at)} (normally about ${nf2v.format(base)} per active hour)`, amt: b.total });
  }
  // stuck pending
  const now = Date.now(), stuck = S.f.filter(t => t.oc === 'pending' && t.ts != null && now - t.ts > c.pendingAgeMins * 60e3);
  if (stuck.length) F.push({ type: 'Stuck pending transactions', sev: stuck.length >= 20 ? 'high' : 'med', kind: 'ops', subj: 'Pending queue', detail: `${stuck.length} transaction(s) pending for more than ${c.pendingAgeMins} minutes`, amt: stuck.reduce((a, t) => a + V(t), 0) });
  const rank = { high: 0, med: 1, low: 2 };
  S.flags = F.sort((a, b) => rank[a.sev] - rank[b.sev] || b.amt - a.amt);
}

/* ---------------- Charts ---------------- */
function chart(id, cfg) {
  if (S.charts[id]) { S.charts[id].destroy(); delete S.charts[id]; }
  const el = document.getElementById(id); if (!el || !window.Chart) return;
  Chart.defaults.font.family = cssVar('--font'); Chart.defaults.color = cssVar('--muted');
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10 } } } }, cfg.options || {});
  const sc = cfg.options.scales; if (sc) for (const k in sc) { sc[k].grid = Object.assign({ color: cssVar('--line2') }, sc[k].grid || {}); sc[k].border = { display: false }; }
  S.charts[id] = new Chart(el, cfg);
}
const PALETTE = () => [cssVar('--accent'), cssVar('--blue'), cssVar('--gold'), cssVar('--warn'), cssVar('--bad'), '#7A5AA6', '#3A8FA8', '#8C9A3C', '#B5677F', '#6B7A8F'];
function bucketSize(list) {
  let mn = Infinity, mx = -Infinity; for (const t of list) if (t.ts != null) { if (t.ts < mn) mn = t.ts; if (t.ts > mx) mx = t.ts; }
  if (!isFinite(mn)) return null; const span = mx - mn;
  if (span <= 3 * 3600e3) return { ms: 60e3, label: 'minute' };
  if (span <= 4 * 86400e3) return { ms: 3600e3, label: 'hour' };
  if (span <= 120 * 86400e3) return { ms: 86400e3, label: 'day' };
  return { ms: 7 * 86400e3, label: 'week' };
}
function bucketLabel(ms, size) { const d = new Date(ms); if (size < 3600e3) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); if (size < 86400e3) return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function bucketKey(ts, size) { if (size >= 86400e3) { const d = new Date(ts); d.setHours(0, 0, 0, 0); if (size > 86400e3) d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); } return Math.floor(ts / size) * size; }
function bucketize(list, size, fn) {
  const m = new Map(); for (const t of list) { if (t.ts == null) continue; const k = bucketKey(t.ts, size); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  const keys = [...m.keys()].sort((a, b) => a - b); if (!keys.length) return { labels: [], keys: [], vals: [] };
  const all = []; for (let k = keys[0]; k <= keys[keys.length - 1];) { all.push(k); if (size >= 86400e3) { const d = new Date(k); d.setDate(d.getDate() + size / 86400e3); k = d.getTime(); } else k += size; }
  const use = all.length > 2000 ? keys : all;
  return { keys: use, labels: use.map(k => bucketLabel(k, size)), vals: use.map(k => fn(m.get(k) || [])) };
}

/* ---------------- Tables ---------------- */
function table(container, id, cols, rows, opt = {}) {
  if (!container) return;
  const st = S.tbl[id] || (S.tbl[id] = { sort: opt.sort || cols[0].k, desc: opt.desc !== false, page: 0, q: '' });
  const size = opt.pageSize || 15;
  let data = rows;
  if (st.q) { const q = st.q.toLowerCase(); data = rows.filter(r => cols.some(c => String(c.text ? c.text(r) : r[c.k] ?? '').toLowerCase().includes(q))); }
  const col = cols.find(c => c.k === st.sort) || cols[0];
  const val = r => col.sortv ? col.sortv(r) : r[col.k];
  data = data.slice().sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (st.desc ? -1 : 1); });
  const pages = Math.max(1, Math.ceil(data.length / size)); if (st.page >= pages) st.page = pages - 1;
  const slice = data.slice(st.page * size, st.page * size + size);
  const maxBar = {}; cols.filter(c => c.bar).forEach(c => maxBar[c.k] = Math.max(...data.map(r => r[c.k] || 0), 1));
  container.innerHTML = `
    ${opt.tools === false ? '' : `<div class="tbl-tools">${opt.search !== false ? `<input type="search" placeholder="Search this table" value="${esc(st.q)}" aria-label="Search this table">` : ''}<span class="spacer"></span><button class="btn btn-line btn-sm" data-exp>Export CSV</button></div>`}
    <div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}" data-k="${c.k}" ${c.k === st.sort ? `aria-sort="${st.desc ? 'descending' : 'ascending'}"` : ''} tabindex="0">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${slice.length ? slice.map((r, ix) => `<tr data-ix="${ix}" class="${opt.onRow ? 'click' : ''} ${opt.isSel && opt.isSel(r) ? 'sel' : ''}">${cols.map(c => {
      const raw = r[c.k]; let h = c.html ? c.html(r) : esc(c.fmt ? c.fmt(raw, r) : raw);
      if (c.bar) h = `<span class="bar-cell">${h}<i style="width:${Math.max(2, 60 * (raw || 0) / maxBar[c.k])}px"></i></span>`;
      return `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${h}</td>`;
    }).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:24px">${esc(opt.empty || 'No rows match.')}</td></tr>`}</tbody></table></div>
    ${data.length > size ? `<div class="pager"><span>${int(data.length)} rows · page ${st.page + 1} of ${pages}</span><button data-p="-1" ${st.page === 0 ? 'disabled' : ''}>Previous</button><button data-p="1" ${st.page >= pages - 1 ? 'disabled' : ''}>Next</button></div>` : (data.length > 5 ? `<div class="pager"><span>${int(data.length)} rows</span></div>` : '')}`;
  const re = () => table(container, id, cols, rows, opt);
  const si = container.querySelector('input[type=search]');
  if (si) si.addEventListener('input', e => { st.q = e.target.value; st.page = 0; const pos = e.target.selectionStart; re(); const n = container.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(pos, pos); });
  container.querySelectorAll('th').forEach(th => { const go = () => { const k = th.dataset.k; if (st.sort === k) st.desc = !st.desc; else { st.sort = k; st.desc = true; } re(); }; th.addEventListener('click', go); th.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
  container.querySelectorAll('.pager button').forEach(b => b.addEventListener('click', () => { st.page += +b.dataset.p; re(); }));
  if (opt.onRow) container.querySelectorAll('tbody tr[data-ix]').forEach(tr => tr.addEventListener('click', () => opt.onRow(slice[+tr.dataset.ix])));
  const ex = container.querySelector('[data-exp]');
  if (ex) ex.addEventListener('click', () => saveCSV((opt.file || id) + '.csv', cols.map(c => c.label), data.map(r => cols.map(c => c.csv ? c.csv(r[c.k], r) : c.text ? c.text(r) : r[c.k]))));
}
function toCSV(head, rows) {
  const q = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && isNaN(+s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [head.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
}
function saveCSV(name, head, rows) {
  const blob = new Blob(['\ufeff' + toCSV(head, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  api('/api/audit', { method: 'POST', body: { action: 'export', detail: `${name} (${rows.length} rows)` } }).catch(() => {});
}

/* =========================================================================
   Analytics views
   ========================================================================= */
const P = n => document.querySelector(`[data-panel="${n}"]`);
const kpi = (v, l, s, lead) => `<div class="kpi${lead ? ' lead' : ''}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const ledger = (...items) => { const n = items.length, c = n <= 6 ? n : Math.ceil(n / 2); return `<div class="ledger" style="--cols:${c}">${items.join('')}</div>`; };
const benLabel = b => b.name ? `${b.key} · ${b.name}` : b.key;
const needs = (flag, what) => `<div class="note">${what} ${S.me.role === 'admin' ? 'Map the field in Admin › Data sources › Edit › Field mapping.' : 'Ask an admin to map it.'}</div>`;
function render() {
  if (S.mode !== 'analytics' || !S.data || !S.txns.length) return;
  const t = S.tab; if (!S.dirty.has(t)) return; S.dirty.delete(t);
  ({ overview: rOverview, growth: rGrowth, bens: rBens, users: rUsers, fx: rFx, corr: rCorr, fees: rFees, ops: rOps, risk: rRisk, txns: rTxns })[t]();
}
function switchTab(t) { S.tab = t; $$('#a-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t)); $$('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel === t)); }
$$('#a-tabs button').forEach(b => b.onclick = () => { switchTab(b.dataset.tab); render(); });
const insightsList = ins => ins.map(([c, t]) => `<li class="${c}">${t}</li>`).join('') || '<li>Not enough data for findings yet.</li>';
const valueCols = () => [
  { k: 'n', label: 'Transactions', num: true, fmt: int },
  { k: 'value', label: `Value (${S.rep})`, num: true, fmt: money, bar: true },
  { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.value },
  { k: 'avg', label: 'Average ticket', num: true, fmt: money },
  { k: 'okRate', label: 'Success', num: true, fmt: pct },
];
function groupTable(el, id, keyLabel, map, extra = [], opt = {}) {
  const total = S.f.reduce((a, t) => a + V(t), 0);
  const rows = [...map].map(([k, arr]) => Object.assign({ k }, stats(arr), opt.rowExtra ? opt.rowExtra(k, arr) : {})); rows.forEach(r => r.share = total ? r.value / total : 0);
  table(el, id, [{ k: 'k', label: keyLabel, fmt: opt.keyFmt || (x => x), text: opt.keyFmt ? r => opt.keyFmt(r.k) : undefined }, ...valueCols(), ...extra], rows, Object.assign({ sort: 'value', pageSize: 10 }, opt));
  return rows;
}

/* ---------------- Overview ---------------- */
function rOverview() {
  const L = S.f, s = stats(L), total = s.value;
  const tp = throughput(L);
  const bens = [...S.ben.values()].sort((a, b) => b.total - a.total), top10 = bens.slice(0, 10);
  const cross = L.filter(t => t.cross === true), crossV = cross.reduce((a, t) => a + V(t), 0);
  const users = [...S.usr.values()];
  P('overview').innerHTML = `
  ${ledger(
    kpi(cm(total), 'Total value transferred', S.unconverted ? int(S.unconverted) + ' not converted' : 'All currencies converted', true),
    kpi(int(s.n), 'Transactions', int(s.users) + ' users · ' + int(s.bens) + ' beneficiaries'),
    kpi(money(s.avg), 'Average ticket (' + S.rep + ')', 'Median ' + money(quant(L.map(V).sort((a, b) => a - b), .5))),
    kpi(S.has.status ? pct(s.okRate) : '–', 'Success rate', S.has.status ? int(s.fail) + ' failed' : 'No status field'),
    kpi(S.has.fee ? cm(s.fees) : '–', 'Fee revenue', S.has.fee ? 'Take rate ' + bps(s.take) : 'No fee field'),
    kpi(S.has.country ? pct(total ? crossV / total : 0) : '–', 'Cross-border share of value', S.has.country ? int(cross.length) + ' cross-border txns' : 'No country fields'),
    kpi(S.has.dur ? dur(s.avgDur) : '–', 'Average processing time', S.has.dur ? 'p95 ' + dur(s.p95) : 'No timing field'),
    kpi(tp.peak ? int(tp.peak) : '–', 'Peak transactions / second', tp.avg ? nf2v.format(tp.avg) + ' per second on average' : '')
  )}
  <div class="grid">
    <div class="card c8"><h3>Value and volume over time</h3><p class="sub" id="ov-bucket"></p><div class="chart tall"><canvas id="ch-time"></canvas></div></div>
    <div class="card c4"><h3>Key findings</h3><p class="sub">Generated from the filtered data</p><ul class="insights" id="ov-ins"></ul></div>
  </div>
  <div class="grid">
    <div class="card c7"><h3>Top 10 beneficiaries by value received</h3><p class="sub">They receive ${pct(total ? top10.reduce((a, b) => a + b.total, 0) / total : 0)} of all value. Click a bar to open one.</p><div class="chart tall"><canvas id="ch-topben"></canvas></div></div>
    <div class="card c5"><h3>Value by original currency</h3><p class="sub">Converted to ${S.rep}</p><div class="chart tall"><canvas id="ch-curmix"></canvas></div></div>
  </div>
  <div class="grid">
    <div class="card c5"><h3>Status breakdown</h3><p class="sub">${S.has.status ? 'Share of transactions by status' : 'No status field mapped'}</p><div class="chart"><canvas id="ch-status"></canvas></div></div>
    <div class="card c7"><h3>When transactions happen</h3><p class="sub">Count by weekday and hour (your local time)</p><div class="tbl-wrap" style="border:0" id="ov-heat"></div></div>
  </div>
  <div class="grid"><div class="card c12"><h3>Most active users</h3><p class="sub">Click a row to open the user</p><div id="ov-users"></div></div></div>`;
  const bs = bucketSize(L);
  if (bs) {
    $('#ov-bucket').textContent = 'Per ' + bs.label + ', value in ' + S.rep;
    const B = bucketize(L, bs.ms, a => [a.reduce((x, t) => x + V(t), 0), a.length]);
    chart('ch-time', { type: 'bar', data: { labels: B.labels, datasets: [
      { type: 'line', label: 'Value', data: B.vals.map(v => v[0]), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2, tension: .25, yAxisID: 'y' },
      { type: 'bar', label: 'Transactions', data: B.vals.map(v => v[1]), backgroundColor: cssVar('--line'), yAxisID: 'y1' }] },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { position: 'left', ticks: { callback: v => nfc.format(v) } }, y1: { position: 'right', grid: { display: false } } } } });
  }
  chart('ch-topben', { type: 'bar', data: { labels: top10.map(b => b.name || b.key), datasets: [{ label: 'Value received (' + S.rep + ')', data: top10.map(b => b.total), backgroundColor: cssVar('--accent'), borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: c => { const b = top10[c.dataIndex]; return `${int(b.n)} transactions from ${int(b.payerN)} payers`; } } } }, scales: { x: { ticks: { callback: v => nfc.format(v) } }, y: { grid: { display: false } } }, onClick: (e, els) => { if (els.length) openBen(top10[els[0].index].key); } } });
  const cg = [...groupBy(L, t => t.cur || '(none)')].map(([k, a]) => [k, a.reduce((x, t) => x + V(t), 0)]).sort((a, b) => b[1] - a[1]);
  const cgTop = cg.slice(0, 8); if (cg.length > 8) cgTop.push(['Other', cg.slice(8).reduce((a, x) => a + x[1], 0)]);
  chart('ch-curmix', { type: 'doughnut', data: { labels: cgTop.map(x => x[0]), datasets: [{ data: cgTop.map(x => x[1]), backgroundColor: PALETTE(), borderColor: cssVar('--panel'), borderWidth: 2 }] }, options: { cutout: '60%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)} ${S.rep} (${pct(total ? c.raw / total : 0)})` } } } } });
  if (S.has.status) {
    const se = [...groupBy(L, t => t.status)].map(([k, a]) => [k, a.length]).sort((a, b) => b[1] - a[1]);
    const col = s => ({ ok: cssVar('--accent'), fail: cssVar('--bad'), pending: cssVar('--warn'), other: cssVar('--blue') })[outcome(s)];
    chart('ch-status', { type: 'doughnut', data: { labels: se.map(x => x[0]), datasets: [{ data: se.map(x => x[1]), backgroundColor: se.map(x => col(x[0])), borderColor: cssVar('--panel'), borderWidth: 2 }] }, options: { cutout: '62%', plugins: { legend: { position: 'right' } } } });
  }
  const H = Array.from({ length: 7 }, () => Array(24).fill(0)); let hmax = 0;
  L.forEach(t => { if (t.ts == null) return; const d = new Date(t.ts); const v = ++H[(d.getDay() + 6) % 7][d.getHours()]; if (v > hmax) hmax = v; });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], rgb = cssVar('--heat');
  $('#ov-heat').innerHTML = `<table class="heat"><thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ''}</th>`).join('')}</tr></thead><tbody>${H.map((r, i) => `<tr><th>${days[i]}</th>${r.map((v, h) => `<td title="${days[i]} ${h}:00 — ${v} transactions" style="background:rgba(${rgb},${hmax ? (0.06 + 0.94 * v / hmax).toFixed(2) : 0.06})"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const ins = [];
  if (bens[0] && total) ins.push(['', `Largest beneficiary <b>${esc(benLabel(bens[0]))}</b> received ${cm(bens[0].total)} (${pct(bens[0].total / total)} of value) from ${int(bens[0].payerN)} users.`]);
  const busiest = users.slice().sort((a, b) => b.n - a.n)[0]; if (busiest) ins.push(['', `Most active user <b>${esc(busiest.key)}</b> made ${int(busiest.n)} transactions worth ${cm(busiest.total)}.`]);
  if (cg.length > 1 && total) ins.push(['', `${int(cg.length)} currencies in use. ${esc(cg[0][0])} carries ${pct(cg[0][1] / total)} of value; ${pct(1 - (cg.find(x => x[0] === S.rep)?.[1] || 0) / total)} is held in currencies other than ${S.rep}.`]);
  if (S.has.country && cross.length) { const corr = [...groupBy(cross, t => t.sc + ' → ' + t.bc)].map(([k, a]) => [k, a.reduce((x, t) => x + V(t), 0)]).sort((a, b) => b[1] - a[1])[0]; ins.push(['', `Top cross-border corridor is <b>${esc(corr[0])}</b> with ${cm(corr[1])}.`]); }
  if (S.has.status && s.failRate > 0.05) ins.push(['bad', `Failure rate is ${pct(s.failRate)}. See Speed & operations for the main failure reasons.`]);
  if (S.has.dur && s.p50 > 0 && s.p95 / s.p50 > 3) ins.push(['warn', `Slowest 5% take ${dur(s.p95)} or more, ${nf2v.format(s.p95 / s.p50)}× the median.`]);
  const hi = S.flags.filter(f => f.sev === 'high').length; if (hi) ins.push(['bad', `${int(hi)} high-severity risk flags. Open Risk & compliance to review.`]);
  $('#ov-ins').innerHTML = insightsList(ins);
  table($('#ov-users'), 'ov-users', userCols().slice(0, 8), users, { sort: 'n', pageSize: 8, onRow: u => openUser(u.key), file: 'top-users' });
}

/* ---------------- Growth ---------------- */
function rGrowth() {
  const { from, to } = dateRange();
  let end = to, start = from;
  let mx = -Infinity, mn = Infinity; for (const t of S.base) if (t.ts != null) { if (t.ts > mx) mx = t.ts; if (t.ts < mn) mn = t.ts; }
  if (end == null) end = mx; if (start == null) start = Math.max(mn, end - 7 * 86400e3);
  const len = end - start;
  const cur = S.base.filter(t => t.ts != null && t.ts > start && t.ts <= end), prev = S.base.filter(t => t.ts != null && t.ts > start - len && t.ts <= start);
  const a = stats(cur), b = stats(prev);
  const g = (x, y) => y ? (x - y) / y : null;
  const hasPrev = prev.length > 0;
  // first seen per user / ben across all loaded data with current non-date filters
  const firstU = new Map(), firstB = new Map();
  for (const t of S.base) if (t.ts != null) { if (!firstU.has(t.user) || t.ts < firstU.get(t.user)) firstU.set(t.user, t.ts); if (!firstB.has(t.ben) || t.ts < firstB.get(t.ben)) firstB.set(t.ben, t.ts); }
  const users = [...S.usr.values()].sort((x, y) => y.total - x.total), totV = users.reduce((s, u) => s + u.total, 0);
  const shareTop = p => { const n = Math.max(1, Math.round(users.length * p)); return totV ? users.slice(0, n).reduce((s, u) => s + u.total, 0) / totV : 0; };
  const repeat = users.filter(u => u.n > 1).length, multiDay = users.filter(u => u.days > 1).length;
  P('growth').innerHTML = `
  <p class="muted" style="margin:0 0 10px">Comparing ${dtShort(start)} – ${dtShort(end)} with the previous ${dur(len)}.</p>
  ${ledger(
    kpi(cm(a.value), 'Value this period', hasPrev ? growth(g(a.value, b.value)) + ' vs previous' : growth(null), true),
    kpi(int(a.n), 'Transactions', hasPrev ? growth(g(a.n, b.n)) : ''),
    kpi(int(a.users), 'Active users', hasPrev ? growth(g(a.users, b.users)) : ''),
    kpi(money(a.avg), 'Average ticket', hasPrev ? growth(g(a.avg, b.avg)) : ''),
    kpi(S.has.fee ? cm(a.fees) : '–', 'Fee revenue', S.has.fee && hasPrev ? growth(g(a.fees, b.fees)) : ''),
    kpi(int([...firstU.values()].filter(x => x > start && x <= end).length), 'New users in period', int([...firstB.values()].filter(x => x > start && x <= end).length) + ' new beneficiaries')
  )}
  <div class="grid">
    <div class="card c8"><h3>Daily value with 7-day average</h3><p class="sub">Value in ${S.rep} for the filtered period</p><div class="chart tall"><canvas id="ch-daily"></canvas></div></div>
    <div class="card c4"><h3>Customer concentration</h3><p class="sub">How much of the value comes from your biggest users</p>
      <div class="mini" style="flex-direction:column;gap:12px">
        <div><b>${pct(shareTop(0.01))}</b><span>of value from the top 1% of users</span></div>
        <div><b>${pct(shareTop(0.1))}</b><span>from the top 10%</span></div>
        <div><b>${pct(shareTop(0.2))}</b><span>from the top 20%</span></div>
        <div><b>${pct(users.length ? repeat / users.length : 0)}</b><span>of users transacted more than once</span></div>
        <div><b>${pct(users.length ? multiDay / users.length : 0)}</b><span>were active on more than one day</span></div>
      </div></div>
  </div>
  <div class="grid">
    <div class="card c6"><h3>New and returning users per day</h3><p class="sub">A user is new on the day of their first transaction in the loaded data</p><div class="chart"><canvas id="ch-newret"></canvas></div></div>
    <div class="card c6"><h3>Cumulative share of value</h3><p class="sub">Users ranked by value sent (Pareto curve)</p><div class="chart"><canvas id="ch-pareto"></canvas></div></div>
  </div>
  <div class="grid"><div class="card c12"><h3>Performance by day of week</h3><p class="sub">Plan staffing, liquidity and maintenance windows</p><div id="gr-dow"></div></div></div>`;
  const days = bucketize(S.f, 86400e3, arr => ({ v: arr.reduce((s, t) => s + V(t), 0), arr }));
  const vals = days.vals.map(x => x.v), ma = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1); return w.reduce((s, x) => s + x, 0) / w.length; });
  chart('ch-daily', { type: 'bar', data: { labels: days.labels, datasets: [{ type: 'line', label: '7-day average', data: ma, borderColor: cssVar('--gold'), backgroundColor: cssVar('--gold'), pointRadius: 0, borderWidth: 2, tension: .3 }, { label: 'Daily value', data: vals, backgroundColor: cssVar('--accent'), borderRadius: 2 }] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { ticks: { callback: v => nfc.format(v) } } } } });
  const nr = days.vals.map((x, i) => { const dStart = days.keys[i], dEnd = dStart + 86400e3; const us = new Set(x.arr.map(t => t.user)); let n = 0; us.forEach(u => { const f = firstU.get(u); if (f >= dStart && f < dEnd) n++; }); return [n, us.size - n]; });
  chart('ch-newret', { type: 'bar', data: { labels: days.labels, datasets: [{ label: 'New', data: nr.map(x => x[0]), backgroundColor: cssVar('--accent'), stack: 's' }, { label: 'Returning', data: nr.map(x => x[1]), backgroundColor: cssVar('--blue'), stack: 's' }] }, options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { stacked: true, ticks: { precision: 0 } } } } });
  const steps = 50, curve = Array.from({ length: steps + 1 }, (_, i) => { const n = Math.round(users.length * i / steps); return totV ? users.slice(0, n).reduce((s, u) => s + u.total, 0) / totV * 100 : 0; });
  chart('ch-pareto', { type: 'line', data: { labels: curve.map((_, i) => Math.round(i * 100 / steps) + '%'), datasets: [{ label: 'Share of value', data: curve, borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent-soft'), fill: true, pointRadius: 0, borderWidth: 2 }, { label: 'Equal distribution', data: curve.map((_, i) => i * 100 / steps), borderColor: cssVar('--line'), pointRadius: 0, borderDash: [4, 4], borderWidth: 1 }] }, options: { scales: { x: { title: { display: true, text: 'Top % of users' }, ticks: { maxTicksLimit: 6 } }, y: { max: 100, ticks: { callback: v => v + '%' } } } } });
  const dn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  groupTable($('#gr-dow'), 'gr-dow', 'Day', groupBy(S.f.filter(t => t.ts != null), t => dn[(new Date(t.ts).getDay() + 6) % 7]), [{ k: 'avgDur', label: 'Avg processing', num: true, fmt: dur }], { search: false, sort: 'value' });
}

/* ---------------- Beneficiaries ---------------- */
function rBens() {
  const bens = [...S.ben.values()], total = bens.reduce((a, b) => a + b.total, 0);
  bens.forEach(b => b.share = total ? b.total / total : 0);
  const sorted = bens.slice().sort((a, b) => b.total - a.total);
  const hhi = bens.reduce((a, b) => a + (b.share * 100) ** 2, 0);
  const shared = bens.filter(b => b.payerN >= 2).sort((a, b) => b.payerN - a.payerN || b.total - a.total);
  P('bens').innerHTML = `
  ${ledger(
    kpi(int(bens.length), 'Beneficiaries paid', '', true),
    kpi(sorted[0] ? pct(sorted[0].share) : '–', 'Share of the largest', sorted[0] ? esc(sorted[0].name || sorted[0].key) : ''),
    kpi(pct(sorted.slice(0, 10).reduce((a, b) => a + b.share, 0)), 'Share of the top 10'),
    kpi(int(shared.length), 'Paid by 2+ users'),
    kpi(int(hhi), 'Concentration index (HHI)', hhi > 2500 ? 'Highly concentrated' : hhi > 1500 ? 'Moderately concentrated' : 'Spread out')
  )}
  <div id="ben-detail"></div>
  <div class="grid"><div class="card c12"><h3>All beneficiaries</h3><p class="sub">Who receives the most money. Click a row to see every user who paid them.</p><div id="ben-tbl"></div></div></div>
  <div class="grid">
    <div class="card c7"><h3>Beneficiaries shared by multiple users</h3><p class="sub">The same beneficiary receiving from several different senders</p><div id="ben-shared"></div></div>
    <div class="card c5"><h3>Beneficiary banks</h3><p class="sub">${S.has.bank ? 'Where the money lands' : 'No beneficiary bank field mapped'}</p><div id="ben-banks"></div></div>
  </div>`;
  table($('#ben-tbl'), 'bens', [
    { k: 'key', label: 'Beneficiary' }, { k: 'name', label: 'Name' }, { k: 'cc', label: 'Country' }, { k: 'bank', label: 'Bank' },
    { k: 'total', label: `Received (${S.rep})`, num: true, fmt: money, bar: true }, { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.total },
    { k: 'n', label: 'Transactions', num: true, fmt: int }, { k: 'payerN', label: 'Distinct payers', num: true, fmt: int },
    { k: 'avg', label: 'Average', num: true, fmt: money }, { k: 'max', label: 'Largest', num: true, fmt: money },
    { k: 'first', label: 'First seen', fmt: v => isFinite(v) ? dtShort(v) : '–', csv: v => iso(v) }, { k: 'last', label: 'Last seen', fmt: v => isFinite(v) ? dtShort(v) : '–', csv: v => iso(v) }
  ], bens, { sort: 'total', onRow: b => openBen(b.key), isSel: b => b.key === S.selBen, file: 'beneficiaries' });
  shared.forEach(b => b.payersTxt = [...b.payers.values()].sort((x, y) => y.total - x.total).map(x => x.user).join(', '));
  table($('#ben-shared'), 'ben-shared', [
    { k: 'key', label: 'Beneficiary' }, { k: 'name', label: 'Name' }, { k: 'payerN', label: 'Payers', num: true, fmt: int, bar: true },
    { k: 'total', label: `Received (${S.rep})`, num: true, fmt: money },
    { k: 'payersTxt', label: 'Paid by', html: r => esc(r.payersTxt.length > 60 ? r.payersTxt.slice(0, 60) + '…' : r.payersTxt), text: r => r.payersTxt }
  ], shared, { sort: 'payerN', pageSize: 10, onRow: b => openBen(b.key), file: 'shared-beneficiaries' });
  if (S.has.bank) groupTable($('#ben-banks'), 'ben-banks', 'Bank', groupBy(S.f, t => t.bank || '(blank)'), [], { pageSize: 10 });
  if (S.selBen) renderBenDetail();
}
function renderBenDetail() {
  const box = $('#ben-detail'), b = S.ben.get(S.selBen); if (!box) return; if (!b) { box.innerHTML = ''; return; }
  const payers = [...b.payers.values()]; payers.forEach(x => { x.share = b.total ? x.total / b.total : 0; x.avg = x.total / x.n; });
  box.innerHTML = `<div class="grid"><div class="card c12 detail">
    <div class="detail-head"><div><h3>${esc(benLabel(b))}</h3><p class="sub">${esc([b.bank, b.cc && cname(b.cc)].filter(Boolean).join(' · ') || 'Beneficiary detail')} · current filters</p></div><button class="btn btn-line" id="ben-close">Close</button></div>
    <div class="mini">
      <div><b>${cm(b.total)}</b><span>Total received</span></div><div><b>${int(b.n)}</b><span>Transactions</span></div>
      <div><b>${int(b.payerN)}</b><span>Distinct payers</span></div><div><b>${money(b.avg)}</b><span>Average payment</span></div>
      <div><b>${money(b.max)}</b><span>Largest payment</span></div><div><b>${S.has.status ? pct(b.ok / b.n) : '–'}</b><span>Successful</span></div>
    </div>
    <div class="grid" style="margin:0"><div class="c7"><div id="ben-payers"></div></div><div class="c5"><div class="chart"><canvas id="ch-ben"></canvas></div></div></div>
  </div></div>`;
  $('#ben-close').onclick = () => { S.selBen = null; S.dirty.add('bens'); render(); };
  table($('#ben-payers'), 'ben-payers-' + b.key, [
    { k: 'user', label: 'User who paid' }, { k: 'total', label: `Amount (${S.rep})`, num: true, fmt: money, bar: true }, { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.total },
    { k: 'n', label: 'Transactions', num: true, fmt: int }, { k: 'avg', label: 'Average', num: true, fmt: money }, { k: 'last', label: 'Last payment', fmt: v => isFinite(v) ? dtShort(v) : '–', csv: v => iso(v) }
  ], payers, { sort: 'total', pageSize: 8, onRow: x => openUser(x.user), file: 'payers-of-' + b.key });
  const bs = bucketSize(b.list); if (bs) { const B = bucketize(b.list, bs.ms, a => a.reduce((s, t) => s + V(t), 0)); chart('ch-ben', { type: 'bar', data: { labels: B.labels, datasets: [{ label: 'Received per ' + bs.label, data: B.vals, backgroundColor: cssVar('--accent'), borderRadius: 2 }] }, options: { scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { callback: v => nfc.format(v) } } } } }); }
}
function openBen(key) { S.selBen = key; switchTab('bens'); S.dirty.add('bens'); render(); setTimeout(() => $('#ben-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }

/* ---------------- Users ---------------- */
function userCols() {
  return [
    { k: 'key', label: 'User' }, { k: 'n', label: 'Transactions', num: true, fmt: int, bar: true },
    { k: 'total', label: `Total sent (${S.rep})`, num: true, fmt: money }, { k: 'avg', label: 'Average', num: true, fmt: money },
    { k: 'benN', label: 'Beneficiaries', num: true, fmt: int }, { k: 'peakSec', label: 'Peak / second', num: true, fmt: int },
    { k: 'peakMin', label: 'Peak / minute', num: true, fmt: int }, { k: 'avgGap', label: 'Avg gap', num: true, fmt: dur },
    { k: 'rate', label: 'Txns / second (overall)', num: true, fmt: v => v == null ? '–' : v < 0.01 ? v.toExponential(1) : nf2v.format(v) },
    { k: 'okRate', label: 'Success', num: true, fmt: pct }, { k: 'avgDur', label: 'Avg processing', num: true, fmt: dur },
    { k: 'curList', label: 'Currencies' }, { k: 'cc', label: 'Country' }
  ];
}
function rUsers() {
  const users = [...S.usr.values()], counts = users.map(u => u.n).sort((a, b) => a - b), top = users.slice().sort((a, b) => b.n - a.n).slice(0, 15);
  P('users').innerHTML = `
  ${ledger(
    kpi(int(users.length), 'Users sending', '', true),
    kpi(nf2v.format(users.length ? S.f.length / users.length : 0), 'Transactions per user', 'Median ' + int(quant(counts, .5))),
    kpi(cm(users.length ? users.reduce((a, u) => a + u.total, 0) / users.length : 0), 'Value per user'),
    kpi(int(users.length ? Math.max(...users.map(u => u.peakSec)) : 0), 'Highest per-second burst'),
    kpi(nf2v.format(users.length ? users.reduce((a, u) => a + u.benN, 0) / users.length : 0), 'Beneficiaries per user')
  )}
  <div id="user-detail"></div>
  <div class="grid"><div class="card c12"><h3>Transactions per user</h3><p class="sub">The 15 most active users</p><div class="chart"><canvas id="ch-users"></canvas></div></div></div>
  <div class="grid"><div class="card c12"><h3>All users</h3><p class="sub">“Peak / second” is the most transactions a user made within one second. “Txns / second (overall)” is their count divided by the time between their first and last transaction.</p><div id="user-tbl"></div></div></div>`;
  chart('ch-users', { type: 'bar', data: { labels: top.map(u => u.key), datasets: [{ label: 'Transactions', data: top.map(u => u.n), backgroundColor: cssVar('--blue'), borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: {} }, onClick: (e, els) => { if (els.length) openUser(top[els[0].index].key); } } });
  table($('#user-tbl'), 'users', userCols(), users, { sort: 'n', onRow: u => openUser(u.key), isSel: u => u.key === S.selUser, file: 'users' });
  if (S.selUser) renderUserDetail();
}
function renderUserDetail() {
  const box = $('#user-detail'), u = S.usr.get(S.selUser); if (!box) return; if (!u) { box.innerHTML = ''; return; }
  const bens = [...u.bens.values()]; bens.forEach(b => { b.share = u.total ? b.total / u.total : 0; const B = S.ben.get(b.ben); b.otherPayers = B ? B.payerN - 1 : 0; });
  box.innerHTML = `<div class="grid"><div class="card c12 detail">
    <div class="detail-head"><div><h3>User ${esc(u.key)}</h3><p class="sub">${u.cc ? esc(cname(u.cc)) + ' · ' : ''}current filters</p></div><button class="btn btn-line" id="user-close">Close</button></div>
    <div class="mini">
      <div><b>${int(u.n)}</b><span>Transactions</span></div><div><b>${cm(u.total)}</b><span>Total sent</span></div>
      <div><b>${int(u.benN)}</b><span>Beneficiaries</span></div><div><b>${int(u.peakSec)}</b><span>Peak per second</span></div>
      <div><b>${dur(u.avgGap)}</b><span>Average gap</span></div><div><b>${dur(u.avgDur)}</b><span>Avg processing</span></div>
      <div><b>${int(u.fail)}</b><span>Failed</span></div>${S.has.fee ? `<div><b>${money(u.fees)}</b><span>Fees paid</span></div>` : ''}
    </div>
    <div class="grid" style="margin:0"><div class="c7"><div id="user-bens"></div></div><div class="c5"><div class="chart"><canvas id="ch-user"></canvas></div></div></div>
  </div></div>`;
  $('#user-close').onclick = () => { S.selUser = null; S.dirty.add('users'); render(); };
  table($('#user-bens'), 'user-bens-' + u.key, [
    { k: 'ben', label: 'Beneficiary' }, { k: 'name', label: 'Name' }, { k: 'cc', label: 'Country' }, { k: 'total', label: `Amount (${S.rep})`, num: true, fmt: money, bar: true },
    { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.total }, { k: 'n', label: 'Txns', num: true, fmt: int }, { k: 'otherPayers', label: 'Other users paying them', num: true, fmt: int }
  ], bens, { sort: 'total', pageSize: 8, onRow: b => openBen(b.ben), file: 'beneficiaries-of-' + u.key });
  const hrs = Array(24).fill(0); u.list.forEach(t => { if (t.ts != null) hrs[new Date(t.ts).getHours()]++; });
  chart('ch-user', { type: 'bar', data: { labels: hrs.map((_, h) => h + ':00'), datasets: [{ label: 'Transactions by hour of day', data: hrs, backgroundColor: cssVar('--blue'), borderRadius: 2 }] }, options: { scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { precision: 0 } } } } });
}
function openUser(key) { S.selUser = key; switchTab('users'); S.dirty.add('users'); render(); setTimeout(() => $('#user-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }

/* ---------------- Currencies ---------------- */
function rFx() {
  const fx = S.data.fx, L = S.f, total = L.reduce((a, t) => a + V(t), 0);
  const by = groupBy(L, t => t.cur || '(none)');
  const rows = [...by].map(([c, arr]) => {
    const conv = arr.filter(t => t.v != null), orig = arr.reduce((s, t) => s + (t.amount || 0), 0), val = conv.reduce((s, t) => s + t.v, 0);
    return { cur: c, name: S.names[c] || '', n: arr.length, orig, value: val, share: total ? val / total : 0, avgOrig: arr.length ? orig / arr.length : 0, avgRep: conv.length ? val / conv.length : null, rate: S.rates[c] && S.rates[S.rep] ? S.rates[c] / S.rates[S.rep] : null, src: S.rateSrc[c] || 'missing', users: new Set(arr.map(t => t.user)).size };
  });
  const foreign = rows.filter(r => r.cur !== S.rep).reduce((s, r) => s + r.value, 0);
  const top = rows.slice().sort((a, b) => b.value - a.value);
  P('fx').innerHTML = `
  <div class="note info">Amounts are converted at the current rate, not the rate on the transaction date. Rates: ${esc(fx.provider === 'manual' ? 'set manually by an admin' : fx.provider || 'built-in approximate values')}${fx.updatedAt ? ', updated ' + ago(fx.updatedAt) : ''}.</div>
  ${ledger(
    kpi(int(rows.length), 'Currencies in use', '', true),
    kpi(pct(total ? foreign / total : 0), `Value not in ${S.rep}`, cm(foreign) + ' FX exposure'),
    kpi(top[0] ? esc(top[0].cur) : '–', 'Largest currency', top[0] ? pct(top[0].share) + ' of value' : ''),
    kpi(int(S.unconverted), 'Transactions without a rate', S.unconverted ? 'Excluded from totals' : 'All converted'),
    kpi(fx.updatedAt ? ago(fx.updatedAt) : 'Built-in', 'Rates last updated', fx.error ? 'Last update failed' : '')
  )}
  <div class="grid">
    <div class="card c6"><h3>Value by currency</h3><p class="sub">Converted to ${S.rep}</p><div class="chart"><canvas id="ch-fxbar"></canvas></div></div>
    <div class="card c6"><h3>Daily value of the top 5 currencies</h3><p class="sub">Converted to ${S.rep}</p><div class="chart"><canvas id="ch-fxtime"></canvas></div></div>
  </div>
  <div class="grid"><div class="card c12"><h3>Currency breakdown</h3><p class="sub">Original amounts next to converted values. Rate shows units of the currency per 1 ${S.rep}.</p><div id="fx-tbl"></div></div></div>
  <div class="grid"><div class="card c12"><h3>Currency by beneficiary country</h3><p class="sub">${S.has.country ? 'Which currencies fund each destination' : 'No beneficiary country field mapped'}</p><div id="fx-dest"></div></div></div>`;
  chart('ch-fxbar', { type: 'bar', data: { labels: top.map(r => r.cur), datasets: [{ label: 'Value (' + S.rep + ')', data: top.map(r => r.value), backgroundColor: cssVar('--accent'), borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => nfc.format(v) } } } } });
  const t5 = top.slice(0, 5).map(r => r.cur), pal = PALETTE();
  const days = bucketize(L, 86400e3, arr => arr);
  chart('ch-fxtime', { type: 'line', data: { labels: days.labels, datasets: t5.map((c, i) => ({ label: c, data: days.vals.map(a => a.filter(t => (t.cur || '(none)') === c).reduce((s, t) => s + V(t), 0)), borderColor: pal[i], backgroundColor: pal[i], pointRadius: 0, borderWidth: 2, tension: .25 })) }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { callback: v => nfc.format(v) } } } } });
  table($('#fx-tbl'), 'fx-tbl', [
    { k: 'cur', label: 'Currency' }, { k: 'name', label: 'Name' }, { k: 'n', label: 'Transactions', num: true, fmt: int },
    { k: 'orig', label: 'Original amount', num: true, fmt: money }, { k: 'value', label: `Value (${S.rep})`, num: true, fmt: money, bar: true },
    { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.value }, { k: 'avgOrig', label: 'Avg ticket (original)', num: true, fmt: money },
    { k: 'avgRep', label: `Avg ticket (${S.rep})`, num: true, fmt: money }, { k: 'users', label: 'Users', num: true, fmt: int },
    { k: 'rate', label: `Rate per 1 ${S.rep}`, num: true, fmt: v => v == null ? 'No rate' : nfr.format(v) }, { k: 'src', label: 'Rate source' }
  ], rows, { sort: 'value', file: 'currencies' });
  if (S.has.country) {
    const m = groupBy(L.filter(t => t.bc), t => t.bc);
    const rr = [...m].map(([cc, arr]) => { const s = stats(arr); const mix = [...groupBy(arr, t => t.cur)].map(([c, a]) => [c, a.reduce((x, t) => x + V(t), 0)]).sort((a, b) => b[1] - a[1]); return { cc, n: s.n, value: s.value, mix: mix.map(([c, v]) => `${c} ${pct(s.value ? v / s.value : 0)}`).join(', ') }; });
    table($('#fx-dest'), 'fx-dest', [{ k: 'cc', label: 'Beneficiary country', fmt: cname, text: r => cname(r.cc) }, { k: 'n', label: 'Transactions', num: true, fmt: int }, { k: 'value', label: `Value (${S.rep})`, num: true, fmt: money, bar: true }, { k: 'mix', label: 'Currency mix', wrap: true }], rr, { sort: 'value', pageSize: 10, file: 'currency-by-destination' });
  }
}

/* ---------------- Corridors ---------------- */
function rCorr() {
  const p = P('corr');
  if (!S.has.country) { p.innerHTML = needs('country', 'Corridor analysis needs sender and beneficiary country fields.'); return; }
  const L = S.f, total = L.reduce((a, t) => a + V(t), 0);
  const cross = L.filter(t => t.cross === true), dom = L.filter(t => t.cross === false);
  const hr = new Set(S.risk.highRiskCountries || []), hrT = L.filter(t => hr.has(t.bc) || hr.has(t.sc));
  const corr = groupBy(L.filter(t => t.sc && t.bc), t => t.sc + ' → ' + t.bc);
  const cr = [...corr].map(([k, a]) => [k, a.reduce((s, t) => s + V(t), 0)]).sort((a, b) => b[1] - a[1]);
  const cs = stats(cross), ds = stats(dom);
  p.innerHTML = `
  ${ledger(
    kpi(int(corr.size), 'Active corridors', '', true),
    kpi(pct(total ? cs.value / total : 0), 'Cross-border share of value', int(cs.n) + ' transactions'),
    kpi(cr[0] ? esc(cr[0][0]) : '–', 'Top corridor', cr[0] ? cm(cr[0][1]) : ''),
    kpi(money(cs.avg), 'Cross-border avg ticket', 'Domestic ' + money(ds.avg)),
    kpi(S.has.status ? pct(cs.okRate) : '–', 'Cross-border success', S.has.status ? 'Domestic ' + pct(ds.okRate) : ''),
    kpi(cm(hrT.reduce((s, t) => s + V(t), 0)), 'High-risk jurisdiction exposure', int(hrT.length) + ' transactions')
  )}
  <div class="grid">
    <div class="card c7"><h3>Top 10 corridors by value</h3><p class="sub">Sender country → beneficiary country</p><div class="chart tall"><canvas id="ch-corr"></canvas></div></div>
    <div class="card c5"><h3>Cross-border compared with domestic</h3><p class="sub">Side by side</p><div id="corr-cmp"></div></div>
  </div>
  <div class="grid"><div class="card c12"><h3>All corridors</h3><p class="sub">Volume, speed, reliability and pricing per route</p><div id="corr-tbl"></div></div></div>
  <div class="grid">
    <div class="card c6"><h3>Inbound by beneficiary country</h3><p class="sub">Where money is going</p><div id="corr-in"></div></div>
    <div class="card c6"><h3>Outbound by sender country</h3><p class="sub">Where money comes from</p><div id="corr-out"></div></div>
  </div>`;
  const t10 = cr.slice(0, 10);
  chart('ch-corr', { type: 'bar', data: { labels: t10.map(x => x[0]), datasets: [{ label: 'Value (' + S.rep + ')', data: t10.map(x => x[1]), backgroundColor: t10.map(x => { const [a, b] = x[0].split(' → '); return hr.has(a) || hr.has(b) ? cssVar('--bad') : a === b ? cssVar('--blue') : cssVar('--accent'); }), borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => nfc.format(v) } }, y: { grid: { display: false } } } } });
  const cmpRows = [['Transactions', int(cs.n), int(ds.n)], [`Value (${S.rep})`, moneyC(cs.value), moneyC(ds.value)], ['Average ticket', money(cs.avg), money(ds.avg)], ['Success rate', pct(cs.okRate), pct(ds.okRate)], ['Avg processing', dur(cs.avgDur), dur(ds.avgDur)], ['Take rate', bps(cs.take), bps(ds.take)]];
  $('#corr-cmp').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th></th><th class="num">Cross-border</th><th class="num">Domestic</th></tr></thead><tbody>${cmpRows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody></table></div>`;
  groupTable($('#corr-tbl'), 'corr-tbl', 'Corridor', corr, [
    { k: 'users', label: 'Senders', num: true, fmt: int }, { k: 'avgDur', label: 'Avg processing', num: true, fmt: dur },
    { k: 'take', label: 'Take rate', num: true, fmt: bps }, { k: 'risk', label: 'Risk', html: r => r.risk ? '<span class="sev-high">High-risk country</span>' : '', text: r => r.risk ? 'High-risk' : '' }
  ], { pageSize: 15, rowExtra: k => { const [a, b] = k.split(' → '); return { risk: hr.has(a) || hr.has(b) }; }, file: 'corridors' });
  groupTable($('#corr-in'), 'corr-in', 'Country', groupBy(L.filter(t => t.bc), t => t.bc), [], { keyFmt: cname, file: 'inbound-countries' });
  groupTable($('#corr-out'), 'corr-out', 'Country', groupBy(L.filter(t => t.sc), t => t.sc), [], { keyFmt: cname, file: 'outbound-countries' });
}

/* ---------------- Fees & revenue ---------------- */
function rFees() {
  const p = P('fees');
  if (!S.has.fee) { p.innerHTML = needs('fee', 'Fee and revenue analysis needs a fee field (fee, charges or commission).'); return; }
  const L = S.f, s = stats(L), okT = L.filter(t => t.oc === 'ok' || !S.has.status);
  const charged = L.filter(t => t.fv > 0), free = okT.filter(t => !t.fv);
  const failedV = L.filter(t => t.oc === 'fail').reduce((a, t) => a + V(t), 0), lost = s.take ? failedV * s.take : null;
  const cross = L.filter(t => t.cross === true), crossFees = cross.reduce((a, t) => a + (t.fv || 0), 0);
  P('fees').innerHTML = `
  ${ledger(
    kpi(cm(s.fees), 'Fee revenue', '', true),
    kpi(bps(s.take), 'Take rate', 'Fees ÷ successful value'),
    kpi(money(charged.length ? s.fees / charged.length : 0), 'Average fee per charged txn', int(charged.length) + ' transactions charged'),
    kpi(pct(s.fees ? crossFees / s.fees : 0), 'Revenue from cross-border', S.has.country ? '' : 'No country fields'),
    kpi(int(free.length), 'Successful txns with no fee', pct(okT.length ? free.length / okT.length : 0) + ' of successful'),
    kpi(lost != null && S.has.status ? cm(lost) : '–', 'Revenue lost to failures (est.)', 'Failed value × take rate')
  )}
  <div class="grid">
    <div class="card c8"><h3>Fee revenue over time</h3><p class="sub" id="fee-bucket"></p><div class="chart tall"><canvas id="ch-fees"></canvas></div></div>
    <div class="card c4"><h3>Revenue findings</h3><p class="sub">What the pricing data shows</p><ul class="insights" id="fee-ins"></ul></div>
  </div>
  <div class="grid">
    <div class="card c6"><h3>By channel</h3><p class="sub">Revenue and pricing per channel</p><div id="fee-ch"></div></div>
    <div class="card c6"><h3>By currency</h3><p class="sub">Revenue and pricing per currency</p><div id="fee-cur"></div></div>
  </div>
  <div class="grid">
    <div class="card c6"><h3>By corridor</h3><p class="sub">${S.has.country ? 'Revenue per route' : 'No country fields'}</p><div id="fee-corr"></div></div>
    <div class="card c6"><h3>Top fee-paying users</h3><p class="sub">Your most valuable customers by revenue</p><div id="fee-users"></div></div>
  </div>`;
  const bs = bucketSize(L);
  if (bs) { $('#fee-bucket').textContent = 'Per ' + bs.label + ' in ' + S.rep; const B = bucketize(L, bs.ms, a => { const f = a.reduce((x, t) => x + (t.fv || 0), 0), v = a.filter(t => t.oc === 'ok' || !S.has.status).reduce((x, t) => x + V(t), 0); return [f, v ? f / v * 10000 : null]; });
    chart('ch-fees', { type: 'bar', data: { labels: B.labels, datasets: [{ type: 'line', label: 'Take rate (bps)', data: B.vals.map(v => v[1]), borderColor: cssVar('--gold'), backgroundColor: cssVar('--gold'), pointRadius: 0, borderWidth: 2, yAxisID: 'y1', spanGaps: true }, { label: 'Fees', data: B.vals.map(v => v[0]), backgroundColor: cssVar('--accent'), borderRadius: 2, yAxisID: 'y' }] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 }, grid: { display: false } }, y: { ticks: { callback: v => nfc.format(v) } }, y1: { position: 'right', grid: { display: false } } } } }); }
  const feeCols = [{ k: 'fees', label: `Fees (${S.rep})`, num: true, fmt: money, bar: true }, { k: 'take', label: 'Take rate', num: true, fmt: bps }];
  const chRows = S.has.channel ? groupTable($('#fee-ch'), 'fee-ch', 'Channel', groupBy(L, t => t.channel || '(blank)'), feeCols, { search: false, sort: 'fees' }) : ($('#fee-ch').innerHTML = '<p class="muted">No channel field mapped.</p>', []);
  groupTable($('#fee-cur'), 'fee-cur', 'Currency', groupBy(L, t => t.cur || '(none)'), feeCols, { search: false, sort: 'fees' });
  const coRows = S.has.country ? groupTable($('#fee-corr'), 'fee-corr', 'Corridor', groupBy(L.filter(t => t.sc && t.bc), t => t.sc + ' → ' + t.bc), feeCols, { sort: 'fees' }) : [];
  table($('#fee-users'), 'fee-users', [{ k: 'key', label: 'User' }, { k: 'fees', label: `Fees (${S.rep})`, num: true, fmt: money, bar: true }, { k: 'n', label: 'Txns', num: true, fmt: int }, { k: 'total', label: `Value (${S.rep})`, num: true, fmt: money }], [...S.usr.values()], { sort: 'fees', pageSize: 10, onRow: u => openUser(u.key), file: 'fee-users' });
  const ins = [];
  const users = [...S.usr.values()].sort((a, b) => b.fees - a.fees), n10 = Math.max(1, Math.round(users.length * 0.1));
  if (s.fees) ins.push(['', `The top 10% of users generate ${pct(users.slice(0, n10).reduce((a, u) => a + u.fees, 0) / s.fees)} of fee revenue.`]);
  const chs = chRows.filter(r => r.take != null && r.n >= 20).sort((a, b) => b.take - a.take);
  if (chs.length > 1) ins.push(['', `${esc(chs[0].k)} has the highest take rate (${bps(chs[0].take)}); ${esc(chs[chs.length - 1].k)} the lowest (${bps(chs[chs.length - 1].take)}).`]);
  const cos = coRows.filter(r => r.take != null && r.n >= 20).sort((a, b) => b.value - a.value);
  if (cos[0]) ins.push(['', `Largest corridor ${esc(cos[0].k)} earns ${bps(cos[0].take)} on ${cm(cos[0].value)}.`]);
  if (lost && S.has.status) ins.push([lost > s.fees * 0.03 ? 'warn' : '', `Failed transactions cost an estimated ${cm(lost)} in fees. Reducing failures is direct revenue.`]);
  if (free.length > okT.length * 0.2) ins.push(['warn', `${pct(free.length / okT.length)} of successful transactions carry no fee. Check whether that is intended (promotions, fee waivers) or a pricing gap.`]);
  $('#fee-ins').innerHTML = insightsList(ins);
}

/* ---------------- Speed & operations ---------------- */
function rOps() {
  const L = S.f, D = L.filter(t => t.dur != null), ds = D.map(t => t.dur).sort((a, b) => a - b), s = stats(L), tp = throughput(L);
  const now = Date.now(), pend = L.filter(t => t.oc === 'pending'), stuck = pend.filter(t => t.ts != null && now - t.ts > S.risk.pendingAgeMins * 60e3);
  const latCols = [{ k: 'k', label: 'Group' }, { k: 'n', label: 'Transactions', num: true, fmt: int }, { k: 'avgDur', label: 'Average', num: true, fmt: dur, bar: true }, { k: 'p50', label: 'Median', num: true, fmt: dur }, { k: 'p95', label: 'p95', num: true, fmt: dur }, { k: 'max', label: 'Slowest', num: true, fmt: dur }, { k: 'okRate', label: 'Success', num: true, fmt: pct }];
  P('ops').innerHTML = `
  ${S.has.dur ? '' : '<div class="note">No processing time found. Map a duration field or a completed-time field to unlock latency reports. Throughput still works from start times.</div>'}
  ${ledger(
    kpi(dur(s.avgDur), 'Average processing time', '', true), kpi(dur(quant(ds, .5)), 'Median (p50)'), kpi(dur(quant(ds, .9)), 'p90'),
    kpi(dur(quant(ds, .95)), 'p95'), kpi(dur(quant(ds, .99)), 'p99'), kpi(dur(ds[ds.length - 1]), 'Slowest')
  )}
  ${ledger(
    kpi(tp.peak ? int(tp.peak) : '–', 'Peak transactions / second', tp.peakAt ? dt(tp.peakAt) : '', true),
    kpi(tp.avg ? nf2v.format(tp.avg) : '–', 'Average per second', 'Across the whole period'),
    kpi(int(tp.peakMin), 'Peak per minute', tp.peakMinAt ? dtShort(tp.peakMinAt) : ''),
    kpi(S.has.status ? pct(s.okRate) : '–', 'Success rate', S.has.status ? int(s.fail) + ' failed' : ''),
    kpi(int(pend.length), 'Pending now', int(stuck.length) + ` older than ${S.risk.pendingAgeMins} min`),
    kpi(dur(tp.avgGap), 'Average time between transactions', 'System-wide')
  )}
  <div class="grid">
    <div class="card c7"><h3>Throughput over time</h3><p class="sub" id="op-bucket"></p><div class="chart tall"><canvas id="ch-tps"></canvas></div></div>
    <div class="card c5"><h3>How to make it faster</h3><p class="sub">What this data suggests</p><ul class="insights" id="op-ins"></ul></div>
  </div>
  <div class="grid">
    <div class="card c6"><h3>Processing time by hour of day</h3><p class="sub">Does speed drop when load rises?</p><div class="chart"><canvas id="ch-lathr"></canvas></div></div>
    <div class="card c6"><h3>Failure reasons</h3><p class="sub">${S.has.reason ? 'Why transactions fail, and how long users wait to find out' : 'No failure reason field mapped'}</p><div id="op-reasons"></div></div>
  </div>
  <div class="grid">
    <div class="card c6"><h3>Speed and success by channel</h3><p class="sub">${S.has.channel ? 'Which channel is slowest or least reliable' : 'No channel field mapped'}</p><div id="op-ch"></div></div>
    <div class="card c6"><h3>Speed by status</h3><p class="sub">Slow failures often mean timeouts</p><div id="op-st"></div></div>
  </div>
  <div class="grid"><div class="card c12"><h3>Stuck pending transactions</h3><p class="sub">Pending for more than ${S.risk.pendingAgeMins} minutes. Chase these with the processor or partner bank.</p><div id="op-stuck"></div></div></div>
  <div class="grid"><div class="card c12"><h3>Slowest transactions</h3><p class="sub">Start here when investigating delays</p><div id="op-slow"></div></div></div>`;
  const bs = bucketSize(L);
  if (bs) { $('#op-bucket').textContent = `Peak and average transactions per second, per ${bs.label}`;
    const B = bucketize(L, bs.ms, arr => { const ps = perSecond(arr); let pk = 0; ps.forEach(v => { if (v > pk) pk = v; }); return [pk, arr.length / (bs.ms / 1000)]; });
    chart('ch-tps', { type: 'line', data: { labels: B.labels, datasets: [{ label: 'Peak per second', data: B.vals.map(v => v[0]), borderColor: cssVar('--warn'), backgroundColor: cssVar('--warn'), pointRadius: 0, borderWidth: 2, stepped: true }, { label: 'Average per second', data: B.vals.map(v => +v[1].toFixed(4)), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2, tension: .2 }] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true } } } }); }
  const hrs = Array.from({ length: 24 }, () => []), cnt = Array(24).fill(0);
  D.forEach(t => { if (t.ts != null) hrs[new Date(t.ts).getHours()].push(t.dur); }); L.forEach(t => { if (t.ts != null) cnt[new Date(t.ts).getHours()]++; });
  if (ds.length) chart('ch-lathr', { type: 'bar', data: { labels: hrs.map((_, h) => h + ':00'), datasets: [
    { type: 'line', label: 'Average', data: hrs.map(a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), pointRadius: 2, yAxisID: 'y', spanGaps: true },
    { type: 'line', label: 'p95', data: hrs.map(a => a.length ? Math.round(quant(a.slice().sort((x, y) => x - y), .95)) : null), borderColor: cssVar('--warn'), backgroundColor: cssVar('--warn'), pointRadius: 2, borderDash: [4, 3], yAxisID: 'y', spanGaps: true },
    { type: 'bar', label: 'Transactions', data: cnt, backgroundColor: cssVar('--line'), yAxisID: 'y1' }] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y' ? `${c.dataset.label}: ${dur(c.raw)}` : `${c.dataset.label}: ${int(c.raw)}` } } }, scales: { x: { ticks: { maxTicksLimit: 12 }, grid: { display: false } }, y: { ticks: { callback: v => dur(v) } }, y1: { position: 'right', grid: { display: false } } } } });
  let reasonRows = [];
  if (S.has.reason) {
    const fails = L.filter(t => t.oc === 'fail');
    reasonRows = [...groupBy(fails, t => t.reason || '(no reason given)')].map(([k, a]) => ({ k, n: a.length, share: fails.length ? a.length / fails.length : 0, value: a.reduce((s, t) => s + V(t), 0), avgDur: (() => { const d = a.map(t => t.dur).filter(x => x != null); return d.length ? d.reduce((x, y) => x + y, 0) / d.length : null; })() }));
    table($('#op-reasons'), 'op-reasons', [{ k: 'k', label: 'Reason' }, { k: 'n', label: 'Failures', num: true, fmt: int, bar: true }, { k: 'share', label: 'Share', num: true, fmt: pct, sortv: r => r.n }, { k: 'value', label: `Value affected (${S.rep})`, num: true, fmt: money }, { k: 'avgDur', label: 'Time to fail', num: true, fmt: dur }], reasonRows, { sort: 'n', search: false, pageSize: 8, file: 'failure-reasons' });
  }
  const chG = [...groupBy(L, t => t.channel || '(blank)')].map(([k, a]) => Object.assign({ k }, stats(a)));
  if (S.has.channel) table($('#op-ch'), 'op-ch', latCols, chG, { sort: 'avgDur', search: false, pageSize: 8, file: 'speed-by-channel' });
  const stG = [...groupBy(L, t => t.status)].map(([k, a]) => Object.assign({ k }, stats(a)));
  table($('#op-st'), 'op-st', latCols.filter(c => c.k !== 'okRate'), stG, { sort: 'avgDur', search: false, pageSize: 8, file: 'speed-by-status' });
  const txCols = [{ k: 'id', label: 'Transaction' }, { k: 'user', label: 'User' }, { k: 'ben', label: 'Beneficiary' }, { k: 'v', label: `Amount (${S.rep})`, num: true, fmt: money }, { k: 'channel', label: 'Channel' }, { k: 'ts', label: 'Started', fmt: dt, csv: v => iso(v) }];
  table($('#op-stuck'), 'op-stuck', [...txCols, { k: 'age', label: 'Pending for', num: true, fmt: dur }], stuck.map(t => Object.assign({}, t, { age: now - t.ts })), { sort: 'age', pageSize: 8, empty: 'Nothing stuck. Good.', file: 'stuck-pending' });
  table($('#op-slow'), 'op-slow', [...txCols, { k: 'dur', label: 'Processing time', num: true, fmt: dur }, { k: 'status', label: 'Status', html: r => `<span class="pill ${r.oc}">${esc(r.status)}</span>`, text: r => r.status }, { k: 'reason', label: 'Reason' }], D.slice().sort((a, b) => b.dur - a.dur).slice(0, 200), { sort: 'dur', pageSize: 10, onRow: t => openUser(t.user), file: 'slowest-transactions' });
  const ins = [];
  if (ds.length) {
    const p50 = quant(ds, .5), p95 = quant(ds, .95), p99 = quant(ds, .99);
    if (p50 > 0 && p95 / p50 > 3) ins.push(['warn', `Long tail: p95 is ${nf2v.format(p95 / p50)}× the median. Fixing the slowest 5% (timeouts, retries, slow partner responses) helps more than tuning the average.`]);
    else ins.push(['', `Processing times are consistent: p95 is ${nf2v.format(p95 / (p50 || 1))}× the median.`]);
    if (p99 > 30000) ins.push(['bad', `1% of transactions take ${dur(p99)} or longer. Review timeout and retry settings on downstream calls.`]);
    const hA = hrs.map((a, h) => ({ h, avg: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, n: cnt[h] })).filter(x => x.avg != null && x.n >= 5);
    if (hA.length > 3) { const w = hA.slice().sort((a, b) => b.avg - a.avg)[0], busy = hA.slice().sort((a, b) => b.n - a.n)[0]; if (w.avg > s.avgDur * 1.3) ins.push(['warn', `Slowest hour is ${w.h}:00 at ${dur(w.avg)} average, ${pct(w.avg / s.avgDur - 1)} slower than overall.${w.h === busy.h ? ' It is also the busiest hour, which points to capacity limits.' : ''}`]); }
    const okG = stG.filter(g => outcome(g.k) === 'ok' && g.avgDur != null), fG = stG.filter(g => outcome(g.k) === 'fail' && g.avgDur != null);
    if (okG.length && fG.length) { const oa = okG.reduce((a, g) => a + g.avgDur * g.n, 0) / okG.reduce((a, g) => a + g.n, 0), fa = fG.reduce((a, g) => a + g.avgDur * g.n, 0) / fG.reduce((a, g) => a + g.n, 0); if (fa > oa * 1.5) ins.push(['bad', `Failures take ${dur(fa)} on average vs ${dur(oa)} for successes. Failing fast (shorter timeouts, upfront validation) saves users time.`]); }
    const cs = chG.filter(g => g.avgDur != null && g.n >= 10).sort((a, b) => b.avgDur - a.avgDur);
    if (S.has.channel && cs.length > 1 && cs[0].avgDur > cs[cs.length - 1].avgDur * 1.5) ins.push(['warn', `${esc(cs[0].k)} is the slowest channel (${dur(cs[0].avgDur)}) compared with ${esc(cs[cs.length - 1].k)} (${dur(cs[cs.length - 1].avgDur)}).`]);
  }
  const topR = reasonRows.slice().sort((a, b) => b.n - a.n)[0];
  if (topR) ins.push(['warn', `Top failure reason is “${esc(topR.k)}” (${pct(topR.share)} of failures). ${/insufficient|limit/i.test(topR.k) ? 'Show balances and limits before the user submits.' : /timeout/i.test(topR.k) ? 'Talk to the partner bank or add a faster fallback route.' : /invalid|account/i.test(topR.k) ? 'Validate account details (IBAN or account checks) before sending.' : 'Target this first.'}`]);
  if (stuck.length) ins.push(['bad', `${int(stuck.length)} transactions are stuck in pending. Automate status polling or reconciliation with the processor.`]);
  if (tp.peak && tp.avg && tp.peak / tp.avg > 20) ins.push(['', `Traffic is bursty: peak ${int(tp.peak)}/s against ${nf2v.format(tp.avg)}/s on average. Size capacity for bursts, not the average.`]);
  $('#op-ins').innerHTML = insightsList(ins);
}

/* ---------------- Risk & compliance ---------------- */
function rRisk() {
  const c = S.risk, B = S.baseCur, hr = new Set(c.highRiskCountries || []);
  const types = new Map(); S.flags.forEach(f => types.set(f.type, (types.get(f.type) || 0) + 1));
  const large = S.f.filter(t => t.vb != null && t.vb >= c.largeTxn), hrT = S.f.filter(t => hr.has(t.bc) || hr.has(t.sc));
  P('risk').innerHTML = `
  ${ledger(
    kpi(int(S.flags.length), 'Flags raised', '', true), kpi(int(S.flags.filter(f => f.sev === 'high').length), 'High severity'),
    kpi(int(S.flags.filter(f => f.sev === 'med').length), 'Medium'), kpi(int(new Set(S.flags.map(f => f.subj)).size), 'Subjects flagged'),
    kpi(int(large.length), 'Large transactions', `≥ ${int(c.largeTxn)} ${B}`), kpi(int(hrT.length), 'High-risk jurisdiction txns', [...hr].join(', ') || 'None set')
  )}
  <div class="grid">
    <div class="card c8"><h3>Flags</h3><p class="sub">Patterns worth a closer look. These are signals for review, not proof of wrongdoing. Click a row to open the subject.</p><div id="risk-tbl"></div></div>
    <div class="card c4"><h3>Flags by type</h3><p class="sub">Count of flags</p><div class="chart tall"><canvas id="ch-risk"></canvas></div>
      <p class="sub" style="margin-top:12px">Rules in use: burst ≥ ${c.velSec}/s · ${c.velMin}/min · duplicates within ${c.dupWin}s · fan-in ${c.fanIn} payers/hour · fan-out ${c.fanOut} beneficiaries/hour · structuring within ${c.structPct}% under ${int(c.largeTxn)} ${B} · new-beneficiary ≥ ${int(c.newBenLarge)} ${B}. ${S.me.role === 'admin' ? '<a href="#" id="edit-rules">Edit risk rules</a>' : 'Admins can change these.'}</p></div>
  </div>
  <div class="grid"><div class="card c12"><h3>Large transaction report</h3><p class="sub">Transactions at or above ${int(c.largeTxn)} ${B} equivalent. Check them against your local reporting obligations.</p><div id="risk-large"></div></div></div>
  <div class="grid"><div class="card c12"><h3>High-risk jurisdiction transactions</h3><p class="sub">Sender or beneficiary in ${[...hr].map(cname).join(', ') || 'no countries configured'}${S.has.country ? '' : ' (no country fields mapped)'}</p><div id="risk-hr"></div></div></div>`;
  if ($('#edit-rules')) $('#edit-rules').onclick = e => { e.preventDefault(); S.admin.tab = 'risk'; setMode('admin'); };
  table($('#risk-tbl'), 'risk', [
    { k: 'sev', label: 'Severity', html: r => `<span class="sev-${r.sev}">${r.sev === 'high' ? 'High' : r.sev === 'med' ? 'Medium' : 'Low'}</span>`, text: r => r.sev, sortv: r => ({ high: 3, med: 2, low: 1 })[r.sev] },
    { k: 'type', label: 'Type' }, { k: 'subj', label: 'Subject' }, { k: 'detail', label: 'Detail', wrap: true }, { k: 'amt', label: `Value involved (${S.rep})`, num: true, fmt: money }
  ], S.flags, { sort: 'sev', onRow: f => f.kind === 'ben' ? openBen(f.subj) : f.kind === 'user' ? openUser(f.subj) : (switchTab('ops'), render()), file: 'risk-flags', empty: 'No flags for the current filters.' });
  const te = [...types].sort((a, b) => b[1] - a[1]);
  chart('ch-risk', { type: 'bar', data: { labels: te.map(x => x[0]), datasets: [{ label: 'Flags', data: te.map(x => x[1]), backgroundColor: cssVar('--bad'), borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
  const txCols = [{ k: 'id', label: 'Transaction' }, { k: 'ts', label: 'Date', fmt: dt, csv: v => iso(v) }, { k: 'user', label: 'User' }, { k: 'ben', label: 'Beneficiary' }, { k: 'benName', label: 'Name' }, { k: 'amount', label: 'Original amount', num: true, fmt: money }, { k: 'cur', label: 'Cur' }, { k: 'vb', label: `${B} equivalent`, num: true, fmt: money }, { k: 'sc', label: 'From' }, { k: 'bc', label: 'To' }, { k: 'status', label: 'Status', html: r => `<span class="pill ${r.oc}">${esc(r.status)}</span>`, text: r => r.status }];
  table($('#risk-large'), 'risk-large', txCols, large, { sort: 'vb', pageSize: 10, onRow: t => openUser(t.user), file: 'large-transactions', empty: 'No transactions above the threshold.' });
  table($('#risk-hr'), 'risk-hr', txCols, hrT, { sort: 'ts', pageSize: 10, onRow: t => openUser(t.user), file: 'high-risk-jurisdiction', empty: 'None found.' });
}

/* ---------------- Transactions ---------------- */
function rTxns() {
  P('txns').innerHTML = `<div class="card"><h3>Transactions</h3><p class="sub">Every transaction matching your filters. Click a row to open the user.</p><div id="tx-tbl"></div></div>`;
  table($('#tx-tbl'), 'txns', [
    { k: 'id', label: 'Transaction' }, { k: 'ts', label: 'Started', fmt: dt, csv: v => iso(v) }, { k: 'user', label: 'User' }, { k: 'ben', label: 'Beneficiary' }, { k: 'benName', label: 'Name' },
    { k: 'amount', label: 'Amount', num: true, fmt: money }, { k: 'cur', label: 'Cur' }, { k: 'v', label: `In ${S.rep}`, num: true, fmt: money }, { k: 'fee', label: 'Fee', num: true, fmt: money },
    { k: 'status', label: 'Status', html: r => `<span class="pill ${r.oc}">${esc(r.status)}</span>`, text: r => r.status }, { k: 'reason', label: 'Reason' },
    { k: 'channel', label: 'Channel' }, { k: 'sc', label: 'From' }, { k: 'bc', label: 'To' }, { k: 'bank', label: 'Bank' }, { k: 'dur', label: 'Processing', num: true, fmt: dur }, { k: 'srcName', label: 'Source' }
  ], S.f, { sort: 'ts', pageSize: 25, onRow: t => openUser(t.user), file: 'transactions' });
}

/* ---------------- Exports ---------------- */
$('#exp-data').onclick = () => saveCSV('transactions.csv', ['transaction_id', 'started', 'user', 'beneficiary', 'beneficiary_name', 'beneficiary_bank', 'amount', 'currency', 'value_' + S.rep, 'fee', 'status', 'failure_reason', 'channel', 'sender_country', 'beneficiary_country', 'processing_ms', 'source'],
  S.f.map(t => [t.id, iso(t.ts), t.user, t.ben, t.benName, t.bank, t.amount, t.cur, t.v == null ? '' : t.v.toFixed(2), t.fee ?? '', t.status, t.reason, t.channel, t.sc, t.bc, t.dur ?? '', t.srcName]));
$('#exp-summary').onclick = () => {
  const L = S.f, s = stats(L), tp = throughput(L), ds = L.map(t => t.dur).filter(x => x != null).sort((a, b) => a - b), out = [];
  const add = (a, b, c) => out.push([a, b, c]);
  add('Report', 'Generated', new Date().toISOString()); add('Report', 'Reporting currency', S.rep); add('Report', 'Period', isFinite(S.span.min) ? iso(S.span.min) + ' to ' + iso(S.span.max) : '');
  add('Summary', 'Transactions', s.n); add('Summary', 'Total value', s.value.toFixed(2)); add('Summary', 'Users', s.users); add('Summary', 'Beneficiaries', s.bens); add('Summary', 'Average ticket', s.avg.toFixed(2));
  if (S.has.status) add('Summary', 'Success rate', (s.okRate || 0).toFixed(4));
  if (S.has.fee) { add('Revenue', 'Fees', s.fees.toFixed(2)); add('Revenue', 'Take rate (bps)', s.take ? Math.round(s.take * 10000) : ''); }
  add('Speed', 'Peak transactions per second', tp.peak); add('Speed', 'Average transactions per second', tp.avg ? tp.avg.toFixed(4) : '');
  if (ds.length) { add('Speed', 'Average processing ms', Math.round(s.avgDur)); [.5, .95, .99].forEach(q => add('Speed', 'p' + Math.round(q * 100) + ' processing ms', Math.round(quant(ds, q)))); }
  [...groupBy(L, t => t.cur || '(none)')].map(([k, a]) => [k, a.reduce((x, t) => x + V(t), 0), a.length]).sort((a, b) => b[1] - a[1]).forEach(([k, v, n]) => add('Currencies', k, `${v.toFixed(2)} ${S.rep} in ${n} txns`));
  if (S.has.country) [...groupBy(L.filter(t => t.sc && t.bc), t => t.sc + ' > ' + t.bc)].map(([k, a]) => [k, a.reduce((x, t) => x + V(t), 0), a.length]).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v, n]) => add('Corridors', k, `${v.toFixed(2)} ${S.rep} in ${n} txns`));
  [...S.ben.values()].sort((a, b) => b.total - a.total).slice(0, 25).forEach((b, i) => add('Top beneficiaries', `#${i + 1} ${b.key}${b.name ? ' (' + b.name + ')' : ''}`, `${b.total.toFixed(2)} from ${b.payerN} payers in ${b.n} txns`));
  [...S.usr.values()].sort((a, b) => b.n - a.n).slice(0, 25).forEach((u, i) => add('Top users', `#${i + 1} ${u.key}`, `${u.n} txns, ${u.total.toFixed(2)} sent, peak ${u.peakSec}/s`));
  S.flags.forEach(f => add('Risk flags', `${f.sev.toUpperCase()} ${f.type}: ${f.subj}`, f.detail));
  saveCSV('analytics-report.csv', ['Section', 'Metric', 'Value'], out);
};
$('#print-btn').onclick = () => {
  const keep = S.tab; ATABS.forEach(t => { if (S.dirty.has(t)) { S.tab = t; render(); } }); S.tab = keep;
  api('/api/audit', { method: 'POST', body: { action: 'print', detail: 'Analytics report' } }).catch(() => {});
  setTimeout(() => window.print(), 300);
};

/* =========================================================================
   Admin panel
   ========================================================================= */
const AP = n => document.querySelector(`[data-apanel="${n}"]`);
$$('#ad-tabs button').forEach(b => b.onclick = () => { S.admin.tab = b.dataset.tab; adminRender(); });
async function adminLoad() {
  try {
    const [src, users, settings] = await Promise.all([api('/api/admin/sources'), api('/api/admin/users'), api('/api/admin/settings')]);
    S.admin.sources = src.sources; S.admin.fields = src.fields; S.admin.users = users.users; S.admin.settings = settings;
    adminRender();
  } catch (e) { toast(e.message, true); }
}
function adminRender() {
  const t = S.admin.tab;
  $$('#ad-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('[data-apanel]').forEach(p => p.classList.toggle('active', p.dataset.apanel === t));
  ({ sources: adSources, users: adUsers, fx: adFx, risk: adRisk, org: adOrg, audit: adAudit })[t]();
}
const AUTH_LABEL = { none: 'No authentication', bearer: 'Bearer token', header: 'API key in header', query: 'API key in URL', basic: 'Username and password' };

/* ---------------- Data sources ---------------- */
function adSources() {
  const list = S.admin.sources;
  AP('sources').innerHTML = `
    <div class="btn-row" style="justify-content:space-between;margin-bottom:14px">
      <p class="muted" style="margin:0;max-width:70ch">Each data source is an API that returns transactions. Keys are encrypted on the server and never sent to anyone's browser. Staff only see the analytics.</p>
      <button class="btn btn-primary" id="add-src">Add data source</button>
    </div>
    <div class="src-list">${list.length ? list.map(s => {
      const ls = s.lastSync, state = !s.enabled ? 'off' : !ls ? '' : ls.ok ? 'ok' : 'bad';
      let host = ''; try { host = s.type === 'demo' ? 'Built-in sample data' : new URL(s.url).host + new URL(s.url).pathname; } catch (e) { host = s.url || 'No URL'; }
      return `<div class="src-card">
        <div>
          <h3><span class="dot ${state}"></span>${esc(s.name)}</h3>
          <div class="mono muted">${esc(host)}</div>
          <div class="src-meta">
            <span>${s.type === 'demo' ? 'Demo' : esc(AUTH_LABEL[s.authType] || s.authType)}</span>
            ${s.type === 'api' && s.authType !== 'none' ? `<span class="key-chip">${s.secretSet ? 'Key ' + esc(s.secretHint) : 'No key saved'}</span>` : ''}
            ${s.extraHeaderNames?.length ? `<span>Headers: ${esc(s.extraHeaderNames.join(', '))}</span>` : ''}
            <span>${s.enabled ? (s.refreshMins ? 'Syncs every ' + s.refreshMins + ' min' : 'Manual sync') : 'Disabled'}</span>
            <span>${ls ? (ls.ok ? int(ls.count) + ' transactions · ' : 'Failed · ') + 'synced ' + ago(ls.at) + ' · ' + dur(ls.ms) : 'Never synced'}</span>
            ${s.defaultCurrency ? `<span>Default currency ${esc(s.defaultCurrency)}</span>` : ''}
          </div>
          ${ls && !ls.ok ? `<div class="err-text">${esc(ls.error)}</div>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn-line btn-sm" data-sync="${s.id}">Sync now</button>
          <button class="btn btn-line btn-sm" data-edit="${s.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${s.id}">Delete</button>
        </div></div>`;
    }).join('') : `<div class="empty"><h2>No data sources yet</h2><p>Add your transactions API with its key. You can test the connection and check the field mapping before saving.</p></div>`}</div>`;
  $('#add-src').onclick = () => sourceModal(null);
  AP('sources').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => sourceModal(list.find(s => s.id === b.dataset.edit)));
  AP('sources').querySelectorAll('[data-sync]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Syncing…';
    try { const r = await api(`/api/admin/sources/${b.dataset.sync}/sync`, { method: 'POST' }); toast(`Synced ${int(r.lastSync.count)} transactions.`); loadData(); }
    catch (e) { toast(e.message, true); }
    adminLoad();
  });
  AP('sources').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const s = list.find(x => x.id === b.dataset.del);
    if (!await confirmBox('Delete data source', `Delete <b>${esc(s.name)}</b>? Its saved key and cached transactions are removed. Staff lose access to this data.`, 'Delete', true)) return;
    try { await api('/api/admin/sources/' + s.id, { method: 'DELETE' }); toast('Data source deleted.'); adminLoad(); loadData(); } catch (e) { toast(e.message, true); }
  });
}
function sourceModal(src) {
  const s = src || { type: 'api', method: 'GET', authType: 'bearer', authHeaderName: 'x-api-key', authQueryName: 'api_key', enabled: true, refreshMins: 15, timeoutMs: 30000, startPage: 1, maxPages: 1, durUnit: 'ms', mapping: {}, demoSize: 8000 };
  let keys = src?.detectedKeys || [], autoMap = src?.appliedMap || {};
  const f = (id, label, val, attrs = '') => `<div><label for="${id}">${label}</label><input id="${id}" value="${esc(val ?? '')}" ${attrs}></div>`;
  openModal(`
    <div class="modal-head"><h2>${src ? 'Edit data source' : 'Add data source'}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="row2">${f('s-name', 'Name', s.name, 'placeholder="e.g. Core payments API"')}
      <div><label for="s-type">Type</label><select id="s-type"><option value="api">API</option><option value="demo">Demo sample data</option></select></div></div>
    <label class="check"><input type="checkbox" id="s-enabled" ${s.enabled !== false ? 'checked' : ''}> Enabled (staff with access can see this data)</label>
    <div id="s-api">
      <div class="form-section"><h4>Connection</h4>
        <label for="s-url">Endpoint URL</label><input id="s-url" value="${esc(s.url || '')}" placeholder="https://api.yourbank.com/v1/transactions">
        <div class="row3"><div><label for="s-method">Method</label><select id="s-method"><option>GET</option><option>POST</option></select></div>
          ${f('s-timeout', 'Timeout (ms)', s.timeoutMs, 'type="number" min="2000" step="1000"')}
          ${f('s-path', 'Records path', s.recordsPath, 'placeholder="auto, e.g. data.items"')}</div>
        <div id="s-body-wrap"><label for="s-body">Request body (JSON). Use {page} and {pageSize} as placeholders.</label><textarea id="s-body">${esc(s.body || '')}</textarea></div>
      </div>
      <div class="form-section"><h4>Authentication</h4>
        <label for="s-auth">Method</label><select id="s-auth">${Object.entries(AUTH_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <div class="row2">
          <div id="w-hname">${f('s-hname', 'Header name', s.authHeaderName)}</div>
          <div id="w-qname">${f('s-qname', 'Query parameter name', s.authQueryName)}</div>
          <div id="w-user">${f('s-username', 'Username', s.username, 'autocomplete="off"')}</div>
        </div>
        <div id="w-secret"><label for="s-secret" id="s-secret-label">API key or token</label><input id="s-secret" type="password" autocomplete="new-password" placeholder="${src?.secretSet ? 'Saved (' + esc(src.secretHint) + '). Leave blank to keep it.' : 'Paste the key'}">
          ${src?.secretSet ? '<label class="check"><input type="checkbox" id="s-clear-secret"> Remove the saved key</label>' : ''}
          <p class="field-hint">Stored encrypted (AES-256-GCM). It is never shown again or sent to browsers.</p></div>
        <label for="s-headers">Extra headers (one per line, also encrypted)</label>
        <textarea id="s-headers" placeholder="${src?.extraHeaderNames?.length ? 'Saved: ' + esc(src.extraHeaderNames.join(', ')) + '. Enter new lines to replace them.' : 'X-Client-Id: abc123'}"></textarea>
        ${src?.extraHeaderNames?.length ? '<label class="check"><input type="checkbox" id="s-clear-headers"> Remove saved extra headers</label>' : ''}
      </div>
      <div class="form-section"><h4>Pagination (optional)</h4>
        <div class="row3">${f('s-pparam', 'Page parameter', s.pageParam, 'placeholder="page"')}${f('s-pstart', 'First page number', s.startPage, 'type="number" min="0"')}${f('s-pmax', 'Max pages per sync', s.maxPages, 'type="number" min="1" max="1000"')}</div>
        <div class="row2">${f('s-psparam', 'Page size parameter', s.pageSizeParam, 'placeholder="limit"')}${f('s-psize', 'Page size', s.pageSize, 'type="number" min="1"')}</div>
      </div>
    </div>
    <div id="s-demo">${f('s-demosize', 'Number of sample transactions', s.demoSize, 'type="number" min="100" max="50000"')}</div>
    <div class="form-section"><h4>Data</h4>
      <div class="row3">
        <div><label for="s-cur">Default currency</label><input id="s-cur" value="${esc(s.defaultCurrency || '')}" maxlength="3" placeholder="Used if records have none"></div>
        <div><label for="s-durunit">Processing time unit</label><select id="s-durunit"><option value="ms">Milliseconds</option><option value="s">Seconds</option></select></div>
        ${f('s-refresh', 'Auto-sync every (minutes, 0 = off)', s.refreshMins, 'type="number" min="0"')}
      </div>
    </div>
    <div class="form-section"><h4>Test and map fields</h4>
      <p class="field-hint">Test fetches the first page with the settings above (using the saved key if you left it blank), then suggests a field mapping.</p>
      <button class="btn btn-line" id="s-test" style="margin-top:8px">Test connection</button>
      <div id="s-test-out"></div>
      <div id="s-map" class="map-grid"></div>
    </div>
    <p class="form-err" id="s-err"></p>
    <div class="modal-foot"><button class="btn btn-line" data-close>Cancel</button><button class="btn btn-primary" id="s-save">${src ? 'Save and sync' : 'Add and sync'}</button></div>`, () => {
    $('#s-type').value = s.type; $('#s-method').value = s.method; $('#s-auth').value = s.authType; $('#s-durunit').value = s.durUnit || 'ms';
    const vis = () => {
      const demo = $('#s-type').value === 'demo', a = $('#s-auth').value;
      $('#s-api').hidden = demo; $('#s-demo').hidden = !demo;
      $('#s-body-wrap').hidden = $('#s-method').value !== 'POST';
      $('#w-hname').hidden = a !== 'header'; $('#w-qname').hidden = a !== 'query'; $('#w-user').hidden = a !== 'basic'; $('#w-secret').hidden = a === 'none';
      $('#s-secret-label').textContent = a === 'basic' ? 'Password' : a === 'bearer' ? 'Bearer token' : 'API key';
    };
    ['#s-type', '#s-auth', '#s-method'].forEach(x => $(x).addEventListener('change', vis)); vis();
    const drawMap = () => {
      if (!keys.length) { $('#s-map').innerHTML = '<p class="field-hint">Run a test to see the fields in your data.</p>'; return; }
      const opts = v => `<option value="">Auto${autoMap[v] ? ' (' + esc(autoMap[v]) + ')' : ''}</option>` + keys.map(k => `<option ${s.mapping?.[v] === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
      $('#s-map').innerHTML = S.admin.fields.map(fl => `<div><label for="m-${fl.k}">${esc(fl.l)}</label><select id="m-${fl.k}" data-mk="${fl.k}">${opts(fl.k)}</select></div>`).join('');
    };
    drawMap();
    const collect = () => {
      const b = {
        name: $('#s-name').value.trim() || 'Untitled source', type: $('#s-type').value, enabled: $('#s-enabled').checked,
        url: $('#s-url').value.trim(), method: $('#s-method').value, timeoutMs: +$('#s-timeout').value || 30000, recordsPath: $('#s-path').value.trim(), body: $('#s-body').value,
        authType: $('#s-auth').value, authHeaderName: $('#s-hname').value.trim(), authQueryName: $('#s-qname').value.trim(), username: $('#s-username').value,
        pageParam: $('#s-pparam').value.trim(), startPage: +$('#s-pstart').value || 1, maxPages: +$('#s-pmax').value || 1, pageSizeParam: $('#s-psparam').value.trim(), pageSize: $('#s-psize').value,
        defaultCurrency: $('#s-cur').value.trim().toUpperCase(), durUnit: $('#s-durunit').value, refreshMins: +$('#s-refresh').value || 0, demoSize: +$('#s-demosize').value || 8000
      };
      if ($('#s-secret').value) b.secret = $('#s-secret').value;
      if ($('#s-clear-secret')?.checked) b.clearSecret = true;
      if ($('#s-headers').value.trim()) b.extraHeaders = $('#s-headers').value.trim();
      if ($('#s-clear-headers')?.checked) b.clearExtraHeaders = true;
      if (keys.length) { b.mapping = {}; $$('[data-mk]').forEach(el => { if (el.value) b.mapping[el.dataset.mk] = el.value; }); }
      return b;
    };
    $('#s-test').onclick = async () => {
      const btn = $('#s-test'); btn.disabled = true; btn.textContent = 'Testing…'; $('#s-test-out').innerHTML = '';
      try {
        const r = await api('/api/admin/sources/test', { method: 'POST', body: Object.assign(collect(), { id: src?.id }) });
        keys = r.keys; autoMap = r.map; s.mapping = collect().mapping || s.mapping;
        const missing = ['user', 'ben', 'amount', 'ts'].filter(k => !autoMap[k] && !(s.mapping || {})[k]).map(k => S.admin.fields.find(x => x.k === k).l.toLowerCase());
        $('#s-test-out').innerHTML = `<div class="test-result ok">Connected in ${dur(r.ms)}. Received ${int(r.count)} records on the first page. ${missing.length ? '<br><b>Please map:</b> ' + esc(missing.join(', ')) + '.' : 'All key fields were matched.'}</div>
          <details style="margin-top:8px"><summary class="muted" style="cursor:pointer">First record (sensitive-looking fields hidden)</summary><pre class="preview mono">${esc(JSON.stringify(r.preview, null, 2))}</pre></details>`;
        drawMap();
      } catch (e) { $('#s-test-out').innerHTML = `<div class="test-result bad">${esc(e.message)}</div>`; }
      finally { btn.disabled = false; btn.textContent = 'Test connection'; }
    };
    $('#s-save').onclick = async () => {
      const btn = $('#s-save'); btn.disabled = true; $('#s-err').textContent = '';
      try {
        const b = collect();
        const r = src ? await api('/api/admin/sources/' + src.id, { method: 'PUT', body: b }) : await api('/api/admin/sources', { method: 'POST', body: b });
        closeModal(); toast('Saved. Syncing…');
        try { const y = await api(`/api/admin/sources/${r.source.id}/sync`, { method: 'POST' }); toast(`Saved and synced ${int(y.lastSync.count)} transactions.`); }
        catch (e) { toast('Saved, but the sync failed: ' + e.message, true); }
        adminLoad(); loadData();
      } catch (e) { $('#s-err').textContent = e.message; btn.disabled = false; }
    };
  });
}

/* ---------------- Users ---------------- */
function adUsers() {
  const users = S.admin.users, srcName = Object.fromEntries(S.admin.sources.map(s => [s.id, s.name]));
  AP('users').innerHTML = `
    <div class="btn-row" style="justify-content:space-between;margin-bottom:14px">
      <p class="muted" style="margin:0;max-width:70ch"><b>Admins</b> manage sources, keys, users and settings. <b>Staff</b> use the analytics for the data sources you allow, and can filter and export. New users must change their password at first sign-in.</p>
      <button class="btn btn-primary" id="add-user">Add user</button>
    </div>
    <div class="card"><div id="users-tbl"></div></div>`;
  table($('#users-tbl'), 'ad-users', [
    { k: 'name', label: 'Name' }, { k: 'username', label: 'Username' },
    { k: 'role', label: 'Role', html: r => `<span class="pill ${r.role === 'admin' ? 'ok' : 'other'}">${r.role === 'admin' ? 'Admin' : 'Staff'}</span>`, text: r => r.role },
    { k: 'active', label: 'Status', html: r => r.active ? 'Active' : '<span class="sev-high">Disabled</span>', text: r => r.active ? 'Active' : 'Disabled' },
    { k: 'access', label: 'Data access', html: r => esc(r.role === 'admin' || r.sources.includes('*') ? 'All sources' : r.sources.map(id => srcName[id] || '(deleted)').join(', ')), text: r => r.sources.includes('*') ? 'All' : r.sources.map(id => srcName[id]).join('; '), wrap: true },
    { k: 'lastLogin', label: 'Last sign-in', fmt: v => v ? ago(v) : 'Never', csv: v => iso(v) },
    { k: 'act', label: '', html: r => `<button class="btn btn-line btn-sm" data-uedit="${r.id}">Edit</button> ${r.id !== S.me.id ? `<button class="btn btn-danger btn-sm" data-udel="${r.id}">Delete</button>` : ''}`, text: () => '' }
  ], users, { sort: 'name', desc: false, file: 'users' });
  $('#add-user').onclick = () => userModal(null);
  AP('users').querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => userModal(users.find(u => u.id === b.dataset.uedit)));
  AP('users').querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.id === b.dataset.udel);
    if (!await confirmBox('Delete user', `Delete <b>${esc(u.name)}</b> (${esc(u.username)})? They are signed out immediately.`, 'Delete', true)) return;
    try { await api('/api/admin/users/' + u.id, { method: 'DELETE' }); toast('User deleted.'); adminLoad(); } catch (e) { toast(e.message, true); }
  });
}
function userModal(u) {
  const all = !u || u.sources.includes('*');
  openModal(`
    <div class="modal-head"><h2>${u ? 'Edit user' : 'Add user'}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="row2">
      <div><label for="u-username">Username</label><input id="u-username" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''} autocomplete="off"></div>
      <div><label for="u-name">Full name</label><input id="u-name" value="${esc(u?.name || '')}"></div>
    </div>
    <div class="row2">
      <div><label for="u-role">Role</label><select id="u-role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
      <div><label for="u-pass">${u ? 'Reset password (optional)' : 'Temporary password'}</label><input id="u-pass" type="password" autocomplete="new-password"></div>
    </div>
    <p class="field-hint">At least 10 characters with letters and numbers. The user is asked to change it at first sign-in.</p>
    ${u ? `<label class="check"><input type="checkbox" id="u-active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}
    <div class="form-section" id="u-access-wrap"><h4>Data access</h4>
      <label class="check"><input type="radio" name="u-acc" value="all" ${all ? 'checked' : ''}> All data sources, including ones added later</label>
      <label class="check"><input type="radio" name="u-acc" value="some" ${all ? '' : 'checked'}> Only these data sources:</label>
      <div class="access-list" id="u-srcs">${S.admin.sources.map(s => `<label class="check"><input type="checkbox" value="${s.id}" ${u && u.sources.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') || '<p class="muted">No data sources yet.</p>'}</div>
    </div>
    <p class="form-err" id="u-err"></p>
    <div class="modal-foot"><button class="btn btn-line" data-close>Cancel</button><button class="btn btn-primary" id="u-save">${u ? 'Save changes' : 'Add user'}</button></div>`, () => {
    $('#u-role').value = u?.role || 'staff';
    const vis = () => { $('#u-access-wrap').hidden = $('#u-role').value === 'admin'; $('#u-srcs').style.opacity = document.querySelector('input[name=u-acc]:checked').value === 'all' ? .5 : 1; };
    $('#u-role').onchange = vis; $$('input[name=u-acc]').forEach(r => r.onchange = vis); vis();
    $('#u-save').onclick = async () => {
      $('#u-err').textContent = '';
      const some = document.querySelector('input[name=u-acc]:checked').value === 'some';
      const sources = some ? $$('#u-srcs input:checked').map(x => x.value) : ['*'];
      if (some && !sources.length && $('#u-role').value !== 'admin') { $('#u-err').textContent = 'Pick at least one data source, or choose all sources.'; return; }
      const b = { name: $('#u-name').value.trim(), role: $('#u-role').value, sources };
      if ($('#u-pass').value) b.password = $('#u-pass').value;
      try {
        if (u) { if ($('#u-active')) b.active = $('#u-active').checked; await api('/api/admin/users/' + u.id, { method: 'PUT', body: b }); }
        else { b.username = $('#u-username').value.trim(); await api('/api/admin/users', { method: 'POST', body: b }); }
        closeModal(); toast(u ? 'User updated.' : 'User added. Share the temporary password with them securely.'); adminLoad();
      } catch (e) { $('#u-err').textContent = e.message; }
    };
  });
}

/* ---------------- Currencies & FX ---------------- */
function adFx() {
  const st = S.admin.settings, fx = st.fx, base = st.baseCurrency, rates = st.rates;
  const codes = Object.keys(rates).sort();
  AP('fx').innerHTML = `
    <div class="grid">
      <div class="card c6"><h3>Reporting currency</h3><p class="sub">The default for everyone and the currency risk thresholds are set in. Each user can still switch the display currency.</p>
        <select id="fx-base">${codes.map(c => `<option value="${c}" ${c === base ? 'selected' : ''}>${c}${st.currencyNames[c] ? ' – ' + esc(st.currencyNames[c]) : ''}</option>`).join('')}</select>
        <button class="btn btn-primary" id="fx-base-save" style="margin-top:12px">Save reporting currency</button></div>
      <div class="card c6"><h3>Rate status</h3><p class="sub">Where today's rates come from</p>
        <div class="mini" style="margin:4px 0">
          <div><b>${fx.mode === 'live' ? 'Live' : fx.mode === 'custom' ? 'Custom API' : 'Manual'}</b><span>Mode</span></div>
          <div><b>${fx.updatedAt ? ago(fx.updatedAt) : 'Never'}</b><span>Last update</span></div>
          <div><b>${int(codes.length)}</b><span>Currencies</span></div>
        </div>
        ${fx.error ? `<div class="err-text">Last update failed: ${esc(fx.error)}</div>` : `<p class="field-hint">${esc(fx.provider || 'Using built-in approximate rates')}</p>`}
        <button class="btn btn-line" id="fx-refresh" style="margin-top:10px" ${fx.mode === 'manual' ? 'disabled' : ''}>Refresh rates now</button></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h3>Rate provider</h3><p class="sub">Manual overrides below always win over the provider.</p>
      <label class="check"><input type="radio" name="fx-mode" value="live" ${fx.mode === 'live' ? 'checked' : ''}> Free daily mid-market rates (open.er-api.com, no key needed)</label>
      <label class="check"><input type="radio" name="fx-mode" value="custom" ${fx.mode === 'custom' ? 'checked' : ''}> My own FX provider API (e.g. your bank, treasury system or a paid feed)</label>
      <label class="check"><input type="radio" name="fx-mode" value="manual" ${fx.mode === 'manual' ? 'checked' : ''}> Manual rates only</label>
      <div id="fx-custom" class="form-section">
        <label for="fx-url">Provider URL (use {key} to place the key in the URL)</label><input id="fx-url" value="${esc(fx.customUrl || '')}" placeholder="https://api.provider.com/latest?base=USD">
        <div class="row3">
          <div><label for="fx-key">API key</label><input id="fx-key" type="password" autocomplete="new-password" placeholder="${fx.customKeySet ? 'Saved. Leave blank to keep.' : 'Optional'}"></div>
          <div><label for="fx-kh">Send key in header</label><input id="fx-kh" value="${esc(fx.customKeyHeader || '')}" placeholder="e.g. apikey"></div>
          <div><label for="fx-kq">Or as query parameter</label><input id="fx-kq" value="${esc(fx.customKeyQuery || '')}" placeholder="e.g. access_key"></div>
        </div>
        <div class="row2">
          <div><label for="fx-path">Path to rates object</label><input id="fx-path" value="${esc(fx.customRatesPath || 'rates')}"></div>
          <div><label for="fx-cbase">Base currency of the response</label><input id="fx-cbase" value="${esc(fx.customBase || 'USD')}" maxlength="3"></div>
        </div>
        <p class="field-hint">The response must contain a USD rate (or use USD as base) so all rates can be normalised.</p>
      </div>
      <div class="row3"><div><label for="fx-hours">Refresh every (hours)</label><input id="fx-hours" type="number" min="1" value="${fx.refreshHours || 12}"></div></div>
      <button class="btn btn-primary" id="fx-save" style="margin-top:12px">Save provider settings</button>
    </div>
    <div class="card"><h3>Rates</h3><p class="sub">Units of each currency per 1 USD, and per 1 ${esc(base)}. Enter a value in "Override" to fix a rate (for example your bank's booking rate).</p>
      <div class="tbl-tools"><input id="fx-search" type="search" placeholder="Find a currency"><span class="spacer"></span>
        <input id="fx-new-code" placeholder="Add code, e.g. XOF" maxlength="3" style="max-width:150px"><input id="fx-new-rate" type="number" step="any" placeholder="Per 1 USD" style="max-width:130px"><button class="btn btn-line btn-sm" id="fx-add">Add</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Currency</th><th>Name</th><th class="num">Per 1 USD</th><th class="num">Per 1 ${esc(base)}</th><th>Source</th><th>Override (per 1 USD)</th></tr></thead>
      <tbody id="fx-rows">${codes.map(c => `<tr data-c="${c}"><td><b>${c}</b></td><td>${esc(st.currencyNames[c] || '')}</td><td class="num">${nfr.format(rates[c])}</td><td class="num">${rates[base] ? nfr.format(rates[c] / rates[base]) : '–'}</td><td>${esc(st.rateSource[c])}</td><td><input class="rate-input" type="number" step="any" data-ov="${c}" value="${fx.manual[c] ?? ''}" placeholder="—" aria-label="Override for ${c}"></td></tr>`).join('')}</tbody></table></div>
      <button class="btn btn-primary" id="fx-ov-save" style="margin-top:12px">Save overrides</button>
    </div>`;
  const vis = () => { $('#fx-custom').hidden = document.querySelector('input[name=fx-mode]:checked').value !== 'custom'; };
  $$('input[name=fx-mode]').forEach(r => r.onchange = vis); vis();
  const saveSettings = async (body, msg) => { try { S.admin.settings = await api('/api/admin/settings', { method: 'PUT', body }); toast(msg); adFx(); loadData(); } catch (e) { toast(e.message, true); } };
  $('#fx-base-save').onclick = () => saveSettings({ baseCurrency: $('#fx-base').value }, 'Reporting currency saved.');
  $('#fx-save').onclick = async () => {
    const b = { fx: { mode: document.querySelector('input[name=fx-mode]:checked').value, customUrl: $('#fx-url').value.trim(), customKeyHeader: $('#fx-kh').value.trim(), customKeyQuery: $('#fx-kq').value.trim(), customRatesPath: $('#fx-path').value.trim(), customBase: $('#fx-cbase').value.trim().toUpperCase(), refreshHours: +$('#fx-hours').value || 12 } };
    if ($('#fx-key').value) b.fx.customKey = $('#fx-key').value;
    await saveSettings(b, 'Provider settings saved.');
    if (b.fx.mode !== 'manual') $('#fx-refresh')?.click();
  };
  $('#fx-refresh').onclick = async () => {
    const btn = $('#fx-refresh'); btn.disabled = true; btn.textContent = 'Refreshing…';
    try { const r = await api('/api/admin/fx/refresh', { method: 'POST' }); S.admin.settings = r; toast(`Updated ${int(r.count)} rates.`); adFx(); loadData(); }
    catch (e) { toast('Rate refresh failed: ' + e.message, true); S.admin.settings = e.data && e.data.rates ? e.data : S.admin.settings; adFx(); }
  };
  $('#fx-ov-save').onclick = () => { const m = {}; $$('[data-ov]').forEach(i => { if (i.value !== '' && +i.value > 0) m[i.dataset.ov] = +i.value; }); saveSettings({ fx: { manual: m } }, 'Overrides saved.'); };
  $('#fx-add').onclick = () => {
    const c = $('#fx-new-code').value.trim().toUpperCase(), r = +$('#fx-new-rate').value;
    if (!/^[A-Z]{3}$/.test(c) || !(r > 0)) { toast('Enter a 3-letter currency code and a rate per 1 USD.', true); return; }
    const m = Object.assign({}, fx.manual, { [c]: r }); saveSettings({ fx: { manual: m } }, c + ' added.');
  };
  $('#fx-search').oninput = e => { const q = e.target.value.trim().toUpperCase(); $$('#fx-rows tr').forEach(tr => tr.hidden = q && !(tr.dataset.c.includes(q) || tr.textContent.toUpperCase().includes(q))); };
}

/* ---------------- Risk rules ---------------- */
function adRisk() {
  const r = S.admin.settings.risk, B = S.admin.settings.baseCurrency;
  const n = (k, l, hint, step = 1) => `<div><label for="r-${k}">${l}</label><input id="r-${k}" type="number" min="0" step="${step}" value="${r[k]}">${hint ? `<p class="field-hint">${hint}</p>` : ''}</div>`;
  AP('risk').innerHTML = `
    <div class="card"><h3>Detection rules</h3><p class="sub">These apply to every user's Risk & compliance view. Amount thresholds are in ${esc(B)} (the reporting currency); other currencies are converted first.</p>
      <div class="settings-grid">
        ${n('largeTxn', `Large transaction threshold (${B})`, 'Also the line for structuring checks', 100)}
        ${n('structPct', 'Structuring band below threshold (%)', 'e.g. 10 = flag payments 90–100% of the threshold')}
        ${n('newBenLarge', `Large first payment to new beneficiary (${B})`, '', 100)}
        ${n('roundMin', `Round amounts from (${B})`, '', 100)}
        ${n('velSec', 'Velocity burst: transactions in 1 second')}
        ${n('velMin', 'High frequency: transactions in 60 seconds')}
        ${n('dupWin', 'Duplicate window (seconds)')}
        ${n('fanIn', 'Payer spike: distinct payers in 1 hour')}
        ${n('fanOut', 'Fan-out: beneficiaries in 1 hour')}
        ${n('outlierZ', 'Unusual amount (standard deviations)', '', 0.5)}
        ${n('failMin', 'Repeated failures: minimum count')}
        ${n('pendingAgeMins', 'Pending counts as stuck after (minutes)')}
      </div>
      <label for="r-hr">High-risk jurisdictions (2-letter country codes, comma separated)</label>
      <input id="r-hr" value="${esc((r.highRiskCountries || []).join(', '))}">
      <p class="field-hint">Pre-filled with the FATF "call for action" list as known in mid-2026 (KP, IR, MM). FATF updates its lists several times a year, and you may need to add countries under increased monitoring or required by your regulator. Keep this current.</p>
      <button class="btn btn-primary" id="r-save" style="margin-top:14px">Save rules</button>
    </div>`;
  $('#r-save').onclick = async () => {
    const risk = {}; Object.keys(r).forEach(k => { if (k !== 'highRiskCountries') { const el = $('#r-' + k); if (el) risk[k] = +el.value; } });
    risk.highRiskCountries = $('#r-hr').value;
    try { S.admin.settings = await api('/api/admin/settings', { method: 'PUT', body: { risk } }); toast('Risk rules saved.'); adRisk(); loadData(); } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- Organisation ---------------- */
function adOrg() {
  AP('org').innerHTML = `<div class="card" style="max-width:560px"><h3>Organisation</h3><p class="sub">Shown in the header and on the sign-in page</p>
    <label for="o-name">Organisation name</label><input id="o-name" value="${esc(S.admin.settings.orgName || '')}">
    <button class="btn btn-primary" id="o-save" style="margin-top:12px">Save</button></div>`;
  $('#o-save').onclick = async () => { try { S.admin.settings = await api('/api/admin/settings', { method: 'PUT', body: { orgName: $('#o-name').value } }); $('#org-name').textContent = S.admin.settings.orgName; toast('Saved.'); } catch (e) { toast(e.message, true); } };
}

/* ---------------- Audit log ---------------- */
async function adAudit() {
  AP('audit').innerHTML = '<div class="card"><h3>Audit log</h3><p class="sub">Sign-ins, changes to sources, keys, users and settings, syncs, and exports. The latest 3,000 entries.</p><div id="audit-tbl">Loading…</div></div>';
  try {
    const r = await api('/api/admin/audit');
    table($('#audit-tbl'), 'audit', [
      { k: 'at', label: 'Time', fmt: dt, csv: v => iso(v) }, { k: 'username', label: 'User' },
      { k: 'action', label: 'Action', fmt: v => v.replace(/_/g, ' ') }, { k: 'detail', label: 'Detail', wrap: true }, { k: 'ip', label: 'IP address' }
    ], r.audit, { sort: 'at', pageSize: 25, file: 'audit-log' });
  } catch (e) { $('#audit-tbl').textContent = e.message; }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { S.dirty = new Set(ATABS); render(); });
boot();
