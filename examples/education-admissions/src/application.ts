import { createHash } from 'node:crypto';
import { DEMO_FOOTER, formatInr, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { PaymentOrder } from '@lazyapp-examples/sdk';
import { APPLICATION_FEE, documentsFor, findProgram } from './catalog.js';
import type { Program } from './catalog.js';
import type { Ctx } from './context.js';
import { firstName, tagContact } from './context.js';
import { dateLabel, deadlineFor, intakeKey, intakeLabel, nextIntakes, parseIntakeKey } from './finder.js';
import { TEMPLATE_PAYLOADS, TEMPLATES } from './manifest.js';
import { MENU_IDS, nudge } from './menu.js';
import type { Application } from './state.js';

export const APPLY_IDS = {
  intakePrefix: 'apply:intake:',
  pay: 'apply:pay',
  payLater: 'apply:later',
  remind: 'apply:remind',
} as const;

const DEADLINE_REMINDERS = [
  { key: 'deadline-7d', beforeMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'deadline-1d', beforeMs: 24 * 60 * 60 * 1000 },
] as const;

/** "BP27-4K7Q9M": year of intake plus six readable characters. */
export function applicationRef(seed: string, intake: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const digest = createHash('sha256').update(seed).digest();
  return `BP${intake.slice(2, 4)}-${Array.from(digest.subarray(0, 6), (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

export async function onApply(ctx: Ctx, programId: string): Promise<void> {
  const program = findProgram(programId);
  if (program === undefined) {
    return nudge(ctx);
  }
  const current = ctx.state.application;
  if (current?.status === 'submitted' && current.programId !== programId) {
    const filed = findProgram(current.programId);
    await ctx.send.buttons({
      body: `Your application to ${filed?.university ?? 'your first choice'} is being filed. In this demo you can track one application at a time; your counsellor adds more universities on the call.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.application, title: 'My application' },
        { id: MENU_IDS.counselling, title: 'Free counselling' },
      ],
    });
    return;
  }
  const intakes = nextIntakes(program, ctx.now(), ctx.state.profile.intake, 3);
  const options = intakes.length > 0 ? intakes : nextIntakes(program, ctx.now(), null, 3);
  const [only] = options;
  if (only === undefined) {
    await ctx.send.text(`${program.university} has no intake open for applications right now.`);
    return nudge(ctx);
  }
  if (options.length === 1) {
    return onIntake(ctx, `${program.id}:${intakeKey(only)}`);
  }
  ctx.setState((state) => ({ ...state, step: 'application' }));
  await ctx.send.buttons({
    header: program.university,
    body: `*${program.name}* · ${program.duration}\nWhich intake? The application deadline is about ten weeks before classes start.`,
    footer: DEMO_FOOTER,
    buttons: options.map((intake) => ({
      id: `${APPLY_IDS.intakePrefix}${program.id}:${intakeKey(intake)}`,
      title: intakeLabel(intake),
    })),
  });
}

export async function onIntake(ctx: Ctx, value: string): Promise<void> {
  const separator = value.lastIndexOf(':');
  const program = findProgram(value.slice(0, separator));
  const intake = parseIntakeKey(value.slice(separator + 1));
  if (program === undefined || intake === null) {
    return nudge(ctx);
  }
  const key = intakeKey(intake);
  const existing = ctx.state.application;
  const application: Application =
    existing !== null &&
    existing.programId === program.id &&
    existing.intake === key &&
    existing.status !== 'submitted'
      ? existing
      : {
          ref: applicationRef(ctx.idempotencyKey('application'), key),
          programId: program.id,
          intake: key,
          status: 'fee_pending',
          payMode: null,
          paymentId: null,
          paymentAttempts: 0,
          remindersOn: false,
        };
  ctx.setState((state) => ({ ...state, application, step: 'application' }));
  await tagContact(ctx, ['admissions:applicant', `admissions:intake-${key}`]);
  await showSummary(ctx, application, program);
}

async function showSummary(ctx: Ctx, application: Application, program: Program): Promise<void> {
  const intake = parseIntakeKey(application.intake);
  const required = documentsFor(ctx.state.profile.level);
  const done = required.filter((document) => ctx.state.documents[document.id] !== undefined).length;
  await ctx.send.buttons({
    header: `Application ${application.ref}`,
    body: [
      `🎓 *${program.name}*`,
      `🏛️ ${program.university}, ${program.city}`,
      intake === null
        ? null
        : `🗓️ ${intakeLabel(intake)} intake · deadline *${dateLabel(deadlineFor(intake))}*`,
      `📄 Documents ${done}/${required.length}`,
      `💳 Application fee *${formatInr(APPLICATION_FEE)}* (adjusted against our service fee if you enrol through us)`,
      '',
      'Pay the fee and we start filing straight away. Missing documents can follow.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: APPLY_IDS.pay, title: `Pay ${formatInr(APPLICATION_FEE)}` },
      { id: APPLY_IDS.payLater, title: 'Pay at counselling' },
      { id: MENU_IDS.documents, title: 'Upload documents' },
    ],
  });
}

