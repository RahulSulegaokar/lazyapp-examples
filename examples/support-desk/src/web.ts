import { escapeHtml, formatInr, htmlResponse } from '@lazyapp-examples/demo-kit';
import type { WebRoute } from '@lazyapp-examples/demo-kit';
import { BRAND, findOrder, ORDER_STATUS_LABEL } from './data.js';
import type { Order } from './data.js';
import { formatDate } from './hours.js';
import type { SupportState } from './state.js';

/**
 * The shipment tracking page the "Track shipment" button opens. Seed orders only: a real desk
 * would render the courier's live scan events here.
 */
export function webRoutes(): readonly WebRoute<SupportState>[] {
  return [
    {
      method: 'GET',
      path: '/track/:orderId',
      handler: async (web, _request, params) => {
        const order = findOrder((params.orderId ?? '').toUpperCase());
        return order === undefined
          ? htmlResponse(page('Order not found', '<p class="muted">We could not find that order.</p>'), 404)
          : htmlResponse(page(`Track ${order.id}`, trackingBody(order, web.now())));
      },
    },
  ];
}

function trackingBody(order: Order, now: Date): string {
  const day = (daysAgo: number) => formatDate(new Date(now.getTime() - daysAgo * 86_400_000));
  const steps = order.timeline
    .map(
      (step, index) =>
        `<li class="${index === order.timeline.length - 1 ? 'current' : ''}"><span class="when">${escapeHtml(day(step.daysAgo))}</span>${escapeHtml(step.text)}</li>`,
    )
    .join('');
  return `
    <p class="eyebrow">${escapeHtml(order.id)} · ${escapeHtml(order.courier ?? 'Not shipped yet')}${order.awb === null ? '' : ` · AWB ${escapeHtml(order.awb)}`}</p>
    <h1>${escapeHtml(ORDER_STATUS_LABEL[order.status])}</h1>
    <p class="muted">${escapeHtml(order.product)} · ${escapeHtml(formatInr(order.amount))} · to ${escapeHtml(order.city)}</p>
    <ol class="timeline">${steps}</ol>
    <p class="muted small">Questions? Reply in the WhatsApp chat; it reaches ${escapeHtml(BRAND.desk)} directly.</p>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · ${escapeHtml(BRAND.name)}</title>
<style>
  :root { --bg: #f6f5f2; --card: #fff; --text: #17140f; --muted: #6b665c; --line: #e4e0d8; --accent: #c2410c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #12110f; --card: #1b1a17; --text: #efece6; --muted: #a39e94; --line: #2c2a26; --accent: #fb923c; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; }
  main { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; }
  .brand { font-weight: 700; color: var(--accent); margin: 0 0 16px; }
  .eyebrow { margin: 0; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  h1 { font-size: 22px; margin: 4px 0; }
  .muted { color: var(--muted); margin: 0 0 16px; } .small { font-size: 13px; margin-top: 20px; }
  .timeline { list-style: none; padding: 0; margin: 20px 0 0; border-left: 2px solid var(--line); }
  .timeline li { position: relative; padding: 0 0 16px 18px; }
  .timeline li::before { content: ""; position: absolute; left: -7px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
  .timeline li.current::before { background: var(--accent); }
  .when { display: block; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style></head>
<body><main><p class="brand">${escapeHtml(BRAND.name)}</p>${body}</main></body></html>`;
}
