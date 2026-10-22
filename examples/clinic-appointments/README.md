# Clinic appointments (Aarogya Clinics)

A multi-specialty clinic's front desk on WhatsApp, for clinics, diagnostic centres and hospital OPDs in India. Patients pick a specialty and a doctor, see **live availability** inside a WhatsApp Flow, hold a slot, pay the consultation fee with **WhatsApp Pay** (or choose to pay at the clinic), and then get reminders, a pre-visit form, directions, and their prescription and lab report as PDFs. Reschedules, cancellations with automatic refunds, and follow-up visits work in the same chat.

Aarogya Clinics is fictional: three Bengaluru branches, seven specialties, eight doctors with their own weekly rosters and fees.

## Try it

Send **`DEMO CLINIC`** (or `/clinic`) to the demo number, then:

1. **Book an appointment** → _General Medicine_ → _Dr. Kavita Rao_ → **Pick a slot**.
2. Tap **I agree** on the privacy prompt (DPDP Act consent before any health data is collected).
3. In the Flow, pick a day: the times load live. Enter the patient's name and age and tap **Hold this slot**.
4. **Pay ₹600 now** (WhatsApp order with UPI) or **Pay at clinic**.
5. Tap **Remind me**, fill the **Pre-visit form**, send an old report as a photo or PDF.
6. Open **Reports & prescriptions** from the menu: the demo fast-forwards past the visit, sends the prescription and lab report PDFs, and offers a half-price **follow-up**.

`MENU` shows the menu, `EXIT` ends the demo (and releases any unpaid hold), `STOP` ends it and opts you out.

## The conversation

```mermaid
sequenceDiagram
  autonumber
  actor P as Patient
  participant W as WhatsApp
  participant L as LazyApp
  participant S as Demo server
  P->>W: "DEMO CLINIC"
  W->>L: message
  L->>S: message.received (signed)
  S->>L: POST /v1/messages (list: book, my appointment, reports, branches…)
  P->>L: Book → General Medicine → Dr. Kavita Rao → Pick a slot → I agree
  S->>L: POST /v1/messages (interactive flow, flow_action: data_exchange)
  W->>L: Flow INIT (encrypted)
  L->>S: POST /flows/clinic-appointments/book (decrypted, signed)
  S-->>L: APPOINTMENT screen: open dates
  P->>W: picks Saturday
  L->>S: data_exchange {trigger: date_selected}
  S-->>L: free times for Saturday
  P->>W: 10:30 AM, name, age → Hold this slot
  L->>S: data_exchange {trigger: book}
  S->>S: hold slot in shared store (15 min)
  S-->>L: SUCCESS {booking_id}
  L->>S: message.received (nfm_reply)
  S->>L: POST /v1/messages (buttons: Pay ₹600 now · Pay at clinic · Change slot)
  P->>L: Pay ₹600 now
  S->>L: POST /v1/payments (order_details, payment_gateway)
  L->>W: Review and pay
  P->>W: pays with UPI
  L->>S: payment.captured
  S->>L: POST /v1/payments/{id}/status {processing}
  S->>L: POST /v1/messages (Appointment confirmed ✅)
  P->>L: Remind me
  S->>L: POST /v1/messages {template, send_at: visit − 24h} ×2
  P->>L: Reports & prescriptions
  S->>L: POST /v1/payments/{id}/status {completed}
  S->>L: POST /v1/messages (document: prescription PDF; buttons with PDF header: lab report)
```

## Meta features used

