import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { Inbound } from '@lazyapp-examples/demo-kit';
import type { Category } from './data.js';
import { CATEGORIES, ESCALATION_REPLY, findCategory, findOrder, ORDERS, SLA_MINUTES } from './data.js';
import { formatDuration, formatTime, formatWhen, HOURS_LABEL, isOpen, nextOpening } from './hours.js';
import { Inbox } from './inbox.js';
import { FLOWS, TEMPLATES } from './manifest.js';
import { MENU_IDS, mainMenu } from './self-service.js';
import type { Ctx, Draft } from './state.js';
import type { Attachment, Ticket } from './tickets.js';
import { TICKET_STATUS_LABEL, TicketDesk } from './tickets.js';

const MAX_ATTACHMENTS = 5;

export const DESK_IDS = {
  submit: 'tsubmit',
  cancel: 'tcancel',
  noOrder: 'tord:none',
  /** Followed by `:<ticketId>`. */
  chat: 'tchat',
  view: 'tview',
  notify: 'tnotify',
  reopen: 'treopen',
  solved: 'tsolved',
  unsolved: 'tunsolved',
  /** `csat:<score>:<ticketId>`, the rating fallback when the CSAT flow is unavailable. */
  csat: 'csat',
} as const;

const desk = (ctx: Ctx) => new TicketDesk(ctx.kv, ctx.now);
const inbox = (ctx: Ctx) => new Inbox(ctx.api, ctx.log);

/** The ticket from `<prefix>:<ticketId>` if it belongs to this person. */
function ownTicket(ctx: Ctx, ticketId: string): Ticket | undefined {
  const ticket = desk(ctx).get(ticketId);
  return ticket?.address === ctx.user.address ? ticket : undefined;
}

// --- Writing a ticket -----------------------------------------------------------------

export async function chooseCategory(
  ctx: Ctx,
  forAgent: boolean,
  orderId: string | null = null,
): Promise<void> {
  ctx.setState((state) => ({
    ...state,
    step: 'ticket_category',
    draft: { categoryId: '', orderId, description: null, attachments: [], forAgent },
  }));
  await ctx.send.list({
    header: forAgent ? 'Talk to an agent' : 'Report a problem',
    body: forAgent
      ? 'Agents fix things fastest when they know what it is about, so you never repeat yourself. What do you need help with?'
      : 'What went wrong? Pick the closest match; it decides who handles it and how fast.',
    button: 'Choose a topic',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Topics',
        rows: CATEGORIES.map((category) => ({
          id: `cat:${category.id}`,
          title: category.title,
          description: `${category.description} · reply within ${formatDuration(SLA_MINUTES[category.priority] * 60_000)}`,
        })),
      },
    ],
  });
}

export async function onCategory(ctx: Ctx, categoryId: string): Promise<void> {
  const category = findCategory(categoryId);
  const draft = ctx.state.draft;
  if (category === undefined || draft === null) {
    return chooseCategory(ctx, draft?.forAgent ?? false);
  }
  const next: Draft = { ...draft, categoryId: category.id };
  if (category.needsOrder && draft.orderId === null) {
    ctx.setState((state) => ({ ...state, step: 'ticket_order', draft: next }));
    await ctx.send.list({
      body: `*${category.title}*: which order is it about? Pick one, or type the order number.`,
      button: 'Choose an order',
      footer: DEMO_FOOTER,
      sections: [
        {
          title: 'Recent orders',
          rows: [
            ...ORDERS.map((order) => ({
              id: `tord:${order.id}`,
              title: order.id,
              description: order.product,
            })),
            { id: DESK_IDS.noOrder, title: 'Not about an order' },
          ],
        },
      ],
    });
    return;
  }
  return askDescription(ctx, next, category);
}

export async function onOrderForTicket(ctx: Ctx, orderId: string | null): Promise<void> {
  const draft = ctx.state.draft;
  const category = draft === null ? undefined : findCategory(draft.categoryId);
  if (draft === null || category === undefined) {
    return chooseCategory(ctx, false);
  }
  if (orderId !== null && findOrder(orderId) === undefined) {
    await ctx.send.text(
      `I couldn't find *${orderId}*. Pick an order from the list, or type a number like *HH-1057*.`,
    );
    return;
  }
  return askDescription(ctx, { ...draft, orderId }, category);
}

