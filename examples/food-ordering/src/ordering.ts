import { DEMO_FOOTER, FlowUnavailableError, formatInr, ui } from '@lazyapp-examples/demo-kit';
import type { OrderItem } from '@lazyapp-examples/demo-kit';
import {
  areaFromText,
  CATEGORIES,
  DELIVERY_RADIUS_KM,
  etaMinutes,
  findItem,
  findOutlet,
  itemsIn,
  MENU,
  nearestOutlet,
  SPICE_LEVELS,
  vegMark,
} from './kitchen.js';
import type { CategoryId, MenuItem } from './kitchen.js';
import { FLOWS } from './manifest.js';
import { billText, bill, lineLabel, priceLines, unitPrice } from './pricing.js';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from './state.js';
import type { CartLine } from './state.js';
import { menuCatalog, nudge } from './views.js';
import type { FoodCtx } from './views.js';

const CART_HINT = 'Add dishes in the catalog and tap *Send* in the cart.';

// --- Where are you? ---------------------------------------------------------------------

export async function startOrder(ctx: FoodCtx, intro?: string): Promise<void> {
  const outlet = findOutlet(ctx.state.outletId);
  if (outlet !== undefined && ctx.state.mode !== null) {
    return showMenu(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'locating' }));
  await ctx.send.locationRequest(
    `${intro === undefined ? '' : `${intro}\n\n`}Share your location so I can find your nearest Masala Mile kitchen and check that we deliver to you. Or just type your area, like _Koramangala_.`,
  );
}

/** A shared pin or a typed area: pick the nearest kitchen and check the delivery radius. */
export async function onLocation(
  ctx: FoodCtx,
  latitude: number,
  longitude: number,
  name: string | null,
): Promise<void> {
  const { outlet, km } = nearestOutlet(latitude, longitude);
  const rounded = Math.round(km * 10) / 10;
  if (km <= DELIVERY_RADIUS_KM) {
    ctx.setState((state) => ({
      ...state,
      mode: 'delivery',
      outletId: outlet.id,
      drop: { latitude, longitude, km: rounded, details: state.drop?.details ?? null, name },
    }));
    return showMenu(
      ctx,
      `📍 We deliver to you from *Masala Mile ${outlet.name}*: ${rounded} km away, about ${etaMinutes(km)} minutes.`,
    );
  }
  ctx.setState((state) => ({ ...state, mode: null, outletId: outlet.id, drop: null }));
  await ctx.send.location({
    latitude: outlet.latitude,
    longitude: outlet.longitude,
    name: `Masala Mile ${outlet.name}`,
    address: outlet.address,
  });
  await ctx.send.buttons({
    body: `You are ${rounded} km from our nearest kitchen (${outlet.name}, pinned above), and we deliver within ${DELIVERY_RADIUS_KM} km so the food arrives hot. You can pick up instead, or eat with us.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'order:pickup', title: 'Pick up instead' },
      ...(outlet.dineIn ? [{ id: 'table:start', title: 'Book a table' }] : []),
      { id: 'order:relocate', title: 'Other location' },
    ],
  });
}

export async function onAreaText(ctx: FoodCtx, text: string): Promise<void> {
  const area = areaFromText(text);
  if (area === null) {
    await ctx.send.locationRequest(
      `I don't know "${text}" yet. Share your location with the button below, or type a Bengaluru area like _Indiranagar_ or _HSR Layout_.`,
    );
    return;
  }
  await onLocation(ctx, area.latitude, area.longitude, area.name);
}

export async function choosePickup(ctx: FoodCtx): Promise<void> {
  const outlet = findOutlet(ctx.state.outletId);
  if (outlet === undefined) {
    return startOrder(ctx);
  }
  ctx.setState((state) => ({ ...state, mode: 'pickup' }));
  await showMenu(ctx, `🛍️ Pickup from *Masala Mile ${outlet.name}*. We'll tell you the moment it's packed.`);
}

export async function relocate(ctx: FoodCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, mode: null, outletId: null, drop: null }));
  await startOrder(ctx);
}

// --- Menu -------------------------------------------------------------------------------

