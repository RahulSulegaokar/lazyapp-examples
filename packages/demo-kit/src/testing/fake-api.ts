import type { CatalogProduct, Flow, PaymentConfiguration, PaymentOrder } from '@lazyapp-examples/sdk';

/** One HTTP call the code under test made to LazyApp. */
export interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly idempotencyKey: string | null;
}

export interface FakeResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type FakeHandler = (
  call: ApiCall,
  params: Readonly<Record<string, string>>,
) => FakeResponse | Promise<FakeResponse>;

export interface FakeLazyAppOptions {
  /** Products `GET /v1/catalog/products` returns. Empty/undefined = no catalog connected (422). */
  readonly catalog?: readonly CatalogProduct[] | undefined;
  readonly catalogId?: string | undefined;
  /** Name of an active payment configuration. Undefined = none set up. */
  readonly paymentConfiguration?: string | undefined;
  /** Flows `GET /v1/flows` lists. The harness fills this from the example manifest. */
  readonly flows?: readonly Flow[] | undefined;
}

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly keys: readonly string[];
  readonly handler: FakeHandler;
}

/**
 * An in-memory LazyApp that speaks HTTP through an injected `fetch`. The real SDK
 * runs against it, so tests exercise the exact requests production would send.
 * Override any route with `on(method, '/v1/path/:param', handler)`.
 */
export class FakeLazyApp {
  readonly calls: ApiCall[] = [];
  private readonly routes: Route[] = [];
  private sequence = 0;
  /** Payments created through `POST /v1/payments`, by id. */
  readonly payments = new Map<string, PaymentOrder>();
  /** Scheduled messages still pending, by id. */
  readonly scheduled = new Map<string, unknown>();

  constructor(private readonly options: FakeLazyAppOptions = {}) {
    this.installDefaults();
  }