async function askDescription(ctx: Ctx, draft: Draft, category: Category): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'ticket_describe', draft }));
  const order = draft.orderId === null ? '' : ` with *${draft.orderId}*`;
  await ctx.send.text(
    `Got it: *${category.title}*${order}.\n\nIn a sentence or two, what happened?` +
      (category.needsPhoto ? ' You can send photos right away too.' : ''),
  );
}

export async function onDescription(ctx: Ctx, text: string): Promise<void> {
  const draft = ctx.state.draft;
  if (draft === null) {
    return mainMenu(ctx);
  }
  if (text.trim().length < 10) {
    await ctx.send.text('A little more detail helps the agent fix it the first time. What happened?');
    return;
  }
  const next: Draft = { ...draft, description: text.trim().slice(0, 1000) };
  ctx.setState((state) => ({ ...state, step: 'ticket_attach', draft: next }));
  await attachPrompt(ctx, next, 'Thanks.');
}

async function attachPrompt(ctx: Ctx, draft: Draft, lead: string): Promise<void> {
  const category = findCategory(draft.categoryId);
  const count = draft.attachments.length;
  const have = count === 0 ? '' : ` (${count} attached so far)`;
  const ask =
    category?.needsPhoto === true
      ? 'Please send a photo of the item and the box: we need one to approve a replacement.'
      : 'Add photos, a screen recording or your invoice if they help (optional).';
  await ctx.send.buttons({
    body: `${lead} ${ask}${have}\n\nTap *Submit ticket* when you are done.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: DESK_IDS.submit, title: 'Submit ticket' },
      { id: DESK_IDS.cancel, title: 'Cancel' },
    ],
  });
}

export async function onDraftMedia(ctx: Ctx, inbound: Extract<Inbound, { kind: 'media' }>): Promise<void> {
  const draft = ctx.state.draft;
  if (draft === null) {
    return mainMenu(ctx);
  }
  if (draft.attachments.length >= MAX_ATTACHMENTS) {
    await ctx.send.text(
      `That's the maximum of ${MAX_ATTACHMENTS} attachments. Tap *Submit ticket* to send them.`,
    );
    return;
  }
  const attachment: Attachment = {
    mediaId: inbound.mediaId ?? inbound.uuid,
    kind: inbound.mediaType,
    filename: inbound.filename,
  };
  ctx.setState((state) => ({
    ...state,
    draft: { ...draft, attachments: [...draft.attachments, attachment] },
  }));
  // One reaction per file keeps the chat quiet while someone sends several photos.
  await ctx.send.react('📎');
  if (ctx.state.step === 'ticket_describe' && draft.description === null && inbound.caption !== null) {
    await onDescription(ctx, inbound.caption);
  }
}

