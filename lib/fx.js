'use strict';
// Exchange rates are kept as "units of currency per 1 USD".
// Priority: admin manual overrides > fetched rates (live or custom provider) > built-in fallback.
const store = require('./store');

// Approximate fallback rates so the app works offline. Admins should refresh or override these.
const FALLBACK = {
  USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.88, JPY: 150, CNY: 7.2, HKD: 7.8, SGD: 1.34, AUD: 1.52, NZD: 1.66, CAD: 1.37,
  AED: 3.6725, SAR: 3.75, QAR: 3.64, KWD: 0.307, BHD: 0.376, OMR: 0.3845, JOD: 0.709, EGP: 49, TRY: 38, ILS: 3.7,
  INR: 85, PKR: 280, BDT: 120, LKR: 300, NPR: 136, PHP: 57, IDR: 16200, MYR: 4.5, THB: 34, VND: 25500, KRW: 1380,
  NGN: 1550, KES: 129, GHS: 15, ZAR: 18.5, MAD: 9.8, ETB: 125, UGX: 3700, TZS: 2600,
  MXN: 18.5, BRL: 5.6, ARS: 1100, CLP: 940, COP: 4100, PEN: 3.75, RUB: 90, PLN: 4, SEK: 10.5, NOK: 10.7, DKK: 6.9, CZK: 23, HUF: 360, RON: 4.6
};
const NAMES = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', CHF: 'Swiss franc', JPY: 'Japanese yen', CNY: 'Chinese yuan', HKD: 'Hong Kong dollar', SGD: 'Singapore dollar', AUD: 'Australian dollar', NZD: 'New Zealand dollar', CAD: 'Canadian dollar',
  AED: 'UAE dirham', SAR: 'Saudi riyal', QAR: 'Qatari riyal', KWD: 'Kuwaiti dinar', BHD: 'Bahraini dinar', OMR: 'Omani rial', JOD: 'Jordanian dinar', EGP: 'Egyptian pound', TRY: 'Turkish lira', ILS: 'Israeli shekel',
  INR: 'Indian rupee', PKR: 'Pakistani rupee', BDT: 'Bangladeshi taka', LKR: 'Sri Lankan rupee', NPR: 'Nepalese rupee', PHP: 'Philippine peso', IDR: 'Indonesian rupiah', MYR: 'Malaysian ringgit', THB: 'Thai baht', VND: 'Vietnamese dong', KRW: 'South Korean won',
  NGN: 'Nigerian naira', KES: 'Kenyan shilling', GHS: 'Ghanaian cedi', ZAR: 'South African rand', MAD: 'Moroccan dirham', ETB: 'Ethiopian birr', UGX: 'Ugandan shilling', TZS: 'Tanzanian shilling',
  MXN: 'Mexican peso', BRL: 'Brazilian real', ARS: 'Argentine peso', CLP: 'Chilean peso', COP: 'Colombian peso', PEN: 'Peruvian sol', RUB: 'Russian ruble', PLN: 'Polish zloty', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', CZK: 'Czech koruna', HUF: 'Hungarian forint', RON: 'Romanian leu'
};

function effectiveRates() {
  const fx = store.db.settings.fx;
  const rates = Object.assign({}, FALLBACK, fx.mode === 'manual' ? {} : fx.fetched || {}, fx.manual || {});
  const sourceOf = {};
  for (const c of Object.keys(rates)) sourceOf[c] = (fx.manual && fx.manual[c] != null) ? 'manual' : (fx.mode !== 'manual' && fx.fetched && fx.fetched[c] != null) ? 'provider' : 'built-in';
  return { rates, sourceOf };
}

function getPath(o, p) { return p ? p.split('.').reduce((a, k) => a == null ? a : a[k], o) : o; }

async function refresh() {
  const fx = store.db.settings.fx;
  if (fx.mode === 'manual') return { ok: true, skipped: true };
  try {
    let rates, provider;
    if (fx.mode === 'custom') {
      if (!fx.customUrl) throw new Error('No custom FX URL configured.');
      const key = store.decrypt(fx.customKeyEnc || '');
      const u = new URL(fx.customUrl.replace('{key}', encodeURIComponent(key)));
      if (fx.customKeyQuery && key) u.searchParams.set(fx.customKeyQuery, key);
      const headers = { Accept: 'application/json' };
      if (fx.customKeyHeader && key) headers[fx.customKeyHeader] = key;
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('FX provider answered ' + res.status);
      const json = await res.json();
      const raw = getPath(json, fx.customRatesPath || 'rates');
      if (!raw || typeof raw !== 'object') throw new Error('No rates object at path "' + (fx.customRatesPath || 'rates') + '".');
      const base = (fx.customBase || 'USD').toUpperCase();
      const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toUpperCase(), +v]).filter(([, v]) => v > 0));
      r[base] = r[base] || 1;
      const usd = r.USD;
      if (!usd) throw new Error('The provider response has no USD rate, so rates cannot be normalised.');
      rates = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / usd]));
      provider = u.host;
    } else {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('Rate service answered ' + res.status);
      const json = await res.json();
      if (json.result !== 'success' || !json.rates) throw new Error('Rate service returned an unexpected response.');
      rates = json.rates; provider = 'open.er-api.com (ExchangeRate-API, daily mid-market)';
    }
    fx.fetched = rates; fx.updatedAt = Date.now(); fx.provider = provider; fx.error = null;
    store.save();
    return { ok: true, count: Object.keys(rates).length };
  } catch (e) {
    fx.error = e.message; fx.lastAttempt = Date.now(); store.save();
    return { ok: false, error: e.message };
  }
}

module.exports = { FALLBACK, NAMES, effectiveRates, refresh };
