# LazyApp examples

Production-grade WhatsApp apps built on the [LazyApp](https://lazyapp.in) API: a storefront, food ordering, real estate, lead generation and more, each one a full end-to-end conversation using the Meta features a real business would use (catalogs, Flows, India payments, address forms, templates, carousels…).

Every example runs on one shared WhatsApp number behind one small server, and every example is a typed, fully tested state machine you can copy into your own product.

> **Try them on WhatsApp:** message **`DEMO`** to the LazyApp demo number to see every demo, or send a demo's start code (for example `DEMO HELLO`). Type `MENU` any time, `EXIT` to leave, `STOP` to opt out.

## Examples

<!-- examples:start -->

| Demo                                                     | Start code        | What it shows                                                                                                                                                                                         |
| -------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Hello LazyApp](examples/_template) (reference)          | `DEMO HELLO`      | Reply buttons, lists, reactions, location request, a WhatsApp Flow, follow-ups                                                                                                                        |
| [Halo Home Care](examples/support-desk)                  | `DEMO SUPPORT`    | Support desk: FAQ lists, order tracking, tickets with photos, SLA routing to agents in business hours, escalation, CSAT Flow, reopen, inbox pinning                                                   |
| [Login with WhatsApp](examples/otp-login)                | `DEMO OTP`        | Authentication templates (copy code, one-tap), managed OTP send/verify in chat and on a web sign-in page, sign-in alerts from `otp.*` webhooks, fraud guards                                          |
| [LazyApp Events](examples/event-tickets)                 | `DEMO EVENTS`     | Media carousel, attendee Flow with live pricing, India payments with seat holds, QR tickets (PNG + PDF), reminders with a map, web check-in, waitlist                                                 |
| [Brickfield Homes](examples/real-estate)                 | `DEMO HOMES`      | Property search to site visit: data-exchange Flows (preferences, EMI, slot booking), media carousel, brochure PDF, location, agent contact card, location-header template, reminders, lead-score tags |
| [Ledgerly lead machine](examples/lead-generation)        | `DEMO LEADS`      | Ad/QR attribution, qualification Flow, scoring with reasons, signed CRM webhook, rep calendar Flow, consented nurture with a coupon template, every opt-out path                                      |
| [Clinic appointments](examples/clinic-appointments)      | `DEMO CLINIC`     | Live-slot booking Flow, consultation fee payments with refunds, reminder templates, pre-visit Flow, prescription PDFs                                                                                 |
| [Study abroad admissions](examples/education-admissions) | `DEMO ADMISSIONS` | Course finder Flow, program carousel, document uploads, application fee, parent view, image-header intake template                                                                                    |
| [WhatsApp Shop](examples/whatsapp-shop)                  | `DEMO SHOP`       | A D2C store: catalog and carousels, sizes, India address message, slots, UPI/COD checkout, order status, returns Flow, coupon and cart reminder                                                       |
| [Food ordering](examples/food-ordering)                  | `DEMO FOOD`       | A cloud kitchen: nearest outlet by location, customise Flow, scheduled orders, UPI/cash, rider card and pin, table booking Flow, loyalty, one-tap reorder                                             |

<!-- examples:end -->

## How it works

```mermaid
flowchart LR
  U([WhatsApp user]) <--> M[Meta Cloud API]
  M <--> L[LazyApp]
  L -- "signed webhook<br/>X-LazyApp-Signature" --> W
  subgraph S[demo server · Hono on Node 22]
    W[POST /webhooks/lazyapp] --> I[(SQLite inbox<br/>dedupe by event id)]
    I --> Q[per-user serial queue]
    Q --> R{router<br/>hard rules}
    R -- start code / session --> E[example state machine]
    R -- everyone else --> X[silence]
    F[POST /flows/:example/:flow] --> E
  end
  E -- "typed SDK<br/>Idempotency-Key per event" --> L
  L -- "decrypted, signed<br/>data_exchange" --> F
```

