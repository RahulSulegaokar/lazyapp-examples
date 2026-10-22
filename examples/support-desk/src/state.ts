import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { attachmentSchema } from './tickets.js';

/** A ticket being written: category, order, description, then attachments. */
const draftSchema = z.object({
  categoryId: z.string(),
  orderId: z.string().nullable(),
  description: z.string().nullable(),
  attachments: z.array(attachmentSchema).max(5),
  /** Hand straight to an agent once created ("Talk to an agent" started this ticket). */
  forAgent: z.boolean(),
});

export const supportStateSchema = z.object({
  step: z.enum([
    'menu',
    'faq',
    'track',
    'ticket_category',
    'ticket_order',
    'ticket_describe',
    'ticket_attach',
    'with_agent',
    'centre',
  ]),
  draft: draftSchema.nullable(),
  /** The ticket the person is talking about (with an agent, or rating). Tickets live in `kv`. */
  ticketId: z.string().nullable(),
});

export type SupportState = z.infer<typeof supportStateSchema>;
export type Draft = z.infer<typeof draftSchema>;

export const initialSupportState = (): SupportState => ({ step: 'menu', draft: null, ticketId: null });

/** The context every handler receives. */
export type Ctx = ExampleContext<SupportState>;