export async function submitTicket(ctx: Ctx, conversationId: string | null): Promise<void> {
  const draft = ctx.state.draft;
  const category = draft === null ? undefined : findCategory(draft.categoryId);
  const description = draft?.description ?? null;
  if (draft === null || description === null || category === undefined) {
    return mainMenu(ctx, 'That ticket was already sent or cancelled.');
  }
  if (category.needsPhoto && draft.attachments.length === 0) {
    await attachPrompt(ctx, draft, 'Almost there.');
    return;
  }
  const ticket = desk(ctx).create({
    address: ctx.user.address,
    categoryId: category.id,
    orderId: draft.orderId,
    description,
    attachments: draft.attachments,
    conversationId,
  });
  ctx.setState((state) => ({ ...state, step: 'menu', draft: null, ticketId: ticket.id }));
  await tag(ctx, ['support:open', `support:${ticket.priority.toLowerCase()}`], []);
  if (ticket.priority === 'P1') {
    await inbox(ctx).pin(ticket.conversationId, true, ctx.idempotencyKey('pin'));
  }

  const attachments =
    ticket.attachments.length === 0
      ? ''
      : `\n📎 ${ticket.attachments.length} attachment${ticket.attachments.length === 1 ? '' : 's'}`;
  const header = `✅ Ticket *${ticket.id}* created\n\n*${category.title}*${ticket.orderId === null ? '' : ` · ${ticket.orderId}`}${attachments}`;
  if (ticket.agent === null) {
    const opening = nextOpening(ctx.now());
    await ctx.send.buttons({
      body:
        `${header}\n\n🌙 Our team is offline right now (${HOURS_LABEL}). You're first in line: ` +
        `an agent picks this up by *${formatWhen(new Date(ticket.slaDueAt), ctx.now())}*.\n\n` +
        `Want a WhatsApp update when the desk opens at ${formatWhen(opening, ctx.now())}?`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${DESK_IDS.notify}:${ticket.id}`, title: 'Notify me' },
        { id: `${DESK_IDS.view}:${ticket.id}`, title: 'Ticket status' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await ctx.send.buttons({
    body:
      `${header}\nPriority *${ticket.priority}* · first reply by *${formatTime(new Date(ticket.slaDueAt))}*\n` +
      `Assigned to *${ticket.agent.name}* (${ticket.agent.team})\n\n` +
      `${ticket.agent.name} already has your details${ticket.attachments.length > 0 ? ' and photos' : ''}, so you won't have to repeat yourself.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${DESK_IDS.chat}:${ticket.id}`, title: `Chat with ${ticket.agent.name}` },
      { id: `${DESK_IDS.view}:${ticket.id}`, title: 'Ticket status' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

// --- With an agent ---------------------------------------------------------------------

export async function talkToAgent(ctx: Ctx): Promise<void> {
  const active = desk(ctx).activeFor(ctx.user.address);
  if (active === undefined) {
    return chooseCategory(ctx, true);
  }
  return chatWithAgent(ctx, active.id);
}

/**
 * The hand-off. In production a person answers from LazyApp's inbox (the thread is pinned for P1s);
 * here the agent's first reply is simulated so the whole journey can be tried alone.
 */
export async function chatWithAgent(ctx: Ctx, ticketId: string): Promise<void> {
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined) {
    return mainMenu(ctx, "I couldn't find that ticket.");
  }
  if (ticket.agent === null) {
    await ctx.send.buttons({
      body: `🌙 *${ticket.id}* is first in the queue for when the desk opens (${HOURS_LABEL}). I can notify you when an agent picks it up.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${DESK_IDS.notify}:${ticket.id}`, title: 'Notify me' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return viewTicket(ctx, ticket.id);
  }
  await inbox(ctx).typing(ticket.conversationId);
  const answered = desk(ctx).respond(ticket);
  const agent = answered.agent ?? ticket.agent;
  const category = findCategory(ticket.categoryId);
  const order =
    ticket.orderId === null
      ? 'your order'
      : `${ticket.orderId} (${findOrder(ticket.orderId)?.product ?? 'your order'})`;
  const reply =
    ticket.escalationLevel > 0 ? ESCALATION_REPLY : (category?.agentReply ?? '').replaceAll('{order}', order);
  ctx.setState((state) => ({ ...state, step: 'with_agent', ticketId: ticket.id }));
  await ctx.send.text(`👤 *${agent.name}* · ${agent.team}\n\n${reply}`);
  await resolutionQuestion(ctx, answered);
}

async function resolutionQuestion(ctx: Ctx, ticket: Ticket): Promise<void> {
  const agent = ticket.agent?.name ?? 'The agent';
  await ctx.send.buttons({
    body:
      `Did that solve it? You can also reply here or send more photos; it all goes on *${ticket.id}*.\n\n` +
      `_Demo note: ${agent} is simulated. In production a person replies from the LazyApp inbox._`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${DESK_IDS.solved}:${ticket.id}`, title: 'Yes, solved' },
      { id: `${DESK_IDS.unsolved}:${ticket.id}`, title: 'No, escalate' },
      { id: `${DESK_IDS.view}:${ticket.id}`, title: 'Ticket status' },
    ],
  });
}

/** Something the customer sent while an agent has the ticket: a note or another attachment. */
export async function onAgentMessage(
  ctx: Ctx,
  inbound: { readonly kind: 'text'; readonly text: string } | Extract<Inbound, { kind: 'media' }>,
): Promise<void> {
  const ticket = ctx.state.ticketId === null ? undefined : ownTicket(ctx, ctx.state.ticketId);
  if (ticket === undefined) {
    return mainMenu(ctx);
  }
  if (inbound.kind === 'media') {
    desk(ctx).addAttachment(ticket, {
      mediaId: inbound.mediaId ?? inbound.uuid,
      kind: inbound.mediaType,
      filename: inbound.filename,
    });
    await ctx.send.react('📎');
    return;
  }
  const updated = desk(ctx).addNote(ticket, inbound.text);
  await ctx.send.text(
    `👤 *${updated.agent?.name ?? 'Agent'}*: Noted, thanks. I've added that to ${updated.id}.`,
  );
  await resolutionQuestion(ctx, updated);
}

export async function markSolved(ctx: Ctx, ticketId: string): Promise<void> {
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined || ticket.status === 'resolved' || ticket.status === 'closed') {
    return mainMenu(ctx, 'That ticket is already resolved. Anything else?');
  }
  const resolved = desk(ctx).resolve(ticket);
  ctx.setState((state) => ({ ...state, step: 'menu', ticketId: resolved.id }));
  await inbox(ctx).pin(resolved.conversationId, false, ctx.idempotencyKey('unpin'));
  await tag(ctx, ['support:resolved'], ['support:open', 'support:escalated']);
  await ctx.send.react('🎉');
  await askForRating(ctx, resolved);
}

export async function escalate(ctx: Ctx, ticketId: string): Promise<void> {
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined) {
    return mainMenu(ctx);
  }
  if (ticket.escalationLevel >= 1 && ticket.respondedAt !== null) {
    await ctx.send.buttons({
      body:
        `*${ticket.id}* is already with our team lead at the highest priority. Our head of customer experience ` +
        'reviews every ticket that is still open after an escalation, and will write to you today.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${DESK_IDS.view}:${ticket.id}`, title: 'Ticket status' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  const escalated = desk(ctx).escalate(ticket, 'customer said the fix did not work');
  ctx.setState((state) => ({ ...state, step: 'menu', ticketId: escalated.id }));
  await inbox(ctx).pin(escalated.conversationId, true, ctx.idempotencyKey('pin'));
  await tag(ctx, ['support:escalated'], []);
  await ctx.send.buttons({
    body:
      `⏫ Escalated *${escalated.id}* to *${escalated.agent?.name ?? 'our team lead'}* (${escalated.agent?.team ?? 'Team lead'}).\n` +
      `Priority is now *${escalated.priority}*, reply due by *${formatTime(new Date(escalated.slaDueAt))}*.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${DESK_IDS.chat}:${escalated.id}`, title: `Chat with ${escalated.agent?.name ?? 'lead'}` },
      { id: `${DESK_IDS.view}:${escalated.id}`, title: 'Ticket status' },
    ],
  });
}

// --- Rating ---------------------------------------------------------------------------------

async function askForRating(ctx: Ctx, ticket: Ticket): Promise<void> {
  const agent = ticket.agent?.name ?? 'our team';
  if (await ctx.flows.isAvailable(FLOWS.csat)) {
    await ctx.flows.send({
      key: FLOWS.csat,
      header: 'Glad that is sorted!',
      body: `How did ${agent} do on ${ticket.id}? Thirty seconds, and it goes straight to the team.`,
      cta: 'Rate your support',
      footer: DEMO_FOOTER,
      screen: 'RATE',
      data: { headline: `How did ${agent} do on ${ticket.id}?`, ticket_id: ticket.id },
    });
    return;
  }
  await ctx.send.buttons({
    body: `Glad that is sorted! How did ${agent} do on ${ticket.id}?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${DESK_IDS.csat}:5:${ticket.id}`, title: '😍 Great' },
      { id: `${DESK_IDS.csat}:3:${ticket.id}`, title: '😐 Okay' },
      { id: `${DESK_IDS.csat}:1:${ticket.id}`, title: '😞 Poor' },
    ],
  });
}

export async function onRating(
  ctx: Ctx,
  input: {
    readonly ticketId: string;
    readonly score: number;
    readonly liked: readonly string[];
    readonly comment: string | null;
  },
): Promise<void> {
  const ticket = ownTicket(ctx, input.ticketId);
  if (ticket === undefined || !Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    return mainMenu(ctx, "I couldn't record that rating. Anything else?");
  }
  if (ticket.csat !== null) {
    return mainMenu(ctx, `You already rated ${ticket.id}. Thank you!`);
  }
  const closed = desk(ctx).close(ticket, { score: input.score, liked: input.liked, comment: input.comment });
  const sentiment = input.score >= 4 ? 'happy' : input.score <= 2 ? 'unhappy' : 'neutral';
  await tag(ctx, [`csat:${sentiment}`], []);
  await ctx.send.react(input.score >= 4 ? '🙏' : '💙');
  const thanks =
    input.score >= 4
      ? `Thank you! I've passed that on to ${closed.agent?.name ?? 'the team'}. ⭐`
      : input.score <= 2
        ? `Sorry we let you down. Rohan, our team lead, will review ${closed.id} personally today.`
        : 'Thanks for the honest rating. We read every comment.';
  await mainMenu(ctx, `${thanks}\n\nAnything else I can help with?`);
}

// --- Status, reopening, notifications ---------------------------------------------------------

export async function myTickets(ctx: Ctx): Promise<void> {
  const tickets = desk(ctx).forAddress(ctx.user.address).slice(0, 10);
  if (tickets.length === 0) {
    await ctx.send.buttons({
      body: "You don't have any tickets yet. If something's wrong, I can raise one in under a minute.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.ticket, title: 'Report a problem' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: 'My tickets',
    body: 'Tap a ticket for its status and timeline.',
    button: 'View tickets',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Newest first',
        rows: tickets.map((ticket) => ({
          id: `${DESK_IDS.view}:${ticket.id}`,
          title: ticket.id,
          description: `${TICKET_STATUS_LABEL[ticket.status]} · ${findCategory(ticket.categoryId)?.title ?? 'Ticket'}`,
        })),
      },
    ],
  });
}

export async function viewTicket(ctx: Ctx, ticketId: string): Promise<void> {
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined) {
    return mainMenu(ctx, "I couldn't find that ticket.");
  }
  const tickets = desk(ctx);
  const thread = await inbox(ctx).conversation(ticket.conversationId);
  const category = findCategory(ticket.categoryId);
  const remaining = tickets.slaRemainingMs(ticket);
  const owner =
    ticket.agent === null
      ? 'waiting for the next shift'
      : `with *${ticket.agent.name}* (${ticket.agent.team})`;
  const sla =
    remaining === null
      ? ''
      : remaining >= 0
        ? `\nNext reply due by *${formatWhen(new Date(ticket.slaDueAt), ctx.now())}* (${formatDuration(remaining)} left)`
        : `\n⚠️ Reply overdue by ${formatDuration(remaining)}`;
  const timeline = ticket.events
    .map((event) => `${formatWhen(new Date(event.at), ctx.now())} · ${event.text}`)
    .join('\n');
  const assignee = thread?.assignee ?? null;
  const inInbox = assignee === null ? '' : `\nIn the LazyApp inbox: assigned to ${assignee.name}`;

  const buttons = [
    ...(ticket.agent !== null && !['resolved', 'closed'].includes(ticket.status)
      ? [{ id: `${DESK_IDS.chat}:${ticket.id}`, title: `Chat with ${ticket.agent.name}` }]
      : []),
    ...(ticket.agent === null ? [{ id: `${DESK_IDS.notify}:${ticket.id}`, title: 'Notify me' }] : []),
    ...(tickets.canReopen(ticket) ? [{ id: `${DESK_IDS.reopen}:${ticket.id}`, title: 'Reopen ticket' }] : []),
    { id: RESERVED_IDS.menu, title: 'Main menu' },
  ];
  await ctx.send.buttons({
    header: `🎫 ${ticket.id}`,
    body:
      `*${category?.title ?? 'Ticket'}*${ticket.orderId === null ? '' : ` · ${ticket.orderId}`}\n` +
      `Status: *${TICKET_STATUS_LABEL[ticket.status]}*, ${owner}\nPriority: *${ticket.priority}*${sla}${inInbox}\n\n` +
      `*Timeline*\n${timeline}`,
    footer: DEMO_FOOTER,
    buttons,
  });
}

export async function reopenTicket(ctx: Ctx, ticketId: string): Promise<void> {
  const tickets = desk(ctx);
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined || !tickets.canReopen(ticket)) {
    return mainMenu(
      ctx,
      'That ticket can no longer be reopened (7 days after it was resolved). Raise a new one instead.',
    );
  }
  const reopened = tickets.reopen(ticket);
  ctx.setState((state) => ({ ...state, step: 'menu', ticketId: reopened.id }));
  await tag(ctx, ['support:open'], ['support:resolved']);
  await ctx.send.buttons({
    body:
      `🔁 *${reopened.id}* is open again and back with *${reopened.agent?.name ?? 'the team'}*, ` +
      `who already has the full history. Reply due by *${formatWhen(new Date(reopened.slaDueAt), ctx.now())}*.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${DESK_IDS.chat}:${reopened.id}`, title: `Chat with ${reopened.agent?.name ?? 'agent'}` },
      { id: `${DESK_IDS.view}:${reopened.id}`, title: 'Ticket status' },
    ],
  });
}

