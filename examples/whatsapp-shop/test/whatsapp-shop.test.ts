import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import type { CatalogProduct } from '@lazyapp-examples/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTS } from '../src/catalog.js';
import shop from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import type { ShopState } from '../src/state.js';

type ShopHarness = Harness<ShopState>;

const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]): ShopHarness => {
  const harness = createHarness(shop, { displayName: 'Asha', ...options });
  harnesses.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

/** The seed uploaded to the Meta catalog, as `GET /v1/catalog/products` returns it. */
const CATALOG: CatalogProduct[] = PRODUCTS.map((product, index) => ({
  id: `meta-${index}`,
  retailer_id: product.sku,
  name: product.name,
  description: product.description,
  price: `${product.pricePaise / 100} INR`,
  image_url: product.imageUrl,
  availability: 'in stock',
}));

const ADDRESS = {
  name: 'Asha Rao',
  phone_number: '9800000001',
  in_pin_code: '560038',
  house_number: '12',
  building_name: 'Lotus Apartments',
  address: '100 Feet Road, Indiranagar',
  landmark_area: 'Near the metro',
  city: 'Bengaluru',
  state: 'Karnataka',
};

const FIRST_SLOT = 'slot:2026-10-24:am';

function body(h: ShopHarness): string {
  const last = h.lastInteractive();
  return last?.body?.text ?? '';
}

async function fillCart(h: ShopHarness): Promise<void> {
  await h.user.send('DEMO SHOP');
  await h.user.tap('cart:add:il-saree-banarasi-plum');
  await h.user.tap('cart:add:il-dress-bandhani-red');
  await h.user.choose('size:M');
}

async function reachPayment(h: ShopHarness): Promise<void> {
  await fillCart(h);
  await h.user.tap('checkout');
  await h.user.submitAddress(ADDRESS);
  await h.user.choose(FIRST_SLOT);
}

async function placeCodOrder(h: ShopHarness): Promise<string> {
  await reachPayment(h);
  await h.user.tap('pay:cod');
  await h.user.tap('cod:confirm');
  const id = /Order (IL\d+) confirmed/.exec(body(h))?.[1];
  if (id === undefined) {
    throw new Error(`no confirmation in: ${body(h)}`);
  }
  return id;
}

async function deliver(h: ShopHarness, id: string): Promise<void> {
  for (let step = 0; step < 4; step++) {
    await h.user.tap(`next:${id}`);
  }
}

describe('whatsapp-shop: entry and browsing', () => {
  it('stays silent for people who have not started the demo', async () => {
    const h = setup();
    expect(await h.user.send('hi')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(await h.user.tap('cart:add:il-rug-ivory')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);

    await h.user.send('DEMO SHOP');
    h.clear();
    expect(await h.as('+919811111111').send('silk saree')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('welcomes with a banner and three ways in', async () => {
    const h = setup();
    await h.user.send('demo shop');

    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image' },
      body: { text: expect.stringContaining('Namaste Asha') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual(['home:browse', 'home:deals', 'home:more']);

    await h.user.send('MENU');
    expect(h.lastInteractive()).toMatchObject({ type: 'list' });
    expect(h.lastChoices()).toContain('menu:orders');
  });

  it('browses collections → products → product card with lists when there is no catalog', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('home:browse');
    expect(h.lastChoices()).toEqual(['cat:sarees', 'cat:wear', 'cat:home', 'cat:bags']);

    await h.user.choose('cat:home');
    expect(h.lastChoices()).toEqual([
      'product:il-bedsheet-rust',
      'product:il-bedding-charcoal',
      'product:il-pillow-cotton',
      'product:il-rug-ivory',
    ]);

    await h.user.choose('product:il-rug-ivory');
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image', image: { link: expect.stringContaining('images.unsplash.com') } },
      body: { text: expect.stringContaining('₹7,999 ~₹9,999~ (20% off)') },
    });
    expect(h.lastChoices()).toEqual(['cart:add:il-rug-ivory', 'cat:home', 'cart:view']);
  });

  it('uses multi-product and single-product messages when the catalog has the products', async () => {
    const h = setup({ catalog: CATALOG, catalogId: 'cat_indigo' });
    await h.user.send('DEMO SHOP');
    await h.user.tap('home:browse');

    const list = h.lastInteractive();
    expect(list).toMatchObject({ type: 'product_list', action: { catalog_id: 'cat_indigo' } });
    expect(list?.type === 'product_list' ? list.action.sections.map((section) => section.title) : []).toEqual(
      ['Sarees', 'Dresses & jackets', 'Home & bedding', 'Bags'],
    );

    await h.user.choose('product:il-bag-coral');
    expect(h.lastInteractive()).toMatchObject({
      type: 'product',
      action: { catalog_id: 'cat_indigo', product_retailer_id: 'il-bag-coral' },
    });
  });

  it('ignores catalog products that are not part of the shop', async () => {
    const foreign: CatalogProduct = { ...CATALOG[0]!, retailer_id: 'someone-elses-sku' };
    const h = setup({ catalog: [foreign] });
    await h.user.send('DEMO SHOP');
    await h.user.tap('home:browse');
    expect(h.lastInteractive()).toMatchObject({ type: 'list' });
  });

  it("shows today's deals as an image carousel, or a product carousel with a catalog", async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    h.clear();
    await h.user.tap('home:deals');
    const [carousel, coupon] = h.interactives();
    expect(carousel).toMatchObject({ type: 'carousel' });
    expect(carousel?.type === 'carousel' ? carousel.action.cards[0] : undefined).toMatchObject({
      header: { type: 'image' },
      action: {
        buttons: [{ quick_reply: { id: 'cart:add:il-saree-banarasi-plum' } }, { type: 'quick_reply' }],
      },
    });
    expect(coupon).toMatchObject({ type: 'button' });

    const withCatalog = setup({ catalog: CATALOG });
    await withCatalog.user.send('DEMO SHOP');
    withCatalog.clear();
    await withCatalog.user.tap('home:deals');
    expect(withCatalog.interactives()[0]).toMatchObject({
      type: 'carousel',
      action: {
        cards: [{ type: 'product', action: { product_retailer_id: 'il-saree-banarasi-plum' } }, {}, {}],
      },
    });
  });

  it('treats free text as a search', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');

    await h.user.send('silk sarees');
    expect(h.lastChoices()).toEqual(['product:il-saree-banarasi-plum', 'product:il-saree-kanjivaram-red']);

    await h.user.send('linen trousers');
    expect(h.lastChoices()).toEqual(['cart:add:il-trousers-blush', 'cat:wear', 'cart:view']);

    await h.user.send('spaceship');
    expect(body(h)).toContain(`couldn't find anything for "spaceship"`);

    await h.user.tap('menu:search');
    expect(h.texts().at(-1)).toContain('What are you looking for?');
    await h.user.send('hello');
    expect(body(h)).toContain('couldn\'t find anything for "hello"');
  });
});

describe('whatsapp-shop: cart', () => {
  it('asks for a size, reacts, and shows the running total', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-dress-bandhani-red');

    expect(h.lastInteractive()).toMatchObject({ type: 'list', header: { text: 'Pick a size' } });
    expect(h.lastChoices()).toEqual(['size:XS', 'size:S', 'size:M', 'size:L', 'size:XL', 'size:XXL']);
    h.clear();

    await h.user.choose('size:L');
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '🛍️' } });
    expect(body(h)).toContain('Added *Bandhani maxi dress, red* in size *L*');
    expect(body(h)).toContain('Shipping is free.');
    expect(h.state()?.cart).toEqual([{ sku: 'il-dress-bandhani-red', size: 'L', qty: 1 }]);

    await h.user.tap('cart:add:il-dress-bandhani-red');
    await h.user.choose('size:L');
    expect(h.state()?.cart).toEqual([{ sku: 'il-dress-bandhani-red', size: 'L', qty: 2 }]);
  });

  it('merges a catalog cart and asks for the missing sizes', async () => {
    const h = setup({ catalog: CATALOG });
    await h.user.send('DEMO SHOP');
    h.clear();
    await h.user.sendOrder([
      { retailerId: 'il-jacket-rust', quantity: 1, itemPrice: 2299 },
      { retailerId: 'il-pillow-cotton', quantity: 2, itemPrice: 999 },
      { retailerId: 'not-ours', quantity: 1 },
    ]);
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '🛒' } });
    expect(body(h)).toContain('Cotton bomber jacket, rust');

    await h.user.choose('size:XL');
    expect(h.state()?.cart).toEqual([
      { sku: 'il-jacket-rust', size: 'XL', qty: 1 },
      { sku: 'il-pillow-cotton', size: null, qty: 2 },
    ]);
  });

  it('edits quantities, removes lines and empties the cart', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-pillow-cotton');
    expect(body(h)).toContain('Add ₹500 more for free shipping.');
    await h.user.tap('cart:add:il-bag-coral');
    await h.user.tap('cart:edit');
    expect(h.lastChoices()).toEqual(['cart:line:0', 'cart:line:1', 'cart:clear']);

    await h.user.choose('cart:line:0');
    await h.user.tap('cart:inc');
    expect(h.state()?.cart[0]?.qty).toBe(2);
    expect(body(h)).toContain('2 × Organic cotton pillows (pair) — ₹1,998');

    await h.user.choose('cart:line:0');
    await h.user.tap('cart:dec');
    await h.user.choose('cart:line:1');
    await h.user.tap('cart:remove');
    expect(h.state()?.cart).toEqual([{ sku: 'il-pillow-cotton', size: null, qty: 1 }]);

    await h.user.tap('cart:edit');
    await h.user.choose('cart:clear');
    expect(h.state()?.cart).toEqual([]);
    expect(body(h)).toContain('Your cart is empty');
  });

  it('applies typed coupons and explains when one does not apply', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-pillow-cotton');

    await h.user.send('festive200');
    expect(body(h)).toContain('*FESTIVE200* is saved');
    expect(body(h)).toContain('FESTIVE200 needs ₹1,999 or more');

    await h.user.send('WELCOME10');
    expect(body(h)).toContain('*WELCOME10* applied: you save ₹100');
    expect(body(h)).toContain('*Total: ₹978*');
  });

  it('schedules the abandoned-cart reminder only after an explicit opt-in, and EXIT cancels it', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-saree-kanjivaram-red');
    await h.user.tap('cart:view');
    expect(h.lastChoices()).toEqual(['checkout', 'cart:edit', 'cart:remind']);

    h.clear();
    await h.user.tap('cart:remind');
    expect(
      h.callsTo('POST', '/v1/messages').filter((call) => (call.body as { send_at?: string }).send_at),
    ).toHaveLength(0);
    expect(h.lastChoices()).toEqual(['remind:yes', 'cart:view']);

    await h.user.tap('remind:yes');
    expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: true, purpose: 'marketing' });
    const scheduled = h
      .callsTo('POST', '/v1/messages')
      .find((call) => (call.body as { send_at?: string }).send_at);
    expect(scheduled?.body).toMatchObject({
      type: 'template',
      send_at: new Date(h.now().getTime() + 3 * 3_600_000).toISOString(),
      template: {
        name: TEMPLATES.cartReminder,
        components: [
          { type: 'body', parameters: [{ text: 'Asha' }, { text: 'Kanjivaram silk saree, crimson' }] },
          { index: '0', parameters: [{ payload: 'cart:view' }] },
          { index: '1', parameters: [{ payload: 'offers:optout' }] },
        ],
      },
    });
    h.clear();

    await h.user.send('EXIT');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.session()).toBeUndefined();
  });

  it('stops reminders from the template quick reply', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-rug-ivory');
    await h.user.tap('cart:remind');
    await h.user.tap('remind:yes');
    h.clear();

    await h.user.tap('offers:optout', 'Stop reminders');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: false });
    expect(h.session()?.meta.marketingOptIn).toBe(false);
  });
});

