import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

/** Template names are workspace-wide: always `demo_<exampleid>_<what>`. */
export const TEMPLATES = {
  followUp: 'demo_hello_follow_up',
} as const;

export const FLOWS = {
  feedback: 'feedback',
} as const;

/**
 * Everything `npm run setup` provisions for this example. The router reads
 * `webhookEvents`; setup reads the rest.
 */
export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose: 'Follow-up the user explicitly asks for ("Remind me later"); sent outside the 24h window.',
      input: {
        name: TEMPLATES.followUp,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, here is the reminder you asked for. Reply MENU to pick up the LazyApp demo where you left off.',
        body_examples: ['Asha'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [{ type: 'QUICK_REPLY', text: 'MENU' }],
        submit: true,
      },
    },
  ],
  flows: [
    {
      key: FLOWS.feedback,
      purpose: 'A one-screen rating form, sent with flow_action navigate (no data endpoint).',
      categories: ['SURVEY'],
      flowJson: loadFlowJson(new URL('../flows/feedback.json', import.meta.url)),
      dataExchange: false,
    },
  ],
  webhookEvents: ['message.failed'],
  requires: { catalog: 'none', payments: 'none' },
  command: { name: 'hello', description: 'Reference demo: buttons, lists, location and a flow' },
  qrPrefill: 'DEMO HELLO',
};