| Feature                             | Where in the flow                                                    | LazyApp API                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| List messages                       | Main menu, specialties, doctors, manage booking, fallback slots      | `POST /v1/messages` `interactive.type: list`                                                   |
| Reply buttons with image header     | Doctor profile card (photo)                                          | `interactive.type: button`, `header.type: image`                                               |
| Reply buttons with document header  | Lab report with "Book follow-up"                                     | `interactive.type: button`, `header.type: document`                                            |
| WhatsApp Flow with data endpoint    | Live slot picker: dates → times → patient details → hold             | `POST /v1/flows` (`data_endpoint_uri`), `interactive.type: flow`, `flow_action: data_exchange` |
| WhatsApp Flow, navigate             | Pre-visit intake form                                                | `interactive.type: flow`, `flow_action: navigate`                                              |
| Payments (India), `order_details`   | Consultation fee, retry on failure                                   | `POST /v1/payments` (`payment_gateway` or `payment_link`)                                      |
| Order status updates                | `processing` when paid, `completed` after the visit                  | `POST /v1/payments/{id}/status`                                                                |
| Refunds                             | Cancel ≥ 4h before; slot lost after a lapsed hold                    | `POST /v1/payments/{id}/refund`                                                                |
| Utility templates + scheduled send  | Reminders 24h and 1h before, with quick replies                      | `POST /v1/templates`, `POST /v1/messages` with `send_at`, `DELETE /v1/messages/scheduled/{id}` |
| Utility template outside the window | Confirmation when payment lands after 24h                            | `POST /v1/messages` `type: template`                                                           |
| Template quick-reply payloads       | "I'll be there" / "Reschedule" on the reminder                       | `components[].sub_type: quick_reply`                                                           |
| Documents                           | Privacy notice, prescription PDF                                     | `type: document` with `media_url`                                                              |
| Location request                    | "Nearest branch"                                                     | `interactive.type: location_request_message`                                                   |
| Location                            | Branch pin, directions to your appointment                           | `type: location`                                                                               |
| Contact cards                       | 24×7 desk and ambulance (108)                                        | `type: contacts`                                                                               |
| Reactions                           | 🗓️ on hold, 📝 on the form, 📎 on uploaded reports, ✅ on attendance | `type: reaction`                                                                               |
| Inbound media                       | Patient sends old reports (photo / PDF)                              | `message.received` with `type: image` or `document`                                            |
| Read receipts + typing              | Every inbound message                                                | `POST /v1/messages/{uuid}/read` `{ typing: true }`                                             |
| Consent record                      | (router) STOP                                                        | `POST /v1/contacts/{uuid}/consent`                                                             |
| Conversation starter, QR link       | `/clinic`, prefilled `DEMO CLINIC`                                   | `PUT /v1/connections/{uuid}/conversation-starters`, `POST /v1/connections/{uuid}/qr-codes`     |

## LazyApp API calls

