import { z } from 'zod';

export const MAX_CART_LINES = 10;
export const MAX_LINE_QUANTITY = 10;

export const cartLineSchema = z.object({
  itemId: z.string(),
  /** Size choice id (`half`, `full`, `regular`), null for dishes without options. */
  size: z.string().nullable(),
  spice: z.string().nullable(),
  addOns: z.array(z.string()).max(5),
  qty: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().max(140).nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const scheduleSchema = z.union([
  z.object({ kind: z.literal('asap') }),
  z.object({ kind: z.literal('later'), at: z.string(), label: z.string() }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export const dropSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  km: z.number(),
  /** Flat, building, landmark: what the rider needs on top of the pin. */
  details: z.string().nullable(),
  name: z.string().nullable(),
});
export type Drop = z.infer<typeof dropSchema>;

export const foodStep = z.enum([
  'home',
  'locating',
  'menu',
  'customizing',
  'editing_cart',
  'when',
  'address',
  'address_text',
  'review',
  'awaiting_payment',
  'booking',
]);

export const foodStateSchema = z.object({
  step: foodStep,
  mode: z.enum(['delivery', 'pickup']).nullable(),
  outletId: z.string().nullable(),
  drop: dropSchema.nullable(),
  cart: z.array(cartLineSchema).max(MAX_CART_LINES),
  activeLine: z.number().int().min(0).nullable(),
  /** Button-by-button customisation when the Flow is unavailable. */
  customizing: z.object({ itemId: z.string(), size: z.string().nullable() }).nullable(),
  schedule: scheduleSchema.nullable(),
  usePoints: z.boolean(),
  checkoutOrderId: z.string().nullable(),
  /** Button-by-button table booking when the Flow is unavailable. */
  bookingDraft: z
    .object({ outletId: z.string(), date: z.string().nullable(), party: z.number().int().nullable() })
    .nullable(),
});

export type FoodState = z.infer<typeof foodStateSchema>;

export const initialFoodState = (): FoodState => ({
  step: 'home',
  mode: null,
  outletId: null,
  drop: null,
  cart: [],
  activeLine: null,
  customizing: null,
  schedule: null,
  usePoints: false,
  checkoutOrderId: null,
  bookingDraft: null,
});
