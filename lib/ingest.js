'use strict';
// Fetches transactions from a configured API (server side, so keys never reach the browser
// and CORS is not an issue), then maps raw records onto a standard transaction shape.
const store = require('./store');
const { generateDemo } = require('./demo');

const FIELDS = [
  ['id', 'Transaction ID', ['transaction_id', 'txn_id', 'transactionid', 'txnid', 'txn_ref', 'reference', 'reference_no', 'ref', 'rrn', 'utr', 'id']],
  ['user', 'User / sender', ['user_id', 'userid', 'sender_id', 'senderid', 'payer_id', 'customer_id', 'customerid', 'from_account', 'debtor_account', 'remitter_id', 'account_id', 'user', 'sender', 'payer', 'customer', 'from', 'debtor', 'remitter']],
  ['ben', 'Beneficiary', ['beneficiary_id', 'beneficiaryid', 'beneficiary_account', 'beneficiary.id', 'beneficiary.account', 'payee_id', 'receiver_id', 'recipient_id', 'to_account', 'creditor_account', 'beneficiary', 'payee', 'receiver', 'recipient', 'to', 'creditor']],
  ['benName', 'Beneficiary name', ['beneficiary_name', 'beneficiaryname', 'beneficiary.name', 'payee_name', 'receiver_name', 'recipient_name', 'creditor_name', 'payee.name', 'receiver.name', 'recipient.name', 'creditor.name', 'beneficiary.full_name']],
  ['amount', 'Amount', ['amount', 'txn_amount', 'transaction_amount', 'amount.value', 'value', 'amt', 'total']],
  ['cur', 'Currency', ['currency', 'currency_code', 'ccy', 'amount.currency', 'txn_currency']],
  ['ts', 'Start time', ['created_at', 'createdat', 'initiated_at', 'timestamp', 'txn_time', 'transaction_time', 'txn_date', 'transaction_date', 'datetime', 'created', 'created_on', 'createdon', 'booking_date', 'posted_at', 'value_date', 'date', 'time']],
  ['end', 'Completed time', ['completed_at', 'completedat', 'settled_at', 'processed_at', 'finished_at', 'end_time', 'updated_at']],
  ['dur', 'Processing time', ['duration_ms', 'processing_time_ms', 'latency_ms', 'response_time_ms', 'elapsed_ms', 'processing_time', 'latency', 'response_time', 'duration', 'tat']],
  ['status', 'Status', ['status', 'txn_status', 'transaction_status', 'state', 'result']],
  ['reason', 'Failure reason', ['failure_reason', 'error_message', 'decline_reason', 'reason', 'error_code', 'response_code']],
  ['channel', 'Channel / type', ['channel', 'payment_mode', 'payment_type', 'mode', 'method', 'rail', 'type']],
  ['fee', 'Fee charged', ['fee', 'fees', 'fee_amount', 'charges', 'commission', 'service_charge']],
  ['sc', 'Sender country', ['sender_country', 'origin_country', 'from_country', 'source_country', 'payer_country', 'sender.country', 'customer.country', 'debtor.country', 'country']],
  ['bc', 'Beneficiary country', ['beneficiary_country', 'destination_country', 'to_country', 'payee_country', 'receiver_country', 'beneficiary.country', 'payee.country', 'receiver.country', 'recipient.country', 'creditor.country']],
  ['bank', 'Beneficiary bank', ['beneficiary_bank', 'bank_name', 'bank', 'beneficiary.bank', 'payee_bank', 'payee.bank', 'receiver.bank', 'recipient.bank', 'bic', 'swift', 'ifsc']],
];
const COLS = ['src', 'id', 'user', 'ben', 'benName', 'amount', 'cur', 'ts', 'dur', 'status', 'reason', 'channel', 'fee', 'sc', 'bc', 'bank'];

function flatten(o, pre = '', out = {}, depth = 0) {
  if (o == null || typeof o !== 'object') { out[pre || 'value'] = o; return out; }
  for (const k of Object.keys(o)) {
    const v = o[k], key = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, key, out, depth + 1);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
function findRecords(json, p) {
  if (p) { const v = getPath(json, p); if (Array.isArray(v)) return v; throw new Error('Nothing found at records path "' + p + '".'); }
  if (Array.isArray(json)) return json;
  let best = null;
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 4) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { if (!best || v.length > best.length) best = v; }
      else if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  walk(json, 0);
  if (!best) throw new Error('No list of transactions found in the response. Set the records path (for example data.items).');
  return best;
}
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  const first = text.split('\n')[0];
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  if (rows.length < 2) return [];
  const h = rows[0].map(x => x.trim());
  return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; });
}
function parseText(text, p) {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('[') || t.startsWith('{')) return findRecords(JSON.parse(t), p);
  return parseCSV(t);
}
const num = v => { if (v == null || v === '') return NaN; if (typeof v === 'number') return v; return parseFloat(String(v).replace(/[^0-9.\-eE]/g, '')); };
function tparse(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) { const n = +s; return n < 1e11 ? n * 1000 : n; }
  let t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s);
  if (isNaN(t)) {
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) t = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  return isNaN(t) ? null : t;
}
const NESTED_ID = new Set(['user', 'ben']);
function detect(keys) {
  const map = {}, used = new Set(), lower = keys.map(k => k.toLowerCase());
  for (const [f, , cands] of FIELDS) {
    let hit = -1;
    // 1) exact names  2) nested objects like customer.id / payee.account  3) nested leaf like value.amount
    for (const c of cands) { hit = lower.findIndex((k, ix) => !used.has(ix) && k === c); if (hit >= 0) break; }
    if (hit < 0 && NESTED_ID.has(f)) for (const c of cands) { hit = lower.findIndex((k, ix) => !used.has(ix) && (k === c + '.id' || k === c + '.account' || k === c + '.account_number' || k === c + '.number')); if (hit >= 0) break; }
    if (hit < 0) for (const c of cands) { if (c === 'id' || c.length < 3) continue; hit = lower.findIndex((k, ix) => !used.has(ix) && k.endsWith('.' + c)); if (hit >= 0) break; }
    if (hit >= 0) { map[f] = keys[hit]; used.add(hit); }
  }
  return map;
}
function keysOf(flat) { const ks = new Set(); flat.slice(0, 300).forEach(r => Object.keys(r).forEach(k => ks.add(k))); return [...ks]; }

