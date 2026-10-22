import { defineExample } from '@lazyapp-examples/demo-kit';
import type { Inbound } from '@lazyapp-examples/demo-kit';
import { normaliseOrderId } from './data.js';
import {
  chatWithAgent,
  chooseCategory,
  DESK_IDS,
  escalate,
  markSolved,
  myTickets,
  notifyWhenPickedUp,
  onAgentMessage,
  onCategory,
  onDescription,
  onDraftMedia,
  onOrderForTicket,
  onRating,
  reopenTicket,
  submitTicket,
  talkToAgent,
  viewTicket,
} from './desk.js';
import { manifest } from './manifest.js';
import {
  askLocation,
  FAQ_HELPED,
  faqAnswer,
  faqForText,
  faqList,
  mainMenu,
  MENU_IDS,
  nearestCentre,
  showOrder,
  trackPrompt,
} from './self-service.js';
import { initialSupportState, supportStateSchema } from './state.js';
import type { Ctx, SupportState } from './state.js';
import { webRoutes } from './web.js';

/**
 * A customer support desk on WhatsApp: self-service first (FAQs, order tracking, service centres),
 * then tickets with attachments, SLA-aware routing to agents in business hours, escalation, a CSAT
 * Flow and reopening. Tickets live in the example's key-value store; LazyApp's inbox is kept in
 * step (pinned threads, contact tags) so human agents see the same picture.
 */
export default defineExample<SupportState>({
  id: 'support-desk',
  title: 'Halo Home Care',
  startCode: 'DEMO SUPPORT',
  manifest,
  stateSchema: supportStateSchema,
  initialState: initialSupportState,
  describe: () => ({
    summary: 'Support desk: FAQs, order tracking, tickets with photos, agents with SLAs, CSAT.',
    metaFeatures: [
      'List messages',
      'Reply buttons',
      'CTA URL button',
      'Media in (photos, video, documents)',
      'Location request',
      'Location',
      'Contact card',
      'Reactions',
      'Typing indicator',
      'WhatsApp Flows (CSAT)',
      'Utility template + send_at',
      'Contact tags',
      'Inbox (pin, assignee)',
    ],
    emoji: '🎧',
  }),

  async onStart(ctx) {
    const name = ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`;
    await mainMenu(
      ctx,
      `Hi${name} 👋 This is Halo Home Care. Most questions are answered right here in seconds, and for anything else ` +
        "I'll get you to a person with your details already filled in.",
    );
  },

  async onMenu(ctx) {
    await mainMenu(ctx);
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id, inbound.conversationId);
      case 'text':
        return onText(ctx, inbound.text);
      case 'media':
        return onMedia(ctx, inbound);
      case 'location':
        return nearestCentre(ctx, inbound.latitude, inbound.longitude);
      case 'flow':
        return onFlow(ctx, inbound.response);
      default:
        return mainMenu(ctx, "I can't read that kind of message yet. Pick an option instead:");
    }
  },

  async onEvent(ctx, event) {
    // A send failed (e.g. the update template is not approved yet). Log it; never retry blindly.
    ctx.log.warn('a support desk message failed', { type: event.type });
  },

  web: webRoutes(),
});

async function onChoice(ctx: Ctx, id: string, conversationId: string | null): Promise<void> {
  const [prefix = '', ...rest] = id.split(':');
  const arg = rest.join(':');
  switch (id) {
    case MENU_IDS.track:
      return trackPrompt(ctx);
    case MENU_IDS.faq:
      return faqList(ctx);
    case MENU_IDS.ticket:
      return chooseCategory(ctx, false);
    case MENU_IDS.agent:
      return talkToAgent(ctx);
    case MENU_IDS.tickets:
      return myTickets(ctx);
    case MENU_IDS.centre:
      return askLocation(ctx);
    case FAQ_HELPED:
      await ctx.send.react('👍');
      return mainMenu(ctx, 'Great! Anything else?');
    case DESK_IDS.submit:
      return submitTicket(ctx, conversationId);
    case DESK_IDS.cancel:
      return mainMenu(ctx, 'Cancelled, nothing was sent. Anything else?');
    case DESK_IDS.noOrder:
      return onOrderForTicket(ctx, null);
    default:
      break;
  }
  switch (prefix) {
    case 'faq':
      if (await faqAnswer(ctx, id)) {
        return;
      }
      break;
    case 'order':
      return showOrder(ctx, arg);
    case 'report':
      return chooseCategory(ctx, false, arg);
    case 'cat':
      return onCategory(ctx, arg);
    case 'tord':
      return onOrderForTicket(ctx, arg);
    case DESK_IDS.chat:
      return chatWithAgent(ctx, arg);
    case DESK_IDS.view:
      return viewTicket(ctx, arg);
    case DESK_IDS.notify:
      return notifyWhenPickedUp(ctx, arg);
    case DESK_IDS.reopen:
      return reopenTicket(ctx, arg);
    case DESK_IDS.solved:
      return markSolved(ctx, arg);
    case DESK_IDS.unsolved:
      return escalate(ctx, arg);
    case DESK_IDS.csat: {
      const [score = '', ticketId = ''] = arg.split(':');
      return onRating(ctx, { ticketId, score: Number(score), liked: [], comment: null });
    }
    default:
      break;
  }
  return mainMenu(ctx, 'That button is from an older message. Here is the menu:');
}

async function onText(ctx: Ctx, text: string): Promise<void> {
  const orderId = normaliseOrderId(text);
  switch (ctx.state.step) {
    case 'ticket_order':
      if (orderId === null) {
        await ctx.send.text('Type the order number (like *HH-1057*), or pick one from the list.');
        return;
      }
      return onOrderForTicket(ctx, orderId);
    case 'ticket_describe':
      return onDescription(ctx, text);
    case 'ticket_attach':
      return onDescription(ctx, `${ctx.state.draft?.description ?? ''}\n${text}`.trim());
    case 'with_agent':
      return onAgentMessage(ctx, { kind: 'text', text });
    default:
      break;
  }
  if (orderId !== null) {
    return showOrder(ctx, orderId);
  }
  if (ctx.state.step === 'track') {
    await ctx.send.text("That doesn't look like an order number. They look like *HH-1057*.");
    return;
  }
  if (/\b(agent|human|person|someone|call me)\b/i.test(text)) {
    return talkToAgent(ctx);
  }
  const faqId = faqForText(text);
  if (faqId !== null && (await faqAnswer(ctx, faqId))) {
    return;
  }
  return mainMenu(ctx, "I'm not sure I understood. These are the things I can do:");
}

async function onMedia(ctx: Ctx, inbound: Extract<Inbound, { kind: 'media' }>): Promise<void> {
  switch (ctx.state.step) {
    case 'ticket_describe':
    case 'ticket_attach':
      return onDraftMedia(ctx, inbound);
    case 'with_agent':
      return onAgentMessage(ctx, inbound);
    default:
      return mainMenu(
        ctx,
        'Thanks! To send photos to our team, start with *Report a problem* so they land on a ticket.',
      );
  }
}

async function onFlow(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
  const liked = Array.isArray(response.liked)
    ? response.liked.filter((value): value is string => typeof value === 'string')
    : [];
  const comment =
    typeof response.comment === 'string' && response.comment.trim() !== '' ? response.comment.trim() : null;
  return onRating(ctx, {
    ticketId: typeof response.ticket_id === 'string' ? response.ticket_id : (ctx.state.ticketId ?? ''),
    score: Number(response.rating),
    liked,
    comment,
  });
}