| Call                                   | Body (abridged)                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/messages`                    | `{ to, type: 'interactive', interactive: { type: 'flow', action: { name: 'flow', parameters: { flow_message_version: '3', flow_id, flow_token, flow_cta: 'Choose a slot', flow_action: 'data_exchange' } } }, metadata: { demo, session } }`                                                           |
| `POST /v1/payments`                    | `{ to, reference_id: 'AAR-<booking>', body, goods_type: 'digital-goods', expires_in_minutes: 15, items: [{ name: 'Consultation · Dr. Kavita Rao', amount: 60000, quantity: 1, retailer_id: 'consult-kavita-rao' }], payment: { method: 'payment_gateway', configuration }, metadata: { booking_id } }` |
| `POST /v1/payments/{id}/status`        | `{ status: 'processing' \| 'completed', description }`                                                                                                                                                                                                                                                 |
| `POST /v1/payments/{id}/refund`        | `{ amount: 60000 }`                                                                                                                                                                                                                                                                                    |
| `GET /v1/payments/configurations`      | (capability check, cached 10 min)                                                                                                                                                                                                                                                                      |
| `POST /v1/messages` (scheduled)        | `{ to, type: 'template', template: { name: 'demo_clinic_appointments_reminder', language: 'en', components: [body ×4, quick_reply payloads] }, send_at }`                                                                                                                                              |
| `DELETE /v1/messages/scheduled/{id}`   | Reminders on reschedule, cancel, EXIT, STOP, expiry                                                                                                                                                                                                                                                    |
| `GET /v1/flows`                        | Resolves `demo_clinic_appointments_book` / `_previsit` to Meta flow ids (cached)                                                                                                                                                                                                                       |
| `POST /flows/clinic-appointments/book` | Data endpoint LazyApp calls: `{ action: 'INIT' \| 'data_exchange', data: { trigger: 'date_selected' \| 'slot_chosen' \| 'book', … }, flow_token }` → next screen or `SUCCESS`                                                                                                                          |

Every write carries an `Idempotency-Key` derived from the webhook event id, so a redelivered `payment.captured` never confirms twice and a retried payment request returns the original order.

### Templates (provisioned by `npm run setup`)

| Name                                    | Category | Body                                                                                                                                                 | Buttons                                  |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `demo_clinic_appointments_reminder`     | Utility  | Reminder: your appointment with {{1}} is on {{2}} at {{3}}, at Aarogya Clinics {{4}}. Please arrive 10 minutes early and bring any previous reports. | Quick replies: I'll be there, Reschedule |
| `demo_clinic_appointments_confirmation` | Utility  | Hi {{1}}, your appointment with {{2}} on {{3}} is confirmed. Your booking ID is {{4}}. Show this message at the front desk.                          | Quick reply: Manage booking              |

## How the slots stay honest

- Each doctor has a weekly roster (`src/clinic.ts`); free slots are the roster minus what is held or booked in the example-wide store (`src/schedule.ts`), and nothing earlier than an hour from now.
- The Flow's last step **holds** the slot for 15 minutes before it closes, so a patient never confirms a slot someone else took. A second patient sees it disappear immediately.
- Paying online extends the hold. If a hold lapses and another patient books the slot before the payment lands, the payment is **refunded automatically** and fresh slots are offered.
- Reschedules book the new slot before freeing the old one, keep the booking id and payment, and move the reminders.
- EXIT, STOP and session expiry release unpaid holds. Confirmed bookings stay.

## Fallbacks

| Missing                                           | What happens                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `book` Flow not published                         | Same live slots as lists (days, then times with "Later times…" paging), then the patient types _name, age_. The chat says why.                               |
| `previsit` Flow not published                     | The patient answers in one chat message.                                                                                                                     |
| No payment configuration                          | With `PAYMENT_GATEWAY_ACCOUNT` set: a payment link. Otherwise the booking is confirmed as **pay at clinic**, and the chat says online payment is not set up. |
| Payment request refused (e.g. terms not accepted) | Confirmed as pay at clinic, with LazyApp's reason in the chat.                                                                                               |
| Payment fails                                     | "Try again" (new `reference_id`, since LazyApp refuses reused ones) or "Pay at clinic".                                                                      |
| Templates not approved yet                        | Scheduling succeeds; the send fails at LazyApp and arrives as `message.failed`, which is logged.                                                             |
| User without a visible phone (username-only)      | Payments need a phone, so the booking is confirmed as pay at clinic.                                                                                         |

## Limitations

- Reminders are follow-ups of the demo session: they are cancelled when the session ends (EXIT, STOP or 24h idle). A production clinic would schedule them independently of a chat session.
- "Reports" fast-forwards past the visit and sends sample PDFs from `public/`. In production, your EMR would generate them and you would send `media_url` (or upload once with `POST /v1/media/url`).
- Media is served by the demo server at `GET /public/clinic-appointments/<file>`, so `PUBLIC_BASE_URL` must be reachable by WhatsApp.

## Run it yourself

```bash
npm run setup -- --only clinic-appointments          # templates, both flows (book points at PUBLIC_BASE_URL)
DEMO_EXAMPLES=clinic-appointments npm run dev
npx vitest run examples/clinic-appointments
```

| Env                       | Needed for                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `LAZYAPP_API_KEY`         | Everything. Scopes: `messages:send`, `messages:read`, `templates:write`, `payments:write` (refunds). |
| `PUBLIC_BASE_URL`         | Flow data endpoint (`/flows/clinic-appointments/book`) and PDF assets.                               |
| `LAZYAPP_FLOW_SECRETS`    | `{"clinic-appointments/book": "<signing secret from LazyApp → Flows>"}`                              |
| `PAYMENT_CONFIGURATION`   | Optional: WhatsApp Pay configuration name. Auto-detected when empty.                                 |
| `PAYMENT_GATEWAY_ACCOUNT` | Optional: Cashfree/Razorpay account id for the payment-link fallback.                                |

## Code tour

| File                   | What it does                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `src/clinic.ts`        | Branches, specialties, doctors, fees, rosters, policies (hold, refund and reschedule windows)      |
| `src/schedule.ts`      | `SlotBook`: availability, holds, confirmations, releases in the shared store; IST date/time labels |
| `src/book-endpoint.ts` | Data endpoint of the `book` Flow: INIT → dates, `date_selected` → times, `book` → hold → `SUCCESS` |
| `src/booking.ts`       | Specialty → doctor → consent → slot (Flow or lists) → review → payment → confirmation → reminders  |
| `src/manage.ts`        | My appointment: reschedule, cancel + refund, pre-visit form, directions, uploaded reports          |
| `src/info.ts`          | Nearest branch, emergency contact cards, privacy notice, reports and follow-up                     |
| `flows/*.json`         | Flow JSON 7.0: `book` (two screens, data_exchange) and `previsit` (one screen, complete)           |
| `test/*.test.ts`       | 40+ conversation tests: every branch, fallback, payment event, refund, reschedule and expiry       |
