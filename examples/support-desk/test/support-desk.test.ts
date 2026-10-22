import type { Harness, HarnessOptions } from '@lazyapp-examples/demo-kit/testing';
import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import supportDesk from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import type { SupportState } from '../src/state.js';
import type { Ticket } from '../src/tickets.js';

/** Friday 23 Oct 2026, 9:00 am IST: the desk has just opened. */
const FRIDAY_9AM = new Date('2026-10-23T09:00:00+05:30');
const MINUTE = 60_000;

const harnesses: { close(): void }[] = [];
function setup(options: HarnessOptions = {}): Harness<SupportState> {
  const h = createHarness(supportDesk, { displayName: 'Asha', now: FRIDAY_9AM, ...options });
  harnesses.push(h);
  // LazyApp's conversations API: pin/archive, typing, and the console assignee.
  h.api.on('PATCH', '/v1/conversations/:id', (call, params) => ({
    status: 200,
    body: {
      id: params.id,
      status: 'open',
      pinned: (call.body as { pinned: boolean }).pinned,
      archived: false,
      assignee: null,
    },
  }));
  h.api.on('POST', '/v1/conversations/:id/typing', () => ({ status: 200, body: { success: true } }));
  h.api.on('GET', '/v1/conversations/:id', (_call, params) => ({
    status: 200,
    body: { id: params.id, status: 'open', pinned: false, archived: false, assignee: null },
  }));
  return h;
}
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

const ticket = (h: Harness<SupportState>, id: string): Ticket | undefined =>
  h.store.keyValue('example:support-desk', () => h.now()).get<Ticket>(`ticket:${id}`);

/** Raises a ticket in one go and returns its id. */
async function raise(
  h: Harness<SupportState>,
  category: string,
  order: string | null,
  photo = false,
): Promise<string> {
  await h.user.send('DEMO SUPPORT');
  await h.user.choose('menu:ticket', 'Report a problem');
  await h.user.choose(`cat:${category}`);
  if (order !== null) {
    await h.user.choose(`tord:${order}`);
  }
  await h.user.send('The box arrived crushed and the jar is cracked.');
  if (photo) {
    await h.user.sendMedia('image', { id: 'media_photo_1', mime_type: 'image/jpeg' });
  }
  await h.user.tap('tsubmit', 'Submit ticket');
  return h.state()?.ticketId ?? '';
}