export async function showMenu(ctx: FoodCtx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  const catalog = await menuCatalog(ctx);
  const body = `${intro === undefined ? '' : `${intro}\n\n`}What are you craving?`;
  if (catalog !== null) {
    await ctx.send.interactive(
      ui.productList({
        header: 'Masala Mile menu',
        body: `${body} ${CART_HINT}`,
        footer: DEMO_FOOTER,
        catalogId: catalog.catalogId,
        sections: CATEGORIES.map((category) => ({
          title: category.title,
          retailerIds: itemsIn(category.id)
            .map((item) => item.id)
            .filter((id) => catalog.ids.has(id)),
        })).filter((section) => section.retailerIds.length > 0),
      }),
    );
    return;
  }
  const items = ctx.state.cart.reduce((sum, line) => sum + line.qty, 0);
  await ctx.send.list({
    header: 'Masala Mile menu',
    body,
    button: 'See the menu',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Menu',
        rows: [
          ...CATEGORIES.map((category) => ({
            id: `cat:${category.id}`,
            title: category.title,
            description: category.description,
          })),
          ...(items === 0 ? [] : [{ id: 'cart:view', title: '🛒 View cart', description: `${items} items` }]),
        ],
      },
    ],
  });
}

export async function showCategory(ctx: FoodCtx, id: CategoryId): Promise<void> {
  const category = CATEGORIES.find((entry) => entry.id === id);
  if (category === undefined) {
    return showMenu(ctx);
  }
  await ctx.send.list({
    header: category.title,
    body: `${category.description}. 🟢 veg · 🔴 non-veg · ★ bestseller`,
    button: 'Pick a dish',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: category.title,
        rows: itemsIn(id).map((item) => ({
          id: `item:${item.id}`,
          title: item.name,
          description: [
            `${vegMark(item)} ${priceFrom(item)}`,
            ...(item.bestseller ? ['★ Bestseller'] : []),
            item.description,
          ].join(' · '),
        })),
      },
    ],
  });
}

function priceFrom(item: MenuItem): string {
  const sizes = item.options?.sizes ?? [];
  return sizes.length > 1
    ? sizes.map((size) => `${size.label.replace(/ \(.*\)$/, '')} ${formatInr(size.pricePaise)}`).join(' / ')
    : formatInr(item.pricePaise);
}

