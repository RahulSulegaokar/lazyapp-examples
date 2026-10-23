import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { PlatformSaasConfig } from './config.js';
import { EXAMPLE_ID } from './manifest.js';
import type { Ctx, TourStep } from './state.js';

/** Reply ids. Everything the tour sends is namespaced `ps:` so old buttons from other demos never match. */
export const IDS = {
  start: 'ps:step:customers',
  connect: 'ps:step:connect',
  embed: 'ps:step:embed',
  webhooks: 'ps:step:webhooks',
  tryIt: 'ps:step:try',
  status: 'ps:status',
  call: 'ps:call',
  componentPrefix: 'ps:component:',
  slotPrefix: 'ps:slot:',
} as const;

export const COMPONENTS = [
  {
    id: 'inbox',
    title: 'Inbox',
    description: "Each salon's conversations, with replies, inside SalonBook",
    detail:
      "The salon's WhatsApp conversations inside SalonBook, with replies. Your support team never logs in to a second tool, and you never build an inbox.",
  },
  {
    id: 'templates',
    title: 'Templates',
    description: 'Create templates and track Meta review per salon',
    detail:
      'The salon writes its own reminder and offer templates and watches Meta review them. Approved templates are what SalonBook sends booking reminders with.',
  },
  {
    id: 'usage',
    title: 'Usage',
    description: "The salon's messages and spend this month",
    detail:
      "This month's messages and spend for that salon. The same numbers are on the API (GET /v1/platform/customers/{id}/usage) if you'd rather draw your own billing page.",
  },
  {
    id: 'connection',
    title: 'Connection',
    description: 'Connect or repair the salon’s number',
    detail:
      "Connect the salon's number, or repair it when Meta flags it. The same Embedded Signup as setup links, without leaving SalonBook.",
  },
  {
    id: 'messages',
    title: 'Messages',
    description: 'Read-only history for audits and support',
    detail:
      'A read-only message log. Useful for your support team: what went out, when, and whether it arrived.',
  },
] as const;

export const CALL_SLOTS = [
  { id: 'tomorrow-am', title: 'Tomorrow morning', description: '10 am – 1 pm IST' },
  { id: 'tomorrow-pm', title: 'Tomorrow afternoon', description: '2 – 6 pm IST' },
  { id: 'this-week', title: 'Later this week', description: 'Any weekday, 10 am – 6 pm IST' },
] as const;

/** Contact tag that puts a call request in front of the LazyApp team in the console. */
export const CALL_TAG = 'platform-saas:call-requested';

export function webDemoUrl(ctx: Ctx): string {
  return `${ctx.config.publicBaseUrl}/x/${EXAMPLE_ID}/`;
}

/**
 * The guided tour: five short steps, each one rich message. Every step can be reached from a
 * stale button or by free text, so nothing strands the person.
 */
export class Tour {
  constructor(private readonly config: PlatformSaasConfig) {}

