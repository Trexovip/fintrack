# FinTrack Analytics

Self-hosted transaction analytics for payments and remittance teams. It has two roles:

- **Admin.** Adds data sources (your transaction APIs) and their API keys, manages staff accounts and access, and sets currencies, exchange rates and risk rules.
- **Staff.** Uses the analytics for the data sources they are allowed to see. Staff never see API keys or settings.

API calls are made by the server, never by the browser. That keeps keys secret and avoids CORS problems.

## Quick start

You need Node.js 18.17 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. On first visit you create the admin account and choose a reporting currency. Leave "Add a demo data source" ticked to explore with sample data, then delete the demo source when your real API is connected.

### With Docker

```bash
docker build -t fintrack .
docker run -d -p 3000:3000 -v fintrack-data:/data -e MASTER_KEY="<your key>" --name fintrack fintrack
```

## Connecting your transactions API

Go to Admin › Data sources & API keys › Add data source.

1. Enter the endpoint URL and method (GET or POST, with an optional JSON body).
2. Pick the authentication type and paste the key:
   - Bearer token (`Authorization: Bearer …`)
   - API key in a header (you choose the header name, such as `x-api-key`)
   - API key in the URL (you choose the query parameter name)
   - Username and password (HTTP Basic)

   Extra headers such as a client ID can be added too, and they are encrypted as well.
3. If the API returns pages, set the page parameter, page size and how many pages to fetch per sync. In a POST body you can use `{page}` and `{pageSize}`.
4. Click **Test connection**. The server fetches the first page, shows the first record (with sensitive-looking fields hidden) and suggests a field mapping. Fix any field it could not match.
5. Save. The source syncs immediately and then on the schedule you set.

The response can be JSON or CSV. The transaction list is found automatically. If it is nested, set the records path (for example `data.items`).

### Fields the analytics use

Only user, beneficiary, amount and time are needed. Each extra field unlocks more reports.

| Field | Unlocks |
| --- | --- |
| User / sender, Beneficiary, Amount, Start time | Core reports |
| Currency (or a default currency per source) | Multi-currency conversion |
| Status, Failure reason | Success rates, failure analysis |
| Processing time, or Completed time | Latency, speed recommendations |
| Fee | Revenue, take rate, revenue lost to failures |
| Sender country, Beneficiary country | Corridors, cross-border, high-risk jurisdictions |
| Beneficiary name, bank, Channel | Labels, bank concentration, channel comparison |

## Reports

- **Overview:** totals, success rate, fee revenue, cross-border share, trends, top beneficiaries, currency mix, activity heatmap and generated findings.
- **Growth:** period-over-period change, daily value with a 7-day average, new and returning users, customer concentration (Pareto) and day-of-week performance.
- **Beneficiaries:** who receives the most and their share. Drill into any beneficiary to see every payer. Also shows beneficiaries shared by many users and bank concentration.
- **Users:** transactions, value, peak transactions per second and per minute, average gap, success, processing time and currencies per user. Drill into any user.
- **Currencies:** value by currency, FX exposure, original and converted amounts, rates and sources, and currency mix by destination.
- **Corridors:** sender country → beneficiary country routes with value, success, speed and take rate. Compares cross-border with domestic, and shows inbound and outbound countries.
- **Fees & revenue:** fee revenue, take rate in basis points, by channel, currency and corridor, top revenue customers, and estimated revenue lost to failures.
- **Speed & operations:** p50, p90, p95 and p99 latency, throughput (TPS), latency by hour and channel, failure reasons with time-to-fail, stuck pending transactions, slowest transactions and recommendations.
- **Risk & compliance:** velocity bursts, high frequency, duplicates, payer spikes (fan-in), fan-out, structuring under the reporting threshold, large transactions, large first payments to new beneficiaries, round amounts, unusual amounts, repeated failures, high-risk jurisdictions and stuck pending. Includes a large transaction report and a high-risk jurisdiction report.
- **Transactions:** the full filtered list.

Every table can be exported to CSV. There is also a full summary report and a print view. Exports are recorded in the audit log.

## Currencies

Every user can switch the display currency from the top bar. Admins choose the default reporting currency, which is also the currency risk thresholds are written in. When it changes, amount thresholds are converted automatically.

Rate sources (Admin › Currencies & FX):

- **Free daily rates** from open.er-api.com. No key is needed, and they refresh every 12 hours by default.
- **Your own provider:** a bank, treasury system or paid feed. Enter the URL, key, path to the rates object and base currency.
- **Manual:** only your own rates.

Manual overrides always win, so you can pin your bank's booking rate. Approximate built-in rates are used until the first refresh.

Note that amounts are converted at the current rate, not the historical rate on each transaction date. Treat converted totals as management figures, not accounting figures.

## Security

- Passwords are hashed with bcrypt. They must have at least 10 characters including letters and numbers. Repeated failed sign-ins lock the account temporarily.
- API keys, extra headers and the FX provider key are encrypted with AES-256-GCM. They are never returned by the API; admins only see the last 4 characters.
- Sessions use an HttpOnly, SameSite=Strict cookie. Changes require a custom request header (CSRF protection), and strict security headers are set (CSP, no framing).
- Staff are restricted server-side to their assigned data sources. All admin endpoints reject staff.
- The audit log records sign-ins, failed sign-ins, changes to sources, keys, users and settings, syncs and exports.

Before going live:

1. Set `MASTER_KEY` in the environment and keep a secure backup. If it is lost, saved keys cannot be decrypted and must be re-entered.
2. Serve over HTTPS behind a reverse proxy (nginx, Caddy or a cloud load balancer). Set `SECURE_COOKIE=true` and `TRUST_PROXY=true`.
3. Restrict network access to your staff (VPN or IP allow-list), and back up the `data/` folder.
4. Admins can point a data source at any URL the server can reach. Only give admin rights to trusted people.

## Storage and scale

Settings, users and the audit log live in `data/db.json`. Synced transactions are cached in `data/cache/` (they are not encrypted at rest, so protect the server disk). Analytics run in the browser, which handles a few hundred thousand transactions comfortably. For millions of rows, move storage to PostgreSQL or ClickHouse and push aggregation into SQL; the API shape (`/api/data`) can stay the same.

## Risk rules disclaimer

Risk flags are review signals, not proof of wrongdoing. They do not replace a regulated transaction monitoring system. Thresholds and the high-risk country list must be set to your own regulatory obligations. The FATF lists change several times a year.
