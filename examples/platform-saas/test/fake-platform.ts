import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import type { PlatformCustomer } from '@lazyapp-examples/sdk';

/** The secret parts LazyApp returns; tests assert they never reach logs or storage. */
export const SETUP_SECRET = 'set_tok_SECRET';
export const EMBED_SECRET = 'emb_tok_SECRET';

/**
 * LazyApp's Platform API on the harness's fake server, with the response shapes LazyApp's source
 * returns (usage analytics, cursor pages).
 */
export function installFakePlatform<S>(h: Harness<S>, options: { readonly embedOrigin?: string } = {}) {
  const customers = new Map<string, PlatformCustomer>();
  const deleted: string[] = [];

  h.api.on('GET', '/v1/platform/customers', (call) => ({
    status: 200,
    body: {
      data: [...customers.values()].filter(
        (customer) => call.query.external_id === undefined || customer.external_id === call.query.external_id,
      ),
      next_cursor: null,
    },
  }));
  h.api.on('POST', '/v1/platform/customers', (call) => {
    const input = call.body as { name: string; external_id: string; billing_mode: 'inherit' };
    const customer: PlatformCustomer = {
      id: h.api.nextId('cus'),
      external_id: input.external_id,
      name: input.name,
      status: 'active',
      billing_mode: input.billing_mode,
      connections: [],
    };
    customers.set(customer.id, customer);
    return { status: 201, body: customer };
  });
  h.api.on('DELETE', '/v1/platform/customers/:id', (_call, params) => {
    deleted.push(params.id ?? '');
    return customers.delete(params.id ?? '')
      ? { status: 204 }
      : { status: 404, body: { message: 'Not found' } };
  });
  h.api.on('GET', '/v1/platform/customers/:id/usage', () => ({
    status: 200,
    body: {
      totals: { messages: 42, freeMessages: 30, paidMessages: 12, totalCharge: '9.840000', currency: 'INR' },
      byCategory: [
        { category: 'utility', messages: 30, totalCharge: '4.20' },
        { category: 'marketing', messages: 12, totalCharge: '5.64' },
      ],
      daily: [],
      billing_mode: 'inherit',
      wallet_balance_cents: 0,
      spending_limit_cents: null,
    },
  }));
  h.api.on('POST', '/v1/platform/setup-links', (call) => {
    const id = h.api.nextId('set');
    return {
      status: 201,
      body: {
        id,
        customer_id: (call.body as { customer_id: string }).customer_id,
        url: `https://lazyapp.test/connect/${SETUP_SECRET}`,
        token: SETUP_SECRET,
        expires_at: '2026-10-24T09:00:00+05:30',
        use_policy: 'single',
        use_count: 0,
        allowed_connection_type: 'new',
        usable: true,
      },
    };
  });
  h.api.on('POST', '/v1/platform/embed-tokens', (call) => ({
    status: 201,
    body: {
      id: h.api.nextId('emb'),
      component: (call.body as { component: string }).component,
      url: `${options.embedOrigin ?? 'https://lazyapp.test'}/embed/${EMBED_SECRET}`,
      token: EMBED_SECRET,
      expires_at: '2026-10-23T09:10:00+05:30',
    },
  }));
  h.api.on('PUT', '/v1/automation-packs/provision', () => ({
    status: 200,
    body: {
      event_mappings: { created: 3, updated: 0, skipped: 0, mappings: [] },
      workflows: { created: 2, skipped: 0, items: [] },
      flows: { created: 1, skipped: 0, items: [] },
    },
  }));

  return { customers, deleted };
}
