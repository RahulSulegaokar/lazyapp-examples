import { DEMO_FOOTER, publicAssetUrl } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import { pushCrmEvent, syncLeadTags } from './crm.js';
import { LEAD_IDS, NURTURE_IDS } from './ids.js';
import { COUPON_CODE, TEMPLATES } from './manifest.js';
import { GUIDE_FILE } from './product.js';
import type { Ctx, Deps } from './types.js';

/**
 * Nurture for leads who are not ready: a useful asset now, and a short drip only after an
 * explicit "Yes, send tips". Consent is recorded on the LazyApp contact; "Stop tips", the
 * WhatsApp-native "Stop promotions" (`contact.opted_out`) and STOP all end it.
 */

export const DRIP_KEYS = { tip: 'nurture-tip', offer: 'comeback-offer' } as const;

const CONSENT_TEXT =
  'Tapped "Yes, send tips" after: "Want 2 short GST tips on WhatsApp over the next few days? You can stop any time."';

export async function sendGuide(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'nurture', guideSent: true }));
  await ctx.send.document(
    publicAssetUrl(ctx.config.publicBaseUrl, ctx.example.id, GUIDE_FILE),
    'Ledgerly-GST-invoicing-guide.pdf',
    'The 2026 GST invoicing checklist: e-invoicing thresholds, e-way bills and GSTR-2B matching.',
  );
  if (ctx.state.nurture === 'subscribed' || ctx.state.nurture === 'stopped') {
    await ctx.send.buttons({
      body: 'Here is your guide. Ready to see it working on your own invoices?',
      footer: DEMO_FOOTER,
      buttons: [{ id: LEAD_IDS.book, title: 'Book a demo' }],
    });
    return;
  }
  await ctx.send.buttons({
    body: 'Here is your guide. Want 2 short GST tips on WhatsApp over the next few days? You can stop any time.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: NURTURE_IDS.optIn, title: 'Yes, send tips' },
      { id: NURTURE_IDS.decline, title: 'No thanks' },
      { id: LEAD_IDS.book, title: 'Book a demo' },
    ],
  });
}

/** Only ever called from the "Yes, send tips" tap. */
export async function optIn(ctx: Ctx, deps: Deps): Promise<void> {
  await ctx.consent.optInToMarketing(CONSENT_TEXT);
  ctx.setState((state) => ({ ...state, nurture: 'subscribed' }));
  const demo = deps.config.timing === 'demo';
  const at = (minutes: number, days: number) =>
    new Date(ctx.now().getTime() + (demo ? minutes * 60_000 : days * 24 * 60 * 60_000));
  const name = ctx.user.displayName ?? 'there';
  const company = ctx.state.answers.company ?? 'your business';
  try {
    await ctx.followUps.schedule({
      key: DRIP_KEYS.tip,
      category: 'marketing',
      sendAt: at(3, 2),
      template: {
        name: TEMPLATES.nurtureTip,
        language: 'en',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: company },
            ],
          },
          quickReply(0, LEAD_IDS.book),
          quickReply(1, NURTURE_IDS.stop),
        ],
      },
    });
    await ctx.followUps.schedule({
      key: DRIP_KEYS.offer,
      category: 'marketing',
      sendAt: at(10, 5),
      template: {
        name: TEMPLATES.comebackOffer,
        language: 'en',
        features: { coupon_code: COUPON_CODE },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: name }] },
          quickReply(1, LEAD_IDS.book),
          quickReply(2, NURTURE_IDS.stop),
        ],
      },
    });
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('could not schedule the nurture drip', { status: error.status, code: error.code });
  }
  await pushCrmEvent(ctx, deps, 'nurture.opted_in');
  await syncLeadTags(ctx);
  await ctx.send.buttons({
    body:
      "You're in. Two short tips are on their way, then nothing else unless you ask." +
      (demo ? '\n\n_Demo: the first arrives in about 3 minutes, the second in 10._' : ''),
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: 'Book a demo' },
      { id: NURTURE_IDS.stop, title: 'Stop tips' },
    ],
  });
}

export async function decline(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({
    ...state,
    nurture: state.nurture === 'subscribed' ? state.nurture : 'declined',
  }));
  await ctx.send.buttons({
    body: 'No problem, we will not message you. Book a demo whenever you are ready.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: 'Book a demo' },
      { id: LEAD_IDS.pricing, title: 'See pricing' },
    ],
  });
}

/** "Stop tips" / "Stop offers": marketing ends, the conversation does not. */
export async function stopTips(ctx: Ctx, deps: Deps): Promise<void> {
  await unsubscribe(ctx, deps);
  await ctx.send.buttons({
    body: 'Done, no more tips or offers. You can still book a demo here any time.',
    footer: DEMO_FOOTER,
    buttons: [{ id: LEAD_IDS.book, title: 'Book a demo' }],
  });
}

/** Marketing opt-out from any channel. Cancels the drip; sends nothing. */
export async function unsubscribe(ctx: Ctx, deps: Deps): Promise<void> {
  const wasSubscribed = ctx.state.nurture === 'subscribed' || ctx.consent.marketingOptIn;
  await ctx.consent.optOutOfMarketing();
  ctx.setState((state) => ({ ...state, nurture: 'stopped' }));
  if (wasSubscribed) {
    await pushCrmEvent(ctx, deps, 'nurture.opted_out');
  }
  await syncLeadTags(ctx);
}

function quickReply(index: number, payload: string): Readonly<Record<string, unknown>> {
  return {
    type: 'button',
    sub_type: 'quick_reply',
    index: String(index),
    parameters: [{ type: 'payload', payload }],
  };
}
