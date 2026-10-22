import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness, HarnessOptions } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { RealEstateConfig } from '../src/config.js';
import realEstate, { createRealEstateExample } from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import type { RealEstateState } from '../src/state.js';

const harnesses: { close(): void }[] = [];
function setup(
  options: HarnessOptions = {},
  config: Partial<RealEstateConfig> = {},
): Harness<RealEstateState> {
  const example =
    Object.keys(config).length === 0 ? realEstate : createRealEstateExample({ ...DEFAULT_CONFIG, ...config });
  const harness = createHarness(example, { displayName: 'Asha', ...options });
  harnesses.push(harness);
  return harness;
}
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

const MINUTE = 60_000;
type Body = Record<string, unknown>;
/** Messages sent now (not scheduled with `send_at`). */
const sentNow = (h: Harness<RealEstateState>) =>
  h.messages().filter((message) => message.send_at === undefined);
const templatesNow = (h: Harness<RealEstateState>) =>
  sentNow(h).flatMap((message) => (message.type === 'template' ? [message.template] : []));

const ok = (result: Awaited<ReturnType<Harness<RealEstateState>['flowExchange']>>): Body => {
  expect(result.status).toBe(200);
  return (result as { body: { data: Body } }).body.data;
};

/** Books Brickfield Aurora through the visit flow and returns the visit id. */
async function bookAurora(h: Harness<RealEstateState>, time = '11:30'): Promise<string> {
  await h.user.tap('visit:book:blr-aurora', 'Book a site visit');
  const init = ok(await h.flowExchange('visit', { action: 'INIT' }));
  const [firstDay] = init.days as { id: string }[];
  await h.flowExchange('visit', { action: 'data_exchange', data: { trigger: 'day', day: firstDay!.id } });
  const done = await h.flowExchange('visit', {
    action: 'data_exchange',
    data: { trigger: 'confirm', day: firstDay!.id, time, name: 'Asha Rao', party: 'family' },
  });
  const params = (done as { body: { data: { extension_message_response: { params: Body } } } }).body.data
    .extension_message_response.params;
  await h.user.submitFlow(params);
  return params.visit_id as string;
}

