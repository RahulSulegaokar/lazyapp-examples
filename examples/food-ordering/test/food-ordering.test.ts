import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import type { CatalogProduct } from '@lazyapp-examples/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import food from '../src/index.js';
import { MENU } from '../src/kitchen.js';
import { TEMPLATES } from '../src/manifest.js';
import type { FoodState } from '../src/state.js';

type FoodHarness = Harness<FoodState>;

/** Friday 23 Oct 2026, 1 pm in Bengaluru: kitchens open. */
const LUNCHTIME = new Date('2026-10-23T13:00:00+05:30');
/** Friday 9 am: kitchens closed. */
const MORNING = new Date('2026-10-23T09:00:00+05:30');

const KORAMANGALA_HOME = { latitude: 12.9345, longitude: 77.6268, name: 'Home' };
const WHITEFIELD = { latitude: 12.9698, longitude: 77.75 };

const ADDRESS = {
  name: 'Asha Rao',
  phone_number: '9800000001',
  house_number: '402',
  building_name: 'Prestige Acropolis',
  landmark_area: 'Forum mall',
  city: 'Bengaluru',
  in_pin_code: '560095',
};

const BIRYANI_CHOICES = {
  item_id: 'ml-chicken-biryani',
  size: 'full',
  spice: 'spicy',
  add_ons: ['raita', 'egg'],
  qty: '2',
  note: 'less oil please',
};

const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]): FoodHarness => {
  const harness = createHarness(food, { displayName: 'Asha', now: LUNCHTIME, ...options });
  harnesses.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

function body(h: FoodHarness): string {
  return h.lastInteractive()?.body?.text ?? '';
}

async function biryaniInCart(h: FoodHarness): Promise<void> {
  await h.user.send('DEMO FOOD');
  await h.user.tap('order:start');
  await h.user.shareLocation(KORAMANGALA_HOME);
  await h.user.choose('item:ml-chicken-biryani');
  await h.user.submitFlow(BIRYANI_CHOICES);
}

async function toReview(h: FoodHarness): Promise<void> {
  await biryaniInCart(h);
  await h.user.tap('checkout');
  await h.user.tap('when:asap');
  await h.user.submitAddress(ADDRESS);
}

async function placeCodOrder(h: FoodHarness): Promise<string> {
  await toReview(h);
  await h.user.tap('pay:cod');
  const id = /Order (MM\d+) placed/.exec(body(h))?.[1];
  if (id === undefined) {
    throw new Error(`no order in: ${body(h)}`);
  }
  return id;
}

/** The booking id a Flow `SUCCESS` response carries. */
function bookingIdOf(result: unknown): string {
  const params = (
    result as { body?: { data?: { extension_message_response?: { params?: { booking_id?: string } } } } }
  ).body?.data?.extension_message_response?.params;
  return params?.booking_id ?? '';
}

function wamidOfReview(h: FoodHarness, id: string): string {
  const order = h.store
    .keyValue('example:food-ordering', () => h.now())
    .get<{ reviewWamid: string }>(`order:${h.user.phone}:${id}`);
  return order?.reviewWamid ?? '';
}

describe('food-ordering: entry and location', () => {
  it('stays silent until the start code, and for everyone else', async () => {
    const h = setup();
    expect(await h.user.send('biryani please')).toMatchObject({ status: 'ignored' });
    expect(await h.user.shareLocation(KORAMANGALA_HOME)).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);

    await h.user.send('DEMO FOOD');
    h.clear();
    expect(await h.as('+919822222222').tap('order:start')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('welcomes with the banner, Club points and three ways in', async () => {
    const h = setup();
    await h.user.send('demo food');
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image' },
      body: { text: expect.stringContaining('you have *100 points*') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual(['order:start', 'table:start', 'home:more']);

    await h.user.send('MENU');
    expect(h.lastChoices()).toEqual(
      expect.arrayContaining(['order:start', 'reorder:last', 'table:start', 'table:mine', 'club', 'support']),
    );
  });

  it('asks for a location and picks the nearest kitchen inside the delivery radius', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });

    await h.user.shareLocation(KORAMANGALA_HOME);
    expect(body(h)).toContain(
      'We deliver to you from *Masala Mile Koramangala*: 0.3 km away, about 20 minutes',
    );
    expect(h.lastChoices()).toEqual([
      'cat:starters',
      'cat:biryani',
      'cat:curries',
      'cat:street',
      'cat:desserts',
      'cat:drinks',
    ]);
    expect(h.state()).toMatchObject({ mode: 'delivery', outletId: 'koramangala' });
  });

  it('offers pickup or a table when the address is outside the radius, with the kitchen pinned', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    h.clear();
    await h.user.shareLocation(WHITEFIELD);

    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Masala Mile Indiranagar' });
    expect(body(h)).toMatch(/You are 1[01]\.\d km from our nearest kitchen/);
    expect(h.lastChoices()).toEqual(['order:pickup', 'table:start', 'order:relocate']);

    await h.user.tap('order:pickup');
    expect(body(h)).toContain('Pickup from *Masala Mile Indiranagar*');
    expect(h.state()?.mode).toBe('pickup');

    await h.user.tap('order:relocate');
    expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });
  });

  it('understands a typed area, and asks again for one it does not know', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.send('Mars colony');
    expect(body(h)).toContain(`I don't know "Mars colony" yet`);

    await h.user.send('near HSR layout sector 2');
    expect(h.state()).toMatchObject({ mode: 'delivery', outletId: 'hsr' });
  });
});

