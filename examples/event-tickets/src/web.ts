import { escapeHtml, htmlResponse } from '@lazyapp-examples/demo-kit';
import type { WebContext, WebRoute } from '@lazyapp-examples/demo-kit';
import type { Booking } from './box-office.js';
import { BoxOffice } from './box-office.js';
import type { EventInfo } from './catalog.js';
import { findEvent, findTier, formatDay, formatTime } from './catalog.js';
import { readConfig } from './manifest.js';
import { qrPng, ticketPdf } from './render.js';
import type { TicketsState } from './state.js';
import { ticketUrls, welcome } from './ticketing.js';

type Web = WebContext<TicketsState>;

const config = readConfig(process.env);
const WRONG_PIN_LIMIT = 10;
const WRONG_PIN_WINDOW_MS = 10 * 60_000;

/**
 * The event's web side: ticket files WhatsApp fetches (PNG and PDF), the door-staff check-in page
 * the QR code opens, a camera scanner for staff phones, and the post-event photo gallery.
 * Ticket URLs carry the booking's secret code (96 random bits), never its id or the buyer's number.
 */
export function webRoutes(): readonly WebRoute<TicketsState>[] {
  return [
    {
      method: 'GET',
      path: '/t/:file',
      handler: async (web, _request, params) => {
        const match = /^([\w-]{16})\.(png|pdf)$/.exec(params.file ?? '');
        const booking = match === null ? undefined : new BoxOffice(web.kv, web.now).byCode(match[1] ?? '');
        const event = booking === undefined ? undefined : findEvent(booking.eventId);
        if (match === null || booking?.status !== 'issued' || event === undefined) {
          return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
        }
        const qrText = ticketUrls(web.config.publicBaseUrl, booking.code).checkIn;
        const headers = {
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        };
        if (match[2] === 'png') {
          return new Response(new Uint8Array(qrPng(qrText)), {
            headers: { ...headers, 'content-type': 'image/png' },
          });
        }
        return new Response(new Uint8Array(ticketPdf(pdfInput(booking, event, qrText, web.now()))), {
          headers: {
            ...headers,
            'content-type': 'application/pdf',
            'content-disposition': `inline; filename="Ticket-${booking.id}.pdf"`,
          },
        });
      },
    },
    {
      method: 'GET',
      path: '/checkin/:code',
      handler: async (web, _request, params) => checkInPage(web, params.code ?? '', null),
    },
    {
      method: 'POST',
      path: '/checkin/:code',
      handler: async (web, request, params) => {
        const code = params.code ?? '';
        const form = new URLSearchParams(await request.text());
        const attemptsKey = `pin-fails:${web.clientIp}`;
        const recent = (web.kv.get<number[]>(attemptsKey) ?? []).filter(
          (at) => at > web.now().getTime() - WRONG_PIN_WINDOW_MS,
        );
        if (recent.length >= WRONG_PIN_LIMIT) {
          return checkInPage(
            web,
            code,
            { kind: 'error', message: 'Too many wrong PINs from this phone. Wait 10 minutes.' },
            429,
          );
        }
        if (form.get('pin') !== config.staffPin) {
          web.kv.set(attemptsKey, [...recent, web.now().getTime()]);
          return checkInPage(web, code, { kind: 'error', message: 'Wrong staff PIN.' }, 403);
        }
        const office = new BoxOffice(web.kv, web.now);
        const booking = office.byCode(code);
        const event = booking === undefined ? undefined : findEvent(booking.eventId);
        if (booking === undefined || event === undefined || hasEnded(booking, web.now())) {
          return checkInPage(web, code, null);
        }
        const result = office.checkIn(code);
        if (result === null) {
          return checkInPage(web, code, null);
        }
        if (result.already) {
          return checkInPage(web, code, null);
        }
        const notified = await web.notify(booking.address, `checkin:${booking.id}`, (ctx) =>
          welcome(ctx, result.booking),
        );
        web.log.info('checked in', { booking: booking.id, notified });
        return checkInPage(web, code, {
          kind: 'done',
          message:
            notified === 'sent'
              ? 'Welcome message sent on WhatsApp.'
              : notified === 'failed'
                ? 'Checked in, but the WhatsApp welcome could not be sent.'
                : 'The guest is not in a live demo chat, so no WhatsApp message was sent.',
        });
      },
    },
    {
      method: 'GET',
      path: '/scan',
      handler: async (web) => htmlResponse(page('Scan tickets', scannerBody(new URL(web.baseUrl).pathname))),
    },
    {
      method: 'GET',
      path: '/gallery/:eventId',
      handler: async (_web, _request, params) => {
        const event = findEvent(params.eventId ?? '');
        return event === undefined
          ? htmlResponse(page('Not found', '<p>No gallery for that event.</p>'), 404)
          : htmlResponse(page(`${event.title} photos`, galleryBody(event)));
      },
    },
  ];
}

