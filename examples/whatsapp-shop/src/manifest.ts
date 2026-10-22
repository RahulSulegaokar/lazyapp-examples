import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

/** Template names are workspace-wide: always `demo_whatsapp_shop_<what>`. */
export const TEMPLATES = {
  cartReminder: 'demo_whatsapp_shop_cart_reminder',
  festiveOffer: 'demo_whatsapp_shop_festive_offer',
} as const;

export const FLOWS = {
  returns: 'returns',
  address: 'address',
} as const;

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose:
        'Abandoned-cart reminder, scheduled only after the shopper taps "Remind me" and opts in to marketing.',
      input: {
        name: TEMPLATES.cartReminder,
        language: 'en',
        category: 'MARKETING',
        header: { format: 'TEXT', text: 'Your cart is waiting' },
        body_text:
          'Hi {{1}}, you left {{2}} in your Indigo Loom cart. Orders above ₹1,499 ship free, and we have saved your cart for the next 24 hours.',
        body_examples: ['Asha', 'Banarasi silk saree, plum'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [
          { type: 'QUICK_REPLY', text: 'View my cart' },
          { type: 'QUICK_REPLY', text: 'Stop reminders' },
        ],
        submit: true,
      },
    },
    {
      kind: 'standard',
      purpose:
        'Limited-time offer with a copy-code coupon, sent in the chat after the shopper opts in to offers.',
      input: {
        name: TEMPLATES.festiveOffer,
        language: 'en',
        category: 'MARKETING',
        body_text:
          'Hi {{1}}, your festive coupon is ready: {{2}} off handloom sarees, bedding and more at Indigo Loom. Copy the code and use it at checkout in this chat.',
        body_examples: ['Asha', '₹200'],
        limited_time_offer: { text: 'Festive offer', has_expiration: true },
        buttons: [
          { type: 'COPY_CODE', example: 'FESTIVE200' },
          { type: 'URL', text: 'See the collection', url: 'https://lazyapp.in' },
        ],
        submit: true,
      },
    },
  ],
  flows: [
    {
      key: FLOWS.returns,
      purpose:
        'Return or exchange a delivered item. The data endpoint lists the order items and prices the refund.',
      categories: ['CUSTOMER_SUPPORT'],
      flowJson: loadFlowJson(new URL('../flows/returns.json', import.meta.url)),
      dataExchange: true,
    },
    {
      key: FLOWS.address,
      purpose: 'Address form for numbers outside India, where WhatsApp address messages are not available.',
      categories: ['SHOPPING'],
      flowJson: loadFlowJson(new URL('../flows/address.json', import.meta.url)),
      dataExchange: false,
    },
  ],
  webhookEvents: ['payment.captured', 'payment.failed', 'message.failed'],
  requires: { catalog: 'optional', payments: 'optional', addressMessages: true },
  command: { name: 'shop', description: 'A complete store in WhatsApp: browse, pay, track, return' },
  qrPrefill: 'DEMO SHOP',
};
