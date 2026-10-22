import { WHATSAPP_LIMITS as L } from '@lazyapp-examples/sdk';
import type {
  AddressField,
  AddressInteractive,
  ButtonInteractive,
  CarouselCard,
  CarouselInteractive,
  CtaUrlInteractive,
  InteractiveHeader,
  ListInteractive,
  LocationRequestInteractive,
  ProductListInteractive,
} from '@lazyapp-examples/sdk';

/**
 * Builders for interactive messages that respect Meta's limits.
 *
 * Policy: copy that comes from data (product names, descriptions) is trimmed to
 * fit with an ellipsis, because a long name is not a bug. Structural mistakes
 * (four buttons, duplicate ids, an id over the limit) throw `MessageLimitError`,
 * so a test catches them long before WhatsApp answers `(#131009)`.
 */
export class MessageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageLimitError';
  }
}

/** Shortens `text` to `max` characters (code points), ending with `…` when cut. */
export function fit(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max
    ? chars.join('')
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

export interface Choice {
  readonly id: string;
  readonly title: string;
}

export type HeaderInput =
  | string
  | { readonly image: string }
  | { readonly video: string }
  | { readonly document: string; readonly filename?: string };

export interface ButtonsInput {
  readonly body: string;
  readonly buttons: readonly Choice[];
  readonly header?: HeaderInput | undefined;
  readonly footer?: string | undefined;
}

export function buttons(input: ButtonsInput): ButtonInteractive {
  if (input.buttons.length < 1 || input.buttons.length > L.maxButtons) {
    throw new MessageLimitError(
      `Reply buttons take 1 to ${L.maxButtons} buttons, got ${input.buttons.length}`,
    );
  }
  assertIds(
    input.buttons.map((button) => button.id),
    L.buttonId,
    'button',
  );
  const titles = input.buttons.map((button) => fit(button.title, L.buttonTitle));
  if (new Set(titles).size !== titles.length) {
    throw new MessageLimitError(`Reply button titles must be unique: ${titles.join(', ')}`);
  }
  return {
    type: 'button',
    ...(input.header === undefined ? {} : { header: header(input.header) }),
    body: { text: fit(input.body, L.buttonBody) },
    ...(input.footer === undefined ? {} : { footer: { text: fit(input.footer, L.footerText) } }),
    action: {
      buttons: input.buttons.map((button, index) => ({
        type: 'reply' as const,
        reply: { id: button.id, title: titles[index] ?? button.title },
      })),
    },
  };
}

export interface ListRowInput extends Choice {
  readonly description?: string | undefined;
}

export interface ListInput {
  readonly body: string;
  /** Label of the button that opens the list (20 chars). */
  readonly button: string;
  readonly sections: readonly { readonly title?: string; readonly rows: readonly ListRowInput[] }[];
  readonly header?: string | undefined;
  readonly footer?: string | undefined;
}

export function list(input: ListInput): ListInteractive {
  const rows = input.sections.flatMap((section) => section.rows);
  if (input.sections.length < 1 || input.sections.length > L.maxListSections) {
    throw new MessageLimitError(
      `Lists take 1 to ${L.maxListSections} sections, got ${input.sections.length}`,
    );
  }
  if (rows.length < 1 || rows.length > L.maxListRows) {
    throw new MessageLimitError(`Lists take 1 to ${L.maxListRows} rows in total, got ${rows.length}`);
  }
  if (input.sections.length > 1 && input.sections.some((section) => section.title === undefined)) {
    throw new MessageLimitError('Every section needs a title when a list has more than one section');
  }
  assertIds(
    rows.map((row) => row.id),
    L.listRowId,
    'list row',
  );
  return {
    type: 'list',
    ...(input.header === undefined
      ? {}
      : { header: { type: 'text' as const, text: fit(input.header, L.headerText) } }),
    body: { text: fit(input.body, L.listBody) },
    ...(input.footer === undefined ? {} : { footer: { text: fit(input.footer, L.footerText) } }),
    action: {
      button: fit(input.button, L.listButton),
      sections: input.sections.map((section) => ({
        ...(section.title === undefined ? {} : { title: fit(section.title, L.listSectionTitle) }),
        rows: section.rows.map((row) => ({
          id: row.id,
          title: fit(row.title, L.listRowTitle),
          ...(row.description === undefined || row.description === ''
            ? {}
            : { description: fit(row.description, L.listRowDescription) }),
        })),
      })),
    },
  };
}

export interface CtaInput {
  readonly body: string;
  readonly displayText: string;
  readonly url: string;
  readonly header?: HeaderInput | undefined;
  readonly footer?: string | undefined;
}

export function cta(input: CtaInput): CtaUrlInteractive {
  if (!/^https?:\/\//.test(input.url)) {
    throw new MessageLimitError(`Link buttons need an http(s) URL, got ${input.url}`);
  }
  return {
    type: 'cta_url',
    ...(input.header === undefined ? {} : { header: header(input.header) }),
    body: { text: fit(input.body, L.buttonBody) },
    ...(input.footer === undefined ? {} : { footer: { text: fit(input.footer, L.footerText) } }),
    action: {
      name: 'cta_url',
      parameters: { display_text: fit(input.displayText, L.ctaDisplayText), url: input.url },
    },
  };
}

export function locationRequest(body: string): LocationRequestInteractive {
  return {
    type: 'location_request_message',
    body: { text: fit(body, L.buttonBody) },
    action: { name: 'send_location' },
  };
}

export interface MediaCardInput {
  readonly image?: string;
  readonly video?: string;
  readonly body?: string;
  /** A link button on the card… */
  readonly link?: { readonly displayText: string; readonly url: string };
  /** …or up to three quick replies. Every card must use the same kind and count. */
  readonly quickReplies?: readonly Choice[];
}

export function mediaCarousel(body: string, cards: readonly MediaCardInput[]): CarouselInteractive {
  if (cards.length < 2 || cards.length > L.maxCarouselCards) {
    throw new MessageLimitError(`Media carousels take 2 to ${L.maxCarouselCards} cards, got ${cards.length}`);
  }
  const shapes = new Set(
    cards.map((card) => (card.link === undefined ? `qr${card.quickReplies?.length ?? 0}` : 'link')),
  );
  if (shapes.size !== 1 || shapes.has('qr0')) {
    throw new MessageLimitError(
      'Every carousel card needs the same buttons: one link, or the same number of quick replies',
    );
  }
  assertIds(
    cards.flatMap((card) => (card.quickReplies ?? []).map((reply) => reply.id)),
    L.buttonId,
    'carousel reply',
  );
  return {
    type: 'carousel',
    body: { text: fit(body, L.buttonBody) },
    action: {
      cards: cards.map((card, index): CarouselCard => {
        const mediaHeader =
          card.video === undefined
            ? { type: 'image' as const, image: { link: required(card.image, 'carousel card image') } }
            : { type: 'video' as const, video: { link: card.video } };
        return {
          card_index: index,
          type: 'cta_url',
          header: mediaHeader,
          ...(card.body === undefined ? {} : { body: { text: fit(card.body, L.carouselCardBody) } }),
          action:
            card.link === undefined
              ? {
                  buttons: (card.quickReplies ?? []).map((reply) => ({
                    type: 'quick_reply' as const,
                    quick_reply: { id: reply.id, title: fit(reply.title, L.buttonTitle) },
                  })),
                }
              : {
                  name: 'cta_url' as const,
                  parameters: {
                    display_text: fit(card.link.displayText, L.ctaDisplayText),
                    url: card.link.url,
                  },
                },
        };
      }),
    },
  };
}

export function productCarousel(
  body: string,
  catalogId: string,
  retailerIds: readonly string[],
): CarouselInteractive {
  if (retailerIds.length < 1 || retailerIds.length > L.maxCarouselCards) {
    throw new MessageLimitError(
      `Product carousels take 1 to ${L.maxCarouselCards} products, got ${retailerIds.length}`,
    );
  }
  return {
    type: 'carousel',
    body: { text: fit(body, L.buttonBody) },
    action: {
      cards: retailerIds.map((retailerId, index) => ({
        card_index: index,
        type: 'product' as const,
        action: { product_retailer_id: retailerId, catalog_id: catalogId },
      })),
    },
  };
}

export function productList(input: {
  readonly header: string;
  readonly body: string;
  readonly catalogId: string;
  readonly sections: readonly { readonly title: string; readonly retailerIds: readonly string[] }[];
  readonly footer?: string;
}): ProductListInteractive {
  const total = input.sections.reduce((sum, section) => sum + section.retailerIds.length, 0);
  if (total < 1 || total > L.maxProductListItems) {
    throw new MessageLimitError(
      `Multi-product messages take 1 to ${L.maxProductListItems} products, got ${total}`,
    );
  }
  return {
    type: 'product_list',
    header: { type: 'text', text: fit(input.header, L.headerText) },
    body: { text: fit(input.body, L.buttonBody) },
    ...(input.footer === undefined ? {} : { footer: { text: fit(input.footer, L.footerText) } }),
    action: {
      catalog_id: input.catalogId,
      sections: input.sections.map((section) => ({
        title: fit(section.title, L.listSectionTitle),
        product_items: section.retailerIds.map((retailerId) => ({ product_retailer_id: retailerId })),
      })),
    },
  };
}

export function addressRequest(input: {
  readonly body: string;
  readonly values?: Partial<Record<AddressField, string>>;
  readonly savedAddresses?: readonly {
    readonly id: string;
    readonly value: Partial<Record<AddressField, string>>;
  }[];
  readonly validationErrors?: Partial<Record<AddressField, string>>;
}): AddressInteractive {
  return {
    type: 'address_message',
    body: { text: fit(input.body, L.buttonBody) },
    action: {
      name: 'address_message',
      parameters: {
        country: 'IN',
        ...(input.values === undefined ? {} : { values: input.values }),
        ...(input.savedAddresses === undefined ? {} : { saved_addresses: input.savedAddresses }),
        ...(input.validationErrors === undefined ? {} : { validation_errors: input.validationErrors }),
      },
    },
  };
}

export function header(input: HeaderInput): InteractiveHeader {
  if (typeof input === 'string') {
    return { type: 'text', text: fit(input, L.headerText) };
  }
  if ('image' in input) {
    return { type: 'image', image: { link: input.image } };
  }
  if ('video' in input) {
    return { type: 'video', video: { link: input.video } };
  }
  return {
    type: 'document',
    document: { link: input.document, ...(input.filename === undefined ? {} : { filename: input.filename }) },
  };
}

/** Formats paise as Indian rupees: `formatInr(104800)` → `₹1,048`. */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  }).format(rupees);
}

function assertIds(ids: readonly string[], max: number, what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === '' || Array.from(id).length > max) {
      throw new MessageLimitError(`A ${what} id must be 1 to ${max} characters, got "${id}"`);
    }
    if (seen.has(id)) {
      throw new MessageLimitError(`Duplicate ${what} id "${id}"`);
    }
    seen.add(id);
  }
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new MessageLimitError(`Missing ${what}`);
  }
  return value;
}