describe('food-ordering: menu and cart', () => {
  it('lists a category with veg marks and adds simple dishes in one tap', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.shareLocation(KORAMANGALA_HOME);
    await h.user.choose('cat:street');
    const list = h.lastInteractive();
    expect(list?.type === 'list' ? list.action.sections[0]?.rows[1] : undefined).toEqual({
      id: 'item:ml-pav-bhaji',
      title: 'Mumbai pav bhaji',
      description: expect.stringMatching(/^🟢 ₹179 · ★ Bestseller · /),
    });
    h.clear();

    await h.user.choose('item:ml-pav-bhaji');
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '😋' } });
    expect(body(h)).toContain('Added *1 × Mumbai pav bhaji* (₹179)');
    expect(h.lastChoices()).toEqual(['checkout', 'menu:open', 'cart:view']);
  });

  it('customises a dish in a Flow and prices the add-ons', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.shareLocation(KORAMANGALA_HOME);
    await h.user.choose('item:ml-chicken-biryani');

    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      header: { type: 'image' },
      action: {
        parameters: {
          flow_id: 'meta-flow-food-ordering-customize',
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'CUSTOMIZE',
            data: {
              item_id: 'ml-chicken-biryani',
              price_note: 'Half ₹299 / Full ₹449',
              sizes: [{ id: 'half' }, { id: 'full', description: '₹449' }],
              add_ons: [{ id: 'raita', description: '+ ₹30' }, { id: 'egg' }, { id: 'salan' }],
            },
          },
        },
      },
    });

    await h.user.submitFlow(BIRYANI_CHOICES);
    expect(h.state()?.cart).toEqual([
      {
        itemId: 'ml-chicken-biryani',
        size: 'full',
        spice: 'spicy',
        addOns: ['raita', 'egg'],
        qty: 2,
        note: 'less oil please',
      },
    ]);
    expect(body(h)).toContain(
      'Added *2 × Chicken dum biryani (Full, Spicy, + Extra raita, + Boiled egg)* (₹1,008)',
    );

    await h.user.submitFlow({ ...BIRYANI_CHOICES, add_ons: ['caviar'], qty: '99', size: 'jumbo' });
    expect(h.state()?.cart[1]).toMatchObject({ size: 'half', addOns: [], qty: 5 });
  });

  it('falls back to portion and spice buttons when the Flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.shareLocation(KORAMANGALA_HOME);
    await h.user.choose('item:ml-veg-biryani');
    expect(h.lastChoices()).toEqual(['cz:size:half', 'cz:size:full']);

    await h.user.tap('cz:size:full');
    expect(h.lastChoices()).toEqual(['cz:spice:mild', 'cz:spice:medium', 'cz:spice:spicy']);
    await h.user.tap('cz:spice:mild');
    expect(h.state()?.cart).toEqual([
      { itemId: 'ml-veg-biryani', size: 'full', spice: 'mild', addOns: [], qty: 1, note: null },
    ]);

    await h.user.choose('item:ml-butter-chicken');
    expect(h.lastChoices()).toEqual(['cz:spice:mild', 'cz:spice:medium', 'cz:spice:spicy']);
  });

  it('edits and empties the cart', async () => {
    const h = setup();
    await biryaniInCart(h);
    await h.user.choose('item:ml-chaas');
    await h.user.tap('cart:edit');
    expect(h.lastChoices()).toEqual(['cart:line:0', 'cart:line:1', 'cart:clear']);
    await h.user.choose('cart:line:1');
    await h.user.tap('cart:inc');
    expect(h.state()?.cart[1]?.qty).toBe(2);
    await h.user.choose('cart:line:0');
    await h.user.tap('cart:remove');
    expect(h.state()?.cart).toEqual([expect.objectContaining({ itemId: 'ml-chaas', qty: 2 })]);
    await h.user.tap('cart:edit');
    await h.user.choose('cart:clear');
    expect(body(h)).toContain('Your cart is empty');
  });

  it('uses the catalog when it has the menu, and fills in defaults for catalog carts', async () => {
    const catalog: CatalogProduct[] = MENU.map((item, index) => ({
      id: `p${index}`,
      retailer_id: item.id,
      name: item.name,
      description: item.description,
      price: `${item.pricePaise / 100} INR`,
      image_url: item.imageUrl,
      availability: 'in stock',
    }));
    const h = setup({ catalog, catalogId: 'cat_food' });
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.shareLocation(KORAMANGALA_HOME);
    expect(h.lastInteractive()).toMatchObject({ type: 'product_list', action: { catalog_id: 'cat_food' } });

    await h.user.sendOrder([
      { retailerId: 'ml-chicken-biryani', quantity: 1 },
      { retailerId: 'ml-mango-lassi', quantity: 2 },
    ]);
    expect(body(h)).toContain("chef's defaults");
    expect(h.state()?.cart).toEqual([
      { itemId: 'ml-chicken-biryani', size: 'half', spice: 'medium', addOns: [], qty: 1, note: null },
      { itemId: 'ml-mango-lassi', size: null, spice: null, addOns: [], qty: 2, note: null },
    ]);
  });

  it('opens a dish typed by name, and points elsewhere for anything else', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.send('pav bhaji');
    expect(h.state()?.cart).toEqual([expect.objectContaining({ itemId: 'ml-pav-bhaji' })]);

    await h.user.send('pizza');
    expect(body(h)).toContain(`I couldn't find "pizza" on our menu`);

    await h.user.message('sticker', { sticker: { id: 's1' } });
    expect(body(h)).toContain("can't read that kind of message");

    await h.user.tap('nope:old');
    expect(h.lastInteractive()).toMatchObject({ type: 'list' });
  });
});