describe('real estate: getting in and out', () => {
  it('stays silent for anyone who has not sent DEMO HOMES', async () => {
    const h = setup();

    expect(await h.user.send('hi, is the 2 BHK available?')).toEqual({
      status: 'ignored',
      reason: 'not in a demo',
    });
    expect(await h.user.shareLocation({ latitude: 12.97, longitude: 77.59 })).toMatchObject({
      status: 'ignored',
    });
    expect(h.calls).toHaveLength(0);
  });

  it('welcomes with a branded card and three ways in', async () => {
    const h = setup();
    await h.user.send('demo homes');

    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image', image: { link: expect.stringContaining('images.unsplash.com') } },
      body: { text: expect.stringContaining('Namaste Asha') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual(['menu:search', 'menu:near', 'menu:more']);
    expect(h.lastMessage()).toMatchObject({ metadata: { demo: 'real-estate' } });
  });

  it('searches straight away when the start message carries a query (ice breaker, QR, ad)', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES 2 BHK to rent in Pune');

    expect(h.texts()[0]).toContain('Searching for "2 BHK to rent in Pune"');
    expect(h.state()).toMatchObject({
      prefs: { purpose: 'rent', city: 'pune', bhk: [2] },
      results: ['pune-kharadi-rent'],
    });
    expect(h.lastChoices()).toEqual([
      'home:view:pune-kharadi-rent',
      'home:save:pune-kharadi-rent',
      'search:start',
    ]);
  });

  it('shows the full menu on MENU and on "More options"', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:more', 'More options');

    expect(h.lastChoices()).toEqual([
      'menu:search',
      'menu:near',
      'menu:shortlist',
      'menu:visits',
      'menu:emi',
      'menu:advisor',
    ]);
    h.clear();
    await h.user.send('menu');
    expect(h.lastInteractive()).toMatchObject({ type: 'list', action: { button: 'Open menu' } });
  });

  it('ends the session after 24 hours of silence and goes quiet again', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.advance(24 * 60 * MINUTE + 1);
    h.clear();

    expect(await h.user.send('3 bhk in hebbal')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(h.messages()).toHaveLength(0);
  });

  it('STOP ends the demo, records the opt-out and stays silent afterwards', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();

    await h.user.send('STOP');
    expect(h.texts()[0]).toContain("You're opted out");
    h.clear();
    expect(await h.user.send('2 bhk pune')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('real estate: search', () => {
  it('opens the preferences flow (data exchange) and reloads localities and budgets as the buyer picks', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:search', 'Find a home');

    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: {
        parameters: {
          flow_id: 'meta-flow-real-estate-search',
          flow_action: 'data_exchange',
          flow_cta: 'Set preferences',
        },
      },
    });

    const init = ok(await h.flowExchange('search', { action: 'INIT' }));
    expect(init.cities).toHaveLength(4);
    expect(init.localities).toEqual([{ id: 'any', title: 'Pick a city first' }]);

    const city = ok(
      await h.flowExchange('search', {
        action: 'data_exchange',
        data: { trigger: 'city', purpose: 'rent', city: 'pune' },
      }),
    );
    expect(city.localities).toEqual([
      { id: 'any', title: 'Anywhere in Pune' },
      { id: 'Baner', title: 'Baner' },
      { id: 'Hinjewadi', title: 'Hinjewadi' },
      { id: 'Kharadi', title: 'Kharadi' },
    ]);
    expect((city.budgets as { id: string }[]).map((band) => band.id)).toEqual([
      'any',
      'rent-35',
      'rent-60',
      'rent-max',
    ]);
  });

  it('turns the completed flow into a media carousel of matching homes', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:search');
    h.clear();

    await h.user.submitFlow({
      flow: 'search',
      purpose: 'buy',
      city: 'bengaluru',
      locality: 'any',
      budget: 'any',
      bedrooms: ['2', '3'],
    });

    const [carousel, next] = h.interactives();
    expect(carousel).toMatchObject({
      type: 'carousel',
      body: { text: expect.stringContaining('3 homes to buy in Bengaluru (2/3 BHK). Swipe to compare.') },
    });
    expect(carousel).toBeDefined();
    if (carousel?.type !== 'carousel') {
      throw new Error('expected a carousel');
    }
    expect(carousel.action.cards).toHaveLength(3);
    expect(carousel.action.cards[0]).toMatchObject({
      header: { type: 'image' },
      body: { text: expect.stringContaining('Brickfield Aurora') },
      action: {
        buttons: [
          { type: 'quick_reply', quick_reply: { id: 'home:view:blr-aurora', title: 'View details' } },
          { type: 'quick_reply', quick_reply: { id: 'home:save:blr-aurora', title: 'Shortlist' } },
        ],
      },
    });
    expect(next).toMatchObject({ type: 'button' });
    expect(h.state()?.results).toEqual(['blr-aurora', 'blr-meadows', 'blr-skyline']);
  });

  it('says so when it had to widen the search', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();

    await h.user.send('4 bhk to rent in powai');

    expect(h.interactives()[0]).toMatchObject({
      body: { text: expect.stringContaining('Nothing matched exactly, so I widened the locality, bedrooms') },
    });
  });

  it('falls back to buttons and lists when the search flow is not published, and says so', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:search');

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('The search form is not available right now') },
    });
    expect(h.lastChoices()).toEqual(['search:purpose:buy', 'search:purpose:rent']);

    await h.user.tap('search:purpose:buy', 'Buy');
    expect(h.lastChoices()).toEqual([
      'search:city:bengaluru',
      'search:city:pune',
      'search:city:mumbai',
      'search:city:hyderabad',
    ]);

    await h.user.choose('search:city:mumbai', 'Mumbai');
    expect(h.lastChoices()).toEqual([
      'search:budget:buy-75',
      'search:budget:buy-150',
      'search:budget:buy-250',
      'search:budget:buy-max',
      'search:budget:any',
    ]);
    h.clear();

    await h.user.choose('search:budget:any', 'Any budget');
    expect(h.state()?.results).toEqual(['mum-thane', 'mum-powai']);
    expect(h.interactives()[0]).toMatchObject({ type: 'carousel' });
  });

  it('finds the closest homes to a shared location', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:near', 'Homes near me');
    expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });
    h.clear();

    await h.user.shareLocation({ latitude: 19.119, longitude: 72.905, name: 'IIT Bombay' });

    expect(h.interactives()[0]).toMatchObject({
      type: 'carousel',
      body: { text: expect.stringContaining('Brickfield Lakeside is 0.2 km away') },
    });
    expect(h.state()?.results[0]).toBe('mum-powai');
  });

  it('nudges with examples on text it cannot read, and recovers from stale buttons', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();

    await h.user.send('what is the weather?');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("I didn't catch that") },
    });
    expect(h.lastChoices()).toEqual(['menu:search', 'menu:near', 'menu:more']);

    await h.user.tap('home:view:sold-out-project', 'View details');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('That option has expired') },
    });

    await h.user.sendMedia('image', { caption: 'my current flat' });
    expect(h.messages().some((message) => message.type === 'reaction')).toBe(true);
    h.clear();

    await h.user.react('👍', 'wamid.msg_1');
    expect(h.messages()).toHaveLength(0);
  });
});

