import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import { BRAND, findItem } from './kitchen.js';
import { FoodOrderBook } from './orders.js';
import { LoyaltyLedger } from './pricing.js';
import type { FoodState } from './state.js';

export type FoodCtx = ExampleContext<FoodState>;

/** Menu items the number's Meta catalog can show, or null for list fallbacks. */
export async function menuCatalog(
  ctx: FoodCtx,
): Promise<{ catalogId: string; ids: ReadonlySet<string> } | null> {
  const info = await ctx.capabilities.catalog();
  if (info === null) {
    return null;
  }
  const ids = new Set(
    info.products.flatMap((product) =>
      product.retailer_id !== null && findItem(product.retailer_id) !== undefined
        ? [product.retailer_id]
        : [],
    ),
  );
  return ids.size === 0 ? null : { catalogId: info.catalogId, ids };
}

export async function home(ctx: FoodCtx, greeting: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'home' }));
  const points = new LoyaltyLedger(ctx.kv).get(ctx.user.address, ctx.now()).points;
  const last = new FoodOrderBook(ctx.kv).latest(ctx.user.address);
  await ctx.send.buttons({
    header: { image: BRAND.banner },
    body: [
      greeting,
      '',
      `Welcome to *${BRAND.name}*: ${BRAND.tagline.toLowerCase()}. Order in a few taps, pay by UPI or cash, and watch your food leave the kitchen.`,
      '',
      `🎁 Masala Mile Club: you have *${points} points*.`,
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      ...(last === undefined ? [] : [{ id: 'reorder:last', title: 'Reorder last meal' }]),
      { id: 'order:start', title: 'Order food' },
      ...(last === undefined ? [{ id: 'table:start', title: 'Book a table' }] : []),
      { id: 'home:more', title: 'More options' },
    ],
  });
}

export async function moreMenu(ctx: FoodCtx, body = 'What would you like to do?'): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'home' }));
  const hasCart = ctx.state.cart.length > 0;
  await ctx.send.list({
    header: BRAND.name,
    body,
    button: 'Open menu',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Order',
        rows: [
          { id: 'order:start', title: 'Order food', description: 'Delivery or pickup' },
          ...(hasCart ? [{ id: 'cart:view', title: 'My cart', description: 'Review and check out' }] : []),
          { id: 'reorder:last', title: 'Reorder last meal', description: 'Same dishes, one tap' },
          { id: 'track:latest', title: 'Track my order', description: 'Kitchen and rider status' },
        ],
      },
      {
        title: 'Dine in',
        rows: [
          { id: 'table:start', title: 'Book a table', description: 'Indiranagar or Koramangala' },
          { id: 'table:mine', title: 'My bookings', description: 'Directions, changes' },
        ],
      },
      {
        title: 'You',
        rows: [
          { id: 'club', title: 'Masala Mile Club', description: 'Points and rewards' },
          { id: 'support', title: 'Talk to us', description: 'A person replies here' },
        ],
      },
    ],
  });
}

export async function nudge(ctx: FoodCtx, message: string): Promise<void> {
  await ctx.send.buttons({
    body: message,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'order:start', title: 'Order food' },
      { id: 'table:start', title: 'Book a table' },
      { id: 'home:more', title: 'More options' },
    ],
  });
}