function normalize(records, src) {
  const flat = records.map(r => flatten(r));
  const keys = keysOf(flat);
  const map = Object.assign({}, detect(keys), src.mapping || {});
  for (const k of Object.keys(map)) if (!map[k]) delete map[k];
  const unit = src.durUnit === 's' ? 1000 : 1;
  const defCur = (src.defaultCurrency || '').toUpperCase();
  const str = (r, f) => map[f] ? String(r[map[f]] ?? '').trim() : '';
  const rows = flat.map((r, i) => {
    const ts = map.ts ? tparse(r[map.ts]) : null, end = map.end ? tparse(r[map.end]) : null;
    let d = null;
    if (map.dur) { const n = num(r[map.dur]); if (!isNaN(n)) d = Math.round(n * unit); }
    else if (ts != null && end != null && end >= ts) d = end - ts;
    const amt = map.amount ? num(r[map.amount]) : NaN;
    const fee = map.fee ? num(r[map.fee]) : NaN;
    return [
      src.id,
      str(r, 'id') || String(i + 1),
      str(r, 'user') || '(none)',
      str(r, 'ben') || '(none)',
      str(r, 'benName'),
      isNaN(amt) ? 0 : amt,
      (str(r, 'cur') || defCur).toUpperCase(),
      ts, d,
      (str(r, 'status') || 'unknown').toLowerCase(),
      str(r, 'reason'),
      str(r, 'channel'),
      isNaN(fee) ? null : fee,
      str(r, 'sc').toUpperCase(),
      str(r, 'bc').toUpperCase(),
      str(r, 'bank'),
    ];
  });
  return { rows, keys, map };
}

function headersFor(src) {
  const h = { Accept: 'application/json, text/csv;q=0.9, */*;q=0.5' };
  let secret = '';
  try { secret = store.decrypt(src.secretEnc || ''); } catch (e) { throw new Error('The saved key could not be decrypted. Re-enter it (was the encryption key changed?).'); }
  if (src.authType === 'bearer' && secret) h.Authorization = 'Bearer ' + secret;
  if (src.authType === 'header' && secret) h[src.authHeaderName || 'x-api-key'] = secret;
  if (src.authType === 'basic') h.Authorization = 'Basic ' + Buffer.from((src.username || '') + ':' + secret).toString('base64');
  let extra = '';
  try { extra = store.decrypt(src.extraHeadersEnc || ''); } catch (e) { /* ignore */ }
  extra.split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  return { h, secret };
}

async function fetchRecords(src, { sample = false } = {}) {
  if (src.type === 'demo') return generateDemo(src.demoSize || 8000);
  if (!src.url) throw new Error('No URL configured.');
  const { h, secret } = headersFor(src);
  const pages = src.pageParam ? Math.max(1, Math.min(1000, +src.maxPages || 1)) : 1;
  let all = [];
  for (let i = 0; i < pages; i++) {
    const page = (+src.startPage || 1) + i;
    const u = new URL(src.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs are supported.');
    if (src.authType === 'query' && secret) u.searchParams.set(src.authQueryName || 'api_key', secret);
    if (src.pageParam) u.searchParams.set(src.pageParam, String(page));
    if (src.pageSizeParam && src.pageSize) u.searchParams.set(src.pageSizeParam, String(src.pageSize));
    const opt = { method: src.method || 'GET', headers: { ...h }, signal: AbortSignal.timeout(+src.timeoutMs || 30000) };
    if (opt.method === 'POST' && src.body) {
      opt.body = String(src.body).replace(/\{page\}/g, page).replace(/\{pageSize\}/g, src.pageSize || '');
      if (!Object.keys(opt.headers).some(k => k.toLowerCase() === 'content-type')) opt.headers['Content-Type'] = 'application/json';
    }
    let res;
    try { res = await fetch(u, opt); }
    catch (e) { throw new Error(e.name === 'TimeoutError' ? 'The API did not answer within ' + Math.round((+src.timeoutMs || 30000) / 1000) + ' seconds.' : 'Could not reach the API: ' + (e.cause?.message || e.message)); }
    const text = await res.text();
    if (!res.ok) {
      const tip = res.status === 401 || res.status === 403 ? ' Check the API key and authentication type.' : '';
      throw new Error('The API answered ' + res.status + ' ' + res.statusText + '.' + tip + ' ' + text.slice(0, 200).replace(/\s+/g, ' '));
    }
    const recs = parseText(text, src.recordsPath);
    all = all.concat(recs);
    if (sample || !recs.length) break;
    if (src.pageSize && recs.length < +src.pageSize) break;
  }
  return all;
}

module.exports = { FIELDS, COLS, fetchRecords, normalize, flatten, keysOf, detect, parseText };