describe('food-ordering: checkout and payment', () => {
  it('collects flat details with an address message, then shows the bill with GST and points', async () => {
    const h = setup();
    await biryaniInCart(h);
    await h.user.tap('checkout');
    expect(h.lastChoices()).toEqual(['when:asap', 'when:later']);
    expect(h.lastInteractive()).toMatchObject({
      action: { buttons: [{ reply: { title: 'Now · ~20 min' } }, {}] },
    });

    await h.user.tap('when:asap');
    expect(h.lastInteractive()).toMatchObject({
      type: 'address_message',
      action: { parameters: { values: { name: 'Asha', city: 'Bengaluru' } } },
    });
    await h.user.submitAddress({ name: 'Asha' });
    expect(h.lastInteractive()).toMatchObject({
      action: { parameters: { validation_errors: { house_number: 'Add your flat or house number' } } },
    });

    await h.user.submitAddress(ADDRESS);
    expect(body(h)).toContain('Item total: ₹1,008');
    expect(body(h)).toContain('Packaging: ₹20');
    expect(body(h)).toContain('Delivery: Free');
    expect(body(h)).toContain('GST (5%): ₹50.40');
    expect(body(h)).toContain('*To pay: ₹1,078.40*');
    expect(body(h)).toContain('📍 402, Prestige Acropolis, near Forum mall');
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod', 'points:use']);

    await h.user.tap('points:use');
    expect(body(h)).toContain('Club points (100): −₹50');
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod']);
  });

  it('takes UPI in WhatsApp and only starts cooking on payment.captured', async () => {
    const h = setup({ paymentConfiguration: 'masala-mile' });
    await toReview(h);
    await h.user.tap('points:use');
    h.clear();

    await h.user.tap('pay:prepaid');
    expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
      to: h.user.phone,
      reference_id: expect.stringMatching(/^MM\d{5}$/),
      items: [
        {
          name: expect.stringMatching(/^Chicken dum biryani \(Full, Spicy, \+ Extra raita, .*…$/),
          amount: 50_400,
          quantity: 2,
          retailer_id: 'ml-chicken-biryani',
        },
      ],
      tax: { amount: 4_790, description: 'GST 5%' },
      shipping: { amount: 2_000, description: 'Packaging' },
      discount: { amount: 5_000, program_name: 'Masala Mile Club' },
      payment: { method: 'payment_gateway', configuration: 'masala-mile' },
      metadata: { demo: 'food-ordering' },
    });
    expect(h.state()?.step).toBe('awaiting_payment');
    h.clear();

    await h.payPayment();
    expect(h.callsTo('POST', /\/status$/)[0]?.body).toMatchObject({ status: 'processing' });
    expect(body(h)).toMatch(/Order MM\d{5} placed/);
    expect(body(h)).toContain('*Paid: ₹1,025.90*');
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-food-customer'] });
    expect(h.callsTo('POST', '/v1/events')).toHaveLength(0);
    expect(h.state()?.cart).toEqual([]);

    await h.user.tap('club');
    expect(body(h)).toContain('You have *0 points*');
  });

  it('places cash orders when no payment method is set up, and says why', async () => {
    const h = setup();
    await toReview(h);
    h.clear();
    await h.user.tap('pay:prepaid');
    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
    expect(h.texts()[0]).toContain('Online payment is not set up on this demo number yet');
    expect(body(h)).toContain('*To pay on delivery: ₹1,078.40* (cash or UPI)');
  });

  it('falls back to cash when WhatsApp refuses the payment request', async () => {
    const h = setup({ paymentConfiguration: 'masala-mile' });
    h.api.on('POST', '/v1/payments', () => ({
      status: 422,
      body: { message: 'Accept the WhatsApp payment terms first.', code: 'provider_134011' },
    }));
    await toReview(h);
    await h.user.tap('pay:prepaid');
    expect(h.texts().at(-1)).toContain('WhatsApp could not create the payment request');
    expect(body(h)).toMatch(/Order MM\d{5} placed/);
  });

  it('offers a retry when the payment fails', async () => {
    const h = setup({ paymentConfiguration: 'masala-mile' });
    await toReview(h);
    await h.user.tap('pay:prepaid');
    const first = [...h.api.payments.values()].at(-1)!;
    await h.event('payment.failed', { payment: { ...first, payment_status: 'failed' } });
    expect(body(h)).toContain("didn't go through, and no money was taken");
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod']);

    h.clear();
    await h.event('payment.failed', { payment: { ...first, payment_status: 'failed' } });
    expect(h.messages()).toHaveLength(0);
  });

  it('schedules for later, and only allows later when the kitchen is closed', async () => {
    const open = setup();
    await biryaniInCart(open);
    await open.user.tap('checkout');
    await open.user.tap('when:later');
    expect(open.lastChoices()[0]).toBe(`when:at:${Date.parse('2026-10-23T14:00:00+05:30')}`);
    await open.user.choose(`when:at:${Date.parse('2026-10-23T14:30:00+05:30')}`);
    await open.user.submitAddress(ADDRESS);
    expect(body(open)).toContain('🕒 Today, Fri 23 Oct, 2:30 pm');

    const closed = setup({ now: MORNING });
    await biryaniInCart(closed);
    await closed.user.tap('checkout');
    expect(body(closed)).toContain('closed right now');
    expect(closed.lastChoices()[0]).toBe(`when:at:${Date.parse('2026-10-23T11:30:00+05:30')}`);
    await closed.user.tap('when:asap');
    expect(body(closed)).toContain('The kitchen has just closed');
  });

  it('asks non-Indian numbers for flat details as text', async () => {
    const h = setup({ phone: '+447700900123' });
    await biryaniInCart(h);
    await h.user.tap('checkout');
    await h.user.tap('when:asap');
    expect(h.texts().at(-1)).toContain('Type your flat or house number');
    await h.user.send('12');
    expect(h.texts().at(-1)).toContain('A little more detail');
    await h.user.send('Flat 12, Sunrise Apartments');
    expect(body(h)).toContain('📍 Flat 12, Sunrise Apartments');
  });
});

