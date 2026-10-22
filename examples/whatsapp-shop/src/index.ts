import { defineExample } from '@lazyapp-examples/demo-kit';
import type { Inbound } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import { askForSearch, browse, category, deals, productCard, search } from './browse.js';
import { isCategory } from './catalog.js';
import {
  acceptReminder,
  addToCart,
  applyCoupon,
  changeQuantity,
  chooseSize,
  clearCart,
  editCart,
  lineMenu,
  mergeCatalogOrder,
  offerReminder,
  showCart,
  stopReminders,
} from './cart.js';
import {
  askAddress,
  askCodConfirmation,
  chooseSlot,
  confirmCod,
  onAddressFlow,
  onAddressForm,
  onAddressText,
  onPaymentCaptured,
  onPaymentFailed,
  payNow,
  startCheckout,
} from './checkout.js';
import { acceptOffer, claimOffer, onSendFailed, talkToSupport } from './engagement.js';
import {
  advance,
  askReschedule,
  listOrders,
  onReaction,
  orderDetail,
  rate,
  reorder,
  reschedule,
  track,
} from './fulfilment.js';
import { manifest } from './manifest.js';
import { OrderBook } from './orders.js';
import { findCoupon } from './pricing.js';
import {
  fallbackItem,
  fallbackKind,
  fallbackReason,
  fallbackSize,
  onReturnFlow,
  returnsEndpoint,
  startReturn,
} from './returns.js';
import { initialShopState, shopStateSchema } from './state.js';
import type { ShopState } from './state.js';
import { home, mainMenu, nudge } from './views.js';
import type { ShopCtx } from './views.js';

/**
 * Indigo Loom: a complete D2C store in WhatsApp. Browse (catalog or lists),
 * search by typing, cart with sizes, India address message, delivery slots,
 * UPI/card via order_details or cash on delivery, receipts, tracking with
 * native order-status updates, ratings by reaction, returns via a Flow, an
 * opt-in abandoned-cart reminder, a limited-time-offer coupon and a human handoff.
 */
