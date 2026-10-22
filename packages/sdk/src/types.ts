/**
 * Response and request shapes for the LazyApp REST API, hand-derived from
 * `api-reference/openapi.json` (LazyApp docs) and checked against LazyApp's source.
 * Only the endpoints the examples use are modelled; unknown fields pass through.
 */

/** Cursor pagination envelope used by every list endpoint. */
export interface Page<T> {
  readonly data: readonly T[];
  readonly next_cursor?: string | null;
}

export interface ListParams {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';

/** `201` from `POST /v1/messages`. */
export interface SentMessage {
  readonly uuid: string;
  readonly request_id?: string | null;
  readonly status: MessageStatus;
  readonly acceptance_status?: string | null;
  readonly type: string;
  readonly provider_message_id?: string | null;
  readonly error_message?: string | null;
}

/** `202` from `POST /v1/messages` with `send_at`. */
export interface ScheduledMessageAccepted {
  /** Pass to `messages.cancelScheduled` to cancel before it goes out. */
  readonly id: string;
  readonly status: string;
  readonly send_at?: string | null;
  readonly expires_at?: string | null;
}

export interface ReadReceipt {
  readonly uuid: string;
  readonly read: boolean;
  readonly typing: boolean;
}

// --- Templates --------------------------------------------------------------

export type TemplateCategory = 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
export type TemplateStatus =
  | 'draft'
  | 'submitting'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'archived'
  | 'deleted';

export type TemplateButton =
  | { readonly type: 'QUICK_REPLY'; readonly text: string }
  | {
      readonly type: 'URL';
      readonly text: string;
      readonly url: string;
      readonly examples?: readonly string[];
    }
  | { readonly type: 'PHONE_NUMBER'; readonly text: string; readonly phone_number: string }
  | { readonly type: 'COPY_CODE'; readonly example: string; readonly text?: string }
  | { readonly type: 'FLOW'; readonly text: string; readonly flow_id: string }
  | { readonly type: 'CATALOG' | 'MPM' | 'SPM'; readonly text: string }
  | { readonly type: 'OTP'; readonly text?: string };

export type TemplateHeader =
  | { readonly format: 'NONE' }
  | { readonly format: 'TEXT'; readonly text: string; readonly examples?: readonly string[] }
  | {
      readonly format: 'IMAGE' | 'VIDEO' | 'GIF' | 'DOCUMENT';
      /** Resumable-upload handle; use `POST /v1/templates/media` for a file instead. */
      readonly example_handle?: string;
    }
  | { readonly format: 'LOCATION' | 'PRODUCT' };

export interface TemplateCarouselCard {
  readonly header: TemplateHeader;
  readonly body_text?: string;
  readonly body_examples?: readonly string[];
  readonly buttons?: readonly TemplateButton[];
}

/** Body of `POST /v1/templates`. */
export interface CreateTemplateInput {
  readonly name: string;
  readonly language: string;
  readonly category: TemplateCategory;
  readonly body_text?: string;
  readonly body_examples?: readonly string[];
  readonly footer_text?: string;
  readonly header?: TemplateHeader;
  readonly buttons?: readonly TemplateButton[];
  /** Submit to Meta immediately (otherwise stays a draft). */
  readonly submit?: boolean;
  readonly parameter_format?: 'POSITIONAL' | 'NAMED';
  readonly library_template_name?: string;
  readonly limited_time_offer?: { readonly text: string; readonly has_expiration: boolean };
  readonly carousel_cards?: readonly TemplateCarouselCard[];
  readonly message_send_ttl_seconds?: number;
}

/** Body of `POST /v1/templates/authentication`. */
export interface CreateAuthenticationTemplateInput {
  readonly name: string;
  readonly languages: readonly string[];
  readonly otp_type?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';
  readonly package_name?: string;
  readonly signature_hash?: string;
  readonly add_security_recommendation?: boolean;
  readonly code_expiration_minutes?: number;
  readonly message_send_ttl_seconds?: number;
}

export interface Template {
  readonly uuid: string;
  readonly name: string;
  readonly language: string;
  readonly category: TemplateCategory;
  readonly status: TemplateStatus;
  readonly body_text?: string;
  readonly footer_text?: string | null;
  readonly rejection_reason?: string | null;
}

// --- Flows ------------------------------------------------------------------

export interface Flow {
  readonly uuid: string;
  readonly name: string;
  readonly status: string;
  readonly categories: readonly string[];
  /** Meta's flow id: what `interactive.action.parameters.flow_id` needs. */
  readonly provider_flow_id: string | null;
  readonly version?: string | number | null;
  readonly data_endpoint_uri: string | null;
  readonly published_at: string | null;
  readonly created_at?: string | null;
  readonly can_send_message?: 'AVAILABLE' | 'LIMITED' | 'BLOCKED' | null;
}

export interface FlowDetail extends Flow {
  readonly flow_json: unknown;
}

export type FlowCategory =
  | 'SIGN_UP'
  | 'SIGN_IN'
  | 'APPOINTMENT_BOOKING'
  | 'LEAD_GENERATION'
  | 'CONTACT_US'
  | 'CUSTOMER_SUPPORT'
  | 'SURVEY'
  | 'SHOPPING'
  | 'OTHER';

export interface CreateFlowInput {
  readonly name: string;
  readonly categories: readonly FlowCategory[];
  readonly flow_json: Readonly<Record<string, unknown>> | string;
  /** HTTPS URL LazyApp forwards decrypted data_exchange requests to, signed with the flow's secret. */
  readonly data_endpoint_uri?: string | null;
}

export interface FlowHealth {
  readonly can_send_message: 'AVAILABLE' | 'LIMITED' | 'BLOCKED';
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

// --- Webhooks ---------------------------------------------------------------

export interface WebhookEndpoint {
  readonly id: number;
  readonly url: string;
  readonly description: string | null;
  readonly is_active: boolean;
  /** Empty or null means every event. */
  readonly subscribed_events: readonly string[] | null;
  readonly phone_number_restrictions?: readonly string[] | null;
  readonly timeout_seconds?: number;
  readonly max_attempts?: number;
  readonly paused_at?: string | null;
  readonly pause_reason?: string | null;
}

export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  /** Shown once. Store it as LAZYAPP_WEBHOOK_SECRET. */
  readonly secret: string;
}

export interface CreateWebhookInput {
  readonly url: string;
  readonly description?: string;
  readonly subscribed_events?: readonly string[];
  readonly custom_headers?: Readonly<Record<string, string>>;
  readonly phone_number_restrictions?: readonly string[];
  readonly timeout_seconds?: number;
  readonly max_attempts?: number;
}

// --- Contacts ---------------------------------------------------------------

export interface Contact {
  readonly uuid: string;
  readonly phone_number: string | null;
  readonly bsuid?: string | null;
  readonly external_id?: string | null;
  readonly username?: string | null;
  readonly email?: string | null;
  readonly preferred_language?: string | null;
  readonly timezone?: string | null;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[];
}

export interface UpsertContactInput {
  readonly phone_number?: string;
  readonly bsuid?: string;
  readonly external_id?: string;
  readonly username?: string;
  readonly email?: string;
  readonly preferred_language?: string;
  readonly timezone?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface ConsentInput {
  readonly granted: boolean;
  readonly channel?: 'whatsapp' | 'sms' | 'email';
  readonly purpose?: 'marketing' | 'transactional' | 'all';
  readonly consent_text?: string;
  readonly proof_reference?: string;
  readonly captured_by?: string;
}

// --- Catalog ----------------------------------------------------------------

export interface CatalogProduct {
  readonly id: string | null;
  readonly retailer_id: string | null;
  readonly name: string | null;
  readonly description: string | null;
  /** Meta's formatted price, e.g. `"499 INR"`. */
  readonly price: string | null;
  readonly image_url: string | null;
  readonly availability: string | null;
}

export interface CatalogProductPage extends Page<CatalogProduct> {
  readonly catalog_id: string;
}

export interface CommerceSettings {
  readonly catalog_id: string | null;
  readonly is_catalog_visible: boolean;
  readonly is_cart_enabled: boolean;
  readonly order_handoff_url?: string | null;
  readonly catalog_link?: string | null;
}

// --- Payments (India) -------------------------------------------------------

export type PaymentMethod = 'payment_gateway' | 'upi_intent_link' | 'payment_link';
export type PaymentStatus = 'pending' | 'captured' | 'failed' | 'partially_refunded' | 'refunded';
export type OrderStatus =
  'pending' | 'processing' | 'partially_shipped' | 'shipped' | 'completed' | 'canceled';

export interface PaymentItem {
  readonly name: string;
  /** Paise. */
  readonly amount: number;
  readonly quantity: number;
  readonly sale_amount?: number;
  readonly retailer_id?: string;
  readonly image_url?: string;
  readonly country_of_origin?: string;
}

export interface PaymentAmount {
  /** Paise. */
  readonly amount: number;
  readonly description?: string;
}

/** Body of `POST /v1/payments`. Amounts are paise; LazyApp computes totals the way Meta checks them. */
export interface CreatePaymentInput {
  readonly to: string;
  readonly reference_id?: string;
  readonly body: string;
  readonly footer?: string;
  readonly header_image_url?: string;
  readonly phone_number_id?: string;
  readonly goods_type?: 'physical-goods' | 'digital-goods';
  readonly catalog_id?: string;
  readonly expires_in_minutes?: number;
  readonly items: readonly PaymentItem[];
  readonly importer?: {
    readonly name: string;
    readonly country_of_origin?: string;
    readonly address: Readonly<Record<string, string>>;
  };
  readonly tax?: PaymentAmount;
  readonly shipping?: PaymentAmount;
  readonly discount?: PaymentAmount & { readonly program_name?: string };
  readonly payment: {
    readonly method: PaymentMethod;
    readonly configuration?: string;
    readonly gateway_account?: string;
    readonly upi_intent_link?: string;
    readonly payment_link?: string;
  };
  readonly template?: { readonly name: string; readonly language?: string; readonly style?: 'link_button' };
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentOrder {
  readonly id: string;
  readonly reference_id: string;
  readonly to: string;
  readonly status: OrderStatus;
  readonly payment_status: PaymentStatus;
  readonly payment_method: PaymentMethod;
  readonly payment_configuration?: string | null;
  readonly payment_link?: string | null;
  readonly currency: string;
  readonly total_amount: number;
  readonly amount_paid: number;
  readonly amount_refunded: number;
  readonly paid_with?: string | null;
  readonly message_id?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
  readonly last_error?: string | null;
  readonly paid_at?: string | null;
  readonly created_at: string;
}

export interface PaymentConfiguration {
  readonly id: string;
  readonly configuration_name: string;
  readonly provider: 'razorpay' | 'payu' | 'zaakpay' | 'billdesk' | 'upi_vpa';
  readonly status: 'active' | 'needs_connecting' | 'needs_testing';
  readonly merchant_vpa?: string | null;
  readonly link_url?: string | null;
}

// --- Connections & growth tools ----------------------------------------------

export interface Connection {
  readonly uuid: string;
  readonly phone_number_id: string;
  readonly display_phone_number: string;
  readonly verified_name: string | null;
  readonly waba_id: string;
  readonly mode: 'live' | 'test';
  readonly is_default: boolean;
  readonly status: string;
}

export interface QrCode {
  readonly code: string;
  readonly prefilled_message: string;
  readonly deep_link_url: string;
  /** Short-lived Meta link; only present on create. */
  readonly qr_image_url?: string | null;
}

export interface ConversationStarters {
  readonly connection_uuid?: string;
  readonly ice_breakers: readonly string[];
  readonly commands: readonly { readonly name: string; readonly description: string }[];
  readonly welcome_message?: boolean;
}

export interface Capability {
  readonly connection_uuid: string;
  readonly phone_number_id: string;
  readonly display_phone_number?: string | null;
  readonly is_default: boolean;
  readonly quality_rating?: string | null;
  readonly messaging_limit_tier?: string | null;
  readonly capabilities: Readonly<Record<string, boolean>>;
}

// --- Events, OTP -------------------------------------------------------------

export interface SendEventInput {
  readonly type: string;
  /** By phone (`recipient.phone_number`, required for that type) or by contact uuid (`recipient.value`). */
  readonly recipient:
    | { readonly type?: 'phone_number'; readonly phone_number: string }
    | { readonly type: 'contact_id'; readonly value: string };
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SendOtpInput {
  readonly to: string;
  /** `managed`: LazyApp generates and checks the code. `delivery_only`: you pass `code`. */
  readonly mode?: 'managed' | 'delivery_only';
  readonly code?: string;
  readonly template_name?: string;
  readonly phone_number_id?: string;
}

export interface OtpChallenge {
  readonly id: string | null;
  readonly to?: string | null;
  readonly status: string;
  readonly expires_at?: string | null;
  readonly mode?: 'managed' | 'delivery_only';
  readonly message_uuid?: string | null;
}

export interface OtpVerification {
  readonly id: string;
  readonly status: string;
  readonly verified_at?: string | null;
}