function pdfInput(booking: Booking, event: EventInfo, qrText: string, now: Date) {
  const start = new Date(booking.startsAt);
  const doors = new Date(start.getTime() - event.doorsBeforeMinutes * 60_000);
  return {
    title: event.title,
    kind: event.kind,
    when: `${formatDay(start, now)} · ${formatTime(start)} (doors ${formatTime(doors)})`,
    venue: `${event.venue.name}, ${event.venue.area}, ${event.venue.city}`,
    holder: booking.name,
    tier: findTier(event, booking.tierId)?.name ?? booking.tierId,
    admits: booking.quantity,
    bookingId: booking.id,
    total: booking.quote.total === 0 ? 'Free' : `Paid ₹${(booking.quote.total / 100).toFixed(2)}`,
    qrText,
  };
}

function hasEnded(booking: Booking, now: Date): boolean {
  return new Date(booking.endsAt) <= now;
}

type Notice = { readonly kind: 'done' | 'error'; readonly message: string } | null;

const SCAN_NEXT = '<a class="next" href="../scan">Scan the next ticket</a>';

function checkInPage(web: Web, code: string, notice: Notice, status = 200): Response {
  const booking = new BoxOffice(web.kv, web.now).byCode(code);
  const event = booking === undefined ? undefined : findEvent(booking.eventId);
  const now = web.now();
  if (booking === undefined || event === undefined || booking.status !== 'issued') {
    return htmlResponse(
      page(
        'Not valid',
        verdict(
          'bad',
          'Not a valid ticket',
          booking === undefined
            ? 'This QR code is not a ticket for these events.'
            : 'This booking was cancelled or refunded.',
        ) + SCAN_NEXT,
      ),
      404,
    );
  }
  const tier = findTier(event, booking.tierId)?.name ?? booking.tierId;
  const start = new Date(booking.startsAt);
  const details = `
    <dl>
      <dt>Event</dt><dd>${escapeHtml(event.title)}</dd>
      <dt>When</dt><dd>${escapeHtml(`${formatDay(start, now)}, ${formatTime(start)}`)}</dd>
      <dt>Guest</dt><dd>${escapeHtml(booking.name)}</dd>
      <dt>Ticket</dt><dd>${escapeHtml(tier)} · <strong>Admit ${booking.quantity}</strong></dd>
      <dt>Booking</dt><dd class="mono">${escapeHtml(booking.id)}</dd>
    </dl>`;
  if (hasEnded(booking, now)) {
    return htmlResponse(
      page(
        'Event ended',
        verdict('bad', 'This event has ended', 'The ticket can no longer be used.') + details,
      ),
    );
  }
  if (booking.checkedInAt !== null) {
    const done = notice?.kind === 'done';
    return htmlResponse(
      page(
        done ? 'Checked in' : 'Already checked in',
        verdict(
          done ? 'ok' : 'warn',
          done ? `Checked in · Admit ${booking.quantity}` : 'Already checked in',
          done
            ? notice.message
            : `Scanned at ${formatTime(new Date(booking.checkedInAt))}. Do not admit again.`,
        ) +
          details +
          SCAN_NEXT,
      ),
      status,
    );
  }
  const error =
    notice?.kind === 'error' ? `<p class="error" role="alert">${escapeHtml(notice.message)}</p>` : '';
  return htmlResponse(
    page(
      'Valid ticket',
      `${verdict('ok', 'Valid ticket', `Admit ${booking.quantity}`)}${details}
      <form method="post">
        ${error}
        <label for="pin">Staff PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" required>
        <button type="submit">Check in ${booking.quantity === 1 ? 'guest' : `${booking.quantity} guests`}</button>
      </form>`,
    ),
    status,
  );
}

function verdict(tone: 'ok' | 'warn' | 'bad', title: string, detail: string): string {
  const icon = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '✕';
  return `<div class="verdict ${tone}"><span class="icon" aria-hidden="true">${icon}</span><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div></div>`;
}

