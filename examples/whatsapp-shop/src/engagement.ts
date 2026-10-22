import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import type { WebhookEnvelope } from '@lazyapp-examples/sdk';
import { BRAND } from './catalog.js';
import { TEMPLATES } from './manifest.js';
import { OrderBook } from './orders.js';
import { findCoupon, OFFER_COUPON } from './pricing.js';
import { nudge } from './views.js';
import type { ShopCtx } from './views.js';

const OFFER_HOURS = 48;
const OFFER_CONSENT =
  'Yes, send me offers and coupons from Indigo Loom on WhatsApp. I can reply STOP at any time.';

/** "Get the coupon": marketing, so it needs an explicit opt-in first. */
export async function claimOffer(ctx: ShopCtx): Promise<void> {
  if (ctx.session.marketingOptIn) {
    return sendOffer(ctx);
  }
  await ctx.send.buttons({
    body: `The festive coupon comes as a WhatsApp offer message.\n\nTapping *Yes* means: "${OFFER_CONSENT}"`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'offer:yes', title: 'Yes, send it' },
      { id: 'home:browse', title: 'No thanks' },
    ],
  });
}

export async function acceptOffer(ctx: ShopCtx): Promise<void> {
  await ctx.consent.optInToMarketing(OFFER_CONSENT);
  await sendOffer(ctx);
}

/** Limited-time offer template: a countdown and a copy-code button. The code is also saved to the cart. */
async function sendOffer(ctx: ShopCtx): Promise<void> {
  const coupon = findCoupon(OFFER_COUPON);
  ctx.setState((state) => ({ ...state, coupon: OFFER_COUPON }));
  await ctx.send.template({
    name: TEMPLATES.festiveOffer,
    language: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: ctx.user.displayName ?? 'there' },
          { type: 'text', text: '₹200' },
        ],
      },
    ],
    features: {
      coupon_code: OFFER_COUPON,
      offer_expires_at: new Date(ctx.now().getTime() + OFFER_HOURS * 3_600_000).toISOString(),
    },
  });
  await ctx.send.buttons({
    body: `I've also saved *${OFFER_COUPON}* to your cart (${coupon?.label ?? '₹200 off'}).`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'home:deals', title: "Today's deals" },
      { id: 'cart:view', title: 'View cart' },
    ],
  });
}

/** Hands the chat to a person: tag the contact so the team's inbox view picks it up. */
export async function talkToSupport(ctx: ShopCtx): Promise<void> {
  if (ctx.user.contactUuid !== null) {
    try {
      await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-shop-support']);
    } catch (error) {
      ctx.log.warn('could not tag the contact for support', { error });
    }
  }
  const latest = new OrderBook(ctx.kv).list(ctx.user.address)[0];
  await ctx.send.contacts([
    {
      name: { formatted_name: `${BRAND.name} Care`, first_name: BRAND.name, last_name: 'Care' },
      phones: [{ phone: BRAND.supportPhone, type: 'WORK' }],
      emails: [{ email: BRAND.supportEmail, type: 'WORK' }],
      org: { company: BRAND.name, title: 'Customer care' },
    },
  ]);
  await nudge(
    ctx,
    [
      'A person from our care team will reply right here, usually within 10 minutes (9 am – 9 pm). Their contact card is above.',
      ...(latest === undefined
        ? []
        : [`I've noted your latest order (${latest.id}) so you don't have to repeat yourself.`]),
      '',
      '_Demo: this chat is now tagged demo-shop-support in the LazyApp inbox._',
    ].join('\n'),
  );
}

/**
 * A send of ours failed. The common case in a fresh workspace: the offer template
 * is still in Meta review. Tell the shopper instead of leaving them waiting.
 */
export async function onSendFailed(ctx: ShopCtx, event: WebhookEnvelope): Promise<void> {
  if (!isEventType(event, 'message.failed')) {
    return;
  }
  const message = event.data.message as { type?: string; error_message?: string | null };
  ctx.log.warn('a shop message failed', { type: message.type, error: message.error_message });
  if (message.type === 'template' && ctx.session.windowOpen && ctx.state.coupon === OFFER_COUPON) {
    await ctx.send.text(
      `The offer message couldn't be delivered (the template may still be in review). Your code is *${OFFER_COUPON}*, and it's already applied to your cart.`,
    );
  }
}
