import { createHash } from 'node:crypto';
import { defineExample, DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { Example } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import { greetingFor, parseAttribution } from './attribution.js';
import { configFromEnv } from './config.js';
import type { LeadGenConfig } from './config.js';
import { pushCrmEvent, syncLeadTags } from './crm.js';
import { flowEndpoints } from './endpoints.js';
import { LEAD_IDS, MEETING_IDS, NURTURE_IDS, QUALIFY_PREFIX } from './ids.js';
import { EXAMPLE_ID, manifest, START_CODE } from './manifest.js';
import {
  askCancel,
  cancelMeeting,
  onAttending,
  onMeetingFlowCompleted,
  onMessageFailed,
  onSlotPicked,
  showMeeting,
  startMeeting,
} from './meeting.js';
import { decline, optIn, sendGuide, stopTips, unsubscribe } from './nurture.js';
import { onFallbackAnswer, onQualifyCompleted, startQualify } from './qualify.js';
import { TAG_PREFIX } from './scoring.js';
import { initialLeadState, leadStateSchema } from './state.js';
import type { LeadState } from './state.js';
import type { Ctx, Deps } from './types.js';
import { mainMenu, pricing, welcome } from './welcome.js';

/**
 * Ledgerly's inbound lead machine: ad or QR in, qualified, scored, tagged and routed to
 * sales, a calendar or a consented nurture track, with every step mirrored to the CRM.
 *
 * A factory so tests inject the CRM transport and timing; the default export reads the env.
 */
export function createLeadGenerationExample(config: LeadGenConfig): Example<LeadState> {
  const deps: Deps = { config };

  return defineExample<LeadState>({
    id: EXAMPLE_ID,
    title: 'Ledgerly lead machine',
    startCode: START_CODE,
    manifest,
    stateSchema: leadStateSchema,
    initialState: initialLeadState,
    flowEndpoints,
    describe: () => ({
      summary:
        'Ad or QR to booked demo: attribution, qualification Flow, scoring, CRM alerts and consented nurture.',
      metaFeatures: [
        'Click-to-WhatsApp ad referral',
        'QR codes and chat links',
        'WhatsApp Flows (navigate + data exchange)',
        'Reply buttons',
        'List messages',
        'Document (PDF guide)',
        'Contact card',
        'Reactions',
        'Utility templates',
        'Marketing templates (coupon code)',
        'Scheduled follow-ups',
        'Marketing consent',
        'Contact tags',
        'Events API',
      ],
      emoji: '🎯',
    }),

    async onStart(ctx, inbound) {
      const text = inbound.kind === 'text' ? inbound.text : null;
      ctx.setState((state) => ({
        ...state,
        leadId: `LD-${createHash('sha256').update(ctx.session.id).digest('hex').slice(0, 8).toUpperCase()}`,
        attribution: parseAttribution(inbound.referral, text),
      }));
      await pushCrmEvent(ctx, deps, 'lead.created');
      await syncLeadTags(ctx);
      if (text !== null && asksForDemo(text)) {
        await ctx.send.text(`Hi! ${greetingFor(ctx.state.attribution)} Let us set up your Ledgerly demo.`);
        await startQualify(ctx);
        return;
      }
      await welcome(ctx);
    },

    async onMenu(ctx) {
      await mainMenu(ctx);
    },

    async onMessage(ctx, inbound) {
      switch (inbound.kind) {
        case 'button':
        case 'list':
          return onChoice(ctx, inbound.id);
        case 'flow':
          return onFlow(ctx, inbound.response);
        case 'text':
          return mainMenu(
            ctx,
            "Thanks! I'm an automated assistant, so taps work best here. What would you like to do?",
          );
        case 'reaction':
          return;
        default:
          return mainMenu(ctx);
      }
    },

    async onEvent(ctx, event) {
      if (isEventType(event, 'message.failed')) {
        await onMessageFailed(ctx, event.data.message.uuid);
        return;
      }
      if (event.type === 'contact.opted_out') {
        // LazyApp suppressed the contact. Marketing-only: stop the drip, keep the chat.
        // Anything wider (STOP keyword, all purposes): nothing more may be sent, so end quietly.
        await unsubscribe(ctx, deps);
        if (event.data.purpose !== 'marketing') {
          await pushCrmEvent(ctx, deps, 'lead.opted_out');
          await ctx.end();
        }
      }
    },

    async onEnd(ctx, reason) {
      if (reason !== 'stop') {
        return;
      }
      // The router has already cancelled every follow-up; record the opt-out where sales sees it.
      await pushCrmEvent(ctx, deps, 'lead.opted_out');
      const contact = ctx.user.contactUuid;
      if (contact !== null) {
        await ctx.api.contacts.recordConsent(
          contact,
          {
            granted: false,
            channel: 'whatsapp',
            purpose: 'all',
            consent_text: 'Sent STOP in the demo chat',
            captured_by: `lazyapp-examples:${EXAMPLE_ID}`,
          },
          { idempotencyKey: ctx.idempotencyKey('consent:stop') },
        );
        await ctx.api.contacts.addTags(contact, [`${TAG_PREFIX}:opted-out`], {
          idempotencyKey: ctx.idempotencyKey('tags:opted-out'),
        });
      }
    },
  });

  async function onChoice(ctx: Ctx, id: string): Promise<void> {
    const booked = ctx.state.meeting?.status === 'booked';
    if (Object.values(QUALIFY_PREFIX).some((prefix) => id.startsWith(prefix))) {
      return onFallbackAnswer(ctx, deps, id);
    }
    if (id.startsWith(MEETING_IDS.slot)) {
      return onSlotPicked(ctx, deps, id.slice(MEETING_IDS.slot.length));
    }
    switch (id) {
      case LEAD_IDS.book:
        return booked
          ? showMeeting(ctx)
          : ctx.state.score === null
            ? startQualify(ctx)
            : startMeeting(ctx, deps);
      case LEAD_IDS.pricing:
        return pricing(ctx);
      case LEAD_IDS.guide:
        return sendGuide(ctx);
      case NURTURE_IDS.optIn:
        return optIn(ctx, deps);
      case NURTURE_IDS.decline:
        return decline(ctx);
      case NURTURE_IDS.stop:
        return stopTips(ctx, deps);
      case MEETING_IDS.reschedule:
        return booked ? startMeeting(ctx, deps, true) : startQualifyOrMeeting(ctx);
      case MEETING_IDS.cancel:
        return booked ? askCancel(ctx) : mainMenu(ctx, 'You have no demo booked right now.');
      case MEETING_IDS.cancelConfirmed:
        return booked ? cancelMeeting(ctx, deps) : mainMenu(ctx, 'You have no demo booked right now.');
      case MEETING_IDS.keep:
        return showMeeting(ctx);
      case MEETING_IDS.attending:
        return booked ? onAttending(ctx) : mainMenu(ctx);
      default:
        return mainMenu(ctx, 'That option has expired. Here is what you can do:');
    }
  }

  async function startQualifyOrMeeting(ctx: Ctx): Promise<void> {
    return ctx.state.score === null ? startQualify(ctx) : startMeeting(ctx, deps);
  }

  async function onFlow(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
    switch (response.flow) {
      case 'qualify':
        return onQualifyCompleted(ctx, deps, response);
      case 'meeting':
        return onMeetingFlowCompleted(ctx, deps, response.meeting_id);
      default:
        await ctx.send.buttons({
          body: 'That form is from an older message.',
          footer: DEMO_FOOTER,
          buttons: [{ id: LEAD_IDS.book, title: 'Book a demo' }],
        });
    }
  }
}

/** "DEMO LEADS I want a demo" (ice breaker, ad prefill): intent after the code, ignoring `src=` tags. */
export function asksForDemo(text: string): boolean {
  const rest = text
    .trim()
    .slice(START_CODE.length)
    .replace(/\b[a-z_]+=\S+/gi, '');
  return /\bdemo\b/i.test(rest);
}

export default createLeadGenerationExample(configFromEnv(process.env));
