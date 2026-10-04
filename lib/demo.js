'use strict';
// Generates realistic multi-currency, cross-border sample transactions with planted risk patterns.
function generateDemo(n = 8000) {
  let seed = 424242;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const wpick = (items, w) => { const s = w.reduce((a, b) => a + b, 0); let r = rnd() * s; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[0]; };

  // corridors: [benCountry, currency, weight, bank names]
  const corridors = [
    ['AE', 'AED', 30, ['Emirates Gulf Bank', 'Desert National Bank', 'Creek Commercial Bank']],
    ['IN', 'INR', 22, ['Bharat Union Bank', 'Western Coast Bank', 'Deccan Co-operative']],
    ['PK', 'PKR', 12, ['Indus Commercial Bank', 'Punjab Mercantile']],
    ['PH', 'PHP', 8, ['Luzon Savings Bank', 'Visayas Trust']],
    ['EG', 'EGP', 6, ['Nile Commercial Bank']],
    ['GB', 'GBP', 6, ['Thames Retail Bank', 'Northern Counties Bank']],
    ['US', 'USD', 6, ['Hudson National', 'Great Lakes Federal']],
    ['DE', 'EUR', 4, ['Rhein Handelsbank']],
    ['SA', 'SAR', 4, ['Najd Commercial Bank']],
    ['BD', 'BDT', 2, ['Padma Commercial Bank']],
  ];
  const fxApprox = { AED: 3.6725, INR: 85, PKR: 280, PHP: 57, EGP: 49, GBP: 0.79, USD: 1, EUR: 0.92, SAR: 3.75, BDT: 120 };
  const firstNames = ['Harbor', 'Sandstone', 'Palm', 'Northgate', 'Bluewater', 'Oasis', 'Falcon', 'Silverleaf', 'Dune', 'Corniche', 'Pearl', 'Meridian', 'Amber', 'Zenith', 'Crescent', 'Skyline', 'Cedar', 'Atlas', 'Mirage', 'Coral', 'Lotus', 'Monsoon', 'Saffron', 'Indigo'];
  const lastNames = ['Trading', 'Logistics', 'Foods', 'Electronics', 'Marine', 'Supplies', 'Freight', 'Pharmacy', 'Motors', 'Textiles', 'Realty', 'Telecom', 'Family Account', 'Utilities', 'School Fees', 'Rentals', 'Medical', 'Builders', 'Travel', 'Insurance'];
  const bens = [];
  let bi = 0;
  for (const [cc, cur, w, banks] of corridors) {
    const count = Math.max(4, Math.round(w * 2.2));
    for (let j = 0; j < count; j++) {
      bens.push({ id: 'BEN' + (5001 + bi), name: pick(firstNames) + ' ' + pick(lastNames), cc, cur, bank: pick(banks), w: 1 / Math.pow(j + 1, 0.9) * w });
      bi++;
    }
  }
  const users = Array.from({ length: 260 }, (_, i) => ({ id: 'U' + (1001 + i), cc: rnd() < 0.85 ? 'AE' : pick(['SA', 'GB', 'US']), join: Math.floor(rnd() * 14) }));
  const fav = new Map(users.map(u => [u.id, [wpick(bens, bens.map(b => b.w)), wpick(bens, bens.map(b => b.w)), wpick(bens, bens.map(b => b.w))]]));
  const channels = ['Mobile app', 'Web banking', 'Partner API', 'Branch'];
  const reasons = ['Insufficient funds', 'Beneficiary bank timeout', 'Invalid account number', 'Compliance hold', 'Daily limit exceeded'];
  const reasonW = [30, 28, 18, 12, 12];
  const hourW = [1, .5, .3, .3, .4, .8, 2, 4, 6, 8, 9, 9, 8, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const days = 14;
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
  const out = []; let id = 7000000;

  const mk = (user, ben, usdAmount, ts, o = {}) => {
    const ch = o.ch || pick(channels);
    const h = new Date(ts).getHours();
    const cross = ben.cc !== user.cc;
    // most users pay in AED; cross-border is sometimes initiated in the destination currency
    const cur = o.cur || (rnd() < (cross ? 0.35 : 0.1) ? ben.cur : (user.cc === 'AE' ? 'AED' : user.cc === 'SA' ? 'SAR' : user.cc === 'GB' ? 'GBP' : 'USD'));
    const amount = Math.round(usdAmount * fxApprox[cur] * 100) / 100;
    let st = o.st || (rnd() < (cross ? 0.07 : 0.04) ? 'FAILED' : 'SUCCESS');
    if (!o.st && Date.now() - ts < 3 * 3600e3 && rnd() < 0.25) st = 'PENDING'; // recent ones still in flight
    let ms = Math.exp(6.6 + 0.55 * gauss()) * (ch === 'Partner API' ? 0.6 : ch === 'Branch' ? 2.2 : 1) * (hourW[h] > 8 ? 1.6 : 1) * (cross ? 1.8 : 1);
    if (st === 'FAILED') ms *= rnd() < 0.5 ? 12 : 2.5;
    if (rnd() < 0.02) ms *= 25;
    const feeRate = cross ? 0.009 + rnd() * 0.006 : 0.002;
    const fee = Math.round((amount * feeRate + (cross ? 5 : 1) * fxApprox[cur] / 3.6725) * 100) / 100;
    out.push({
      transaction_id: 'TXN' + (id++),
      user_id: user.id,
      sender_country: user.cc,
      beneficiary: { id: ben.id, name: ben.name, country: ben.cc, bank: ben.bank },
      amount, currency: cur, fee: st === 'SUCCESS' ? fee : 0,
      created_at: new Date(ts).toISOString(),
      completed_at: st === 'PENDING' ? null : new Date(ts + ms).toISOString(),
      status: st,
      failure_reason: st === 'FAILED' ? wpick(reasons, reasonW) : '',
      channel: ch,
    });
  };
  const base = Math.round(n * 0.94);
  for (let i = 0; i < base; i++) {
    const d = Math.floor(rnd() * days);
    const growth = 0.75 + 0.5 * d / days; // gentle growth trend
    if (rnd() > growth) { i--; continue; }
    const hr = wpick([...Array(24).keys()], hourW);
    const ts = start.getTime() + d * 86400e3 + hr * 3600e3 + Math.floor(rnd() * 3600e3);
    if (ts > Date.now()) { i--; continue; }
    const eligible = users.filter(u => u.join <= d);
    const u = pick(eligible.length ? eligible : users);
    const ben = rnd() < 0.62 ? pick(fav.get(u.id)) : wpick(bens, bens.map(b => b.w));
    mk(u, ben, Math.max(3, Math.exp(5.6 + 1.1 * gauss())), ts);
  }
  const U = idx => users[idx];
  const t0 = start.getTime();
  // velocity bursts
  for (let k = 0; k < 4; k++) { const s = t0 + 5 * 86400e3 + (10 + k) * 3600e3 + 123000; for (let j = 0; j < 6; j++) mk(U(6), bens[3], 70 + j, s + j * 140, { ch: 'Partner API', st: 'SUCCESS' }); }
  // payer spike to a quiet beneficiary
  const quiet = bens[bens.length - 3];
  for (let j = 0; j < 30; j++) mk(U((j * 7 + 11) % users.length), quiet, 220 + rnd() * 400, t0 + 11 * 86400e3 + 9 * 3600e3 + j * 45e3);
  // structuring just below 10,000 USD equivalent
  for (let j = 0; j < 6; j++) mk(U(32), bens[25], 9500 + Math.floor(rnd() * 480), t0 + (j * 2) * 86400e3 + 12 * 3600e3, { cur: 'USD' });
  // duplicates
  for (let j = 0; j < 4; j++) { const s = t0 + (j * 3) * 86400e3 + 15 * 3600e3; mk(U(49), bens[7], 330, s, { cur: 'AED' }); mk(U(49), bens[7], 330, s + 25000, { cur: 'AED' }); }
  // outlier
  for (let j = 0; j < 8; j++) mk(U(87), bens[2], 90 + rnd() * 50, t0 + j * 100000e3);
  mk(U(87), bens[40], 130000, t0 + 12 * 86400e3 + 22 * 3600e3);
  // fan-out
  for (let j = 0; j < 10; j++) mk(U(119), bens[45 + j], 550 + rnd() * 140, t0 + 8 * 86400e3 + 20 * 3600e3 + j * 240e3);
  // a few stuck in pending since yesterday
  for (let j = 0; j < 6; j++) mk(pick(users), pick(bens), 400 + rnd() * 900, Date.now() - 86400e3 + j * 1800e3, { st: 'PENDING', ch: 'Partner API' });
  // high-risk jurisdiction payments
  const hr = { id: 'BEN9901', name: 'Persian Gulf Exports', cc: 'IR', cur: 'USD', bank: 'Tehran Trade Bank', w: 0 };
  for (let j = 0; j < 3; j++) mk(U(140 + j), hr, 2500 + rnd() * 2000, t0 + (4 + j * 3) * 86400e3 + 14 * 3600e3, { cur: 'USD' });
  return out.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
}
module.exports = { generateDemo };
