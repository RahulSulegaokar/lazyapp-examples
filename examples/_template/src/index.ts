import { DEMO_FOOTER, defineExample, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { ExampleContext, Inbound } from '@lazyapp-examples/demo-kit';
import { FLOWS, manifest, TEMPLATES } from './manifest.js';
import { helloStateSchema, initialHelloState } from './state.js';
import type { HelloState } from './state.js';

type Ctx = ExampleContext<HelloState>;

/** LazyApp's office, for the "share your location" step. */
const OFFICE = {
  latitude: 12.9716,
  longitude: 77.5946,
  name: 'LazyApp',
  address: 'Bengaluru, Karnataka',
} as const;

const COLOURS = [
  { id: 'colour:saffron', title: 'Saffron', description: 'Warm and bright' },
  { id: 'colour:teal', title: 'Teal', description: 'WhatsApp-adjacent' },
  { id: 'colour:indigo', title: 'Indigo', description: 'Calm and deep' },
] as const;

const RATING_BUTTONS = [
  { id: 'rating:5', title: 'Loved it' },
  { id: 'rating:3', title: 'It was OK' },
  { id: 'rating:2', title: 'Not for me' },
] as const;

/**
 * The reference example. Every build follows this shape:
 *
 * - `manifest` declares what setup provisions (templates, flows, events).
 * - Handlers are small functions of `(ctx, inbound)`; all I/O goes through `ctx`.
 * - State is a zod-validated object, replaced (never mutated) with `ctx.setState`.
 * - Every capability has a fallback (no flow published → reply buttons).
 */
export default defineExample<HelloState>({
  id: 'hello',
  title: 'Hello LazyApp',
  startCode: 'DEMO HELLO',
  manifest,
  stateSchema: helloStateSchema,
  initialState: initialHelloState,
  describe: () => ({
    summary: 'The reference demo: buttons, a list, location and a feedback flow.',
    metaFeatures: [
      'Reply buttons',
      'List messages',
      'Reactions',
      'Location request',
      'Location',
      'WhatsApp Flows',
      'Typing indicator',
    ],
    emoji: '👋',
  }),

  async onStart(ctx) {
    await menu(
      ctx,
      `Hi${ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`}! This is the smallest LazyApp demo: every message you see is one API call.`,
    );
  },

  async onMenu(ctx) {
    await menu(ctx, 'What would you like to try?');
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'button':
        return onButton(ctx, inbound.id, inbound);
      case 'list':
        return onColour(ctx, inbound);
      case 'location':
        return onLocation(ctx, inbound.latitude, inbound.longitude);
      case 'flow':
        return onRating(ctx, Number(inbound.response.rating), stringOrNull(inbound.response.comment));
      default:
        await ctx.send.text("I didn't catch that. Tap a button below, or type *MENU*.");
        return menu(ctx, 'Here is the menu again:');
    }
  },

  async onEvent(ctx, event) {
    // A send we made failed (e.g. a template that is not approved yet). Log it; never retry blindly.
    ctx.log.warn('a demo message failed', { type: event.type, data: event.data });
  },
});

async function menu(ctx: Ctx, body: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  await ctx.send.buttons({
    header: 'Hello from LazyApp 👋',
    body,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'colour', title: 'Pick a colour' },
      { id: 'location', title: 'Share location' },
      { id: 'feedback', title: 'Give feedback' },
    ],
  });
}

async function onButton(ctx: Ctx, id: string, inbound: Inbound): Promise<void> {
  if (id === 'colour') {
    ctx.setState((state) => ({ ...state, step: 'colour' }));
    await ctx.send.list({
      header: 'Pick a colour',
      body: 'Lists hold up to 10 rows. Pick one and I will react to your choice.',
      button: 'See colours',
      footer: DEMO_FOOTER,
      sections: [{ title: 'Colours', rows: COLOURS }],
    });
    return;
  }
  if (id === 'location') {
    ctx.setState((state) => ({ ...state, step: 'location' }));
    await ctx.send.locationRequest(
      'Share your location and I will tell you how far you are from the LazyApp office.',
    );
    return;
  }
  if (id === 'feedback') {
    ctx.setState((state) => ({ ...state, step: 'feedback' }));
    if (await ctx.flows.isAvailable(FLOWS.feedback)) {
      await ctx.flows.send({
        key: FLOWS.feedback,
        header: 'Feedback',
        body: 'A WhatsApp Flow is a native form inside the chat. It takes ten seconds.',
        cta: 'Rate the demo',
        screen: 'RATE',
      });
    } else {
      await ctx.send.buttons({ body: 'How was this demo?', buttons: RATING_BUTTONS, footer: DEMO_FOOTER });
    }
    return;
  }
  if (id.startsWith('rating:')) {
    return onRating(ctx, Number(id.slice('rating:'.length)), null);
  }
  if (id === 'remind') {
    await ctx.followUps.schedule({
      key: 'reminder',
      category: 'utility',
      sendAt: new Date(ctx.now().getTime() + 60 * 60 * 1000),
      template: {
        name: TEMPLATES.followUp,
        language: 'en',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: ctx.user.displayName ?? 'there' }] },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: RESERVED_IDS.menu }],
          },
        ],
      },
    });
    await ctx.send.text(
      'Done. I will nudge you in an hour with an approved template. Type *EXIT* to cancel it.',
    );
    return;
  }
  await ctx.send.react('🤔', inbound.wamid ?? undefined);
  await menu(ctx, 'That button is from an older message. Here is the menu:');
}

async function onColour(ctx: Ctx, inbound: Extract<Inbound, { kind: 'list' }>): Promise<void> {
  const colour = COLOURS.find((entry) => entry.id === inbound.id);
  if (colour === undefined) {
    return menu(ctx, 'That option is not on the list any more. Here is the menu:');
  }
  ctx.setState((state) => ({ ...state, colour: colour.title, step: 'menu' }));
  await ctx.send.react('🎨');
  await menu(ctx, `${colour.title} it is. I reacted to your message: reactions are one API call too.`);
}

async function onLocation(ctx: Ctx, latitude: number, longitude: number): Promise<void> {
  const km = distanceKm(latitude, longitude, OFFICE.latitude, OFFICE.longitude);
  await ctx.send.location(OFFICE);
  await menu(
    ctx,
    `You are about ${km.toLocaleString('en-IN', { maximumFractionDigits: 0 })} km from the LazyApp office.`,
  );
}

async function onRating(ctx: Ctx, rating: number, comment: string | null): Promise<void> {
  const valid = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
  ctx.setState((state) => ({ ...state, rating: valid, step: 'done' }));
  if (valid !== null) {
    ctx.kv.set(`rating:${ctx.session.id}`, { rating: valid, comment, at: ctx.now().toISOString() });
  }
  await ctx.send.buttons({
    body: `Thanks${valid === null ? '' : ` for the ${valid}/5`}! Want a reminder to come back later? It is only sent because you ask.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'remind', title: 'Remind me in 1h' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Great-circle distance (haversine). */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
