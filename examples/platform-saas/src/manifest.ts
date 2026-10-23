import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const EXAMPLE_ID = 'platform-saas';
export const START_CODE = 'DEMO PLATFORM';

/**
 * The chat needs nothing provisioned: it only replies, with buttons, a list and a link. The
 * platform side (customers, setup links, embeds) runs on a separate test-mode platform workspace,
 * and its webhook endpoint is created with `npm run provision-webhook` (see the README).
 */
export const manifest: ExampleManifest = {
  requires: { catalog: 'none', payments: 'none' },
  command: { name: 'platform', description: 'Build your own WhatsApp SaaS on LazyApp' },
  qrPrefill: START_CODE,
};