describe('whatsapp-shop: checkout', () => {
  it('collects the address with an India address message and re-asks with validation errors', async () => {
    const h = setup();
    await fillCart(h);
    await h.user.tap('checkout');
    expect(h.lastInteractive()).toMatchObject({
      type: 'address_message',
      action: { parameters: { country: 'IN', values: { name: 'Asha', phone_number: '9800000001' } } },
    });

    await h.user.submitAddress({ ...ADDRESS, in_pin_code: '056003' });
    expect(h.lastInteractive()).toMatchObject({
      type: 'address_message',
      action: { parameters: { validation_errors: { in_pin_code: 'Enter a 6-digit PIN code' } } },
    });

    await h.user.submitAddress(ADDRESS);
    expect(h.lastInteractive()).toMatchObject({ type: 'list', header: { text: 'Pick a delivery slot' } });
    expect(h.lastChoices()).toHaveLength(9);
    expect(h.lastChoices()[0]).toBe(FIRST_SLOT);
    expect(body(h)).toContain('Lotus Apartments');
  });

  it('offers the saved address next time', async () => {
    const h = setup();
    await placeCodOrder(h);
    await h.user.tap('cart:add:il-rug-ivory');
    await h.user.tap('checkout');
    expect(h.lastInteractive()).toMatchObject({
      action: { parameters: { saved_addresses: [{ id: 'last-used', value: { in_pin_code: '560038' } }] } },
    });
    await h.user.submitAddress({}, 'last-used');
    expect(h.lastInteractive()).toMatchObject({ header: { text: 'Pick a delivery slot' } });
  });

  it('pays in WhatsApp: order_details via POST /v1/payments, confirmed only on payment.captured', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await reachPayment(h);
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod', 'checkout:address']);
    expect(body(h)).toContain('*Total: ₹6,398*');
    h.clear();

    await h.user.tap('pay:prepaid');
    const [request] = h.callsTo('POST', '/v1/payments');
    expect(request?.idempotencyKey).toMatch(/:whatsapp-shop:payment$/);
    expect(request?.body).toMatchObject({
      to: h.user.phone,
      reference_id: expect.stringMatching(/^IL\d{6}$/),
      goods_type: 'physical-goods',
      importer: { name: 'Indigo Loom Crafts Pvt Ltd' },
      items: [
        {
          name: 'Banarasi silk saree, plum',
          amount: 449_900,
          quantity: 1,
          retailer_id: 'il-saree-banarasi-plum',
        },
        { name: 'Bandhani maxi dress, red (M)', amount: 189_900, quantity: 1, country_of_origin: 'India' },
      ],
      payment: { method: 'payment_gateway', configuration: 'demo-store' },
      metadata: { demo: 'whatsapp-shop' },
    });
    expect(request?.body).not.toHaveProperty('shipping');
    expect(h.state()?.step).toBe('awaiting_payment');
    expect(h.state()?.cart).toHaveLength(2);
    h.clear();

    await h.payPayment();
    expect(h.callsTo('POST', /^\/v1\/payments\/pay_\d+\/status$/)[0]?.body).toMatchObject({
      status: 'processing',
    });
    expect(body(h)).toMatch(/Order IL\d{6} confirmed/);
    expect(body(h)).toContain('*Paid: ₹6,398*');
    expect(h.lastChoices()[0]).toMatch(/^track:IL\d{6}$/);
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-shop-customer'] });
    expect(h.callsTo('POST', '/v1/events')).toHaveLength(0);
    expect(h.state()?.cart).toEqual([]);

    h.clear();
    await h.replayLast();
    expect(h.messages()).toHaveLength(0);
  });

  it('adds shipping and the coupon discount to the payment request', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await h.user.send('DEMO SHOP');
    await h.user.tap('cart:add:il-trousers-blush');
    await h.user.choose('size:S');
    await h.user.send('WELCOME10');
    await h.user.tap('checkout');
    await h.user.submitAddress(ADDRESS);
    await h.user.choose(FIRST_SLOT);
    await h.user.tap('pay:prepaid');
    expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
      discount: { amount: 13_000, program_name: 'WELCOME10' },
    });

    const small = setup({ paymentConfiguration: 'demo-store' });
    await small.user.send('DEMO SHOP');
    await small.user.tap('cart:add:il-pillow-cotton');
    await small.user.tap('checkout');
    await small.user.submitAddress(ADDRESS);
    await small.user.choose(FIRST_SLOT);
    await small.user.tap('pay:prepaid');
    expect(small.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
      shipping: { amount: 7_900 },
    });
  });

  it('offers a retry or COD when the payment fails, with a fresh order id', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await reachPayment(h);
    await h.user.tap('pay:prepaid');
    const first = [...h.api.payments.values()].at(-1)!;
    h.clear();

    await h.event('payment.failed', {
      payment: { ...first, payment_status: 'failed', last_error: 'UPI PIN incorrect' },
    });
    expect(body(h)).toContain("didn't go through (UPI PIN incorrect)");
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'pay:cod']);

    await h.user.tap('pay:prepaid');
    const retry = h.callsTo('POST', '/v1/payments')[0]?.body as { reference_id: string };
    expect(retry.reference_id).not.toBe(first.reference_id);
  });

  it('falls back to cash on delivery when no payment method is set up, and says so', async () => {
    const h = setup();
    await reachPayment(h);
    h.clear();
    await h.user.tap('pay:prepaid');

    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
    expect(body(h)).toContain('Online payment is not set up on this demo number');
    expect(body(h)).toContain('*Total: ₹6,447*');
    expect(h.lastChoices()).toEqual(['cod:confirm', 'pay:prepaid', 'cart:view']);

    await h.user.tap('cod:confirm');
    expect(body(h)).toContain('*To pay on delivery: ₹6,447*');
  });

  it('falls back to cash on delivery when WhatsApp refuses the payment request', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    h.api.on('POST', '/v1/payments', () => ({
      status: 422,
      body: { message: 'Accept the WhatsApp payment terms first.', code: 'provider_134011' },
    }));
    await reachPayment(h);
    await h.user.tap('pay:prepaid');
    expect(body(h)).toContain('WhatsApp could not create the payment request');
    expect(h.lastChoices()[0]).toBe('cod:confirm');
  });

  it('uses a gateway payment link when only a gateway account is configured, and says so', async () => {
    const h = setup({
      config: { capabilities: { paymentGatewayAccount: '9b1f2c3d-0000-4000-8000-000000000001' } },
    });
    await reachPayment(h);
    h.clear();
    await h.user.tap('pay:prepaid');
    expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
      payment: { method: 'payment_link', gateway_account: '9b1f2c3d-0000-4000-8000-000000000001' },
    });
    expect(h.texts()[0]).toContain('opens a secure payment link instead');
    await h.payPayment();
    expect(h.callsTo('POST', /\/status$/)).toHaveLength(0);
    expect(body(h)).toMatch(/Order IL\d{6} confirmed/);
  });

  it('hides cash on delivery for prepaid-only PIN codes', async () => {
    const h = setup();
    await fillCart(h);
    await h.user.tap('checkout');
    await h.user.submitAddress({ ...ADDRESS, in_pin_code: '744101', city: 'Port Blair' });
    await h.user.choose(FIRST_SLOT);
    expect(h.lastChoices()).toEqual(['pay:prepaid', 'checkout:address']);
    expect(body(h)).toContain("Cash on delivery isn't available for PIN 744101");
  });

  it('uses the address Flow for numbers outside India, and typed text without the Flow', async () => {
    const h = setup({ phone: '+447700900123' });
    await fillCart(h);
    await h.user.tap('checkout');
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_action: 'navigate', flow_action_payload: { screen: 'ADDRESS' } } },
    });
    await h.user.submitFlow({
      name: 'Asha Rao',
      house: 'Flat 4',
      street: 'MG Road',
      landmark: '',
      city: 'Bengaluru',
      pincode: '560001',
      state: 'Karnataka',
    });
    expect(h.state()?.address).toMatchObject({ line1: 'Flat 4', line2: 'MG Road', pincode: '560001' });

    const noFlows = setup({ phone: '+447700900124', flowsPublished: false });
    await fillCart(noFlows);
    await noFlows.user.tap('checkout');
    expect(noFlows.texts().at(-1)).toContain('Please type your delivery address');
    await noFlows.user.send('somewhere nice');
    expect(noFlows.texts().at(-1)).toContain('6-digit PIN code');
    await noFlows.user.send('Asha Rao, 12 MG Road, Bengaluru 560001');
    expect(noFlows.state()?.address).toMatchObject({ line1: 'Asha Rao, 12 MG Road', city: 'Bengaluru' });
    expect(noFlows.lastInteractive()).toMatchObject({ header: { text: 'Pick a delivery slot' } });
  });
});

