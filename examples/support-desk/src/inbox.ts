import type { Logger } from '@lazyapp-examples/demo-kit';
import type { LazyAppClient } from '@lazyapp-examples/sdk';

/** The fields of LazyApp's `Conversation` this desk reads (`GET /v1/conversations/{id}`). */
export interface InboxConversation {
  readonly id: string;
  readonly status: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly assignee: { readonly id: number; readonly name: string } | null;
}

/**
 * LazyApp's shared inbox, through the public API. The API can pin, archive, read the assignee and
 * show "typing…"; it cannot assign an agent or set a status (those are console-only, see the README's
 * platform gaps), so the desk keeps assignment in its own ticket store and pins escalated threads so
 * they surface at the top of every agent's inbox.
 *
 * Every call is best effort: the inbox is a convenience for humans, never a reason to fail the chat.
 */
export class Inbox {
  constructor(
    private readonly api: LazyAppClient,
    private readonly log: Logger,
  ) {}

  /** `PATCH /v1/conversations/{id}` `{ pinned }`. */
  async pin(conversationId: string | null, pinned: boolean, idempotencyKey: string): Promise<void> {
    if (conversationId === null) {
      return;
    }
    try {
      await this.api.request('PATCH', `/v1/conversations/${encodeURIComponent(conversationId)}`, {
        body: { pinned },
        idempotencyKey,
      });
    } catch (error) {
      this.log.warn('could not update the inbox thread', { conversationId, error });
    }
  }

  /** `POST /v1/conversations/{id}/typing`: "typing…" as the agent starts answering. */
  async typing(conversationId: string | null): Promise<void> {
    if (conversationId === null) {
      return;
    }
    try {
      await this.api.conversations.typing(conversationId);
    } catch (error) {
      this.log.debug('typing indicator failed', { conversationId, error });
    }
  }

  /** `GET /v1/conversations/{id}`: who (if anyone) a human assigned in LazyApp's console. */
  async conversation(conversationId: string | null): Promise<InboxConversation | null> {
    if (conversationId === null) {
      return null;
    }
    try {
      return await this.api.request<InboxConversation>(
        'GET',
        `/v1/conversations/${encodeURIComponent(conversationId)}`,
      );
    } catch (error) {
      this.log.debug('could not read the inbox thread', { conversationId, error });
      return null;
    }
  }
}
