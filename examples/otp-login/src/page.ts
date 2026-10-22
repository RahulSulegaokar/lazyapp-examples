import { escapeHtml } from '@lazyapp-examples/demo-kit';

/**
 * The demo sign-in page: one self-contained HTML document (no build step, no external assets),
 * mobile-first, light and dark. All state lives in the page; the server only sees the JSON API.
 */
export function renderSignInPage(input: { readonly startCode: string; readonly basePath: string }): string {
  const startCode = escapeHtml(input.startCode);
  const apiBase = JSON.stringify(`${input.basePath}/api/`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Sign in · LazyApp demo</title>
<style>
  :root {
    --bg: #f4f6f5; --card: #ffffff; --text: #101a16; --muted: #5b6b64; --line: #dfe5e2;
    --accent: #128c4a; --accent-press: #0e7a40; --accent-ink: #ffffff; --danger: #b42318; --danger-bg: #fdecea;
    --ok-bg: #e7f6ee; --focus: #1a73e8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1311; --card: #151d1a; --text: #e8efec; --muted: #9aaaa3; --line: #26322d;
      --accent: #25d366; --accent-press: #1fb85a; --accent-ink: #062113; --danger: #ff8a80; --danger-bg: #3a1714;
      --ok-bg: #12301f; --focus: #8ab4f8;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column; align-items: center;
    padding: max(24px, env(safe-area-inset-top)) 16px 24px; background: var(--bg); color: var(--text);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 8px 0 20px; color: var(--muted); font-size: 14px; }
  .brand svg { color: var(--accent); }
  main { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px; }
  h1 { font-size: 22px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; }
  p { margin: 0 0 16px; color: var(--muted); }
  label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; }
  input {
    width: 100%; font: inherit; font-size: 18px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid var(--line); background: transparent; color: var(--text);
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; letter-spacing: 0.5em; text-align: center; padding-left: 0.5em; }
  button {
    width: 100%; margin-top: 16px; padding: 13px 16px; font: inherit; font-weight: 600; border-radius: 10px;
    border: 0; background: var(--accent); color: var(--accent-ink); cursor: pointer; touch-action: manipulation;
  }
  button:active { background: var(--accent-press); }
  button[disabled] { opacity: 0.55; cursor: progress; }
  .link { background: none; color: var(--accent); margin-top: 12px; padding: 8px; font-weight: 500; }
  .number { font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
  .row { display: flex; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .alert { display: none; margin: 0 0 16px; padding: 10px 12px; border-radius: 10px; background: var(--danger-bg); color: var(--danger); font-size: 14px; }
  .alert.show { display: block; }
  .done { text-align: center; }
  .tick { width: 56px; height: 56px; border-radius: 50%; background: var(--ok-bg); color: var(--accent); display: grid; place-items: center; margin: 0 auto 12px; }
  .step { display: none; }
  .step.active { display: block; }
  footer { max-width: 400px; margin-top: 20px; font-size: 13px; color: var(--muted); text-align: center; }
  code { font-size: 12px; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <div class="brand">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    LazyApp demo · Login with WhatsApp
  </div>
  <main>
    <div id="alert" class="alert" role="alert" aria-live="assertive"></div>

    <section id="step-phone" class="step" aria-labelledby="t-phone">
      <h1 id="t-phone">Sign in</h1>
      <p>We'll send a one-time code to your WhatsApp.</p>
      <form id="phone-form" novalidate>
        <label for="phone">Mobile number</label>
        <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required>
        <button type="submit">Continue</button>
      </form>
    </section>

    <section id="step-send" class="step" aria-labelledby="t-send">
      <h1 id="t-send">Get your code</h1>
      <p>Signing in as <span class="number" data-number></span>. The code arrives on WhatsApp in a few seconds.</p>
      <button id="send" type="button">Send code on WhatsApp</button>
      <button class="link" type="button" data-restart>Use a different number</button>
    </section>

    <section id="step-code" class="step" aria-labelledby="t-code">
      <h1 id="t-code">Enter the code</h1>
      <p>Sent to <span class="number" data-number></span> on WhatsApp. Tap <strong>Copy code</strong> in the message, then paste it here.</p>
      <form id="code-form" novalidate>
        <label for="code">6-digit code</label>
        <input id="code" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required>
        <button type="submit">Verify</button>
      </form>
      <div class="row"><span id="expires" aria-live="polite"></span><button id="resend" class="link" type="button" style="width:auto;margin:0;padding:0">Resend code</button></div>
    </section>

    <section id="step-done" class="step done" aria-labelledby="t-done">
      <div class="tick"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1 id="t-done">You're signed in</h1>
      <p>as <span class="number" data-number></span>. Check WhatsApp: there's a sign-in alert in the chat, like the one your bank sends.</p>
      <button id="signout" type="button">Sign out</button>
    </section>

    <section id="step-chat" class="step" aria-labelledby="t-chat">
      <h1 id="t-chat">Start in WhatsApp first</h1>
      <p>This demo runs on a shared number, so it only sends codes to people who are in the demo chat. Send <strong>${startCode}</strong> on WhatsApp, then tap <strong>Sign in on web</strong>.</p>
      <button id="open-chat" type="button">Open WhatsApp</button>
      <button class="link" type="button" data-restart>I've done that, try again</button>
    </section>
  </main>
  <footer>A LazyApp demo. Codes are sent with <code>POST /v1/otp</code> and checked with <code>POST /v1/otp/verify</code>.</footer>

<script>
(() => {
  const api = (path, body) => fetch(${apiBase} + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).then(async (response) => ({ ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) }));

  const $ = (id) => document.getElementById(id);
  const alertBox = $('alert');
  let attempt = null, expiresAt = 0, resendAt = 0, timer = 0;

  const show = (name) => {
    for (const step of document.querySelectorAll('.step')) step.classList.toggle('active', step.id === 'step-' + name);
    const focus = { phone: 'phone', code: 'code', send: 'send', done: 'signout', chat: 'open-chat' }[name];
    if (focus) setTimeout(() => $(focus).focus(), 0);
  };
  const fail = (message) => { alertBox.textContent = message || 'Something went wrong. Try again.'; alertBox.classList.add('show'); };
  const clearFail = () => alertBox.classList.remove('show');
  const setNumber = (number) => { for (const el of document.querySelectorAll('[data-number]')) el.textContent = number; };
  const busy = (button, on) => { button.disabled = on; button.setAttribute('aria-busy', String(on)); };
  const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  const tick = () => {
    const now = Date.now();
    $('expires').textContent = now < expiresAt ? 'Code expires in ' + clock(expiresAt - now) : 'Code expired';
    const wait = resendAt - now;
    $('resend').disabled = wait > 0;
    $('resend').textContent = wait > 0 ? 'Resend in ' + clock(wait) : 'Resend code';
  };

  const handle = (result) => {
    if (result.data.error === 'not_in_demo') { show('chat'); return false; }
    if (result.data.error === 'attempt_expired') { attempt = null; fail(result.data.message); show('phone'); return false; }
    if (!result.ok) { fail(result.data.message); return false; }
    clearFail();
    return true;
  };

  const identify = async (body) => {
    const result = await api('identify', body);
    if (!handle(result)) return;
    attempt = result.data.attempt;
    resendAt = Date.now() + result.data.resendAfter * 1000;
    setNumber(result.data.number);
    show('send');
  };

  const send = async (button) => {
    busy(button, true);
    const result = await api('send', { attempt });
    busy(button, false);
    if (result.data.retryAfter) resendAt = Date.now() + result.data.retryAfter * 1000;
    if (!handle(result)) { tick(); return; }
    expiresAt = Date.parse(result.data.expiresAt);
    resendAt = Date.now() + result.data.resendAfter * 1000;
    clearInterval(timer); timer = setInterval(tick, 500); tick();
    $('code').value = '';
    show('code');
  };

  $('phone-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const phone = $('phone').value.trim();
    if (phone.replace(/\\D/g, '').length < 8) { fail('Enter your mobile number.'); return; }
    identify({ phone });
  });
  $('send').addEventListener('click', (event) => send(event.currentTarget));
  $('resend').addEventListener('click', (event) => send(event.currentTarget));
  $('code').addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\\D/g, '');
    if (digits !== event.target.value) event.target.value = digits;
    if (digits.length === 6) $('code-form').requestSubmit();
  });
  $('code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $('code').value.replace(/\\D/g, '');
    if (code.length < 4) { fail('Enter the code from WhatsApp.'); return; }
    const button = event.target.querySelector('button');
    busy(button, true);
    const result = await api('verify', { attempt, code });
    busy(button, false);
    if (!handle(result)) { $('code').select(); return; }
    clearInterval(timer);
    setNumber(result.data.number);
    show('done');
  });
  $('signout').addEventListener('click', async () => { await api('signout', {}); attempt = null; show('phone'); });
  $('open-chat').addEventListener('click', async () => {
    const demos = await fetch('/demos').then((r) => r.json()).catch(() => ({ demos: [] }));
    const demo = (demos.demos || []).find((d) => d.id === 'otp-login');
    if (demo && demo.chatLink) location.href = demo.chatLink; else fail('Open WhatsApp and send ${startCode} to the LazyApp demo number.');
  });
  for (const el of document.querySelectorAll('[data-restart]')) el.addEventListener('click', () => { clearFail(); show('phone'); });

  // The chat link carries a one-time ticket. Use it, then drop it from the address bar and history.
  const ticket = new URLSearchParams(location.search).get('t');
  if (ticket) history.replaceState(null, '', location.pathname);
  api('me').then((me) => {
    if (me.data.signedIn) { setNumber(me.data.number); show('done'); }
    else if (ticket) identify({ ticket });
    else show('phone');
  });
})();
</script>
</body>
</html>`;
}
