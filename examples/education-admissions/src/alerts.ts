import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { TemplateSend } from '@lazyapp-examples/sdk';
import { ANNOUNCEMENT_IMAGE, PROGRAMS } from './catalog.js';
import type { Ctx } from './context.js';
import { firstName, tagContact } from './context.js';
import { intakeOptions } from './finder.js';
import { TEMPLATE_PAYLOADS, TEMPLATES } from './manifest.js';
import { MENU_IDS, showMenu } from './menu.js';

/**
 * Intake alerts: an explicit opt-in that records marketing consent on the LazyApp contact
 * and tags it `admissions:intake-alerts`, the segment the intake announcement is broadcast to.
 */

export const ALERT_IDS = {
  yes: 'alerts:yes',
  no: 'alerts:no',
  stop: TEMPLATE_PAYLOADS.stopAlerts,
} as const;

export const ALERTS_TAG = 'admissions:intake-alerts';
export const CONSENT_TEXT =
  'Yes, send me intake announcements, deadlines and scholarship alerts from BrightPath on WhatsApp (about two a month). Reply STOP to unsubscribe.';
const TOP_SCHOLARSHIP = '₹10 lakh';

export async function showAlerts(ctx: Ctx): Promise<void> {
  if (ctx.consent.marketingOptIn) {
    await ctx.send.buttons({
      body: "You're subscribed to intake alerts: new intakes, deadlines and scholarships, about two messages a month.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: ALERT_IDS.stop, title: 'Stop alerts' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await ctx.send.buttons({
    header: 'Intake alerts',
    body: `${CONSENT_TEXT}\n\nYou'll get the current announcement right away so you can see what they look like.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: ALERT_IDS.yes, title: 'Yes, send alerts' },
      { id: ALERT_IDS.no, title: 'No thanks' },
    ],
  });
}

export async function onAlertsYes(ctx: Ctx): Promise<void> {
  await ctx.consent.optInToMarketing(CONSENT_TEXT);
  await tagContact(ctx, [ALERTS_TAG]);
  await ctx.send.text("You're in. Here's the latest announcement, exactly as subscribers get it:");
  await sendAnnouncement(ctx);
}

/** The approved marketing template; if it is not approved yet, the same content as an interactive preview. */
export async function sendAnnouncement(ctx: Ctx): Promise<void> {
  const intake = intakeOptions(ctx.now()).at(-1)?.title ?? 'next';
  try {
    await ctx.send.template(announcementTemplate(firstName(ctx) ?? 'there', intake));
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('intake template not sendable, showing a preview', {
      code: error.code,
      status: error.status,
    });
    await ctx.send.buttons({
      header: { image: ANNOUNCEMENT_IMAGE },
      body: `Hi ${firstName(ctx) ?? 'there'}, applications for the ${intake} intake are now open at ${PROGRAMS.length} partner universities in the UK, Canada, Australia, Germany, Ireland and the USA. Early applicants can get scholarships worth up to ${TOP_SCHOLARSHIP}. Check your eligibility in two minutes.\n\n(Preview: the approved template "${TEMPLATES.intake}" is not available on this number yet.)`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.finder, title: 'Check eligibility' },
        { id: ALERT_IDS.stop, title: 'Stop alerts' },
      ],
    });
  }
}

export function announcementTemplate(name: string, intake: string): TemplateSend {
  return {
    name: TEMPLATES.intake,
    language: 'en',
    components: [
      { type: 'header', parameters: [{ type: 'image', image: { link: ANNOUNCEMENT_IMAGE } }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: intake },
          { type: 'text', text: String(PROGRAMS.length) },
          { type: 'text', text: TOP_SCHOLARSHIP },
        ],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.eligibility }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.stopAlerts }],
      },
    ],
  };
}

export async function onAlertsNo(ctx: Ctx): Promise<void> {
  return showMenu(ctx, 'No problem, no alerts. You can turn them on any time from the menu.');
}

export async function onAlertsStop(ctx: Ctx): Promise<void> {
  await ctx.consent.optOutOfMarketing();
  await tagContact(ctx, [], [ALERTS_TAG]);
  await showMenu(
    ctx,
    "Done, you won't get intake alerts any more. Your application updates are not affected.",
  );
}