describe('support-desk: entry and self-service', () => {
  it('stays silent until the start code', async () => {
    const h = setup();
    expect(await h.user.send('my order is late')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(await h.user.sendMedia('image')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('opens with a menu that says whether agents are online', async () => {
    const h = setup();
    await h.user.send('/support');

    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      header: { text: 'Halo Home Care' },
      body: { text: expect.stringContaining('🟢 Agents are online now') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual([
      'menu:track',
      'menu:faq',
      'menu:centre',
      'menu:ticket',
      'menu:agent',
      'menu:tickets',
    ]);
  });

  it('answers FAQs from the list, from free text, and closes the loop', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:faq');
    expect(h.lastInteractive()).toMatchObject({ type: 'list', action: { button: 'See questions' } });
    expect(h.lastChoices()).toHaveLength(8);

    await h.user.choose('faq:refunds', 'How long do refunds take?');
    expect(h.lastInteractive()).toMatchObject({
      header: { text: 'How long do refunds take?' },
      body: { text: expect.stringContaining('UPI refunds land in 1–3 working days') },
    });
    expect(h.lastChoices()).toEqual(['faq:helped', 'menu:agent', 'menu:faq']);

    h.clear();
    await h.user.tap('faq:helped', 'That helped');
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '👍' } });
    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      body: { text: expect.stringContaining('Great!') },
    });

    h.clear();
    await h.user.send('can I pay with emi?');
    expect(h.lastInteractive()).toMatchObject({ header: { text: 'No-cost EMI' } });
  });

  it('tracks orders by list or by typed number, with a tracking link while in transit', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:track');
    expect(h.lastChoices()).toEqual(['order:HH-1057', 'order:HH-1042', 'order:HH-1063', 'order:HH-0998']);
    h.clear();

    await h.user.choose('order:HH-1057');

    const [card, link] = h.interactives();
    expect(card).toMatchObject({
      type: 'button',
      header: { text: '📦 HH-1057' },
      body: { text: expect.stringContaining('Status: *🛵 Out for delivery*') },
    });
    expect(link).toMatchObject({
      type: 'cta_url',
      action: {
        parameters: { display_text: 'Track shipment', url: 'https://demo.test/x/support-desk/track/HH-1057' },
      },
    });

    h.clear();
    await h.user.send('#hh 1042');
    expect(h.interactives()).toHaveLength(1);
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('✅ Delivered') } });

    h.clear();
    await h.user.send('HH-9999');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("couldn't find *HH-9999*") },
    });
  });

  it('finds the nearest service centre from a shared location', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:centre');
    expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });
    h.clear();

    await h.user.shareLocation({ latitude: 19.076, longitude: 72.8777 });

    const [pin, card, buttons] = h.messages();
    expect(pin).toMatchObject({ type: 'location', name: 'Halo Home Care, Andheri East' });
    expect(card).toMatchObject({
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Halo Home Care, Andheri East' },
          emails: [{ email: 'care@halohome.example' }],
        },
      ],
    });
    expect(buttons).toMatchObject({
      interactive: { body: { text: expect.stringMatching(/about \d+ km away/) } },
    });
  });

  it('serves the shipment tracking page', async () => {
    const h = setup();
    const response = await h.web('/track/hh-1057');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Out for delivery');
    expect((await h.web('/track/HH-0000')).status).toBe(404);
  });
});

