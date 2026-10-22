# Contributing

Thanks for building on LazyApp. Every example here should be something a senior engineer would happily copy into production: typed end to end, small focused modules, and a test for every path through the conversation.

## Setup

```bash
npm ci
npm run check     # lint + typecheck + test; CI runs exactly this on Node 22 and 24
```

## Adding an example

1. **Copy the reference.** `cp -r examples/_template examples/<id>` and rename the package (`@lazyapp-examples/example-<id>`), `id`, `title` and `startCode` (`DEMO <WORD>`, unique).
2. **Declare the manifest** (`src/manifest.ts`):
   - Template names start with `demo_<id>_` (hyphens become underscores); flow keys are short (`checkout`), LazyApp names them `demo_<id>_<key>`.
   - Flow JSON lives in `flows/<key>.json`, loaded with `loadFlowJson()`. Set `dataExchange: true` only when the flow calls `flowEndpoints[key]`.
   - List every webhook event `onEvent` handles in `webhookEvents` (e.g. `payment.captured`). `message.received` is implicit.
   - Set `requires.catalog` / `requires.payments` to `optional` and **implement the fallback**: no catalog → interactive lists; no payment configuration → payment link, UPI intent or pay on delivery, and say so in the chat.
   - Add a `command` (`/shop`) for conversation starters. Only add an `iceBreaker` if it is worth showing to every visitor of the number.
3. **Model the state** with zod (`src/state.ts`). Store ids and quantities, not catalog copies. Replace state with `ctx.setState`, never mutate it.
4. **Need a web page?** (a sign-in page, generated ticket files, a staff check-in screen) Declare `web: [{ method, path, handler }]` on the example; it is served at `/x/<id>/<path>`. Handlers get the example's `kv`, the API client, the caller's IP, `session(address)` and `notify(address, key, handler)`, which runs a turn in that person's live session exactly once per key and never reaches anyone outside the demo. Use `htmlResponse()` (strict CSP, no framing, no referrer) and `escapeHtml()`.
5. **Write handlers** as small functions of `(ctx, inbound)`. Switch on `inbound.kind`; never dig through `inbound.raw` unless you must.
6. **Write tests first-class** (`test/*.test.ts`) with `createHarness`: the happy path, every fallback, every button, unexpected input, EXIT mid-flow, and the events you handle.
7. **Write the README** (see below).
8. Run `npm run check` and `npm run setup -- --dry-run --only <id>`.

## Rules for examples

The demo number is shared with real traffic. The router enforces the hard rules, and examples must not work around them:

- Reply to the person who wrote. Never send to any other number.
- No business-initiated messages except `ctx.followUps.schedule`, after an explicit in-chat tap, with an approved template. Marketing follow-ups also need `ctx.consent.optInToMarketing(...)` from a tap like "Remind me".
- Stay inside the 24-hour window. Do not send more than you need: LazyApp refuses more than **20 sends per hour to one person** (`recipient_rate_limit`), so prefer one rich message (buttons with a media header, a carousel, a list) over several small ones. Aim for at most 2–3 messages per turn.
- Every message an example sends should carry `DEMO_FOOTER` (or end with a menu) so `MENU · EXIT · STOP` stay discoverable.
- Use the `ui.*` builders (via `ctx.send.*`): they trim data-driven copy to Meta's limits and throw on structural mistakes in tests.
- Use `ctx.idempotencyKey(label)` for every write you make through `ctx.api` (payments, contacts, events).
- Handle `FlowUnavailableError`, `null` from `ctx.capabilities.catalog()` / `.payments()`, and `LazyAppRefusalError` codes you can act on.
- No secrets in code. Configuration comes from the environment, documented in `.env.example`.

## Example README template

Each `examples/<id>/README.md` has:

1. One-paragraph pitch: who this is for and what the conversation does.
2. **Try it**: the start code and what to tap.
3. A **mermaid sequence diagram** of the main path (User, WhatsApp, LazyApp, demo server).
4. **Meta features used**: a table of feature → where in the flow → LazyApp API call.
5. **LazyApp API calls**: every endpoint the example uses, with the exact request shape.
6. **Fallbacks**: what happens without a catalog, payments, flows, or address messages.
7. **Run it yourself**: setup flags, required env, and how to run only this example (`DEMO_EXAMPLES=<id>`).

## Platform gaps

If LazyApp's API cannot do something an example needs, does it wrongly, or documents it wrongly, do not hack around it silently. Write down the endpoint, the problem, evidence (request/response or source line), and a suggested fix, and open an issue on LazyApp.

## Commits

Small, focused commits with messages in the imperative ("Add the food ordering demo"). Never force-push `main`.