describe('food-ordering: kitchen, rider and after', () => {
  it('walks the kitchen to the door with the rider card, live position and a rating', async () => {
    const h = setup({ paymentConfiguration: 'masala-mile' });
    await toReview(h);
    await h.user.tap('pay:prepaid');
    await h.payPayment();
    const id = /Order (MM\d+) placed/.exec(body(h))?.[1] ?? '';
    h.clear();

    await h.user.tap(`kitchen:${id}`);
    expect(body(h)).toContain('👨‍🍳 *Accepted!*');
    await h.user.tap(`kitchen:${id}`);
    expect(body(h)).toContain('sealing your biryani handi');
    h.clear();

    await h.user.tap(`kitchen:${id}`);
    const [card, live, update] = h.messages();
    expect(card).toMatchObject({ type: 'contacts', contacts: [{ org: { title: 'Delivery rider' } }] });
    expect(live).toMatchObject({ type: 'location', name: 'Ravi Kumar is here' });
    expect(update).toMatchObject({ type: 'interactive' });
    expect(body(h)).toContain('Already paid');
    expect(h.callsTo('POST', /\/status$/)[0]?.body).toMatchObject({ status: 'shipped' });
    h.clear();

    await h.user.tap(`kitchen:${id}`);
    expect(h.callsTo('POST', /\/status$/)[0]?.body).toMatchObject({ status: 'completed' });
    expect(h.lastInteractive()).toMatchObject({ type: 'list', header: { text: 'Delivered! Enjoy 🍛' } });
    expect(body(h)).toContain('You earned *100 Club points* (balance 200)');

    await h.user.react('🤤', wamidOfReview(h, id));
    expect(body(h)).toContain('Thank you for the ⭐⭐⭐⭐⭐');

    await h.user.tap(`track:${id}`);
    expect(h.lastChoices()).toEqual([`reorder:${id}`, 'home:more']);
  });

  it('gives pickup orders a counter code and the kitchen pin', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('order:start');
    await h.user.shareLocation(WHITEFIELD);
    await h.user.tap('order:pickup');
    await h.user.choose('item:ml-idli');
    await h.user.tap('checkout');
    await h.user.tap('when:asap');
    expect(body(h)).toContain('🛍️ Pickup at Masala Mile Indiranagar');
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod', 'points:use']);
    await h.user.tap('pay:cod');
    const id = /Order (MM\d+) placed/.exec(body(h))?.[1] ?? '';

    await h.user.tap(`kitchen:${id}`);
    await h.user.tap(`kitchen:${id}`);
    h.clear();
    await h.user.tap(`kitchen:${id}`);
    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Masala Mile Indiranagar' });
    expect(body(h)).toMatch(/Show code \*\d{4}\* at the counter and pay ₹155\.45/);
    await h.user.tap(`kitchen:${id}`);
    expect(h.lastInteractive()).toMatchObject({ header: { text: 'Enjoy your meal! 🍛' } });
  });

  it('apologises for a bad rating with goodwill points and a tag', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    for (let step = 0; step < 4; step++) {
      await h.user.tap(`kitchen:${id}`);
    }
    h.clear();
    await h.user.choose(`rate:${id}:2`);
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-food-feedback'] });
    expect(body(h)).toContain('added *200 points*');
    expect(body(h)).toContain('(400 now)');
  });

  it('reorders the last meal in one tap, straight to the bill', async () => {
    const h = setup();
    await placeCodOrder(h);
    await h.user.send('EXIT');
    await h.user.send('DEMO FOOD');
    expect(h.lastChoices()).toEqual(['reorder:last', 'order:start', 'home:more']);

    await h.user.tap('reorder:last');
    expect(h.lastInteractive()).toMatchObject({ header: { text: 'Review your order' } });
    expect(body(h)).toContain('2 × Chicken dum biryani (Full, Spicy, + Extra raita, + Boiled egg)');
    expect(body(h)).toContain('📍 402, Prestige Acropolis');
  });

  it('has nothing to reorder for a first-time guest', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.choose('reorder:last');
    expect(h.lastInteractive()).toMatchObject({
      type: 'location_request_message',
      body: { text: expect.stringContaining("You haven't ordered yet") },
    });
  });

  it('hands over to a person with a tag and a contact card', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    h.clear();
    await h.user.choose('support');
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-food-support'] });
    expect(h.messages()[0]).toMatchObject({ type: 'contacts' });
  });
});