describe('support-desk: tickets', () => {
  it('raises a ticket with attachments, routes it by priority and hands over to the agent', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:ticket');
    await h.user.choose('cat:damaged', 'Damaged or wrong item');
    expect(h.lastChoices()).toContain('tord:HH-1042');
    await h.user.choose('tord:HH-1042');
    expect(h.texts().at(-1)).toContain('what happened?');

    await h.user.send('broken');
    expect(h.texts().at(-1)).toContain('A little more detail');

    await h.user.send('The filter housing is cracked and a clip is missing.');
    expect(h.lastChoices()).toEqual(['tsubmit', 'tcancel']);

    // Damaged items need a photo before the ticket goes in.
    h.clear();
    await h.user.tap('tsubmit');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Please send a photo') },
    });

    h.clear();
    await h.user.sendMedia('image', { id: 'media_box', mime_type: 'image/jpeg' });
    await h.user.sendMedia('document', { id: 'media_invoice', filename: 'invoice.pdf' });
    expect(h.messages().map((message) => message.type)).toEqual(['reaction', 'reaction']);

    h.clear();
    await h.user.tap('tsubmit', 'Submit ticket');

    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringMatching(
          /Ticket \*SUP-48211\* created[\s\S]*📎 2 attachments[\s\S]*Priority \*P2\* · first reply by \*10:00 am\*[\s\S]*Assigned to \*Arjun\* \(Customer care\)/,
        ),
      },
    });
    expect(h.lastChoices()).toEqual(['tchat:SUP-48211', 'tview:SUP-48211', 'demo:menu']);
    expect(h.callsTo('POST', '/v1/contacts/contact-919800000001/tags')[0]?.body).toEqual({
      tags: ['support:open', 'support:p2'],
    });
    expect(h.callsTo('PATCH', /\/v1\/conversations\//)).toHaveLength(0);
    expect(ticket(h, 'SUP-48211')).toMatchObject({
      orderId: 'HH-1042',
      conversationId: 'cnv_0001',
      attachments: [
        { mediaId: 'media_box', kind: 'image' },
        { mediaId: 'media_invoice', kind: 'document', filename: 'invoice.pdf' },
      ],
    });

    h.clear();
    await h.user.tap('tchat:SUP-48211', 'Chat with Arjun');

    expect(h.callsTo('POST', '/v1/conversations/cnv_0001/typing')).toHaveLength(1);
    expect(h.texts()[0]).toMatch(
      /^👤 \*Arjun\* · Customer care\n\nSo sorry about HH-1042 \(Halo Air Pro purifier\)!/,
    );
    expect(h.lastChoices()).toEqual(['tsolved:SUP-48211', 'tunsolved:SUP-48211', 'tview:SUP-48211']);
    expect(h.state()).toMatchObject({ step: 'with_agent', ticketId: 'SUP-48211' });

    h.clear();
    await h.user.send('Can the pickup be after 6 pm?');
    expect(h.texts()[0]).toContain("Noted, thanks. I've added that to SUP-48211");
    await h.user.sendMedia('image', { id: 'media_more' });
    expect(ticket(h, 'SUP-48211')?.attachments).toHaveLength(3);
  });

  it('pins P1 tickets in the inbox and closes the loop with a CSAT flow', async () => {
    const h = setup();
    const id = await raise(h, 'not_delivered', 'HH-1057');

    expect(id).toBe('SUP-48211');
    expect(h.callsTo('PATCH', '/v1/conversations/cnv_0001')[0]?.body).toEqual({ pinned: true });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('first reply by *9:15 am*') },
    });

    await h.user.tap(`tchat:${id}`);
    h.clear();
    await h.user.tap(`tsolved:${id}`, 'Yes, solved');

    expect(h.callsTo('PATCH', '/v1/conversations/cnv_0001')[0]?.body).toEqual({ pinned: false });
    expect(h.callsTo('DELETE', /\/tags$/)[0]?.body).toEqual({ tags: ['support:open', 'support:escalated'] });
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '🎉' } });
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: {
        parameters: {
          flow_id: 'meta-flow-support-desk-csat',
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'RATE',
            data: { headline: 'How did Meera do on SUP-48211?', ticket_id: id },
          },
        },
      },
    });

    h.clear();
    await h.user.submitFlow({
      ticket_id: id,
      rating: '5',
      liked: ['speed', 'fixed'],
      comment: ' Super quick! ',
    });

    expect(ticket(h, id)).toMatchObject({
      status: 'closed',
      csat: { score: 5, liked: ['speed', 'fixed'], comment: 'Super quick!' },
    });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['csat:happy'] });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('passed that on to Meera') },
    });

    h.clear();
    await h.user.submitFlow({ ticket_id: id, rating: '1' });
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('already rated') } });
  });

  it('falls back to rating buttons when the CSAT flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    const id = await raise(h, 'payment', null);
    await h.user.tap(`tchat:${id}`);
    await h.user.tap(`tsolved:${id}`);

    expect(h.lastChoices()).toEqual([`csat:5:${id}`, `csat:3:${id}`, `csat:1:${id}`]);

    await h.user.tap(`csat:1:${id}`, '😞 Poor');
    expect(ticket(h, id)?.csat).toEqual({ score: 1, liked: [], comment: null });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Rohan, our team lead, will review') },
    });
  });

  it('escalates to the team lead once, with a higher priority and a fresh SLA', async () => {
    const h = setup();
    const id = await raise(h, 'product', 'HH-1063');
    await h.user.tap(`tchat:${id}`);
    h.advance(5 * MINUTE);
    h.clear();

    await h.user.tap(`tunsolved:${id}`, 'No, escalate');

    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining(
          '⏫ Escalated *SUP-48211* to *Rohan* (Team lead).\nPriority is now *P1*, reply due by *9:20 am*',
        ),
      },
    });
    expect(h.callsTo('PATCH', '/v1/conversations/cnv_0001')[0]?.body).toEqual({ pinned: true });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['support:escalated'] });

    h.clear();
    await h.user.tap(`tchat:${id}`, 'Chat with Rohan');
    expect(h.texts()[0]).toMatch(/^👤 \*Rohan\* · Team lead\n\nI've read the whole thread/);

    h.clear();
    await h.user.tap(`tunsolved:${id}`);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('already with our team lead') },
    });
  });

  it('escalates automatically when the first-reply SLA is breached', async () => {
    const h = setup();
    const id = await raise(h, 'not_delivered', 'HH-1057');
    h.advance(20 * MINUTE);
    h.clear();

    await h.user.tap(`tview:${id}`, 'Ticket status');

    const card = h.lastInteractive();
    expect(card).toMatchObject({ header: { text: `🎫 ${id}` } });
    const body = card?.type === 'button' ? card.body.text : '';
    expect(body).toContain('Status: *⏫ Escalated*, with *Rohan* (Team lead)');
    expect(body).toContain('Escalated to Rohan (Team lead): no reply by 9:15 am (SLA breached)');
    expect(h.lastChoices()).toEqual([`tchat:${id}`, 'demo:menu']);
  });

  it('shows who LazyApp’s inbox has the conversation assigned to', async () => {
    const h = setup();
    const id = await raise(h, 'other', null);
    h.api.on('GET', '/v1/conversations/:id', (_call, params) => ({
      status: 200,
      body: {
        id: params.id,
        status: 'open',
        pinned: false,
        archived: false,
        assignee: { id: 7, name: 'Priya S' },
      },
    }));

    await h.user.tap(`tview:${id}`);

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('In the LazyApp inbox: assigned to Priya S') },
    });
  });

  it('queues tickets after hours and schedules the update the customer asks for', async () => {
    const h = setup({ now: new Date('2026-10-23T22:30:00+05:30') });
    await h.user.send('DEMO SUPPORT');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('🌙 Agents are offline') },
    });

    const id = await raise(h, 'not_delivered', 'HH-1057');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('an agent picks this up by *9:15 am tomorrow*') },
    });
    expect(h.lastChoices()).toEqual([`tnotify:${id}`, `tview:${id}`, 'demo:menu']);
    expect(ticket(h, id)).toMatchObject({ status: 'queued', agent: null });
    h.clear();

    await h.user.tap(`tnotify:${id}`, 'Notify me');

    const [scheduled] = h.callsTo('POST', '/v1/messages');
    expect(scheduled?.body).toMatchObject({
      type: 'template',
      send_at: new Date('2026-10-24T09:02:00+05:30').toISOString(),
      template: {
        name: TEMPLATES.ticketUpdate,
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Asha' },
              { type: 'text', text: id },
              {
                type: 'text',
                text: 'Meera from our priority desk team has picked it up and will reply shortly.',
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            parameters: [{ type: 'payload', payload: `tview:${id}` }],
          },
        ],
      },
      metadata: { demo: 'support-desk', follow_up: `ticket-${id}` },
    });
    expect(h.texts()[0]).toContain("When the desk opens (9:00 am tomorrow) I'll send you an update");

    // Next morning the ticket is assigned at opening time; the template's quick reply opens it.
    h.advance((10 * 60 + 35) * MINUTE);
    h.clear();
    await h.user.tap(`tview:${id}`, 'View ticket');
    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining(
          'Status: *👤 Assigned*, with *Meera* (Priority desk)\nPriority: *P1*\nNext reply due by *9:15 am* (10 min left)',
        ),
      },
    });
    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining('10:30 pm yesterday · Ticket created\n9:00 am · Assigned to Meera'),
      },
    });
  });

  it('cancels the scheduled update on EXIT', async () => {
    const h = setup({ now: new Date('2026-10-23T22:30:00+05:30') });
    const id = await raise(h, 'payment', null);
    await h.user.tap(`tnotify:${id}`);
    h.clear();

    await h.user.send('EXIT');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.session()).toBeUndefined();
  });

  it('will not schedule an update more than a day away', async () => {
    const h = setup({ now: new Date('2026-10-24T21:30:00+05:30') });
    const id = await raise(h, 'other', null);
    h.clear();

    await h.user.tap(`tnotify:${id}`);

    expect(h.callsTo('POST', '/v1/messages')).toHaveLength(1);
    expect(h.texts()[0]).toContain('more than a day away');
  });

  it('lists the person’s tickets and reopens a resolved one', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:tickets');
    expect(h.lastChoices()).toEqual(['menu:ticket', 'demo:menu']);

    const id = await raise(h, 'install', 'HH-1042');
    await h.user.tap(`tchat:${id}`);
    await h.user.tap(`tsolved:${id}`);
    await h.user.choose('menu:tickets');
    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      action: {
        sections: [{ rows: [{ id: `tview:${id}`, description: '✅ Resolved · Installation or demo' }] }],
      },
    });

    await h.user.choose(`tview:${id}`);
    expect(h.lastChoices()).toEqual([`treopen:${id}`, 'demo:menu']);
    h.clear();

    await h.user.tap(`treopen:${id}`, 'Reopen ticket');

    expect(ticket(h, id)).toMatchObject({ status: 'reopened', resolvedAt: null });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining(`🔁 *${id}* is open again`) },
    });
    expect(h.callsTo('DELETE', /\/tags$/)[0]?.body).toEqual({ tags: ['support:resolved'] });
  });

  it('routes "talk to a human" to the open ticket, or starts one', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    h.clear();
    await h.user.send('I want to talk to a human');
    expect(h.lastInteractive()).toMatchObject({ type: 'list', header: { text: 'Talk to an agent' } });

    await h.user.send('MENU');
    const id = await raise(h, 'payment', null);
    h.clear();
    await h.user.choose('menu:agent');
    expect(h.texts()[0]).toMatch(/^👤 \*Meera\*/);
    expect(h.state()?.ticketId).toBe(id);
  });

  it('keeps going when the inbox API fails', async () => {
    const h = setup();
    h.api.on('PATCH', '/v1/conversations/:id', () => ({ status: 500, body: { message: 'down' } }));
    h.api.on('POST', '/v1/contacts/:uuid/tags', () => ({ status: 503, body: { message: 'down' } }));

    const id = await raise(h, 'not_delivered', 'HH-1057');

    expect(id).toBe('SUP-48211');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Ticket *SUP-48211* created') },
    });
  });

  it('handles cancel, stale buttons, stray media and unsupported messages', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    await h.user.choose('menu:ticket');
    await h.user.choose('cat:other');
    await h.user.send('Need a GST invoice for my company');
    h.clear();
    await h.user.tap('tcancel', 'Cancel');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Cancelled, nothing was sent') },
    });
    expect(h.state()).toMatchObject({ step: 'menu', draft: null });

    h.clear();
    await h.user.tap('tsubmit');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('already sent or cancelled') },
    });

    h.clear();
    await h.user.tap('shop:cart:add');
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('older message') } });

    h.clear();
    await h.user.sendMedia('image');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('start with *Report a problem*') },
    });

    h.clear();
    await h.user.message('unsupported', { unsupported: {} });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("can't read that kind") },
    });

    h.clear();
    await h.user.send('blah blah');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("I'm not sure I understood") },
    });
  });

  it('ignores another customer’s ticket ids', async () => {
    const h = setup();
    const id = await raise(h, 'other', null);
    const other = h.as('+919800000077');
    await other.send('DEMO SUPPORT');
    h.clear();

    await other.tap(`tview:${id}`);

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("couldn't find that ticket") },
    });
  });

  it('only logs failed sends', async () => {
    const h = setup();
    await h.user.send('DEMO SUPPORT');
    h.clear();
    await h.event('message.failed', {
      message: {
        to: h.user.phone,
        metadata: { demo: 'support-desk' },
        error_message: 'template not approved',
      },
    });
    expect(h.messages()).toHaveLength(0);
  });
});