/** A dish was picked: customise it in a Flow, or add it straight away when there is nothing to choose. */
export async function pickItem(ctx: FoodCtx, id: string): Promise<void> {
  const item = findItem(id);
  if (item === undefined) {
    return showMenu(ctx, 'That dish is not on the menu any more.');
  }
  if (item.options === null) {
    return addLine(ctx, { itemId: id, size: null, spice: null, addOns: [], qty: 1, note: null });
  }
  ctx.setState((state) => ({ ...state, step: 'customizing', customizing: { itemId: id, size: null } }));
  try {
    await ctx.flows.send({
      key: FLOWS.customize,
      ...(item.imageUrl === null ? {} : { header: { image: item.imageUrl } }),
      body: `*${item.name}* ${vegMark(item)}\n${item.description}\n\nPick the portion, spice level and add-ons.`,
      cta: 'Customise',
      footer: DEMO_FOOTER,
      screen: 'CUSTOMIZE',
      data: customizeData(item),
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await askFallbackOption(ctx, item, null);
  }
}

/** Screen data for the customise Flow: everything the form shows comes from the menu. */
export function customizeData(item: MenuItem): Record<string, unknown> {
  const options = item.options ?? { sizes: [], addOns: [] };
  return {
    item_id: item.id,
    item_name: `${item.name} ${vegMark(item)}`,
    item_description: item.description,
    price_note: priceFrom(item),
    sizes: options.sizes.map((size) => ({
      id: size.id,
      title: size.label,
      description: formatInr(size.pricePaise),
    })),
    spice_levels: SPICE_LEVELS.map((level) => ({ id: level.id, title: level.label })),
    add_ons: options.addOns.map((addOn) => ({
      id: addOn.id,
      title: addOn.label,
      description: `+ ${formatInr(addOn.pricePaise)}`,
    })),
    quantities: Array.from({ length: 5 }, (_unused, index) => ({
      id: String(index + 1),
      title: String(index + 1),
    })),
  };
}

/** The customise Flow's `complete` payload. Everything is re-validated against the menu. */
export async function onCustomizeFlow(
  ctx: FoodCtx,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  const item = typeof response.item_id === 'string' ? findItem(response.item_id) : undefined;
  if (item?.options === null || item === undefined) {
    return nudge(ctx, "I couldn't read that dish. Please pick it from the menu again.");
  }
  const options = item.options;
  const size =
    options.sizes.find((choice) => choice.id === response.size)?.id ?? options.sizes[0]?.id ?? null;
  const spice = SPICE_LEVELS.find((level) => level.id === response.spice)?.id ?? 'medium';
  const requested = Array.isArray(response.add_ons) ? response.add_ons : [];
  const addOns = options.addOns.filter((choice) => requested.includes(choice.id)).map((choice) => choice.id);
  const qty = Math.min(Math.max(Number(response.qty) || 1, 1), 5);
  const note =
    typeof response.note === 'string' && response.note.trim() !== ''
      ? response.note.trim().slice(0, 140)
      : null;
  await addLine(ctx, { itemId: item.id, size, spice, addOns, qty, note });
}

/** Without the Flow: portion (when there is a choice), then spice, as reply buttons. */
async function askFallbackOption(ctx: FoodCtx, item: MenuItem, size: string | null): Promise<void> {
  const sizes = item.options?.sizes ?? [];
  if (size === null && sizes.length > 1) {
    await ctx.send.buttons({
      ...(item.imageUrl === null ? {} : { header: { image: item.imageUrl } }),
      body: `*${item.name}* ${vegMark(item)}\n${item.description}\n\nWhich portion?`,
      footer: DEMO_FOOTER,
      buttons: sizes.slice(0, 3).map((choice) => ({
        id: `cz:size:${choice.id}`,
        title: `${choice.label.replace(/ \(.*\)$/, '')} · ${formatInr(choice.pricePaise)}`,
      })),
    });
    return;
  }
  await ctx.send.buttons({
    ...(item.imageUrl === null || sizes.length > 1 ? {} : { header: { image: item.imageUrl } }),
    body: `How spicy should we make your *${item.name}*?`,
    footer: DEMO_FOOTER,
    buttons: SPICE_LEVELS.slice(0, 3).map((level) => ({ id: `cz:spice:${level.id}`, title: level.label })),
  });
}

export async function onFallbackOption(ctx: FoodCtx, kind: string, value: string): Promise<void> {
  const draft = ctx.state.customizing;
  const item = draft === null ? undefined : findItem(draft.itemId);
  if (draft === null || item?.options === null || item === undefined) {
    return showMenu(ctx);
  }
  if (kind === 'size') {
    const size = item.options.sizes.find((choice) => choice.id === value)?.id ?? null;
    ctx.setState((state) => ({ ...state, customizing: { ...draft, size } }));
    return askFallbackOption(ctx, item, size ?? item.options.sizes[0]?.id ?? null);
  }
  const spice = SPICE_LEVELS.find((level) => level.id === value)?.id ?? 'medium';
  await addLine(ctx, {
    itemId: item.id,
    size: draft.size ?? item.options.sizes[0]?.id ?? null,
    spice,
    addOns: [],
    qty: 1,
    note: null,
  });
}

// --- Cart ---------------------------------------------------------------------------------

function sameChoices(a: CartLine, b: CartLine): boolean {
  return (
    a.itemId === b.itemId &&
    a.size === b.size &&
    a.spice === b.spice &&
    a.note === b.note &&
    [...a.addOns].sort().join() === [...b.addOns].sort().join()
  );
}

export async function addLine(ctx: FoodCtx, line: CartLine): Promise<void> {
  const item = findItem(line.itemId);
  if (item === undefined) {
    return showMenu(ctx);
  }
  const cart = ctx.state.cart;
  const index = cart.findIndex((entry) => sameChoices(entry, line));
  if (index === -1 && cart.length >= MAX_CART_LINES) {
    return cartView(
      ctx,
      `Your cart already has ${MAX_CART_LINES} different dishes. Check out, or remove one first.`,
    );
  }
  const next =
    index === -1
      ? [...cart, line]
      : cart.map((entry, at) =>
          at === index ? { ...entry, qty: Math.min(entry.qty + line.qty, MAX_LINE_QUANTITY) } : entry,
        );
  ctx.setState((state) => ({ ...state, cart: next, customizing: null, step: 'menu' }));
  await ctx.send.react('😋');
  const total = priceLines(next).reduce((sum, entry) => sum + entry.totalPaise, 0);
  const count = next.reduce((sum, entry) => sum + entry.qty, 0);
  await ctx.send.buttons({
    body: `Added *${line.qty} × ${lineLabel(item, line)}* (${formatInr(unitPrice(item, line) * line.qty)}).\n🛒 ${count} item${count === 1 ? '' : 's'} · ${formatInr(total)}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'checkout', title: 'Checkout' },
      { id: 'menu:open', title: 'Add more' },
      { id: 'cart:view', title: 'View cart' },
    ],
  });
}

/** A cart sent from the catalog. Customisable dishes get the chef's defaults, said out loud. */
export async function mergeCatalogOrder(ctx: FoodCtx, items: readonly OrderItem[]): Promise<void> {
  const lines = items.flatMap((entry): CartLine[] => {
    const item = findItem(entry.retailerId);
    if (item === undefined) {
      return [];
    }
    return [
      {
        itemId: item.id,
        size: item.options?.sizes[0]?.id ?? null,
        spice: item.options === null ? null : 'medium',
        addOns: [],
        qty: Math.min(entry.quantity, MAX_LINE_QUANTITY),
        note: null,
      },
    ];
  });
  let cart = [...ctx.state.cart];
  for (const line of lines) {
    const index = cart.findIndex((entry) => sameChoices(entry, line));
    if (index !== -1) {
      cart = cart.map((entry, at) =>
        at === index ? { ...entry, qty: Math.min(entry.qty + line.qty, MAX_LINE_QUANTITY) } : entry,
      );
    } else if (cart.length < MAX_CART_LINES) {
      cart = [...cart, line];
    }
  }
  ctx.setState((state) => ({ ...state, cart }));
  const defaults = lines.some((line) => line.spice !== null);
  await ctx.send.react('🛒');
  await cartView(
    ctx,
    defaults
      ? "Customisable dishes are in with the chef's defaults: smallest portion, medium spice."
      : undefined,
  );
}

export async function cartView(ctx: FoodCtx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu', activeLine: null }));
  const value = bill(ctx.state.cart, {
    mode: ctx.state.mode ?? 'delivery',
    pointsBalance: 0,
    usePoints: false,
  });
  if (value.lines.length === 0) {
    await ctx.send.buttons({
      body: `${intro === undefined ? '' : `${intro}\n\n`}Your cart is empty.`,
      footer: DEMO_FOOTER,
      buttons: [{ id: 'menu:open', title: 'See the menu' }],
    });
    return;
  }
  await ctx.send.buttons({
    header: '🛒 Your cart',
    body: `${intro === undefined ? '' : `${intro}\n\n`}${billText(value)}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'checkout', title: 'Checkout' },
      { id: 'menu:open', title: 'Add more' },
      { id: 'cart:edit', title: 'Edit cart' },
    ],
  });
}

