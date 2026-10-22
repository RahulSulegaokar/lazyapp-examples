import { defineExample } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import {
  myBookings,
  onBookingChoice,
  onFallbackChoice,
  onTableFlow,
  startBooking,
  tableEndpoint,
} from './bookings.js';
import {
  askLater,
  chooseWhen,
  onAddress,
  onAddressText,
  onPaymentCaptured,
  onPaymentFailed,
  payNow,
  placeCod,
  startCheckout,
  usePoints,
} from './checkout.js';
import { isCategory } from './kitchen.js';
import { manifest } from './manifest.js';
import {
  cartView,
  changeQuantity,
  choosePickup,
  clearCart,
  editCart,
  findDish,
  lineMenu,
  mergeCatalogOrder,
  onAreaText,
  onCustomizeFlow,
  onFallbackOption,
  onLocation,
  pickItem,
  relocate,
  showCategory,
  showMenu,
  startOrder,
} from './ordering.js';
import { foodStateSchema, initialFoodState } from './state.js';
import type { FoodState } from './state.js';
import { advance, club, onReaction, rate, reorder, talkToUs, track } from './tracking.js';
import { home, moreMenu, nudge } from './views.js';
import type { FoodCtx } from './views.js';

/**
 * Masala Mile: a cloud kitchen in WhatsApp. Nearest outlet from a shared
 * location with a delivery-radius check, menu by category (catalog or lists),
 * dish customisation in a Flow, ASAP or scheduled delivery, UPI via
 * order_details or cash, live kitchen updates with the rider's card and
 * position, table booking with live availability, loyalty points, ratings by
 * reaction and one-tap reorder.
 */
export default defineExample<FoodState>({
  id: 'food-ordering',
  title: 'Food ordering',
  startCode: 'DEMO FOOD',
  manifest,
  stateSchema: foodStateSchema,
  initialState: initialFoodState,
  describe: () => ({
    summary:
      'A cloud kitchen: nearest outlet, menu, customisation, UPI or cash, live kitchen updates, table booking.',
    metaFeatures: [
      'Location request',
      'Location',
      'WhatsApp Flows',
      'Catalog & product messages',
      'Payments (India)',
      'Order status',
      'Address message',
      'Utility template follow-up',
      'Contact cards',
      'Reactions',
      'List messages',
      'Reply buttons',
    ],
    emoji: '🍛',
  }),

  async onStart(ctx) {
    await home(ctx, `Namaste${ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`} 🙏`);
  },

  async onMenu(ctx) {
    await moreMenu(ctx);
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'text':
        return onText(ctx, inbound.text.trim());
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id);
      case 'location':
        return onLocation(ctx, inbound.latitude, inbound.longitude, inbound.name);
      case 'order':
        return mergeCatalogOrder(ctx, inbound.items);
      case 'address':
        return onAddress(ctx, inbound.values);
      case 'flow':
        return 'booking_id' in inbound.response
          ? onTableFlow(ctx, inbound.response)
          : onCustomizeFlow(ctx, inbound.response);
      case 'reaction':
        return onReaction(ctx, inbound.emoji, inbound.targetWamid);
      default:
        return nudge(
          ctx,
          "I can't read that kind of message here. Tap an option below, or type a dish like _biryani_.",
        );
    }
  },

  async onEvent(ctx, event) {
    if (isEventType(event, 'payment.captured')) {
      return onPaymentCaptured(ctx, event.data.payment);
    }
    if (isEventType(event, 'payment.failed')) {
      return onPaymentFailed(ctx, event.data.payment);
    }
    ctx.log.warn('a food demo message failed', { type: event.type });
  },

  flowEndpoints: { table: tableEndpoint },
});

const GREETING = /^(hi|hii+|hello|hey|namaste|help)\b/i;

async function onText(ctx: FoodCtx, text: string): Promise<void> {
  switch (ctx.state.step) {
    case 'locating':
      return onAreaText(ctx, text);
    case 'address_text':
      return onAddressText(ctx, text);
    default:
      break;
  }
  if (GREETING.test(text)) {
    return moreMenu(ctx, 'Hi again! What would you like?');
  }
  if (/^(menu card|food|order)$/i.test(text)) {
    return startOrder(ctx);
  }
  if (await findDish(ctx, text)) {
    return;
  }
  await nudge(ctx, `I couldn't find "${text}" on our menu. Tap *Order food* to browse it.`);
}

/** Every reply button, list row and template quick reply. Ids are `area:action:arg`. */
async function onChoice(ctx: FoodCtx, id: string): Promise<void> {
  const [area = '', action = '', ...rest] = id.split(':');
  const arg = rest.join(':');
  switch (area) {
    case 'home':
      return moreMenu(ctx);
    case 'order':
      if (action === 'pickup') {
        return choosePickup(ctx);
      }
      return action === 'relocate' ? relocate(ctx) : startOrder(ctx);
    case 'menu':
      return showMenu(ctx);
    case 'cat':
      return isCategory(action) ? showCategory(ctx, action) : showMenu(ctx);
    case 'item':
      return pickItem(ctx, action);
    case 'cz':
      return onFallbackOption(ctx, action, arg);
    case 'cart':
      return onCartChoice(ctx, action, arg);
    case 'checkout':
      return startCheckout(ctx);
    case 'when':
      return action === 'later' ? askLater(ctx) : chooseWhen(ctx, action, arg);
    case 'points':
      return usePoints(ctx);
    case 'pay':
      return action === 'cod' ? placeCod(ctx) : payNow(ctx);
    case 'kitchen':
      return advance(ctx, action);
    case 'track':
      return track(ctx, action);
    case 'rate':
      return rate(ctx, action, Number(arg));
    case 'reorder':
      return reorder(ctx, action);
    case 'table':
      return action === 'mine' ? myBookings(ctx) : startBooking(ctx);
    case 'tb':
      return onFallbackChoice(ctx, action, arg);
    case 'booking':
      return onBookingChoice(ctx, action, arg);
    case 'club':
      return club(ctx);
    case 'support':
      return talkToUs(ctx);
    default:
      await ctx.send.react('🤔');
      return moreMenu(ctx, 'That button is from an older message. Here is the menu:');
  }
}

async function onCartChoice(ctx: FoodCtx, action: string, arg: string): Promise<void> {
  switch (action) {
    case 'edit':
      return editCart(ctx);
    case 'line':
      return lineMenu(ctx, Number(arg));
    case 'inc':
      return changeQuantity(ctx, 1);
    case 'dec':
      return changeQuantity(ctx, -1);
    case 'remove':
      return changeQuantity(ctx, -Infinity);
    case 'clear':
      return clearCart(ctx);
    default:
      return cartView(ctx);
  }
}
