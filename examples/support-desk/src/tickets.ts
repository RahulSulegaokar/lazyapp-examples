import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import type { Agent, Priority } from './data.js';
import { findCategory, ROSTER, SLA_MINUTES, TEAM_LEAD } from './data.js';
import { addBusinessMinutes, formatTime, isOpen, nextOpening } from './hours.js';

export const attachmentSchema = z.object({
  mediaId: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
  filename: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export type TicketStatus =
  'queued' | 'assigned' | 'in_progress' | 'escalated' | 'resolved' | 'reopened' | 'closed';

export const TICKET_STATUS_LABEL: Readonly<Record<TicketStatus, string>> = {
  queued: '🕘 Queued',
  assigned: '👤 Assigned',
  in_progress: '💬 In progress',
  escalated: '⏫ Escalated',
  resolved: '✅ Resolved',
  reopened: '🔁 Reopened',
  closed: '🔒 Closed',
};

export interface Csat {
  readonly score: number;
  readonly liked: readonly string[];
  readonly comment: string | null;
}

export interface Ticket {
  readonly id: string;
  readonly address: string;
  readonly categoryId: string;
  readonly priority: Priority;
  readonly orderId: string | null;
  readonly description: string;
  readonly attachments: readonly Attachment[];
  readonly status: TicketStatus;
  readonly createdAt: string;
  /** When the current SLA target (first reply, or reply after escalation) is due. */
  readonly slaDueAt: string;
  readonly respondedAt: string | null;
  readonly agent: Agent | null;
  readonly escalationLevel: number;
  /** LazyApp conversation (`cnv_…`) the ticket lives in: what the inbox shows the agent. */
  readonly conversationId: string | null;
  readonly resolvedAt: string | null;
  readonly csat: Csat | null;
  readonly events: readonly { readonly at: string; readonly text: string }[];
}

/** Customers can reopen a resolved ticket for this long. */
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60_000;

const BUMP: Readonly<Record<Priority, Priority>> = { P3: 'P2', P2: 'P1', P1: 'P1' };

/**
 * The ticket store and its rules: priority from the category, an SLA clock that runs in business
 * hours, round-robin assignment by priority, automatic escalation on breach, reopen within 7 days.
 * Time-based transitions are applied lazily (`refresh`) whenever a ticket is read, so there is no
 * scheduler to run and replays are harmless.
 */
export class TicketDesk {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  create(input: {
    readonly address: string;
    readonly categoryId: string;
    readonly orderId: string | null;
    readonly description: string;
    readonly attachments: readonly Attachment[];
    readonly conversationId: string | null;
  }): Ticket {
    const category = findCategory(input.categoryId);
    const priority = category?.priority ?? 'P3';
    const now = this.now();
    const sequence = (this.kv.get<number>('ticket-seq') ?? 48_210) + 1;
    this.kv.set('ticket-seq', sequence);
    const created: Ticket = {
      id: `SUP-${sequence}`,
      address: input.address,
      categoryId: input.categoryId,
      priority,
      orderId: input.orderId,
      description: input.description,
      attachments: input.attachments,
      status: 'queued',
      createdAt: now.toISOString(),
      slaDueAt: addBusinessMinutes(now, SLA_MINUTES[priority]).toISOString(),
      respondedAt: null,
      agent: null,
      escalationLevel: 0,
      conversationId: input.conversationId,
      resolvedAt: null,
      csat: null,
      events: [
        {
          at: now.toISOString(),
          text:
            input.attachments.length === 0
              ? 'Ticket created'
              : `Ticket created with ${input.attachments.length} attachment${input.attachments.length === 1 ? '' : 's'}`,
        },
      ],
    };
    const ticket = isOpen(now) ? this.assign(created) : created;
    this.save(ticket);
    this.kv.set(
      `by:${input.address}`,
      [...(this.kv.get<string[]>(`by:${input.address}`) ?? []), ticket.id].slice(-20),
    );
    return ticket;
  }

  /** The ticket with time-based rules applied (assignment at opening, escalation on breach). */
  get(id: string): Ticket | undefined {
    const stored = this.kv.get<Ticket>(`ticket:${id}`);
    if (stored === undefined) {
      return undefined;
    }
    const refreshed = this.refresh(stored);
    if (refreshed !== stored) {
      this.save(refreshed);
    }
    return refreshed;
  }

  /** The person's tickets, newest first. */
  forAddress(address: string): Ticket[] {
    return (this.kv.get<string[]>(`by:${address}`) ?? [])
      .map((id) => this.get(id))
      .filter((ticket): ticket is Ticket => ticket !== undefined)
      .reverse();
  }

  /** The person's newest ticket that is still being worked on. */
  activeFor(address: string): Ticket | undefined {
    return this.forAddress(address).find((ticket) => !['resolved', 'closed'].includes(ticket.status));
  }

  /** The agent answered for the first time (or after an escalation). */
  respond(ticket: Ticket): Ticket {
    const agent = ticket.agent ?? this.pick(ticket.priority);
    return this.update(
      ticket,
      { status: 'in_progress', agent, respondedAt: this.now().toISOString() },
      `${agent.name} replied`,
    );
  }

  addAttachment(ticket: Ticket, attachment: Attachment): Ticket {
    return this.update(
      ticket,
      { attachments: [...ticket.attachments, attachment] },
      'Customer added an attachment',
    );
  }

  addNote(ticket: Ticket, text: string): Ticket {
    return this.update(ticket, {}, `Customer: “${text.length > 80 ? `${text.slice(0, 79)}…` : text}”`);
  }

  /** Hands the ticket to the team lead with a higher priority and a fresh, shorter SLA. */
  escalate(ticket: Ticket, reason: string): Ticket {
    const priority = BUMP[ticket.priority];
    return this.update(
      ticket,
      {
        status: 'escalated',
        priority,
        agent: TEAM_LEAD,
        escalationLevel: ticket.escalationLevel + 1,
        respondedAt: null,
        slaDueAt: addBusinessMinutes(this.now(), SLA_MINUTES[priority]).toISOString(),
      },
      `Escalated to ${TEAM_LEAD.name} (${TEAM_LEAD.team}): ${reason}`,
    );
  }

  resolve(ticket: Ticket): Ticket {
    return this.update(
      ticket,
      { status: 'resolved', resolvedAt: this.now().toISOString() },
      'Customer confirmed it is resolved',
    );
  }

  canReopen(ticket: Ticket): boolean {
    return (
      (ticket.status === 'resolved' || ticket.status === 'closed') &&
      ticket.resolvedAt !== null &&
      this.now().getTime() - new Date(ticket.resolvedAt).getTime() <= REOPEN_WINDOW_MS
    );
  }

  reopen(ticket: Ticket): Ticket {
    const priority: Priority = ticket.priority === 'P3' ? 'P2' : ticket.priority;
    return this.update(
      ticket,
      {
        status: 'reopened',
        priority,
        resolvedAt: null,
        respondedAt: null,
        slaDueAt: addBusinessMinutes(this.now(), SLA_MINUTES[priority]).toISOString(),
      },
      `Reopened by the customer, back with ${ticket.agent?.name ?? 'the team'}`,
    );
  }

  close(ticket: Ticket, csat: Csat): Ticket {
    return this.update(ticket, { status: 'closed', csat }, `Rated ${csat.score}/5`);
  }

  /** Remaining time on the SLA (negative when breached), or null when nothing is due. */
  slaRemainingMs(ticket: Ticket): number | null {
    if (ticket.respondedAt !== null || ['resolved', 'closed'].includes(ticket.status)) {
      return null;
    }
    return new Date(ticket.slaDueAt).getTime() - this.now().getTime();
  }

  private refresh(ticket: Ticket): Ticket {
    let current = ticket;
    const now = this.now();
    if (
      current.agent === null &&
      current.status === 'queued' &&
      now >= nextOpening(new Date(current.createdAt))
    ) {
      current = this.assign(current, nextOpening(new Date(current.createdAt)));
    }
    const remaining = this.slaRemainingMs(current);
    if (remaining !== null && remaining < 0 && current.escalationLevel === 0) {
      current = this.escalate(
        current,
        `no reply by ${formatTime(new Date(current.slaDueAt))} (SLA breached)`,
      );
    }
    return current;
  }

  private assign(ticket: Ticket, at: Date = this.now()): Ticket {
    const agent = this.pick(ticket.priority);
    return {
      ...ticket,
      status: 'assigned',
      agent,
      events: [...ticket.events, { at: at.toISOString(), text: `Assigned to ${agent.name} (${agent.team})` }],
    };
  }

  /** Who the next ticket of `priority` goes to, without taking the turn. */
  nextAgent(priority: Priority): Agent {
    const team = ROSTER[priority];
    return team[(this.kv.get<number>(`rr:${priority}`) ?? 0) % team.length] ?? TEAM_LEAD;
  }

  /** Round robin within the priority's team. */
  private pick(priority: Priority): Agent {
    const team = ROSTER[priority];
    const turn = this.kv.get<number>(`rr:${priority}`) ?? 0;
    this.kv.set(`rr:${priority}`, turn + 1);
    return team[turn % team.length] ?? TEAM_LEAD;
  }

  private update(ticket: Ticket, changes: Partial<Ticket>, event: string): Ticket {
    const next: Ticket = {
      ...ticket,
      ...changes,
      events: [...ticket.events, { at: this.now().toISOString(), text: event }].slice(-12),
    };
    this.save(next);
    return next;
  }

  private save(ticket: Ticket): void {
    this.kv.set(`ticket:${ticket.id}`, ticket);
  }
}
