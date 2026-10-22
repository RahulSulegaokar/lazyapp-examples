/**
 * Request shapes for `POST /v1/messages`. The `interactive` object is WhatsApp's
 * own shape (LazyApp validates it against Meta's limits before sending), so these
 * types follow Meta's Cloud API names exactly.
 *
 * @see https://lazyapp.in/docs/sending/messages
 * @see https://lazyapp.in/docs/sending/interactive-messages
 */

export type MediaRef = { readonly link: string } | { readonly id: string };

/** Who receives the message: a phone number, or a business-scoped user id for username-only users. */
export interface Recipient {
  readonly type: 'phone_number' | 'bsuid';
  readonly value: string;
}

/** Options every send accepts. Pass `to` (E.164) or `recipient`. */
export interface SendOptions {
  /** E.164 recipient, e.g. `+919812345670`. */
  readonly to?: string | undefined;
  /** Alternative to `to`, required for WhatsApp username users who have no visible phone number. */
  readonly recipient?: Recipient | undefined;
  /** Send from a specific number when the workspace has several. */
  readonly phone_number_id?: string | undefined;
  readonly connection_uuid?: string | undefined;
  /** Reply to (quote) an earlier message by its `wamid`. */
  readonly context?: { readonly message_id: string } | undefined;
  /** Up to 20 string pairs, echoed back on every webhook about this message. */
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  /** Schedule for later (ISO 8601). LazyApp answers `202` with a scheduled id. */
  readonly send_at?: string | undefined;
  /** Drop the message if it cannot be sent within this many seconds (60–2,592,000). */
  readonly ttl_seconds?: number | undefined;
}

export interface TextMessage extends SendOptions {
  readonly type: 'text';
  readonly body: string;
  readonly preview_url?: boolean | undefined;
}

export interface MediaMessage extends SendOptions {
  readonly type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly media_url?: string | undefined;
  readonly media_id?: string | undefined;
  readonly caption?: string | undefined;
  readonly filename?: string | undefined;
}

export interface LocationMessage extends SendOptions {
  readonly type: 'location';
  readonly latitude: number;
  readonly longitude: number;
  readonly name?: string | undefined;
  readonly address?: string | undefined;
}

/** A WhatsApp contact card (Meta's `contacts[]` element). */
export interface ContactCard {
  readonly name: {
    readonly formatted_name: string;
    readonly first_name?: string;
    readonly last_name?: string;
  };
  readonly phones?: readonly { readonly phone: string; readonly type?: string; readonly wa_id?: string }[];
  readonly emails?: readonly { readonly email: string; readonly type?: string }[];
  readonly urls?: readonly { readonly url: string; readonly type?: string }[];
  readonly org?: { readonly company?: string; readonly title?: string; readonly department?: string };
  readonly addresses?: readonly Readonly<Record<string, string>>[];
}

export interface ContactsMessage extends SendOptions {
  readonly type: 'contacts';
  readonly contacts: readonly ContactCard[];
}

export interface ReactionMessage extends SendOptions {
  readonly type: 'reaction';
  /** The provider `wamid` (`provider_message_id`) of the message to react to. Empty emoji removes it. */
  readonly reaction: { readonly message_id: string; readonly emoji: string };
}

export interface TemplateMessage extends SendOptions {
  readonly type: 'template';
  readonly template: TemplateSend;
}

export interface TemplateSend {
  readonly name: string;
  readonly language: string;
  /** Raw Meta components, when you build them yourself. */
  readonly components?: readonly Readonly<Record<string, unknown>>[] | undefined;
  /** Send-time inputs LazyApp turns into components (carousel cards, coupon, LTO expiry, products…). */
  readonly features?: TemplateFeatures | undefined;
}