export default defineExample<ShopState>({
  id: 'whatsapp-shop',
  title: 'WhatsApp Shop',
  startCode: 'DEMO SHOP',
  manifest,
  stateSchema: shopStateSchema,
  initialState: initialShopState,
  describe: () => ({
    summary: 'A full D2C store: catalog, cart, address, UPI or COD checkout, tracking, returns and reviews.',
    metaFeatures: [
      'Catalog & product messages',
      'Product carousel',
      'Media carousel',
      'Payments (India)',
      'Order status',
      'Address message',
      'WhatsApp Flows',
      'Limited-time offer template',
      'Marketing follow-up',
      'Reactions',
      'Contact cards',
      'CTA URL button',
    ],
    emoji: '🛍️',
  }),

  async onStart(ctx) {
    await home(ctx, `Namaste${ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`} 🙏`);
  },

  async onMenu(ctx) {
    await mainMenu(ctx);
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'text':
        return onText(ctx, inbound.text.trim());
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id);
      case 'order':
        return mergeCatalogOrder(ctx, inbound.items);
      case 'address':
        return onAddressForm(ctx, inbound.values, inbound.savedAddressId);
      case 'flow':
        return 'kind' in inbound.response
          ? onReturnFlow(ctx, inbound.response)
          : onAddressFlow(ctx, inbound.response);
      case 'reaction':
        return onReaction(ctx, inbound.emoji, inbound.targetWamid);
      case 'media':
        return onMedia(ctx, inbound);
      case 'location':
        return ctx.state.step === 'address' || ctx.state.step === 'address_text'
          ? nudge(
              ctx,
              'Thanks! Couriers need the full written address too, so please fill in the form above.',
            )
          : nudge(ctx, 'We deliver across India in 2–4 days. Want to start shopping?');
      default:
        return nudge(
          ctx,
          "I can't read that kind of message here. Tap an option, or type what you're looking for.",
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
    return onSendFailed(ctx, event);
  },

  flowEndpoints: { returns: returnsEndpoint },
});

const GREETING = /^(hi|hii+|hello|hey|namaste|start|help)\b/i;
const COUPON_LIKE = /^[A-Za-z]+\d+$/;

async function onText(ctx: ShopCtx, text: string): Promise<void> {
  if (ctx.state.step === 'address_text') {
    return onAddressText(ctx, text);
  }
  if (COUPON_LIKE.test(text) && findCoupon(text) !== undefined) {
    return applyCoupon(ctx, text);
  }
  if (ctx.state.step !== 'searching' && GREETING.test(text)) {
    return mainMenu(ctx, 'Hi again! What would you like to do?');
  }
  if (/^(cart|my cart|basket)$/i.test(text)) {
    return showCart(ctx);
  }
  if (/^(orders?|my orders|track)$/i.test(text)) {
    return listOrders(ctx, 'all');
  }
  return search(ctx, text);
}

async function onMedia(ctx: ShopCtx, inbound: Extract<Inbound, { kind: 'media' }>): Promise<void> {
  const latestReturn = new OrderBook(ctx.kv)
    .list(ctx.user.address)
    .find((order) => order.returnRequest !== null);
  if (inbound.mediaType === 'image' && latestReturn !== undefined) {
    await ctx.send.react('📎');
    return nudge(
      ctx,
      `Photo attached to the return for order ${latestReturn.id}. The courier will have it at pickup.`,
    );
  }
  return nudge(ctx, 'Thanks! To find a product, type what you are looking for, like _linen trousers_.');
}

/** Every reply button, list row, carousel quick reply and template quick reply lands here. */
async function onChoice(ctx: ShopCtx, id: string): Promise<void> {
  const [area = '', action = '', ...rest] = id.split(':');
  const arg = rest.join(':');
  switch (area) {
    case 'home':
      if (action === 'browse') {
        return browse(ctx);
      }
      return action === 'deals' ? deals(ctx) : mainMenu(ctx);
    case 'menu':
      switch (action) {
        case 'search':
          return askForSearch(ctx);
        case 'orders':
          return listOrders(ctx, 'all');
        case 'returns':
          return listOrders(ctx, 'returns');
        default:
          return mainMenu(ctx);
      }
    case 'cat':
      return isCategory(action) ? category(ctx, action) : browse(ctx);
    case 'product':
      return productCard(ctx, action);
    case 'size':
      return chooseSize(ctx, action);
    case 'cart':
      return onCartChoice(ctx, action, arg);
    case 'remind':
      return action === 'yes' ? acceptReminder(ctx) : showCart(ctx);
    case 'offers':
      return stopReminders(ctx);
    case 'offer':
      return action === 'yes' ? acceptOffer(ctx) : claimOffer(ctx);
    case 'checkout':
      return action === 'address' ? askAddress(ctx) : startCheckout(ctx);
    case 'slot':
      return chooseSlot(ctx, [action, ...rest].join(':'));
    case 'pay':
      return action === 'cod' ? askCodConfirmation(ctx) : payNow(ctx);
    case 'cod':
      return action === 'confirm' ? confirmCod(ctx) : showCart(ctx);
    case 'order':
      return orderDetail(ctx, action);
    case 'track':
      return track(ctx, action);
    case 'next':
      return advance(ctx, action);
    case 'resched':
      return askReschedule(ctx, action);
    case 'reslot':
      return reschedule(ctx, action, arg);
    case 'rate':
      return rate(ctx, action, Number(arg));
    case 'reorder':
      return reorder(ctx, action);
    case 'return':
      return startReturn(ctx, action);
    case 'ret':
      return onReturnChoice(ctx, action, arg);
    case 'support':
      return talkToSupport(ctx);
    default:
      await ctx.send.react('🤔');
      return mainMenu(ctx, 'That button is from an older message. Here is the menu:');
  }
}

async function onCartChoice(ctx: ShopCtx, action: string, arg: string): Promise<void> {
  switch (action) {
    case 'add':
      return addToCart(ctx, arg);
    case 'edit':
      return editCart(ctx);
    case 'line':
      return lineMenu(ctx, Number(arg));
    case 'inc':
      return changeQuantity(ctx, ctx.state.activeLine, 1);
    case 'dec':
      return changeQuantity(ctx, ctx.state.activeLine, -1);
    case 'remove':
      return changeQuantity(ctx, ctx.state.activeLine, -Infinity);
    case 'clear':
      return clearCart(ctx);
    case 'remind':
      return offerReminder(ctx);
    default:
      return showCart(ctx);
  }
}

async function onReturnChoice(ctx: ShopCtx, action: string, arg: string): Promise<void> {
  switch (action) {
    case 'item':
      return fallbackItem(ctx, arg);
    case 'kind':
      return fallbackKind(ctx, arg === 'exchange' ? 'exchange' : 'return');
    case 'size':
      return fallbackSize(ctx, arg);
    case 'reason':
      return fallbackReason(ctx, arg);
    default:
      return listOrders(ctx, 'returns');
  }
}