describe('real estate: a home', () => {
  it('shows details with a Street View link, then visit, brochure and EMI', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();
    await h.user.tap('home:view:blr-aurora', 'View details');

    const [details, actions] = h.interactives();
    expect(details).toMatchObject({
      type: 'cta_url',
      header: { type: 'image' },
      body: { text: expect.stringContaining('*Brickfield Aurora*, Whitefield, Bengaluru') },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Street view',
          url: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=12.9698,77.75',
        },
      },
    });
    expect(actions).toMatchObject({ type: 'button' });
    expect(h.lastChoices()).toEqual([
      'visit:book:blr-aurora',
      'home:brochure:blr-aurora',
      'home:emi:blr-aurora',
    ]);
    expect(h.state()?.focus).toBe('blr-aurora');
  });

  it('offers to shortlist a rental from its details instead of an EMI', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('home:view:blr-hsr-rent');

    expect(h.lastChoices()).toEqual([
      'visit:book:blr-hsr-rent',
      'home:brochure:blr-hsr-rent',
      'home:save:blr-hsr-rent',
    ]);
  });

  it('sends the brochure PDF from the demo server and the project pin, and tags the contact', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();
    await h.user.tap('home:brochure:pune-baner', 'Brochure & map');

    const [document, location] = h.messages();
    expect(document).toMatchObject({
      type: 'document',
      media_url: 'https://demo.test/public/real-estate/brickfield-hillcrest.pdf',
      filename: 'Brickfield-Hillcrest-brochure.pdf',
    });
    expect(location).toMatchObject({ type: 'location', latitude: 18.559, longitude: 73.7868 });
    expect(h.lastChoices()).toEqual(['visit:book:pune-baner', 'home:results']);
    expect(h.callsTo('POST', '/v1/contacts/contact-919800000001/tags')[0]?.body).toEqual({
      tags: ['demo-homes', 'demo-homes:cold'],
    });
  });

  it('shortlists with a ❤️ reaction, lists saved homes and removes them', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    h.clear();
    await h.user.tap('home:save:blr-meadows', 'Shortlist');

    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '❤️' } });
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('(1 home)') } });

    await h.user.tap('home:save:blr-hsr-rent');
    await h.user.tap('menu:shortlist', 'My shortlist');
    expect(h.lastChoices()).toEqual(['home:view:blr-meadows', 'home:view:blr-hsr-rent']);

    await h.user.tap('home:unsave:blr-meadows');
    expect(h.state()?.shortlist).toEqual(['blr-hsr-rent']);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Removed Brickfield Meadows') },
    });
  });

  it('caps the shortlist at ten homes', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const ids = [
      'blr-aurora',
      'blr-meadows',
      'blr-skyline',
      'blr-hsr-rent',
      'blr-indiranagar-rent',
      'pune-baner',
      'pune-hinjewadi',
      'pune-kharadi-rent',
      'mum-powai',
      'mum-thane',
    ];
    for (const id of ids) {
      await h.user.tap(`home:save:${id}`);
    }
    h.clear();
    await h.user.tap('home:save:hyd-kokapet');

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Your shortlist is full') },
    });
    expect(h.state()?.shortlist).toHaveLength(10);
  });

  it('introduces the city agent with a contact card that points back to this chat', async () => {
    const h = setup({}, { agentPhone: '+919000000000' });
    await h.user.send('DEMO HOMES');
    await h.user.tap('home:view:hyd-gachibowli');
    h.clear();
    await h.user.tap('menu:advisor', 'Talk to an advisor');

    expect(h.messages()[0]).toMatchObject({
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Karthik Reddy' },
          org: { company: 'Brickfield Homes', title: 'Relationship manager, Hyderabad' },
          phones: [{ phone: '+919000000000', wa_id: '919000000000' }],
        },
      ],
    });
  });

  it('leaves the phone off the agent card when no demo number is configured', async () => {
    const h = setup({}, { agentPhone: null });
    await h.user.send('DEMO HOMES');
    h.clear();
    await h.user.tap('menu:advisor');

    expect(h.messages()[0]).toMatchObject({ type: 'contacts' });
    expect(JSON.stringify(h.messages()[0])).not.toContain('phones');
  });
});