/**
 * "Notify me": the one business-initiated message this desk sends, only because the customer
 * tapped for it, as an approved utility template scheduled for the next shift.
 */
export async function notifyWhenPickedUp(ctx: Ctx, ticketId: string): Promise<void> {
  const ticket = ownTicket(ctx, ticketId);
  if (ticket === undefined) {
    return mainMenu(ctx);
  }
  if (isOpen(ctx.now())) {
    return viewTicket(ctx, ticket.id);
  }
  const opening = nextOpening(ctx.now());
  const sendAt = new Date(opening.getTime() + 2 * 60_000);
  if (sendAt.getTime() - ctx.now().getTime() > 23 * 60 * 60_000) {
    await ctx.send.text(
      `The desk next opens ${formatWhen(opening, ctx.now())}, more than a day away. This demo ends after 24 quiet hours, ` +
        'so it cannot schedule that; a real desk would send the update then.',
    );
    return;
  }
  const agent = ticket.agent ?? desk(ctx).nextAgent(ticket.priority);
  await ctx.followUps.schedule({
    key: `ticket-${ticket.id}`,
    category: 'utility',
    sendAt,
    template: {
      name: TEMPLATES.ticketUpdate,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.user.displayName ?? 'there' },
            { type: 'text', text: ticket.id },
            {
              type: 'text',
              text: `${agent.name} from our ${agent.team.toLowerCase()} team has picked it up and will reply shortly.`,
            },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `${DESK_IDS.view}:${ticket.id}` }],
        },
      ],
    },
  });
  await ctx.send.text(
    `Done. When the desk opens (${formatWhen(opening, ctx.now())}) I'll send you an update here. Type *EXIT* to cancel it.`,
  );
}

async function tag(ctx: Ctx, add: readonly string[], remove: readonly string[]): Promise<void> {
  const contact = ctx.user.contactUuid;
  if (contact === null) {
    return;
  }
  try {
    if (remove.length > 0) {
      await ctx.api.contacts.removeTags(contact, remove);
    }
    if (add.length > 0) {
      await ctx.api.contacts.addTags(contact, add);
    }
  } catch (error) {
    ctx.log.warn('could not update contact tags', { error });
  }
}