1. LazyApp delivers a signed webhook. The server verifies the HMAC over the raw bytes, writes the event to a SQLite inbox (a redelivered event id is dropped), answers `202` and moves on.
2. A queue processes events per person in order, and different people in parallel.
3. The **router** enforces the shared-number rules before any example code runs (below).
4. The example's handler receives `ctx` and a normalised `inbound` message. All I/O goes through `ctx`: sends, flows, payments, state, storage.
5. Every send carries an `Idempotency-Key` derived from the inbound event id, so a replay after a crash makes LazyApp return the original message instead of sending it twice.

### Rules for a shared number

The demo number also carries real traffic (login codes, customers). The router guarantees:

| Rule                                       | How                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Silent for everyone who did not opt in     | No session and no start code → no API call at all, not even a read receipt.                                                            |
| No unsolicited business-initiated messages | Examples only reply. Follow-ups need an explicit in-chat tap, go out as approved templates, and marketing ones need a recorded opt-in. |
| `MENU`, `EXIT`, `STOP` work everywhere     | Handled by the router, never reach an example. `STOP` also records an opt-out and cancels scheduled follow-ups.                        |
| Sessions end after 24h idle                | Then the person is a stranger again. Free-form sends outside the 24h window fail fast instead of costing a template.                   |
| One demo at a time                         | A new start code ends the current demo (and its follow-ups) first.                                                                     |

## Repository layout

```
packages/sdk        Typed LazyApp client: retries, idempotency, typed errors, webhook verification
packages/demo-kit   Example contract, router, SQLite store, UI builders, test harness
packages/setup      `npm run setup`: provisions templates, flows, webhook, starters, QR links
apps/demo-server    Hono server: webhooks, flow data endpoints, health, demo catalogue
examples/_template  The reference example every demo follows
examples/<name>     One directory per demo (auto-discovered)
deploy/             nginx, systemd and pm2 files for demo.lazyapp.in
```

## Run it yourself

You need Node **22.13+**, a LazyApp workspace with a connected WhatsApp number, and an API key.

```bash
git clone https://github.com/Meavita-Global/lazyapp-examples && cd lazyapp-examples
npm ci
cp .env.example .env              # add LAZYAPP_API_KEY and PUBLIC_BASE_URL

npm run setup -- --dry-run        # see what would be created; changes nothing
npm run setup                     # creates templates, flows, webhook, /commands, QR codes
                                  # → copy the printed LAZYAPP_WEBHOOK_SECRET into .env
npm run dev                       # http://localhost:8787, reloads on change
```