export interface TemplateFeatures {
  readonly cards?: readonly TemplateCardInput[] | undefined;
  readonly coupon_code?: string | undefined;
  /** Limited-time offer expiry (ISO 8601). */
  readonly offer_expires_at?: string | undefined;
  readonly product_retailer_id?: string | undefined;
  readonly thumbnail_product_retailer_id?: string | undefined;
  readonly catalog_id?: string | undefined;
  readonly sections?: readonly { readonly title: string; readonly product_retailer_ids: readonly string[] }[];
  readonly location?:
    | {
        readonly latitude: string;
        readonly longitude: string;
        readonly name?: string;
        readonly address?: string;
      }
    | undefined;
}

export interface TemplateCardInput {
  readonly header_media?: string;
  readonly product_retailer_id?: string;
  readonly catalog_id?: string;
  readonly body?: readonly string[] | Readonly<Record<string, string>>;
  /** Keyed by button index: the ending of a dynamic URL button. */
  readonly buttons?: Readonly<Record<string, string>>;
  /** Keyed by button index: payload returned when a quick reply is tapped. */
  readonly quick_replies?: Readonly<Record<string, string>>;
}

export interface InteractiveMessage extends SendOptions {
  readonly type: 'interactive';
  readonly interactive: Interactive;
}

export type OutboundMessage =
  | TextMessage
  | MediaMessage
  | LocationMessage
  | ContactsMessage
  | ReactionMessage
  | TemplateMessage
  | InteractiveMessage;

// ---------------------------------------------------------------------------
// Interactive objects
// ---------------------------------------------------------------------------

export type InteractiveHeader =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly image: MediaRef }
  | { readonly type: 'video'; readonly video: MediaRef }
  | { readonly type: 'document'; readonly document: MediaRef & { readonly filename?: string } };

interface InteractiveBase {
  readonly body?: { readonly text: string };
  readonly footer?: { readonly text: string };
}

export interface ReplyButton {
  readonly type: 'reply';
  /** ≤ 256 chars, unique within the message. */
  readonly reply: { readonly id: string; readonly title: string };
}

/** 1–3 reply buttons, 20-char titles. */
export interface ButtonInteractive extends InteractiveBase {
  readonly type: 'button';
  readonly header?: InteractiveHeader;
  readonly body: { readonly text: string };
  readonly action: { readonly buttons: readonly ReplyButton[] };
}