export async function editCart(ctx: FoodCtx): Promise<void> {
  const lines = priceLines(ctx.state.cart);
  if (lines.length === 0) {
    return cartView(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'editing_cart' }));
  await ctx.send.list({
    body: 'Which dish do you want to change?',
    button: 'Choose dish',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'In your cart',
        rows: [
          ...ctx.state.cart.flatMap((line, index) => {
            const item = findItem(line.itemId);
            return item === undefined
              ? []
              : [
                  {
                    id: `cart:line:${index}`,
                    title: item.name,
                    description: `${line.qty} × ${lineLabel(item, line)}`,
                  },
                ];
          }),
          { id: 'cart:clear', title: 'Empty the cart', description: 'Start over' },
        ],
      },
    ],
  });
}

export async function lineMenu(ctx: FoodCtx, index: number): Promise<void> {
  const line = ctx.state.cart[index];
  const item = line === undefined ? undefined : findItem(line.itemId);
  if (line === undefined || item === undefined) {
    return cartView(ctx);
  }
  ctx.setState((state) => ({ ...state, activeLine: index }));
  await ctx.send.buttons({
    body: `*${lineLabel(item, line)}*\nQuantity: ${line.qty}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'cart:inc', title: 'Add one' },
      { id: 'cart:dec', title: 'Remove one' },
      { id: 'cart:remove', title: 'Remove dish' },
    ],
  });
}

export async function changeQuantity(ctx: FoodCtx, delta: number): Promise<void> {
  const index = ctx.state.activeLine;
  const line = index === null ? undefined : ctx.state.cart[index];
  if (index === null || line === undefined) {
    return cartView(ctx);
  }
  const qty = Math.min(line.qty + delta, MAX_LINE_QUANTITY);
  const cart =
    qty <= 0
      ? ctx.state.cart.filter((_entry, at) => at !== index)
      : ctx.state.cart.map((entry, at) => (at === index ? { ...entry, qty } : entry));
  ctx.setState((state) => ({ ...state, cart }));
  await cartView(ctx, qty <= 0 ? 'Removed.' : 'Updated.');
}

export async function clearCart(ctx: FoodCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, cart: [], usePoints: false }));
  await cartView(ctx);
}

/** Free text while browsing: a dish name opens it, anything else gets the menu. */
export async function findDish(ctx: FoodCtx, text: string): Promise<boolean> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  const match = MENU.find(
    (item) => words.length > 0 && words.every((word) => item.name.toLowerCase().includes(word)),
  );
  if (match === undefined) {
    return false;
  }
  await pickItem(ctx, match.id);
  return true;
}