LazyApp needs to reach your server over HTTPS. Locally, run a tunnel (`cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_BASE_URL` to its URL before `npm run setup`.

Then send `DEMO` to your number.

| Command                   | Does                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`             | Demo server with reload                                                      |
| `npm start`               | Demo server                                                                  |
| `npm run setup -- --help` | Provisioning options (`--only shop,food`, `--no-publish`, `--ice-breakers`…) |
| `npm test`                | Every test (SDK, router, server, examples)                                   |
| `npm run check`           | Lint + typecheck + test, as CI runs it                                       |

## Writing an example

Copy `examples/_template`, rename the id and start code, and write handlers. The whole contract:

```ts
export default defineExample<State>({
  id: 'shop',
  title: 'WhatsApp Store',
  startCode: 'DEMO SHOP',
  manifest,                    // templates, flows, webhook events, catalog/payment needs
  stateSchema,                 // zod: stored state is validated on every load
  initialState: () => ({ cart: [] }),
  describe: () => ({ summary: '…', metaFeatures: ['Catalog', 'Payments (India)'] }),
  async onStart(ctx, inbound) { await ctx.send.buttons({ … }) },
  async onMessage(ctx, inbound) { switch (inbound.kind) { … } },
  async onEvent(ctx, event) { /* payment.captured … */ },
  flowEndpoints: { checkout: async (ctx, request) => ({ screen: 'SUMMARY', data: { … } }) },
});
```

Tests drive the example like a person would and assert on the exact HTTP calls:

```ts
const h = createHarness(shop, { catalog: products, paymentConfiguration: 'demo-store' });
await h.user.send('DEMO SHOP');
await h.user.sendOrder([{ retailerId: 'kurta-indigo', quantity: 2 }]);
expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({ items: [{ quantity: 2 }] });
await h.payPayment();
expect(h.texts().at(-1)).toContain('Payment received');
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist.

## Deploy (demo.lazyapp.in)

One small VM with Node 22 is enough: a single process, SQLite on local disk.

```bash
sudo useradd --system --home /srv/lazyapp-examples lazyapp-demo
sudo git clone https://github.com/Meavita-Global/lazyapp-examples /srv/lazyapp-examples
cd /srv/lazyapp-examples && sudo npm ci --omit=dev
sudo install -o lazyapp-demo -m 600 .env.example .env    # then fill it in
sudo install -d -o lazyapp-demo data

sudo cp deploy/nginx.conf /etc/nginx/sites-available/demo.lazyapp.in
sudo ln -s /etc/nginx/sites-available/demo.lazyapp.in /etc/nginx/sites-enabled/
sudo certbot --nginx -d demo.lazyapp.in && sudo nginx -s reload

sudo cp deploy/lazyapp-demo.service /etc/systemd/system/
sudo systemctl enable --now lazyapp-demo
journalctl -u lazyapp-demo -f            # JSON logs, phone numbers masked
```

Prefer pm2? `pm2 start deploy/ecosystem.config.cjs && pm2 save`. Run **one** instance: per-person ordering relies on the in-process queue.

Deploys are safe to do at any time: `SIGTERM` stops intake, drains the queue and closes SQLite; anything accepted but not processed stays in the inbox and is replayed on the next boot. `GET /healthz` is for your uptime monitor.

### Environment

| Variable                    | Required | Default                     | Notes                                                                |
| --------------------------- | -------- | --------------------------- | -------------------------------------------------------------------- |
| `LAZYAPP_API_KEY`           | yes      |                             | `sk_live_…` / `sk_test_…`                                            |
| `LAZYAPP_WEBHOOK_SECRET`    | yes      |                             | Printed once by `npm run setup`                                      |
| `PUBLIC_BASE_URL`           | yes\*    | `http://localhost:8787`     | HTTPS origin LazyApp calls (\*required by setup)                     |
| `LAZYAPP_BASE_URL`          |          | `https://lazyapp.in`        |                                                                      |
| `LAZYAPP_PHONE_NUMBER_ID`   |          |                             | Send from this number when the workspace has several                 |
| `LAZYAPP_CONNECTION_UUID`   |          | default connection          | Setup only                                                           |
| `LAZYAPP_FLOW_SECRETS`      |          | `{}`                        | `{"shop/checkout":"whfs_…"}`: per-flow data-endpoint signing secrets |
| `DEMO_PHONE_NUMBER`         |          |                             | E.164, for chat links on `GET /demos`                                |
| `DEMO_EXAMPLES`             |          | all                         | Comma-separated ids, in hub order                                    |
| `INCLUDE_REFERENCE_EXAMPLE` |          | `false`                     | Also run `DEMO HELLO`                                                |
| `PAYMENT_CONFIGURATION`     |          | auto-detected               | Active WhatsApp payment configuration (India)                        |
| `PAYMENT_GATEWAY_ACCOUNT`   |          |                             | Payment-link fallback (Cashfree / Razorpay account in LazyApp)       |
| `SESSION_IDLE_HOURS`        |          | `24`                        |                                                                      |
| `DATABASE_PATH`             |          | `./data/demo.sqlite`        |                                                                      |
| `HOST`, `PORT`, `LOG_LEVEL` |          | `127.0.0.1`, `8787`, `info` |                                                                      |

### HTTP endpoints

| Route                        | Purpose                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `POST /webhooks/lazyapp`     | LazyApp webhooks (signature required)                                           |
| `POST /flows/:example/:flow` | WhatsApp Flow `data_exchange`, forwarded decrypted and signed by LazyApp        |
| `GET /healthz`               | Liveness, queue depth, loaded examples                                          |
| `GET /demos`                 | Public catalogue: titles, start codes, Meta features, `wa.me` links             |
| `GET, POST /x/:example/*`    | An example's own web pages (`web` routes): sign-in page, ticket files, check-in |

## License

[MIT](LICENSE)