function scannerBody(basePath: string): string {
  return `
    <h1 class="plain">Scan tickets</h1>
    <p class="muted">Point the camera at a ticket QR code. Or paste the link or code below.</p>
    <video id="video" playsinline muted></video>
    <form id="manual"><label for="code">Ticket link or code</label><input id="code" autocomplete="off" required><button type="submit">Open ticket</button></form>
    <p id="status" class="muted" aria-live="polite"></p>
    <script>
      (() => {
        const base = ${JSON.stringify(`${basePath}/checkin/`)};
        const open = (value) => {
          const code = String(value).trim().split('/checkin/').pop().split(/[?#]/)[0];
          if (/^[\\w-]{16}$/.test(code)) location.href = base + code;
          else document.getElementById('status').textContent = 'That is not a ticket code.';
        };
        document.getElementById('manual').addEventListener('submit', (event) => { event.preventDefault(); open(document.getElementById('code').value); });
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
          document.getElementById('status').textContent = 'This browser cannot scan; any phone camera app can open the QR link too.';
          document.getElementById('video').remove();
          return;
        }
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((stream) => {
          const video = document.getElementById('video');
          video.srcObject = stream; video.play();
          const loop = async () => {
            const codes = await detector.detect(video).catch(() => []);
            if (codes.length > 0) { stream.getTracks().forEach((track) => track.stop()); open(codes[0].rawValue); return; }
            requestAnimationFrame(loop);
          };
          loop();
        }).catch(() => { document.getElementById('status').textContent = 'Camera blocked. Paste the link instead.'; });
      })();
    </script>`;
}

const GALLERY: Readonly<Record<string, readonly string[]>> = {
  laughs: [
    'photo-1585699324551-f6c309eedeca',
    'photo-1501386761578-eac5c94b800a',
    'photo-1505373877841-8d25f7d46678',
  ],
  indie: [
    'photo-1533174072545-7a4b6ad7a6c3',
    'photo-1501386761578-eac5c94b800a',
    'photo-1470229722913-7c0e2dbbafd3',
    'photo-1514525253161-7a46d19cd819',
  ],
  devday: [
    'photo-1540575467063-178a50c2df87',
    'photo-1505373877841-8d25f7d46678',
    'photo-1492684223066-81342ee5ff30',
  ],
  food: [
    'photo-1555939594-58d7cb561ad1',
    'photo-1527224538127-2104bb71c51b',
    'photo-1492684223066-81342ee5ff30',
  ],
};

function galleryBody(event: EventInfo): string {
  const photos = (GALLERY[event.id] ?? [])
    .map(
      (id) =>
        `<img src="https://images.unsplash.com/${id}?w=800&h=600&fit=crop&fm=jpg&q=75" alt="${escapeHtml(event.title)}" loading="lazy" width="800" height="600">`,
    )
    .join('');
  return `<h1 class="plain">${escapeHtml(event.title)}</h1><p class="muted">${escapeHtml(`${event.venue.name}, ${event.venue.city}`)} · official photos</p><div class="grid">${photos}</div>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · LazyApp events</title>
<style>
  :root { --bg: #f3f4f6; --card: #fff; --text: #111827; --muted: #6b7280; --line: #e5e7eb; --ok: #047857; --ok-bg: #d1fae5; --warn: #b45309; --warn-bg: #fef3c7; --bad: #b91c1c; --bad-bg: #fee2e2; --accent: #116e3c; --accent-ink: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0f14; --card: #131a22; --text: #e5e7eb; --muted: #9ca3af; --line: #1f2937; --ok: #6ee7b7; --ok-bg: #064e3b; --warn: #fcd34d; --warn-bg: #451a03; --bad: #fca5a5; --bad-bg: #450a0a; --accent: #34d399; --accent-ink: #052e16; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; }
  main { width: 100%; max-width: 480px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .verdict { display: flex; gap: 14px; align-items: center; padding: 16px; border-radius: 12px; margin-bottom: 16px; }
  .verdict h1 { margin: 0; font-size: 22px; } .verdict p { margin: 2px 0 0; }
  .verdict .icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 24px; font-weight: 700; flex-shrink: 0; color: var(--card); }
  .ok { background: var(--ok-bg); color: var(--ok); } .ok .icon { background: var(--ok); }
  .warn { background: var(--warn-bg); color: var(--warn); } .warn .icon { background: var(--warn); }
  .bad { background: var(--bad-bg); color: var(--bad); } .bad .icon { background: var(--bad); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0 0 16px; }
  dt { color: var(--muted); } dd { margin: 0; font-weight: 600; } .mono { font-family: ui-monospace, Menlo, monospace; }
  label { display: block; font-weight: 600; font-size: 14px; margin: 8px 0 6px; }
  input { width: 100%; font: inherit; font-size: 18px; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--text); }
  button { width: 100%; margin-top: 12px; padding: 14px; font: inherit; font-weight: 700; border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-ink); touch-action: manipulation; }
  .next { display: block; text-align: center; margin-top: 16px; color: var(--accent); font-weight: 600; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error { color: var(--bad); margin: 0 0 8px; font-weight: 600; }
  .muted { color: var(--muted); } h1.plain { margin: 0 0 4px; font-size: 22px; }
  video { width: 100%; border-radius: 12px; background: #000; aspect-ratio: 1; object-fit: cover; margin: 8px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
  .grid img { width: 100%; height: auto; border-radius: 10px; display: block; }
</style></head>
<body><main>${body}</main></body></html>`;
}
