import { defineExample, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { Example } from '@lazyapp-examples/demo-kit';
import { configFromEnv } from './config.js';
import type { PlatformSaasConfig } from './config.js';
import { EXAMPLE_ID, manifest, START_CODE } from './manifest.js';
import { initialPlatformState, platformStateSchema } from './state.js';
import type { Ctx, PlatformState } from './state.js';
import { IDS, Tour } from './tour.js';
import { platformClientFromConfig, webRoutes } from './web.js';
import type { WebDeps } from './web.js';

/**
 * "Build your own WhatsApp SaaS": a guided chat about LazyApp's platform layer, plus SalonBook, a
 * fictional salon-booking SaaS whose admin page onboards salons as LazyApp platform customers.
 *
 * Built as a factory so tests pass configuration (and a fake platform client) explicitly; the
 * default export reads the environment.
 */
export function createPlatformSaasExample(
  config: PlatformSaasConfig,
  options: { readonly platformClient?: WebDeps['platformClient'] } = {},
): Example<PlatformState> {
  const tour = new Tour(config);

  return defineExample<PlatformState>({
    id: EXAMPLE_ID,
    title: 'Build your WhatsApp SaaS',
    startCode: START_CODE,
    manifest,
    stateSchema: platformStateSchema,
    initialState: initialPlatformState,
    describe: () => ({
      summary: 'Embed WhatsApp in your SaaS: a customer per tenant, setup links, embeds, webhooks.',
      metaFeatures: [
        'Reply buttons',
        'List messages',
        'CTA URL button',
        'Contact tags',
        'Embedded Signup (setup links)',
        'Platform API: customers, embed tokens, usage',
        'Webhooks with the customer envelope',
        'Automation packs',
      ],
      emoji: '🏗️',
    }),

    async onStart(ctx) {
      await tour.intro(ctx);
    },

    async onMenu(ctx) {
      await tour.intro(ctx);
    },

    async onMessage(ctx, inbound) {
      switch (inbound.kind) {
        case 'button':
        case 'list':
          return onChoice(ctx, inbound.id);
        case 'text':
          return onText(ctx, inbound.text);
        default:
          return tour.repeat(ctx, 'I can only follow taps and text here. Pick an option to carry on.');
      }
    },

    web: webRoutes({ config, platformClient: options.platformClient ?? platformClientFromConfig(config) }),
  });

  async function onChoice(ctx: Ctx, id: string): Promise<void> {
    switch (id) {
      case IDS.start:
        return tour.customers(ctx);
      case IDS.connect:
        return tour.connect(ctx);
      case IDS.embed:
        return tour.embed(ctx);
      case IDS.webhooks:
        return tour.webhooks(ctx);
      case IDS.tryIt:
        return tour.tryIt(ctx);
      case IDS.status:
        return tour.status(ctx);
      case IDS.call:
        return tour.bookCall(ctx);
      case RESERVED_IDS.menu:
        return tour.intro(ctx);
      default:
        break;
    }
    if (id.startsWith(IDS.componentPrefix)) {
      return tour.component(ctx, id.slice(IDS.componentPrefix.length));
    }
    if (id.startsWith(IDS.slotPrefix)) {
      return tour.callSlot(ctx, id.slice(IDS.slotPrefix.length));
    }
    return tour.repeat(ctx, 'That button is from an older message. Here is where you were:');
  }

  async function onText(ctx: Ctx, text: string): Promise<void> {
    const normalized = text.trim().toLowerCase();
    if (/\b(call|talk|sales|meeting|contact)\b/.test(normalized)) {
      return tour.bookCall(ctx);
    }
    if (/\b(next|continue|go on|ok|okay)\b/.test(normalized)) {
      return next(ctx);
    }
    if (/\b(link|web|demo|salonbook|try)\b/.test(normalized)) {
      return tour.tryIt(ctx);
    }
    return tour.repeat(ctx, "I didn't catch that. Tap a button to carry on, or type MENU.");
  }

  async function next(ctx: Ctx): Promise<void> {
    switch (ctx.state.step) {
      case 'intro':
        return tour.customers(ctx);
      case 'customers':
        return tour.connect(ctx);
      case 'connect':
        return tour.embed(ctx);
      case 'embed':
        return tour.webhooks(ctx);
      default:
        return tour.tryIt(ctx);
    }
  }
}

export default createPlatformSaasExample(configFromEnv(process.env));
