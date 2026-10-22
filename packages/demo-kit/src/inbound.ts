import type { WebhookMessage } from '@lazyapp-examples/sdk';

/** Fields every inbound message carries, whatever its kind. */
export interface InboundBase {
  /** LazyApp message uuid: pass to `markRead`. */
  readonly uuid: string;
  /** Meta's `wamid`: what reactions and replies (`context.message_id`) point at. */
  readonly wamid: string | null;
  /** E.164 phone (`+91…`), or the business-scoped user id for username-only users. */
  readonly from: string;
  readonly conversationId: string | null;
  /** `wamid` of the message this one replies to, when the user quoted or tapped one of ours. */
  readonly replyToWamid: string | null;
  /** Click-to-WhatsApp ad that started the chat, when present. */
  readonly referral: Readonly<Record<string, unknown>> | null;
  readonly receivedAt: Date;
  readonly raw: WebhookMessage;
}

export interface OrderItem {
  readonly retailerId: string;
  readonly quantity: number;
  /** Unit price as Meta sent it (major units, e.g. 499 for ₹499), when present. */
  readonly itemPrice: number | null;
  readonly currency: string | null;
}

/**
 * A normalised inbound message. Examples switch on `kind` instead of digging
 * through `content`; `raw` keeps everything for the rare case it is needed.
 */
export type Inbound = InboundBase &
  (
    | { readonly kind: 'text'; readonly text: string }
    /** A reply button, a carousel quick reply, or a template quick-reply button. */
    | { readonly kind: 'button'; readonly id: string; readonly title: string }
    | {
        readonly kind: 'list';
        readonly id: string;
        readonly title: string;
        readonly description: string | null;
      }
    /** A completed WhatsApp Flow (`nfm_reply`). `response` is the parsed `response_json`. */
    | {
        readonly kind: 'flow';
        readonly flowToken: string | null;
        readonly response: Readonly<Record<string, unknown>>;
      }
    /** An India address form submission. */
    | {
        readonly kind: 'address';
        readonly values: Readonly<Record<string, string>>;
        readonly savedAddressId: string | null;
      }
    | {
        readonly kind: 'location';
        readonly latitude: number;
        readonly longitude: number;
        readonly name: string | null;
        readonly address: string | null;
      }
    | {
        readonly kind: 'media';
        readonly mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker';
        readonly mediaId: string | null;
        readonly mimeType: string | null;
        readonly caption: string | null;
        readonly filename: string | null;
        readonly voice: boolean;
      }
    /** A cart sent from the catalog. */
    | {
        readonly kind: 'order';
        readonly catalogId: string | null;
        readonly note: string | null;
        readonly items: readonly OrderItem[];
      }
    | { readonly kind: 'contacts'; readonly contacts: readonly Readonly<Record<string, unknown>>[] }
    | { readonly kind: 'reaction'; readonly emoji: string | null; readonly targetWamid: string | null }
    | { readonly kind: 'contact_info'; readonly phoneNumber: string | null }
    | { readonly kind: 'unsupported'; readonly type: string }
  );

export type InboundKind = Inbound['kind'];