describe('real estate: EMI calculator', () => {
  it('computes the EMI in the flow endpoint and echoes it into the chat', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('home:emi:blr-aurora', 'EMI for this home');

    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_id: 'meta-flow-real-estate-emi', flow_action: 'data_exchange' } },
    });

    const loan = ok(await h.flowExchange('emi', { action: 'INIT' }));
    expect(loan).toMatchObject({
      home: 'Brickfield Aurora, Whitefield',
      loan_amount: '7400000',
      tenure: '20',
      rate: '8.50',
    });

    const invalid = ok(
      await h.flowExchange('emi', {
        action: 'data_exchange',
        data: { loan_amount: '12', tenure: '20', rate: '8.50' },
      }),
    );
    expect(invalid.error_message).toBe('Enter a loan between ₹5 lakh and ₹20 crore.');

    const result = await h.flowExchange('emi', {
      action: 'data_exchange',
      data: { loan_amount: '7400000', tenure: '20', rate: '8.50' },
    });
    expect(result).toMatchObject({
      status: 200,
      body: { screen: 'RESULT', data: { emi_line: '₹64,219 per month' } },
    });
    h.clear();

    await h.user.submitFlow({ flow: 'emi', loan_amount: '7400000', tenure: '20', rate: '8.50', emi: '1' });

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('*₹64,219/month* for 20 years at 8.5%') },
    });
    expect(h.lastChoices()).toEqual(['visit:book:blr-aurora', 'menu:advisor', 'menu:search']);
    expect(h.state()?.emiQuotes).toBe(1);
  });

  it('answers in the chat without the flow, and recalculates when the buyer types an amount', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO HOMES');
    await h.user.tap('menu:emi', 'EMI calculator');

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('The calculator form is not available right now') },
    });
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('*₹75,00,000*') } });
    h.clear();

    await h.user.send('60 lakh');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('20 years: *₹52,069/month*') },
    });
  });
});