describe('whatsapp-shop: after the order', () => {
  it('walks the order to delivery with tracking links, a courier card and a rating', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    h.clear();

    await h.user.tap(`track:${id}`);
    expect(body(h)).toContain('🟢 Confirmed');

    await h.user.tap(`next:${id}`);
    expect(body(h)).toContain('📦 *Packed!*');

    h.clear();
    await h.user.tap(`next:${id}`);
    expect(h.interactives()[0]).toMatchObject({
      type: 'cta_url',
      action: { parameters: { display_text: 'Track shipment', url: expect.stringContaining('awb=DL') } },
    });
    expect(h.callsTo('POST', /\/status$/)).toHaveLength(0);

    h.clear();
    await h.user.tap(`next:${id}`);
    expect(h.messages()[0]).toMatchObject({
      type: 'contacts',
      contacts: [{ org: { company: 'BlueRoute Express' } }],
    });
    expect(body(h)).toContain('Please keep *₹6,447* ready');
    expect(h.lastChoices()).toEqual([`next:${id}`, `resched:${id}`]);

    h.clear();
    await h.user.tap(`next:${id}`);
    expect(h.lastInteractive()).toMatchObject({ type: 'list', header: { text: 'Delivered 🎉' } });
    expect(h.lastChoices()).toEqual([1, 2, 3, 4, 5].reverse().map((stars) => `rate:${id}:${stars}`));

    await h.user.tap(`next:${id}`);
    expect(body(h)).toContain(`*Order ${id}* · Delivered`);
  });

  it('keeps WhatsApp order status in step for in-WhatsApp payments', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await reachPayment(h);
    await h.user.tap('pay:prepaid');
    await h.payPayment();
    const id = /Order (IL\d+) confirmed/.exec(body(h))?.[1] ?? '';
    h.clear();

    await deliver(h, id);
    expect(h.callsTo('POST', /\/status$/).map((call) => (call.body as { status: string }).status)).toEqual([
      'shipped',
      'completed',
    ]);
  });

  it('counts a reaction to the delivered message as a rating, and escalates a bad one', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    await deliver(h, id);
    const stored = h.store
      .keyValue('example:whatsapp-shop', () => h.now())
      .get<{ reviewWamid: string }>(`order:${h.user.phone}:${id}`);
    expect(stored?.reviewWamid).toMatch(/^wamid\./);
    h.clear();

    await h.user.react('🎈', 'wamid.something-else');
    expect(h.messages()).toHaveLength(0);

    await h.user.react('😍', stored!.reviewWamid);
    expect(body(h)).toContain('Thank you for the ⭐⭐⭐⭐⭐');

    await h.user.react('🎈', stored!.reviewWamid);
    expect(h.texts().at(-1)).toContain('Thanks for the 🎈');

    h.clear();
    await h.user.choose(`rate:${id}:1`);
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-shop-unhappy'] });
    expect(h.lastChoices()).toEqual([`return:${id}`, 'support']);
  });

  it('reschedules a delivery from the out-for-delivery message', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    for (let step = 0; step < 3; step++) {
      await h.user.tap(`next:${id}`);
    }
    await h.user.tap(`resched:${id}`);
    expect(h.lastChoices()[1]).toBe(`reslot:${id}:2026-10-24:pm`);
    await h.user.choose(`reslot:${id}:2026-10-24:pm`);
    expect(body(h)).toContain('will now arrive Sat, 24 Oct, 1 pm – 5 pm');
  });

  it('reorders a past order in one tap', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    await h.user.tap('menu:orders');
    expect(h.lastChoices()).toEqual([`order:${id}`]);
    await h.user.choose(`order:${id}`);
    await h.user.tap(`reorder:${id}`);
    expect(h.state()?.cart).toEqual([
      { sku: 'il-saree-banarasi-plum', size: null, qty: 1 },
      { sku: 'il-dress-bandhani-red', size: 'M', qty: 1 },
    ]);
    expect(body(h)).toContain(`Added everything from order ${id}`);
  });

  it('books a return through the Flow data endpoint', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    await deliver(h, id);
    await h.user.tap('menu:returns');
    expect(h.lastChoices()).toEqual([`return:${id}`]);

    await h.user.choose(`return:${id}`);
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_action: 'data_exchange', flow_id: 'meta-flow-whatsapp-shop-returns' } },
    });

    const init = await h.flowExchange('returns', { action: 'INIT' });
    expect(init).toMatchObject({
      status: 200,
      body: {
        screen: 'RETURN',
        data: {
          items: [
            { id: 'il-saree-banarasi-plum' },
            { id: 'il-dress-bandhani-red', title: 'Bandhani maxi dress, red (M)' },
          ],
          has_error: false,
        },
      },
    });

    const oneSize = await h.flowExchange('returns', {
      action: 'data_exchange',
      screen: 'RETURN',
      data: { item: 'il-saree-banarasi-plum', kind: 'exchange', reason: 'size', new_size: 'L' },
    });
    expect(oneSize).toMatchObject({
      body: { screen: 'RETURN', data: { has_error: true, error: expect.stringContaining('one size') } },
    });

    const valid = await h.flowExchange('returns', {
      action: 'data_exchange',
      screen: 'RETURN',
      data: { item: 'il-dress-bandhani-red', kind: 'exchange', reason: 'size', new_size: 'L', comment: '' },
    });
    expect(valid).toMatchObject({
      body: { screen: 'CONFIRM', data: { summary: 'Exchange Bandhani maxi dress, red (M)', new_size: 'L' } },
    });

    await h.user.submitFlow({
      item: 'il-dress-bandhani-red',
      kind: 'exchange',
      reason: 'size',
      new_size: 'L',
    });
    expect(h.lastInteractive()).toMatchObject({ header: { text: 'Pickup booked ✅' } });
    expect(body(h)).toContain('We deliver size L when we collect this one');

    h.clear();
    await h.user.sendMedia('image', { caption: 'torn seam' });
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '📎' } });
  });

  it('refuses stale flow tokens and unknown flows', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    await deliver(h, id);
    await h.user.tap(`return:${id}`);
    await h.user.send('EXIT');
    expect(await h.flowExchange('returns', { action: 'INIT' })).toMatchObject({ status: 427 });
    expect(await h.flowExchange('nope', { action: 'INIT' })).toMatchObject({ status: 404 });
  });

  it('books a return with buttons when the Flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    const id = await placeCodOrder(h);
    await deliver(h, id);
    await h.user.tap(`return:${id}`);
    expect(h.lastChoices()).toEqual(['ret:item:il-saree-banarasi-plum', 'ret:item:il-dress-bandhani-red']);

    await h.user.choose('ret:item:il-saree-banarasi-plum');
    expect(h.lastChoices()).toEqual(['ret:kind:return']);
    await h.user.tap('ret:kind:return');
    await h.user.choose('ret:reason:different');
    expect(body(h)).toContain('Refund of ₹4,499 to your UPI ID');
  });

  it('refuses returns outside the 7-day window', async () => {
    const h = setup();
    const id = await placeCodOrder(h);
    await deliver(h, id);
    h.advance(8 * 86_400_000);
    await h.user.send('DEMO SHOP');
    await h.user.tap('menu:returns');
    expect(body(h)).toContain('No delivered orders from the last 7 days');
  });
});