export async function showApplication(ctx: Ctx): Promise<void> {
  const application = ctx.state.application;
  const program = application === null ? undefined : findProgram(application.programId);
  if (application === null || program === undefined) {
    await ctx.send.buttons({
      body: "You haven't started an application yet. Find a program first, then tap Apply on it.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.finder, title: 'Find a program' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  if (application.status !== 'submitted') {
    return showSummary(ctx, application, program);
  }
  const intake = parseIntakeKey(application.intake);
  const required = documentsFor(ctx.state.profile.level);
  const done = required.filter((document) => ctx.state.documents[document.id] !== undefined).length;
  await ctx.send.buttons({
    header: `Application ${application.ref} · being filed`,
    body: [
      `🎓 ${program.name}, ${program.university}`,
      intake === null
        ? null
        : `🗓️ ${intakeLabel(intake)} intake · deadline ${dateLabel(deadlineFor(intake))}`,
      `💳 Fee ${application.payMode === 'online' ? 'paid' : 'due at counselling'}`,
      `📄 Documents ${done}/${required.length}`,
      `🔔 Deadline reminders ${application.remindersOn ? 'on' : 'off'}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      ...(application.remindersOn ? [] : [{ id: APPLY_IDS.remind, title: 'Remind me' }]),
      { id: MENU_IDS.documents, title: 'Upload documents' },
      { id: MENU_IDS.parent, title: 'Add a parent' },
    ],
  });
}

// --- Fee payment -------------------------------------------------------------------------

export async function onPay(ctx: Ctx): Promise<void> {
  const application = ctx.state.application;
  const program = application === null ? undefined : findProgram(application.programId);
  if (application === null || program === undefined || application.status === 'submitted') {
    return showApplication(ctx);
  }
  const payments = ctx.user.phone === null ? null : await ctx.capabilities.payments();
  if (payments === null) {
    await ctx.send.text(
      "Online payment isn't set up on this demo number yet (no WhatsApp Pay configuration or gateway account), so I've marked the fee as *due at counselling*. On a live number, this sends a WhatsApp order you pay with UPI.",
    );
    return submit(ctx, 'counselling');
  }
  const attempt = application.paymentAttempts + 1;
  let order: PaymentOrder;
  try {
    order = await ctx.api.payments.create(
      {
        to: ctx.user.phone ?? '',
        reference_id: attempt === 1 ? application.ref : `${application.ref}-${attempt}`,
        body: `Application fee for ${program.name} at ${program.university}. We start filing as soon as it's paid.`,
        footer: 'BrightPath Overseas · LazyApp demo',
        goods_type: 'digital-goods',
        expires_in_minutes: 60,
        items: [
          {
            name: `Application fee · ${program.shortUniversity}`,
            amount: APPLICATION_FEE,
            quantity: 1,
            retailer_id: `app-fee-${program.id}`,
          },
        ],
        payment:
          payments.method === 'payment_gateway'
            ? { method: 'payment_gateway', configuration: payments.configuration }
            : { method: payments.method, gateway_account: payments.gatewayAccount },
        metadata: { application_ref: application.ref, demo: 'education-admissions' },
      },
      { idempotencyKey: ctx.idempotencyKey(`payment:${application.ref}:${attempt}`) },
    );
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('payment request refused', { code: error.code, status: error.status });
    await ctx.send.text(
      `WhatsApp could not create the payment just now (${error.message}). I've marked the fee as due at counselling instead.`,
    );
    return submit(ctx, 'counselling');
  }
  ctx.setState((state) => ({
    ...state,
    application: {
      ...application,
      status: 'awaiting_payment',
      payMode: 'online',
      paymentId: order.id,
      paymentAttempts: attempt,
    },
  }));
}

export async function onPayLater(ctx: Ctx): Promise<void> {
  const application = ctx.state.application;
  if (application === null || application.status === 'submitted') {
    return showApplication(ctx);
  }
  return submit(ctx, 'counselling');
}

/** Files the application. Online: after payment.captured. Counselling: the fee is collected on the call. */
async function submit(ctx: Ctx, payMode: 'online' | 'counselling'): Promise<void> {
  const application = ctx.state.application;
  const program = application === null ? undefined : findProgram(application.programId);
  if (application === null || program === undefined) {
    return;
  }
  const submitted: Application = { ...application, status: 'submitted', payMode };
  ctx.setState((state) => ({ ...state, application: submitted, step: 'menu' }));
  ctx.kv.set(`application:${submitted.ref}`, {
    address: ctx.user.address,
    programId: submitted.programId,
    intake: submitted.intake,
    payMode,
    at: ctx.now().toISOString(),
  });
  const intake = parseIntakeKey(submitted.intake);
  await ctx.send.buttons({
    header: payMode === 'online' ? 'Fee received ✅' : 'Application started ✅',
    body: `${payMode === 'online' ? `We received ${formatInr(APPLICATION_FEE)}. ` : ''}Your counsellor starts filing *${program.name}* at ${program.university} (ref ${submitted.ref}).${intake === null ? '' : `\n\nDeadline: *${dateLabel(deadlineFor(intake))}*. Want reminders 7 days and 1 day before?`}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: APPLY_IDS.remind, title: 'Remind me' },
      { id: MENU_IDS.documents, title: 'Upload documents' },
      { id: MENU_IDS.parent, title: 'Add a parent' },
    ],
  });
}

export async function onPaymentCaptured(ctx: Ctx, payment: PaymentOrder): Promise<void> {
  const application = ctx.state.application;
  if (application?.status !== 'awaiting_payment' || payment.metadata?.application_ref !== application.ref) {
    return;
  }
  try {
    await ctx.api.payments.updateStatus(
      payment.id,
      { status: 'processing', description: `Application ${application.ref} is being filed` },
      { idempotencyKey: ctx.idempotencyKey(`order-status:${application.ref}`) },
    );
  } catch (error) {
    ctx.log.warn('order status update failed', { error });
  }
  await tagContact(ctx, ['admissions:fee-paid']);
  return submit(ctx, 'online');
}

export async function onPaymentFailed(ctx: Ctx, payment: PaymentOrder): Promise<void> {
  const application = ctx.state.application;
  if (application?.status !== 'awaiting_payment' || payment.metadata?.application_ref !== application.ref) {
    return;
  }
  ctx.setState((state) => ({ ...state, application: { ...application, status: 'fee_pending' } }));
  await ctx.send.buttons({
    body: `The ${formatInr(APPLICATION_FEE)} payment didn't go through${payment.last_error === null || payment.last_error === undefined ? '' : ` (${payment.last_error})`}. No money was taken.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: APPLY_IDS.pay, title: 'Try again' },
      { id: APPLY_IDS.payLater, title: 'Pay at counselling' },
    ],
  });
}

// --- Deadline reminders -------------------------------------------------------------------

export async function onRemindDeadline(ctx: Ctx): Promise<void> {
  const application = ctx.state.application;
  const program = application === null ? undefined : findProgram(application.programId);
  const intake = application === null ? null : parseIntakeKey(application.intake);
  if (application === null || program === undefined || intake === null) {
    return showApplication(ctx);
  }
  const deadline = deadlineFor(intake);
  let scheduled = 0;
  for (const { key, beforeMs } of DEADLINE_REMINDERS) {
    const sendAt = new Date(deadline.getTime() - beforeMs);
    if (sendAt.getTime() <= ctx.now().getTime() + 60 * 60 * 1000) {
      continue;
    }
    await ctx.followUps.schedule({
      key,
      category: 'utility',
      sendAt,
      template: {
        name: TEMPLATES.deadline,
        language: 'en',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: firstName(ctx) ?? 'there' },
              { type: 'text', text: `${program.name}, ${program.university}` },
              { type: 'text', text: intakeLabel(intake) },
              { type: 'text', text: dateLabel(deadline) },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.documents }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.counselling }],
          },
        ],
      },
    });
    scheduled += 1;
  }
  ctx.setState((state) => ({ ...state, application: { ...application, remindersOn: scheduled > 0 } }));
  await ctx.send.buttons({
    body:
      scheduled === 0
        ? `The deadline (${dateLabel(deadline)}) is too close for reminders. Your counsellor will chase the last documents with you.`
        : `Done. You'll get ${scheduled === 2 ? 'a reminder 7 days and another 1 day' : 'a reminder 1 day'} before the ${dateLabel(deadline)} deadline, as an approved WhatsApp template.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.documents, title: 'Upload documents' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}
