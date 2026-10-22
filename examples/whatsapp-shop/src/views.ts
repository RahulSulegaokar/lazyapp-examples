import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import { BRAND, storefrontCatalog } from './catalog.js';
import type { StorefrontCatalog } from './catalog.js';
import type { ShopState } from './state.js';

export type ShopCtx = ExampleContext<ShopState>;

/**
 * The catalog the storefront can use this turn, or null for list fallbacks.
 * `ctx.capabilities` caches the lookup for a few minutes.
 */
export async function storefront(ctx: ShopCtx): Promise<StorefrontCatalog | null> {
  return storefrontCatalog(await ctx.capabilities.catalog());
}

export async function home(ctx: ShopCtx, greeting: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browsing' }));
  await ctx.send.buttons({
    header: { image: BRAND.banner },
    body: [
      greeting,
      '',
      `Welcome to *${BRAND.name}*: ${BRAND.tagline.toLowerCase()}. Browse, pay by UPI or cash on delivery, and track your order without leaving WhatsApp.`,
      '',
      'Tip: just type what you are looking for, like _red silk saree_.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'home:browse', title: 'Shop collections' },
      { id: 'home:deals', title: "Today's deals" },
      { id: 'home:more', title: 'More options' },
    ],
  });
}

export async function mainMenu(ctx: ShopCtx, body = 'What would you like to do?'): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browsing', activeLine: null }));
  const items = ctx.state.cart.reduce((sum, line) => sum + line.qty, 0);
  await ctx.send.list({
    header: BRAND.name,
    body,
    button: 'Open menu',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Shop',
        rows: [
          { id: 'home:browse', title: 'Collections', description: 'Sarees, dresses, bedding, bags' },
          { id: 'home:deals', title: "Today's deals", description: 'Up to 25% off, today only' },
          { id: 'menu:search', title: 'Search', description: 'Find a product by name or colour' },
          { id: 'offer:claim', title: 'Festive coupon', description: 'Get ₹200 off on WhatsApp' },
        ],
      },
      {
        title: 'Your account',
        rows: [
          {
            id: 'cart:view',
            title: 'Cart',
            description: items === 0 ? 'Empty' : `${items} item${items === 1 ? '' : 's'}`,
          },
          { id: 'menu:orders', title: 'My orders', description: 'Track, reorder, rate' },
          { id: 'menu:returns', title: 'Returns & exchanges', description: '7-day free pickup' },
        ],
      },
      {
        title: 'Help',
        rows: [{ id: 'support', title: 'Talk to support', description: 'A person replies in this chat' }],
      },
    ],
  });
}

/** For input that fits nowhere: say so, then offer the way forward. */
export async function nudge(ctx: ShopCtx, message: string): Promise<void> {
  await ctx.send.buttons({
    body: message,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'home:browse', title: 'Shop collections' },
      { id: 'cart:view', title: 'View cart' },
      { id: 'home:more', title: 'More options' },
    ],
  });
}