  async intro(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'intro');
    const name = ctx.user.displayName === null ? '' : `, ${ctx.user.displayName}`;
    await ctx.send.buttons({
      header: 'Build your own WhatsApp SaaS',
      body: withNote(
        note,
        `Hi${name}. Say you run *SalonBook*, booking software used by 400 salons. Every salon wants ` +
          "reminders and replies on *its own* WhatsApp number, and you don't want 400 Meta integrations.\n\n" +
          "LazyApp's platform layer lets you build it once: each salon becomes a customer workspace, " +
          'connects its own number, and works inside your app.\n\nFive short steps, about two minutes.',
      ),
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.start, title: 'Start the tour' },
        { id: IDS.tryIt, title: 'Open the web demo' },
        { id: IDS.call, title: 'Book a call' },
      ],
    });
  }

  async customers(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'customers');
    await ctx.send.buttons({
      header: '1/5 · One customer per salon',
      body: withNote(
        note,
        'When a salon signs up for SalonBook, your server makes one call:\n\n' +
          '```POST /v1/platform/customers\n{ "name": "Glow Studio",\n  "external_id": "salon_812" }```\n\n' +
          'LazyApp creates an isolated workspace for that salon: its own number, contacts, templates, keys ' +
          'and billing. You keep using *your* id (`external_id`), so there is no mapping table.\n\n' +
          'Billing per salon: *inherit* (your wallet), *prepaid* (their wallet) or *postpaid* (you invoice).',
      ),
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.connect, title: 'Next: connecting' },
        { id: IDS.tryIt, title: 'Skip to the demo' },
      ],
    });
  }

  async connect(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'connect');
    await ctx.send.buttons({
      header: '2/5 · Salons bring their own number',
      body: withNote(
        note,
        '`POST /v1/platform/setup-links` returns a one-time URL. Put it behind a *Connect WhatsApp* button ' +
          "in SalonBook. The owner goes through Meta's Embedded Signup; their credentials go to Meta, never " +
          'through you.\n\nYou learn it worked from the `customer.connected` webhook, not from the redirect.\n\n' +
          '_Completing Embedded Signup needs a live key and LazyApp’s Meta app review. Everything else in ' +
          'this tour works in test mode today._',
      ),
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.embed, title: 'Next: embedding' },
        { id: IDS.tryIt, title: 'Skip to the demo' },
      ],
    });
  }

  async embed(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'embed');
    await ctx.send.list({
      header: '3/5 · Embed, don’t rebuild',
      body: withNote(
        note,
        'Instead of building an inbox, SalonBook mints a short-lived embed token on every page view and ' +
          "drops LazyApp's UI into an iframe. A token opens one component, for one salon, and only renders " +
          "on SalonBook's own domain.\n\nPick a component to see what it does:",
      ),
      footer: DEMO_FOOTER,
      button: 'Components',
      sections: [
        {
          title: 'Embeddable components',
          rows: COMPONENTS.map((component) => ({
            id: `${IDS.componentPrefix}${component.id}`,
            title: component.title,
            description: component.description,
          })),
        },
        { title: 'Tour', rows: [{ id: IDS.webhooks, title: 'Next: webhooks', description: 'Step 4 of 5' }] },
      ],
    });
  }

  async component(ctx: Ctx, componentId: string): Promise<void> {
    const component = COMPONENTS.find((entry) => entry.id === componentId);
    if (component === undefined) {
      return this.embed(ctx, 'That component is not on the list any more.');
    }
    ctx.setState((state) => ({
      ...state,
      step: 'embed',
      componentsSeen: state.componentsSeen.includes(component.id)
        ? state.componentsSeen
        : [...state.componentsSeen, component.id],
    }));
    await ctx.send.buttons({
      header: `Embedded: ${component.title}`,
      body:
        `${component.detail}\n\n` +
        `\`\`\`POST /v1/platform/embed-tokens\n{ "customer_id": "cus_…",\n  "component": "${component.id}",\n` +
        '  "expires_in_minutes": 10,\n  "origin_allowlist":\n    ["https://app.salonbook.example"] }```',
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.webhooks, title: 'Next: webhooks' },
        { id: IDS.embed, title: 'Another component' },
      ],
    });
  }

  async webhooks(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'webhooks');
    await ctx.send.buttons({
      header: '4/5 · Events come back labelled',
      body: withNote(
        note,
        'One webhook endpoint hears every salon. Each delivery carries a customer envelope:\n\n' +
          '```"customer": { "id": "cus_…",\n  "external_id": "salon_812" }```\n\n' +
          'So SalonBook routes by its own id:\n' +
          '• `customer.connected` → mark the salon live\n' +
          "• `message.received` → that salon's inbox\n" +
          '• `customer.usage_alert` → warn before a spending limit\n' +
          '• `setup_link.failed` → offer a fresh link\n\n' +
          'One platform key, one signing secret, every tenant.',
      ),
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.tryIt, title: 'Next: try it' },
        { id: IDS.call, title: 'Book a call' },
      ],
    });
  }

  async tryIt(ctx: Ctx, note?: string): Promise<void> {
    this.at(ctx, 'try');
    await ctx.send.cta({
      header: '5/5 · Try SalonBook',
      body: withNote(
        note,
        "SalonBook's admin is live, running on LazyApp in test mode with three seed salons (reset daily). " +
          'Create a salon, generate its setup link, open the embedded inbox, read its usage and watch ' +
          'webhooks arrive labelled with the salon.',
      ),
      footer: 'Best on a laptop',
      displayText: 'Open SalonBook',
      url: webDemoUrl(ctx),
    });
    await ctx.send.buttons({
      body: "That's the tour. What next?",
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.status, title: 'What works today?' },
        { id: IDS.call, title: 'Book a call' },
        { id: IDS.start, title: 'Restart the tour' },
      ],
    });
  }

  async status(ctx: Ctx): Promise<void> {
    this.at(ctx, 'status');
    await ctx.send.buttons({
      header: 'Test mode vs live',
      body:
        '*Works today with an sk_test key*\n' +
        '• Customers, with your own external_id\n' +
        '• Setup links (URL and QR)\n' +
        '• Embed tokens for inbox, templates and usage\n' +
        '• Per-salon usage and alerts\n' +
        '• Automation packs, per salon\n' +
        '• One webhook endpoint for every salon\n\n' +
        "*Needs live Embedded Signup (LazyApp's Meta app review)*\n" +
        '• A salon actually connecting its number\n' +
        "• Real customer.connected events and messages in that salon's inbox\n" +
        "• Sending from the salon's own number",
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.call, title: 'Book a call' },
        { id: IDS.tryIt, title: 'Open the web demo' },
        { id: IDS.start, title: 'Restart the tour' },
      ],
    });
  }

  async bookCall(ctx: Ctx): Promise<void> {
    this.at(ctx, 'call');
    if (this.config.bookCallUrl !== null) {
      await ctx.send.cta({
        body:
          'Talk to the LazyApp team about your platform: onboarding your customers, white-label setup ' +
          'links, billing modes and going live. Pick a time that suits you.',
        footer: DEMO_FOOTER,
        displayText: 'Book a call',
        url: this.config.bookCallUrl,
      });
      return;
    }
    await ctx.send.list({
      header: 'Talk to LazyApp',
      body:
        'Happy to walk you through building on LazyApp: onboarding your customers, white-label setup links, ' +
        'billing modes and going live.\n\nWhen suits you? Someone from LazyApp replies in this chat to confirm.',
      footer: DEMO_FOOTER,
      button: 'Pick a time',
      sections: [
        {
          title: 'Times (IST)',
          rows: CALL_SLOTS.map((slot) => ({
            id: `${IDS.slotPrefix}${slot.id}`,
            title: slot.title,
            description: slot.description,
          })),
        },
        { title: 'Or', rows: [{ id: IDS.start, title: 'Not now', description: 'Back to the tour' }] },
      ],
    });
  }

  async callSlot(ctx: Ctx, slotId: string): Promise<void> {
    const slot = CALL_SLOTS.find((entry) => entry.id === slotId);
    if (slot === undefined) {
      return this.bookCall(ctx);
    }
    ctx.setState((state) => ({ ...state, step: 'call', callSlot: slot.id }));
    // The request lands in the LazyApp console as a contact tag; the demo keeps no phone numbers.
    ctx.kv.set(`call:${ctx.session.id}`, {
      slot: slot.id,
      at: ctx.now().toISOString(),
      contact: ctx.user.contactUuid,
    });
    if (ctx.user.contactUuid !== null) {
      try {
        await ctx.api.contacts.addTags(ctx.user.contactUuid, [CALL_TAG], {
          idempotencyKey: ctx.idempotencyKey('call-tag'),
        });
      } catch (error) {
        ctx.log.warn('could not tag the call request', { error });
      }
    }
    await ctx.send.buttons({
      body:
        `Noted: *${slot.title.toLowerCase()}* (${slot.description}). Someone from the LazyApp team will reply ` +
        "in this chat to confirm a time. We won't send anything else.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.tryIt, title: 'Open the web demo' },
        { id: IDS.start, title: 'Restart the tour' },
      ],
    });
  }

  /** Re-sends the step the person is on, with a nudge on top. */
  async repeat(ctx: Ctx, note: string): Promise<void> {
    switch (ctx.state.step) {
      case 'intro':
        return this.intro(ctx, note);
      case 'customers':
        return this.customers(ctx, note);
      case 'connect':
        return this.connect(ctx, note);
      case 'embed':
        return this.embed(ctx, note);
      case 'webhooks':
        return this.webhooks(ctx, note);
      case 'try':
      case 'status':
      case 'call':
        return this.tryIt(ctx, note);
    }
  }

  private at(ctx: Ctx, step: TourStep): void {
    ctx.setState((state) => ({ ...state, step }));
  }
}

function withNote(note: string | undefined, body: string): string {
  return note === undefined ? body : `_${note}_\n\n${body}`;
}