  /** Registers a handler; later registrations win. */
  on(method: string, path: string, handler: FakeHandler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:[a-zA-Z_]+/g, (match) => {
        keys.push(match.slice(1));
        return '([^/]+)';
      })}$`,
    );
    this.routes.unshift({ method: method.toUpperCase(), pattern, keys, handler });
    return this;
  }

  /** The `fetch` to pass to `LazyAppClient`. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const call: ApiCall = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      idempotencyKey: headers.get('idempotency-key'),
    };
    this.calls.push(call);
    for (const route of this.routes) {
      const match = route.method === call.method ? route.pattern.exec(call.path) : null;
      if (match !== null) {
        const params = Object.fromEntries(
          route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? '')]),
        );
        const response = await route.handler(call, params);
        return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
          status: response.status,
          headers: { 'content-type': 'application/json', ...response.headers },
        });
      }
    }
    return new Response(
      JSON.stringify({ message: `FakeLazyApp has no route for ${call.method} ${call.path}` }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  private installDefaults(): void {
    const sentByKey = new Map<string, unknown>();

    this.on('POST', '/v1/messages', (call) => {
      const body = call.body as { type?: string; send_at?: string };
      const replay = call.idempotencyKey === null ? undefined : sentByKey.get(call.idempotencyKey);
      if (replay !== undefined) {
        return { status: body.send_at === undefined ? 201 : 202, body: replay };
      }
      let response: unknown;
      if (body.send_at !== undefined) {
        const id = this.nextId('sch');
        this.scheduled.set(id, call.body);
        response = { id, status: 'scheduled', send_at: body.send_at };
      } else {
        const id = this.nextId('msg');
        response = {
          uuid: id,
          status: 'sent',
          type: body.type ?? 'text',
          provider_message_id: `wamid.${id}`,
        };
      }
      if (call.idempotencyKey !== null) {
        sentByKey.set(call.idempotencyKey, response);
      }
      return { status: body.send_at === undefined ? 201 : 202, body: response };
    });

    this.on('DELETE', '/v1/messages/scheduled/:id', (_call, params) => {
      const id = params.id ?? '';
      return this.scheduled.delete(id) ? { status: 204 } : { status: 404, body: { message: 'Not found' } };
    });

    this.on('POST', '/v1/messages/:uuid/read', (call, params) => ({
      status: 200,
      body: {
        uuid: params.uuid,
        read: true,
        typing: (call.body as { typing?: boolean } | undefined)?.typing ?? false,
      },
    }));

    this.on('GET', '/v1/flows', () => ({
      status: 200,
      body: { data: this.options.flows ?? [], next_cursor: null },
    }));

    this.on('GET', '/v1/catalog/products', () =>
      this.options.catalog === undefined || this.options.catalog.length === 0
        ? { status: 422, body: { message: 'No catalog is connected to this number.' } }
        : {
            status: 200,
            body: {
              catalog_id: this.options.catalogId ?? 'catalog_1',
              data: this.options.catalog,
              next_cursor: null,
            },
          },
    );

    this.on('GET', '/v1/payments/configurations', () => ({
      status: 200,
      body: {
        data:
          this.options.paymentConfiguration === undefined
            ? []
            : [
                {
                  id: 'cfg_1',
                  configuration_name: this.options.paymentConfiguration,
                  provider: 'razorpay',
                  status: 'active',
                } satisfies PaymentConfiguration,
              ],
      },
    }));

    this.on('POST', '/v1/payments', (call) => {
      const input = call.body as {
        to: string;
        reference_id?: string;
        items: { amount: number; quantity: number }[];
        shipping?: { amount: number };
        discount?: { amount: number };
        tax?: { amount: number };
        payment: { method: PaymentOrder['payment_method']; configuration?: string };
        metadata?: Record<string, string>;
      };
      const subtotal = input.items.reduce((sum, item) => sum + item.amount * item.quantity, 0);
      const total =
        subtotal + (input.shipping?.amount ?? 0) + (input.tax?.amount ?? 0) - (input.discount?.amount ?? 0);
      const id = this.nextId('pay');
      const order: PaymentOrder = {
        id,
        reference_id: input.reference_id ?? id,
        to: input.to.replace(/^\+/, ''),
        status: 'pending',
        payment_status: 'pending',
        payment_method: input.payment.method,
        payment_configuration: input.payment.configuration ?? null,
        payment_link: input.payment.method === 'payment_gateway' ? null : `https://pay.example/${id}`,
        currency: 'INR',
        total_amount: total,
        amount_paid: 0,
        amount_refunded: 0,
        message_id: this.nextId('msg'),
        metadata: input.metadata ?? null,
        created_at: new Date(0).toISOString(),
      };
      this.payments.set(id, order);
      return { status: 201, body: order };
    });

    this.on('GET', '/v1/payments/:id', (_call, params) => {
      const order = this.payments.get(params.id ?? '');
      return order === undefined
        ? { status: 404, body: { message: 'Not found' } }
        : { status: 200, body: order };
    });

    this.on('POST', '/v1/payments/:id/status', (call, params) => {
      const order = this.payments.get(params.id ?? '');
      if (order === undefined) {
        return { status: 404, body: { message: 'Not found' } };
      }
      const updated = { ...order, status: (call.body as { status: PaymentOrder['status'] }).status };
      this.payments.set(order.id, updated);
      return { status: 200, body: updated };
    });

    this.on('POST', '/v1/contacts/:uuid/consent', () => ({ status: 201, body: { status: 'recorded' } }));
    this.on('POST', '/v1/contacts/:uuid/tags', (call, params) => ({
      status: 200,
      body: { uuid: params.uuid, phone_number: null, tags: (call.body as { tags: string[] }).tags },
    }));
    this.on('DELETE', '/v1/contacts/:uuid/tags', () => ({ status: 204 }));
    this.on('POST', '/v1/contacts', (call) => ({
      status: 201,
      body: { uuid: this.nextId('contact'), ...(call.body as object) },
    }));
    this.on('POST', '/v1/events', (call) => ({
      status: 201,
      body: { uuid: this.nextId('msg'), status: 'sent', type: (call.body as { type: string }).type },
    }));
  }
}