export interface ListRow {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export interface ListSection {
  readonly title?: string;
  readonly rows: readonly ListRow[];
}

/** Up to 10 rows across up to 10 sections. Header is text-only. */
export interface ListInteractive extends InteractiveBase {
  readonly type: 'list';
  readonly header?: { readonly type: 'text'; readonly text: string };
  readonly body: { readonly text: string };
  readonly action: { readonly button: string; readonly sections: readonly ListSection[] };
}

export interface CtaUrlInteractive extends InteractiveBase {
  readonly type: 'cta_url';
  readonly header?: InteractiveHeader;
  readonly body: { readonly text: string };
  readonly action: {
    readonly name: 'cta_url';
    readonly parameters: { readonly display_text: string; readonly url: string };
  };
}

export interface LocationRequestInteractive {
  readonly type: 'location_request_message';
  readonly body: { readonly text: string };
  readonly action: { readonly name: 'send_location' };
}

export type CarouselCard =
  | {
      readonly card_index: number;
      readonly type: 'cta_url';
      readonly header:
        | { readonly type: 'image'; readonly image: MediaRef }
        | { readonly type: 'video'; readonly video: MediaRef };
      readonly body?: { readonly text: string };
      readonly action:
        | {
            readonly name: 'cta_url';
            readonly parameters: { readonly display_text: string; readonly url: string };
          }
        | {
            readonly buttons: readonly {
              readonly type: 'quick_reply';
              readonly quick_reply: { readonly id: string; readonly title: string };
            }[];
          };
    }
  | {
      readonly card_index: number;
      readonly type: 'product';
      readonly action: { readonly product_retailer_id: string; readonly catalog_id: string };
    };

/** 2–10 media cards, or 1–10 product cards. */
export interface CarouselInteractive {
  readonly type: 'carousel';
  readonly body: { readonly text: string };
  readonly action: { readonly cards: readonly CarouselCard[] };
}

export type AddressField =
  | 'name'
  | 'phone_number'
  | 'in_pin_code'
  | 'house_number'
  | 'floor_number'
  | 'tower_number'
  | 'building_name'
  | 'address'
  | 'landmark_area'
  | 'city'
  | 'state';

/** India only: both numbers must be +91. */
export interface AddressInteractive extends InteractiveBase {
  readonly type: 'address_message';
  readonly body: { readonly text: string };
  readonly action: {
    readonly name: 'address_message';
    readonly parameters: {
      readonly country: 'IN';
      readonly values?: Partial<Record<AddressField, string>>;
      readonly saved_addresses?: readonly {
        readonly id: string;
        readonly value: Partial<Record<AddressField, string>>;
      }[];
      readonly validation_errors?: Partial<Record<AddressField, string>>;
    };
  };
}

export interface FlowInteractive extends InteractiveBase {
  readonly type: 'flow';
  readonly header?: InteractiveHeader;
  readonly body: { readonly text: string };
  readonly action: {
    readonly name: 'flow';
    readonly parameters: {
      readonly flow_message_version: '3';
      /** Meta's flow id: `provider_flow_id` from `GET /v1/flows`. */
      readonly flow_id: string;
      /** Opaque token echoed on every data_exchange call and on the completion reply. */
      readonly flow_token: string;
      readonly flow_cta: string;
      readonly flow_action: 'navigate' | 'data_exchange';
      readonly flow_action_payload?: {
        readonly screen: string;
        readonly data?: Readonly<Record<string, unknown>>;
      };
      readonly mode?: 'draft' | 'published';
    };
  };
}

export interface ProductInteractive extends InteractiveBase {
  readonly type: 'product';
  readonly action: { readonly catalog_id: string; readonly product_retailer_id: string };
}

export interface ProductListInteractive extends InteractiveBase {
  readonly type: 'product_list';
  readonly header: { readonly type: 'text'; readonly text: string };
  readonly body: { readonly text: string };
  readonly action: {
    readonly catalog_id: string;
    readonly sections: readonly {
      readonly title: string;
      readonly product_items: readonly { readonly product_retailer_id: string }[];
    }[];
  };
}

export interface CatalogInteractive extends InteractiveBase {
  readonly type: 'catalog_message';
  readonly body: { readonly text: string };
  readonly action: {
    readonly name: 'catalog_message';
    readonly parameters?: { readonly thumbnail_product_retailer_id?: string };
  };
}

/** Raw Meta `order_details`/`order_status`. Prefer `client.payments.create`, which computes totals. */
export interface OrderInteractive extends InteractiveBase {
  readonly type: 'order_details' | 'order_status';
  readonly body: { readonly text: string };
  readonly action: {
    readonly name: 'review_and_pay' | 'review_order';
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export interface ContactInformationRequestInteractive {
  readonly type: 'contact_information_request';
  readonly body: { readonly text: string };
  readonly action: { readonly name: 'contact_information_request' };
}

export type Interactive =
  | ButtonInteractive
  | ListInteractive
  | CtaUrlInteractive
  | LocationRequestInteractive
  | CarouselInteractive
  | AddressInteractive
  | FlowInteractive
  | ProductInteractive
  | ProductListInteractive
  | CatalogInteractive
  | OrderInteractive
  | ContactInformationRequestInteractive;

/** Meta's limits, mirrored so builders can fail fast in tests instead of with a 422. */
export const WHATSAPP_LIMITS = {
  buttonTitle: 20,
  maxButtons: 3,
  buttonId: 256,
  listButton: 20,
  listRowTitle: 24,
  listRowDescription: 72,
  listRowId: 200,
  listSectionTitle: 24,
  maxListRows: 10,
  maxListSections: 10,
  headerText: 60,
  footerText: 60,
  buttonBody: 1024,
  listBody: 4096,
  textBody: 4096,
  caption: 1024,
  ctaDisplayText: 20,
  carouselCardBody: 160,
  maxCarouselCards: 10,
  maxProductListItems: 30,
  iceBreaker: 80,
  maxIceBreakers: 4,
  qrPrefill: 140,
} as const;