describe('food-ordering: table booking', () => {
  it('books through the Flow with live availability and an atomic reservation', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('table:start');
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      header: { type: 'image' },
      action: { parameters: { flow_action: 'data_exchange', flow_id: 'meta-flow-food-ordering-table' } },
    });

    const init = await h.flowExchange('table', { action: 'INIT' });
    expect(init).toMatchObject({
      status: 200,
      body: {
        screen: 'BOOK',
        data: {
          outlets: [{ id: 'indiranagar' }, { id: 'koramangala' }],
          dates: expect.arrayContaining([{ id: '2026-10-23', title: 'Today, Fri 23 Oct' }]),
          has_error: false,
        },
      },
    });

    const hsr = await h.flowExchange('table', {
      action: 'data_exchange',
      screen: 'BOOK',
      data: { step: 'availability', outlet: 'hsr', date: '2026-10-23', party: '4' },
    });
    expect(hsr).toMatchObject({ body: { screen: 'BOOK', data: { has_error: true } } });

    const slots = await h.flowExchange('table', {
      action: 'data_exchange',
      screen: 'BOOK',
      data: { step: 'availability', outlet: 'indiranagar', date: '2026-10-23', party: '4' },
    });
    expect(slots).toMatchObject({
      body: {
        screen: 'SLOTS',
        data: {
          summary: 'Indiranagar · Today, Fri 23 Oct · 4 guests',
          times: [
            { id: '14:00', title: '2:00 pm', description: 'Lunch' },
            { id: '19:00' },
            {},
            {},
            {},
            {},
            {},
          ],
        },
      },
    });

    // Someone else takes most of 7:30 pm in the meantime.
    h.store.keyValue('example:food-ordering', () => h.now()).set('covers:indiranagar:2026-10-23:19:30', 22);
    const full = await h.flowExchange('table', {
      action: 'data_exchange',
      screen: 'SLOTS',
      data: {
        step: 'confirm',
        outlet: 'indiranagar',
        date: '2026-10-23',
        party: '4',
        time: '19:30',
        name: 'Asha',
      },
    });
    expect(full).toMatchObject({
      body: {
        screen: 'SLOTS',
        data: { has_error: true, error: '7:30 pm just filled up. Please pick another time.' },
      },
    });

    const done = await h.flowExchange('table', {
      action: 'data_exchange',
      screen: 'SLOTS',
      data: {
        step: 'confirm',
        outlet: 'indiranagar',
        date: '2026-10-23',
        party: '4',
        time: '20:00',
        name: 'Asha Rao',
        occasion: 'birthday',
        requests: 'Window table if possible',
      },
    });
    expect(done).toMatchObject({
      body: {
        screen: 'SUCCESS',
        data: { extension_message_response: { params: { booking_id: expect.stringMatching(/^T\d{5}$/) } } },
      },
    });
    const bookingId = bookingIdOf(done);
    h.clear();

    await h.user.submitFlow({ booking_id: bookingId });
    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Masala Mile Indiranagar' });
    expect(body(h)).toContain('4 guests · Today, Fri 23 Oct · 8:00 pm');
    expect(body(h)).toContain("🎉 Birthday: we'll have something sweet ready.");
    expect(h.lastChoices()).toEqual([
      `booking:remind:${bookingId}`,
      `booking:cancel:${bookingId}`,
      'order:start',
    ]);
    h.clear();

    await h.user.tap(`booking:remind:${bookingId}`);
    expect(h.callsTo('POST', '/v1/messages')[0]?.body).toMatchObject({
      type: 'template',
      send_at: new Date('2026-10-23T18:00:00+05:30').toISOString(),
      template: {
        name: TEMPLATES.tableReminder,
        components: [
          {
            type: 'body',
            parameters: [
              { text: 'Asha Rao' },
              { text: '4' },
              { text: 'Indiranagar' },
              { text: 'today, fri 23 oct at 8:00 pm' },
            ],
          },
          { index: '0', parameters: [{ payload: `booking:directions:${bookingId}` }] },
          { index: '1', parameters: [{ payload: `booking:cancel:${bookingId}` }] },
        ],
      },
    });
    h.clear();

    await h.user.tap(`booking:cancel:${bookingId}`, 'Cancel booking');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(body(h)).toContain(`Booking ${bookingId} is cancelled`);
    expect(
      h.store
        .keyValue('example:food-ordering', () => h.now())
        .get<number>('covers:indiranagar:2026-10-23:20:00'),
    ).toBe(0);
  });

  it('does not offer a reminder that would fire after the demo session ends', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('table:start');
    const done = await h.flowExchange('table', {
      action: 'data_exchange',
      data: {
        step: 'confirm',
        outlet: 'koramangala',
        date: '2026-10-27',
        party: '2',
        time: '19:30',
        name: 'Asha',
      },
    });
    const id = bookingIdOf(done);
    await h.user.submitFlow({ booking_id: id });
    expect(h.lastChoices()).toEqual([`booking:cancel:${id}`, 'order:start']);

    await h.user.choose('table:mine');
    expect(h.lastChoices()).toEqual([`booking:view:${id}`]);
    h.clear();
    await h.user.tap(`booking:directions:${id}`);
    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Masala Mile Koramangala' });
  });

  it('refuses stale flow tokens', async () => {
    const h = setup();
    await h.user.send('DEMO FOOD');
    await h.user.tap('table:start');
    await h.user.send('EXIT');
    expect(await h.flowExchange('table', { action: 'INIT' })).toMatchObject({ status: 427 });
  });

  it('books with lists when the Flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO FOOD');
    await h.user.tap('table:start');
    expect(h.lastChoices()).toEqual(['tb:outlet:indiranagar', 'tb:outlet:koramangala']);
    await h.user.choose('tb:outlet:koramangala');
    expect(h.lastChoices()).toHaveLength(7);
    await h.user.choose('tb:date:2026-10-24');
    await h.user.choose('tb:party:6');
    expect(h.lastChoices()).toHaveLength(10);
    await h.user.choose('tb:time:13:00');
    expect(body(h)).toContain('6 guests · Tomorrow, Sat 24 Oct · 1:00 pm');
  });
});