/** Converts `data.message` of a `message.received` event. Returns null for messages that are not 1:1 inbound. */
export function toInbound(message: WebhookMessage): Inbound | null {
  if (message.direction !== 'inbound' || message.group !== null) {
    return null;
  }
  const from = normalizeAddress(
    message.from ?? message.contact?.phone_number ?? message.contact?.bsuid ?? null,
  );
  if (from === null) {
    return null;
  }
  const content = message.content ?? {};
  const base: InboundBase = {
    uuid: message.uuid,
    wamid: message.provider_message_id,
    from,
    conversationId: message.conversation_id,
    replyToWamid: str(at(content, 'context', 'id')),
    referral: record(content.referral),
    receivedAt: parseDate(message.provider_timestamp ?? message.created_at),
    raw: message,
  };

  switch (message.type) {
    case 'text':
      return { ...base, kind: 'text', text: str(at(content, 'text', 'body')) ?? message.body ?? '' };
    case 'button':
      return {
        ...base,
        kind: 'button',
        id: str(at(content, 'button', 'payload')) ?? str(at(content, 'button', 'text')) ?? '',
        title: str(at(content, 'button', 'text')) ?? '',
      };
    case 'interactive':
      return interactive(base, record(content.interactive) ?? {});
    case 'location':
      return {
        ...base,
        kind: 'location',
        latitude: num(at(content, 'location', 'latitude')) ?? 0,
        longitude: num(at(content, 'location', 'longitude')) ?? 0,
        name: str(at(content, 'location', 'name')),
        address: str(at(content, 'location', 'address')),
      };
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const media = record(content[message.type]) ?? {};
      return {
        ...base,
        kind: 'media',
        mediaType: message.type,
        mediaId: str(media.id),
        mimeType: str(media.mime_type),
        caption: str(media.caption),
        filename: str(media.filename),
        voice: media.voice === true,
      };
    }
    case 'order': {
      const order = record(content.order) ?? {};
      const items = Array.isArray(order.product_items) ? order.product_items : [];
      return {
        ...base,
        kind: 'order',
        catalogId: str(order.catalog_id),
        note: str(order.text),
        items: items.flatMap((item): OrderItem[] => {
          const entry = record(item);
          const retailerId = str(entry?.product_retailer_id);
          if (entry === null || retailerId === null) {
            return [];
          }
          return [
            {
              retailerId,
              quantity: Math.max(1, Math.trunc(num(entry.quantity) ?? 1)),
              itemPrice: num(entry.item_price),
              currency: str(entry.currency),
            },
          ];
        }),
      };
    }
    case 'contacts':
      return {
        ...base,
        kind: 'contacts',
        contacts: (Array.isArray(content.contacts) ? content.contacts : []).flatMap((entry) => {
          const contact = record(entry);
          return contact === null ? [] : [contact];
        }),
      };
    case 'reaction':
      return {
        ...base,
        kind: 'reaction',
        emoji: str(at(content, 'reaction', 'emoji')),
        targetWamid: str(at(content, 'reaction', 'message_id')),
      };
    default:
      return { ...base, kind: 'unsupported', type: message.type };
  }
}

function interactive(base: InboundBase, value: Record<string, unknown>): Inbound {
  switch (value.type) {
    case 'button_reply':
      return {
        ...base,
        kind: 'button',
        id: str(at(value, 'button_reply', 'id')) ?? '',
        title: str(at(value, 'button_reply', 'title')) ?? '',
      };
    case 'list_reply':
      return {
        ...base,
        kind: 'list',
        id: str(at(value, 'list_reply', 'id')) ?? '',
        title: str(at(value, 'list_reply', 'title')) ?? '',
        description: str(at(value, 'list_reply', 'description')),
      };
    case 'nfm_reply': {
      const reply = record(value.nfm_reply) ?? {};
      const response = record(reply.response) ?? parseJsonRecord(reply.response_json) ?? {};
      if (reply.name === 'address_message') {
        const values = record(response.values) ?? {};
        return {
          ...base,
          kind: 'address',
          values: Object.fromEntries(
            Object.entries(values).flatMap(([key, entry]) =>
              typeof entry === 'string' ? [[key, entry]] : [],
            ),
          ),
          savedAddressId: str(response.saved_address_id),
        };
      }
      return { ...base, kind: 'flow', flowToken: str(response.flow_token), response };
    }
    case 'contact_information_reply':
      return {
        ...base,
        kind: 'contact_info',
        phoneNumber: str(at(value, 'contact_information_reply', 'phone_number')),
      };
    default:
      return { ...base, kind: 'unsupported', type: `interactive.${String(value.type)}` };
  }
}

/** `+919812345670` stays; `919812345670` gains a `+`; business-scoped ids pass through. */
export function normalizeAddress(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (/^\+?[\d\s()-]{6,}$/.test(trimmed)) {
    return `+${trimmed.replace(/\D/g, '')}`;
  }
  return trimmed;
}

/** True when the address is a phone number rather than a business-scoped user id. */
export function isPhoneAddress(address: string): boolean {
  return /^\+\d{6,}$/.test(address);
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    const next = record(current);
    if (next === null) {
      return undefined;
    }
    current = next[key];
  }
  return current;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseDate(value: string | null): Date {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}