describe('whatsapp-shop: offers, support and odd input', () => {
  it('sends the limited-time offer only after opt-in, and applies the code', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    await h.user.tap('offer:claim');
    expect(h.templates()).toHaveLength(0);
    h.clear();

    await h.user.tap('offer:yes');
    expect(h.templates()[0]).toEqual({
      name: TEMPLATES.festiveOffer,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Asha' },
            { type: 'text', text: '₹200' },
          ],
        },
      ],
      features: {
        coupon_code: 'FESTIVE200',
        offer_expires_at: new Date(h.now().getTime() + 48 * 3_600_000).toISOString(),
      },
    });
    expect(h.state()?.coupon).toBe('FESTIVE200');

    h.clear();
    await h.event('message.failed', {
      message: {
        to: h.user.phone,
        type: 'template',
        metadata: { demo: 'whatsapp-shop' },
        error_message: 'Template not approved',
      },
    });
    expect(h.texts()[0]).toContain('Your code is *FESTIVE200*');
  });

  it('hands off to a person with a tag and a contact card', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    h.clear();
    await h.user.choose('support');
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-shop-support'] });
    expect(h.messages()[0]).toMatchObject({
      type: 'contacts',
      contacts: [{ name: { formatted_name: 'Indigo Loom Care' } }],
    });
  });

  it('answers unexpected input with a way forward', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    h.clear();

    await h.user.message('sticker', { sticker: { id: 'st_1' } });
    expect(h.lastChoices()).toEqual(['home:browse', 'cart:view', 'home:more']);

    await h.user.tap('some:old:button');
    expect(h.messages().some((message) => message.type === 'reaction')).toBe(true);
    expect(h.lastInteractive()).toMatchObject({ type: 'list' });

    await h.user.message('unknown_type', {});
    expect(body(h)).toContain("can't read that kind of message");
  });

  it('forgets the shopper after 24 hours of silence', async () => {
    const h = setup();
    await h.user.send('DEMO SHOP');
    h.advance(25 * 3_600_000);
    expect(await h.user.send('silk saree')).toMatchObject({ status: 'ignored' });
  });

  it('ignores payment events for orders that are not waiting for payment', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const id = await placeCodOrder(h);
    h.clear();
    await h.event('payment.captured', {
      payment: { id: 'pay_x', reference_id: id, to: h.user.phone.slice(1), metadata: { order: id } },
    });
    expect(h.messages()).toHaveLength(0);
  });
});

describe('whatsapp-shop: dead ends', () => {
  it('explains when neither online payment nor cash on delivery is possible', async () => {
    const h = setup();
    await fillCart(h);
    await h.user.tap('checkout');
    await h.user.submitAddress({ ...ADDRESS, in_pin_code: '744101', city: 'Port Blair' });
    await h.user.choose(FIRST_SLOT);
    await h.user.tap('pay:prepaid');
    expect(body(h)).toContain(
      "Online payment is not set up on this demo number, and cash on delivery isn't available for PIN 744101.",
    );
    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
  });
});
