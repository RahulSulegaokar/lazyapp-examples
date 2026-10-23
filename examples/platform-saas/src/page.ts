import { escapeHtml } from '@lazyapp-examples/demo-kit';

/**
 * SalonBook's admin page: one self-contained HTML document with inline CSS and JS. It only ever
 * talks to SalonBook's own `/api` routes; embedded components load in iframes from LazyApp.
 */
export function renderAdminPage(input: {
  readonly apiBase: string;
  readonly mode: 'test' | 'live' | null;
}): string {
  const modeLabel =
    input.mode === null
      ? 'Not configured'
      : input.mode === 'test'
        ? 'LazyApp test mode'
        : 'LazyApp live mode';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<title>SalonBook admin · LazyApp platform demo</title>
<style>
  :root { --bg: #f7f5f2; --card: #fff; --text: #1c1915; --muted: #6d675d; --line: #e6e1d8; --accent: #7c3aed;
    --accent-soft: #f1ebfe; --ok: #15803d; --warn: #b45309; --bad: #b91c1c; --code: #f3f0ea; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121110; --card: #1b1a18; --text: #eeebe5; --muted: #a29d93;
    --line: #2d2b27; --accent: #a78bfa; --accent-soft: #2a2240; --ok: #4ade80; --warn: #fbbf24; --bad: #f87171; --code: #24221f; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--card); }
  .logo { font-weight: 800; letter-spacing: -0.02em; font-size: 18px; color: var(--accent); }
  .muted { color: var(--muted); }
  .badge { margin-left: auto; font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; white-space: nowrap; }
  main { max-width: 1080px; margin: 0 auto; padding: 20px 16px 48px; }
  .intro { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
  .intro h1 { font-size: 20px; margin: 0 0 6px; }
  .intro p { margin: 0; }
  .salons { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .salon { text-align: left; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; cursor: pointer; }
  .salon[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .salon strong { display: block; }
  .chip { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); margin-top: 6px; }
  .chip.ok { color: var(--ok); border-color: currentColor; } .chip.warn { color: var(--warn); border-color: currentColor; } .chip.bad { color: var(--bad); border-color: currentColor; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; min-width: 0; }
  section.wide { grid-column: 1 / -1; }
  h2 { font-size: 16px; margin: 0; display: flex; gap: 8px; align-items: baseline; }
  .n { color: var(--accent); font-variant-numeric: tabular-nums; }
  .api { display: inline-block; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); padding: 2px 6px; border-radius: 6px; margin: 6px 0 8px; overflow-wrap: anywhere; }
  section p { margin: 0 0 10px; }
  button.act { font: inherit; font-weight: 600; border: 0; border-radius: 9px; padding: 8px 14px; background: var(--accent); color: #fff; cursor: pointer; }
  button.ghost { font: inherit; border: 1px solid var(--line); border-radius: 9px; padding: 6px 12px; background: transparent; color: var(--text); cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .out { margin-top: 10px; font-size: 14px; overflow-wrap: anywhere; }
  .out code, .mono { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .qr { width: 168px; height: 168px; background: #fff; border-radius: 8px; padding: 4px; }
  iframe { width: 100%; height: 560px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); margin-top: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
  td { padding: 4px 0; border-bottom: 1px solid var(--line); } td:last-child { text-align: right; }
  ol.log { list-style: none; padding: 0; margin: 10px 0 0; max-height: 260px; overflow: auto; }
  ol.log li { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .when { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .note { font-size: 13px; color: var(--muted); background: var(--code); border-radius: 8px; padding: 8px 10px; margin-top: 10px; }
  .error { color: var(--bad); }
  .tabs button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
</style></head>
<body>
<header><span class="logo">SalonBook</span><span class="muted">Admin</span><span class="badge">${escapeHtml(modeLabel)}</span></header>
<main>
  <div class="intro">
    <h1>Every salon on its own WhatsApp number, built once</h1>
    <p class="muted">SalonBook is a fictional salon-booking SaaS. Each button below calls the LazyApp Platform API from
    SalonBook's server; this page never sees an API key. Three seed salons only, reset every day at midnight IST.</p>
  </div>
  <div id="banner"></div>
  <div class="salons" id="salons" role="group" aria-label="Salons"></div>
  <div class="grid" id="detail"></div>
</main>
<script>
(() => {
  const API = ${JSON.stringify(input.apiBase)};
  const state = { data: null, selected: null, busy: false, issued: {} };
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function call(method, path, body) {
    const response = await fetch(API + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.message || json.error || ('HTTP ' + response.status));
    return json;
  }

  const salon = () => state.data && state.data.salons.find((entry) => entry.slug === state.selected);
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const CONNECTION = {
    not_connected: ['Not connected', ''], link_sent: ['Setup link sent', 'warn'], connected: ['Connected', 'ok'],
    failed: ['Setup failed', 'bad'], attention: ['Needs attention', 'bad'],
  };

  async function load() {
    try {
      state.data = await call('GET', 'salons');
      if (!state.selected) state.selected = state.data.salons[0].slug;
      render();
    } catch (error) {
      $('banner').replaceChildren(el('div', { class: 'intro error' }, 'Could not load SalonBook: ' + error.message));
    }
  }

  async function act(button, output, method, path, onDone) {
    button.disabled = true;
    output.replaceChildren(el('span', { class: 'muted' }, 'Working…'));
    try {
      const result = await call(method, path, method === 'GET' ? undefined : {});
      await onDone(result);
    } catch (error) {
      output.replaceChildren(el('span', { class: 'error' }, error.message));
    } finally {
      button.disabled = false;
    }
  }

  function render() {
    const data = state.data;
    $('banner').replaceChildren(data.configured ? '' : el('div', { class: 'intro error' },
      'The platform key is not set. Add PLATFORM_SAAS_API_KEY (an sk_test_ key on a platform workspace) to .env and restart.'));
    $('salons').replaceChildren(...data.salons.map((entry) => {
      const [label, tone] = entry.customerId ? CONNECTION[entry.connection] : ['Not in LazyApp yet', ''];
      return el('button', { class: 'salon', 'aria-pressed': entry.slug === state.selected ? 'true' : 'false',
        onclick: () => { state.selected = entry.slug; render(); } },
        el('strong', {}, entry.name), el('span', { class: 'muted' }, entry.area + ' · ' + entry.stylists + ' stylists'),
        el('br'), el('span', { class: 'chip ' + tone }, label));
    }));
    const current = salon();
    $('detail').replaceChildren(customerCard(current), connectCard(current), usageCard(current),
      embedCard(current), webhookCard(current), packCard(current), liveCard());
  }

  function card(number, title, api, ...body) {
    return el('section', {}, el('h2', {}, el('span', { class: 'n' }, number), title), el('span', { class: 'api' }, api), ...body);
  }

  function customerCard(current) {
    const out = el('div', { class: 'out' });
    if (current.customerId) {
      out.append(el('div', {}, 'LazyApp customer ', el('code', {}, current.customerId)),
        el('div', { class: 'muted' }, 'external_id ', el('code', {}, current.externalId)));
    }
    const button = el('button', { class: 'act', disabled: Boolean(current.customerId) || !state.data.configured,
      onclick: () => act(button, out, 'POST', 'salons/' + current.slug + '/customer', load) },
      current.customerId ? 'Created' : 'Create in LazyApp');
    return card('1', 'Create the salon', 'POST /v1/platform/customers',
      el('p', {}, 'One isolated workspace per salon, keyed by SalonBook\\'s own id, so no mapping table.'), button, out);
  }

  function connectCard(current) {
    const out = el('div', { class: 'out' });
    const issued = state.issued[current.slug];
    if (issued) {
      out.append(el('div', { class: 'row' },
        el('img', { class: 'qr', alt: 'QR code for the setup link', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(issued.qrSvg) }),
        el('div', {}, el('div', {}, el('a', { href: issued.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the setup link')),
          el('div', { class: 'muted' }, 'Single use · expires ' + when(issued.expiresAt)),
          el('div', { class: 'mono muted' }, issued.id))));
    } else if (current.setupLink) {
      out.append(el('div', { class: 'muted' }, 'Link ', el('code', {}, current.setupLink.id), ' sent, expires ' + when(current.setupLink.expiresAt) + '. Links are shown once; create another to see it again.'));
    }
    if (current.connectedNumber) out.append(el('div', {}, 'Connected number: ' + current.connectedNumber));
    if (current.failureReason) out.append(el('div', { class: 'error' }, current.failureReason));
    const button = el('button', { class: 'act', disabled: !current.customerId,
      onclick: () => act(button, out, 'POST', 'salons/' + current.slug + '/setup-link', async (result) => {
        state.issued[current.slug] = result; await load(); }) }, 'Create setup link');
    return card('2', 'Connect WhatsApp', 'POST /v1/platform/setup-links',
      el('p', {}, 'Hand the salon owner a one-time link to Meta\\'s Embedded Signup. Their credentials go to Meta, not to SalonBook.'),
      button, out,
      el('div', { class: 'note' }, 'Finishing Embedded Signup needs a live key and LazyApp\\'s Meta app review. In test mode the link opens, but no number connects: use "Simulate" in Webhooks to see what SalonBook does next.'));
  }

  function usageCard(current) {
    const out = el('div', { class: 'out' });
    const show = (usage) => {
      const money = (cents) => cents === null ? '—' : '₹' + (cents / 100).toFixed(2);
      out.replaceChildren(el('table', {}, el('tbody', {},
        [['Period', usage.period], ['Messages', usage.messages], ['Charge', usage.currency + ' ' + usage.totalCharge],
         ['Billing mode', usage.billingMode || '—'], ['Wallet', money(usage.walletBalanceCents)],
         ['Spending limit', money(usage.spendingLimitCents)],
         ...usage.byCategory.map((row) => [row.category, row.messages])]
          .map(([label, value]) => el('tr', {}, el('td', {}, label), el('td', {}, value))))));
    };
    if (current.usage) show(current.usage.summary);
    if (current.usageAlert) out.prepend(el('div', { class: 'error' }, 'Usage alert: ' + current.usageAlert.detail));
    const button = el('button', { class: 'ghost', disabled: !current.customerId,
      onclick: () => act(button, out, 'GET', 'salons/' + current.slug + '/usage?refresh=1', show) }, 'Refresh usage');
    return card('3', 'Usage', 'GET /v1/platform/customers/{id}/usage',
      el('p', {}, 'Messages and spend for this salon. SalonBook caches it for a minute instead of calling LazyApp on every render.'), button, out);
  }

  function embedCard(current) {
    const out = el('div', { class: 'out' });
    const tabs = ['inbox', 'templates', 'usage'].map((component) => {
      const button = el('button', { class: 'ghost', disabled: !current.customerId, 'aria-pressed': 'false',
        onclick: () => act(button, out, 'POST', 'salons/' + current.slug + '/embed/' + component, (result) => {
          tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
          out.replaceChildren(el('div', { class: 'muted' }, 'Token ' + result.id + ' for this view only · expires ' + when(result.expiresAt)),
            el('iframe', { src: result.url, title: 'LazyApp ' + component + ' for ' + current.name,
              referrerpolicy: 'strict-origin', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups', allow: 'clipboard-write' }));
        }) }, component[0].toUpperCase() + component.slice(1));
      return button;
    });
    const section = card('4', 'Embedded components', 'POST /v1/platform/embed-tokens',
      el('p', {}, 'A fresh token per view: one component, one salon, this origin only, 10 minutes.'),
      el('div', { class: 'row tabs' }, tabs), out,
      el('div', { class: 'note' }, 'LazyApp renders embeds from live-mode data, so a test-mode salon shows an empty inbox until its number connects.'));
    section.className = 'wide';
    return section;
  }

  function webhookCard(current) {
    const log = el('ol', { class: 'log' }, current.activity.length === 0
      ? el('li', { class: 'muted' }, 'No events yet. They arrive here routed by the customer envelope.')
      : current.activity.map((entry) => el('li', {}, el('div', {}, el('code', {}, entry.type), ' · ', entry.summary),
          el('div', { class: 'when' }, when(entry.at) + (entry.source === 'simulated' ? ' · simulated in SalonBook' : ' · signed delivery from LazyApp')))));
    const out = el('div', { class: 'out' });
    const buttons = ['customer.connected', 'message.received', 'customer.usage_alert', 'setup_link.failed'].map((type) => {
      const button = el('button', { class: 'ghost', disabled: !current.customerId,
        onclick: () => act(button, out, 'POST', 'salons/' + current.slug + '/simulate/' + type, async () => { out.replaceChildren(); await load(); }) }, type);
      return button;
    });
    return card('5', 'Webhooks, routed by salon', 'POST ' + state.data.webhookUrl,
      el('p', {}, 'One endpoint for every salon. SalonBook verifies the signature, then routes on customer.external_id.'),
      el('div', { class: 'row' }, el('span', { class: 'muted' }, 'Simulate:'), buttons), out, log);
  }

  function packCard(current) {
    const out = el('div', { class: 'out' }, current.pack ? current.pack.summary : '');
    const button = el('button', { class: 'ghost', disabled: !current.customerId,
      onclick: () => act(button, out, 'POST', 'salons/' + current.slug + '/automation-pack', async (result) => {
        await load(); }) }, 'Provision ' + state.data.automationPack);
    return card('6', 'Automation pack', 'PUT /v1/automation-packs/provision · X-LazyApp-Customer',
      el('p', {}, 'The platform key acts for one salon: event mappings, workflows and flows land in that salon\\'s workspace.'),
      button, out,
      el('div', { class: 'note' }, 'LazyApp ships one pack today (real_estate: appointment confirmations and reminders). A salon pack would use the same call.'));
  }

  function liveCard() {
    const section = card('✓', 'What works today', 'sk_test_… vs live',
      el('p', {}, 'Test mode: customers, setup links, embed tokens, usage, automation packs and webhook routing.'),
      el('p', { class: 'muted' }, 'Live only (Meta app review): a salon finishing Embedded Signup, real customer.connected events, and messages to and from the salon\\'s own number.'));
    section.className = 'wide';
    return section;
  }

  load();
  // Picks up webhook deliveries; paused while an embedded component is open so it is not reloaded.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !document.querySelector('iframe')) load();
  }, 20000);
})();
</script>
</body></html>`;
}
