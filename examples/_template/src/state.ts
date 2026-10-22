import { z } from 'zod';

/**
 * Per-user state, validated on every load. Keep it small and serialisable:
 * it is JSON in SQLite, and a schema change after a deploy resets old sessions
 * instead of crashing them.
 */
export const helloStateSchema = z.object({
  /** Where the conversation is, so free text can be interpreted in context. */
  step: z.enum(['menu', 'colour', 'location', 'feedback', 'done']),
  colour: z.string().nullable(),
  /** Rating 2–5 from the feedback flow or its button fallback. */
  rating: z.number().int().min(1).max(5).nullable(),
});

export type HelloState = z.infer<typeof helloStateSchema>;

export const initialHelloState = (): HelloState => ({ step: 'menu', colour: null, rating: null });