describe('real estate: site visits', () => {
  it('books through the flow: live slots, confirmation template with the pin, agent card, follow-ups, tags', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await h.user.tap('visit:book:blr-aurora', 'Book a site visit');

    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_id: 'meta-flow-real-estate-visit', flow_cta: 'Choose a slot' } },
    });
    const init = ok(await h.flowExchange('visit', { action: 'INIT' }));
    expect(init).toMatchObject({
      home: 'Brickfield Aurora, Whitefield',
      slots: [],
      slots_visible: false,
      name: 'Asha',
    });
    expect((init.days as { id: string }[])[0]).toEqual({ id: '2026-10-23', title: 'Fri, 23 Oct' });

    const today = ok(
      await h.flowExchange('visit', { action: 'data_exchange', data: { trigger: 'day', day: '2026-10-23' } }),
    );
    expect(today.slots).toEqual([
      { id: '11:30', title: '11:30 AM' },
      { id: '13:00', title: '1:00 PM' },
      { id: '15:00', title: '3:00 PM' },
      { id: '16:30', title: '4:30 PM' },
      { id: '18:00', title: '6:00 PM' },
    ]);

    const done = await h.flowExchange('visit', {
      action: 'data_exchange',
      data: { trigger: 'confirm', day: '2026-10-23', time: '15:00', name: 'Asha Rao', party: 'family' },
    });
    expect(done).toMatchObject({
      status: 200,
      body: {
        screen: 'SUCCESS',
        data: {
          extension_message_response: {
            params: { flow: 'visit', visit_id: expect.stringMatching(/^V-[2-9A-Z]{6}$/) },
          },
        },
      },
    });
    const visitId = h.state()!.visits[0]!.id;
    expect(h.state()?.visits[0]).toMatchObject({
      status: 'booked',
      name: 'Asha Rao',
      party: 'family',
      confirmed: false,
    });
    h.clear();

    await h.user.submitFlow({ flow: 'visit', visit_id: visitId });

    const [template] = templatesNow(h);
    expect(template).toEqual({
      name: TEMPLATES.visitConfirmed,
      language: 'en',
      features: {
        location: {
          latitude: '12.9698',
          longitude: '77.75',
          name: 'Brickfield Aurora sales gallery',
          address: 'Hope Farm Junction, Whitefield, Bengaluru 560066',
        },
      },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Brickfield Aurora, Whitefield' },
            { type: 'text', text: 'Fri, 23 Oct at 3:00 PM' },
            { type: 'text', text: 'Priya Nair' },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `visit:reschedule:${visitId}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: `visit:cancel:${visitId}` }],
        },
      ],
    });
    expect(h.messages()[1]).toMatchObject({
      type: 'contacts',
      contacts: [{ name: { formatted_name: 'Priya Nair' } }],
    });

    const scheduled = h
      .callsTo('POST', '/v1/messages')
      .filter((call) => (call.body as Body).send_at !== undefined);
    expect(
      scheduled.map((call) => [
        (call.body as { template: { name: string } }).template.name,
        (call.body as Body).send_at,
      ]),
    ).toEqual([
      [TEMPLATES.visitReminder, new Date(h.now().getTime() + 2 * MINUTE).toISOString()],
      [TEMPLATES.visitFeedback, new Date(h.now().getTime() + 7 * MINUTE).toISOString()],
    ]);
    expect(h.session()?.meta.followUps).toHaveProperty(`reminder:${visitId}`);
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({
      tags: ['demo-homes', 'demo-homes:visit-booked', 'demo-homes:warm'],
    });
    expect(h.state()?.visits[0]).toMatchObject({ confirmed: true, confirmationUuid: expect.any(String) });
    expect(h.state()?.pendingVisit).toBeNull();
  });

  it('ignores a replayed completion: one confirmation per visit', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const visitId = await bookAurora(h);
    h.clear();

    await h.user.submitFlow({ flow: 'visit', visit_id: visitId });
    expect(h.messages()).toHaveLength(0);
  });

  it('keeps a slot to its capacity across buyers and tells the third one to pick again', async () => {
    const h = setup();
    for (const phone of ['+919800000011', '+919800000012']) {
      const buyer = h.as(phone, 'Buyer');
      await buyer.send('DEMO HOMES');
      await buyer.tap('visit:book:blr-aurora');
      const init = ok(await h.flowExchange('visit', { action: 'INIT' }, phone));
      expect(init.days).toBeDefined();
      await h.flowExchange(
        'visit',
        {
          action: 'data_exchange',
          data: { trigger: 'confirm', day: '2026-10-24', time: '10:00', name: 'B', party: 'solo' },
        },
        phone,
      );
    }
    await h.user.send('DEMO HOMES');
    await h.user.tap('visit:book:blr-aurora');

    const day = ok(
      await h.flowExchange('visit', { action: 'data_exchange', data: { trigger: 'day', day: '2026-10-24' } }),
    );
    expect((day.slots as { id: string }[]).map((slot) => slot.id)).not.toContain('10:00');

    const taken = ok(
      await h.flowExchange('visit', {
        action: 'data_exchange',
        data: { trigger: 'confirm', day: '2026-10-24', time: '10:00', name: 'Asha', party: 'solo' },
      }),
    );
    expect(taken.error_message).toBe('That slot was just taken. Pick another time.');
  });

  it('books from a list of open slots when the visit flow is unavailable', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO HOMES');
    await h.user.tap('visit:book:mum-thane', 'Book a site visit');

    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      body: { text: expect.stringContaining('The booking form is not available right now') },
    });
    expect(h.lastChoices()[0]).toBe('visit:slot:mum-thane:2026-10-23T11:30');
    h.clear();

    await h.user.choose('visit:slot:mum-thane:2026-10-23T11:30', 'Fri, 23 Oct · 11:30 AM');

    expect(templatesNow(h)[0]).toMatchObject({ name: TEMPLATES.visitConfirmed });
    expect(h.state()?.visits[0]).toMatchObject({
      listingId: 'mum-thane',
      agentId: 'ayesha',
      name: 'Asha',
      confirmed: true,
    });
  });

  it('confirms with free-form messages when the template is refused', async () => {
    const h = setup();
    h.api.on('POST', '/v1/messages', (call) => {
      const body = call.body as { type: string; send_at?: string };
      if (body.type === 'template' && body.send_at === undefined) {
        return { status: 422, body: { message: 'Template is not approved.', code: 'template_not_approved' } };
      }
      return body.send_at === undefined
        ? {
            status: 201,
            body: {
              uuid: h.api.nextId('msg'),
              status: 'sent',
              type: body.type,
              provider_message_id: 'wamid.x',
            },
          }
        : { status: 202, body: { id: h.api.nextId('sch'), status: 'scheduled' } };
    });
    await h.user.send('DEMO HOMES');
    h.clear();
    await bookAurora(h);

    const types = sentNow(h).map((message) => message.type);
    expect(types.slice(-3)).toEqual(['location', 'interactive', 'contacts']);
    expect(h.interactives().at(-1)).toMatchObject({
      body: { text: expect.stringContaining('✅ Your site visit to *Brickfield Aurora* is confirmed') },
    });
  });

  it('falls back in-session when Meta later reports the confirmation template as failed', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await bookAurora(h);
    const uuid = h.state()!.visits[0]!.confirmationUuid;
    h.clear();

    await h.event('message.failed', {
      message: { uuid, to: h.user.phone, status: 'failed', metadata: { demo: 'real-estate' } },
    });

    expect(h.messages().map((message) => message.type)).toEqual(['location', 'interactive']);
    expect(h.state()?.visits[0]?.confirmationUuid).toBeNull();

    h.clear();
    await h.event('message.failed', {
      message: { uuid: 'other', to: h.user.phone, status: 'failed', metadata: { demo: 'real-estate' } },
    });
    expect(h.messages()).toHaveLength(0);
  });

  it('reschedules from the template quick reply: new slot, old one released, follow-ups replaced', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const visitId = await bookAurora(h, '11:30');
    const before = h.state()!.visits[0]!.at;
    h.clear();

    await h.user.tap(`visit:reschedule:${visitId}`, 'Reschedule');
    expect(h.lastInteractive()).toMatchObject({ type: 'flow', header: { text: 'Reschedule your visit' } });
    const init = ok(await h.flowExchange('visit', { action: 'INIT' }));
    expect(init.address).toBe('Moving your visit on Fri, 23 Oct at 11:30 AM');

    await h.flowExchange('visit', {
      action: 'data_exchange',
      data: { trigger: 'confirm', day: '2026-10-24', time: '16:30', name: 'Asha Rao', party: 'solo' },
    });
    await h.user.submitFlow({ flow: 'visit', visit_id: visitId });

    expect(h.state()?.visits).toHaveLength(1);
    expect(h.state()?.visits[0]).toMatchObject({
      id: visitId,
      at: '2026-10-24T11:00:00.000Z',
      confirmed: true,
    });
    expect(h.state()?.visits[0]?.at).not.toBe(before);
    expect(templatesNow(h)[0]?.components?.[0]).toMatchObject({
      parameters: [
        { text: 'Brickfield Aurora, Whitefield' },
        { text: 'Sat, 24 Oct at 4:30 PM' },
        { text: 'Priya Nair' },
      ],
    });
    expect(h.messages().some((message) => message.type === 'contacts')).toBe(false);
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.store.keyValue('example:real-estate', () => h.now()).list('slot:blr-aurora:')).toEqual([
      { key: 'slot:blr-aurora:2026-10-24T11:00:00.000Z', value: [visitId] },
    ]);
  });

  it('cancels after confirming: slot released, reminders cancelled', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const visitId = await bookAurora(h);
    await h.user.tap('menu:visits', 'My site visits');
    expect(h.lastChoices()).toEqual([`visit:open:${visitId}`]);
    await h.user.choose(`visit:open:${visitId}`);
    expect(h.lastChoices()).toEqual([
      `visit:directions:${visitId}`,
      `visit:reschedule:${visitId}`,
      `visit:cancel:${visitId}`,
    ]);

    await h.user.tap(`visit:cancel:${visitId}`, 'Cancel visit');
    expect(h.lastChoices()).toEqual([
      `visit:cancel-yes:${visitId}`,
      `visit:reschedule:${visitId}`,
      `visit:open:${visitId}`,
    ]);
    h.clear();

    await h.user.tap(`visit:cancel-yes:${visitId}`, 'Yes, cancel it');

    expect(h.state()?.visits[0]?.status).toBe('cancelled');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.session()?.meta.followUps).toEqual({});
    expect(h.store.keyValue('example:real-estate', () => h.now()).list('slot:')).toEqual([]);
    expect(h.lastChoices()).toEqual(['visit:book:blr-aurora', 'search:start']);

    h.clear();
    await h.user.tap(`visit:cancel-yes:${visitId}`);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('That option has expired') },
    });
  });

  it('sends directions from the reminder quick reply', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const visitId = await bookAurora(h);
    h.clear();

    await h.user.tap(`visit:directions:${visitId}`, 'Get directions');

    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Brickfield Aurora sales gallery' });
  });

  it('turns visit feedback into the lead score: loved → hot, not for me → alternatives', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    const visitId = await bookAurora(h);
    h.clear();

    await h.user.tap(`feedback:loved:${visitId}`, 'Loved it');
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '🎉' } });
    expect(h.callsTo('POST', /\/tags$/).at(-1)?.body).toEqual({ tags: ['demo-homes:hot'] });
    expect(h.callsTo('DELETE', /\/tags$/).at(-1)?.body).toEqual({ tags: ['demo-homes:warm'] });

    h.clear();
    await h.user.tap(`feedback:no:${visitId}`, 'Not for me');
    expect(h.interactives()[0]).toMatchObject({
      type: 'carousel',
      body: { text: expect.stringContaining('Sorry it was not the one') },
    });
    expect(h.state()?.results).not.toContain('blr-aurora');
  });

  it('EXIT mid-booking cancels the reminders and invalidates the open flow', async () => {
    const h = setup();
    await h.user.send('DEMO HOMES');
    await bookAurora(h);
    await h.user.tap('visit:book:blr-skyline');
    h.clear();

    await h.user.send('exit');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.texts()[0]).toContain('Thanks for trying Brickfield Homes');
    expect(await h.flowExchange('visit', { action: 'INIT' })).toMatchObject({ status: 427 });
  });

  it('schedules production reminders around the visit time', async () => {
    const h = setup({}, { reminders: 'production' });
    await h.user.send('DEMO HOMES');
    h.clear();
    await bookAurora(h, '18:00');

    const sendAts = h
      .callsTo('POST', '/v1/messages')
      .flatMap((call) => ((call.body as Body).send_at === undefined ? [] : [(call.body as Body).send_at]));
    expect(sendAts).toEqual(['2026-10-23T09:30:00.000Z', '2026-10-23T14:30:00.000Z']);
  });
});

describe('real estate: events API mode', () => {
  it('confirms through POST /v1/events when the workspace maps appointment.confirmed', async () => {
    const h = setup({}, { useEvents: true });
    await h.user.send('DEMO HOMES');
    h.clear();
    const visitId = await bookAurora(h);

    expect(h.callsTo('POST', '/v1/events')[0]?.body).toEqual({
      type: 'appointment.confirmed',
      recipient: { phone_number: h.user.phone },
      properties: {
        project: 'Brickfield Aurora, Whitefield',
        when: 'Fri, 23 Oct at 11:30 AM',
        agent: 'Priya Nair',
        visit_id: visitId,
      },
      idempotency_key: `demo-homes-${visitId}-2026-10-23T06:00:00.000Z`,
    });
    expect(templatesNow(h)).toHaveLength(0);

    h.clear();
    await h.user.tap(`visit:cancel-yes:${visitId}`);
    expect(h.callsTo('POST', '/v1/events')[0]?.body).toMatchObject({ type: 'appointment.cancelled' });
  });

  it('sends the template itself when LazyApp has no mapping for the event', async () => {
    const h = setup({}, { useEvents: true });
    h.api.on('POST', '/v1/events', () => ({
      status: 422,
      body: { message: 'No template mapping configured for event type [appointment.confirmed].' },
    }));
    await h.user.send('DEMO HOMES');
    h.clear();
    await bookAurora(h);

    expect(templatesNow(h)[0]).toMatchObject({ name: TEMPLATES.visitConfirmed });
  });
});
