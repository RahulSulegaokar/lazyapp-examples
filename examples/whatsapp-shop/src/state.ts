import { z } from 'zod';

export const MAX_LINE_QUANTITY = 10;
export const MAX_CART_LINES = 10;

export const cartLineSchema = z.object({
  sku: z.string().min(1),
  /** Null for one-size products, and for sized products added from the catalog before a size is picked. */
  size: z.string().nullable(),
  qty: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const deliveryAddressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable(),
  line1: z.string().min(1),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
});
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;

export const slotSchema = z.object({ id: z.string(), label: z.string() });
export type DeliverySlot = z.infer<typeof slotSchema>;

/**
 * Where the conversation is, so free text and stale taps are read in context.
 * Orders live in example storage (`orders.ts`), not here: state only holds ids.
 */
export const shopStep = z.enum([
  'browsing',
  'searching',
  'choosing_size',
  'editing_cart',
  'address',
  'address_text',
  'slot',
  'payment',
  'awaiting_payment',
  'confirming_cod',
  'returns',
]);
export type ShopStep = z.infer<typeof shopStep>;

export const shopStateSchema = z.object({
  step: shopStep,
  cart: z.array(cartLineSchema).max(MAX_CART_LINES),
  /** Cart line index waiting for a size, or being edited. */
  activeLine: z.number().int().min(0).nullable(),
  address: deliveryAddressSchema.nullable(),
  slot: slotSchema.nullable(),
  /** Applied coupon code (upper case). */
  coupon: z.string().nullable(),
  /** Order created at checkout, waiting for payment or COD confirmation. */
  checkoutOrderId: z.string().nullable(),
  /** Delivered order the returns flow is about. */
  returnOrderId: z.string().nullable(),
  /** Button-by-button return, used when the returns Flow is not published. */
  returnDraft: z
    .object({
      sku: z.string(),
      kind: z.enum(['return', 'exchange']).nullable(),
      newSize: z.string().nullable(),
    })
    .nullable(),
});

export type ShopState = z.infer<typeof shopStateSchema>;

export const initialShopState = (): ShopState => ({
  step: 'browsing',
  cart: [],
  activeLine: null,
  address: null,
  slot: null,
  coupon: null,
  checkoutOrderId: null,
  returnOrderId: null,
  returnDraft: null,
});
