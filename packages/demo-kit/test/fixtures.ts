import { z } from 'zod';
import { defineExample } from '../src/index.js';

export interface CounterState {
  readonly count: number;
  readonly lastPayment: string | null;
}

/** A tiny example that echoes and counts, with every hook wired, for router tests. */
export const counter = defineExample<CounterState>({
  id: 'counter',
  title: 'Counter',
  startCode: 'DEMO COUNT',
  manifest: {
    webhookEvents: ['payment.captured', 'message.failed'],
    command: { name: 'count', description: 'Counter demo' },
    flows: [
      {
        key: 'pick',
        purpose: 'test',
        categories: ['OTHER'],
        flowJson: {
          version: '7.0',
          screens: [{ id: 'PICK', terminal: true, layout: { type: 'SingleColumnLayout', children: [] } }],
        },
        dataExchange: true,
      },
    ],
  },
  stateSchema: z.object({ count: z.number().int(), lastPayment: z.string().nullable() }),
  initialState: () => ({ count: 0, lastPayment: null }),
  describe: () => ({ summary: 'Counts your messages.', metaFeatures: ['Text'], emoji: '🔢' }),
  async onStart(ctx) {
    await ctx.send.text('Counter started');
  },
  async onMessage(ctx, inbound) {
    if (inbound.kind === 'text' && inbound.text === 'boom') {
      ctx.setState((state) => ({ ...state, count: state.count + 100 }));
      throw new Error('kaboom');
    }
    if (inbound.kind === 'text' && inbound.text === 'flow') {
      await ctx.flows.send({ key: 'pick', body: 'Pick one', cta: 'Open' });
      return;
    }
    if (inbound.kind === 'text' && inbound.text === 'bye') {
      await ctx.send.text('Ending now');
      await ctx.end();
      return;
    }
    ctx.setState((state) => ({ ...state, count: state.count + 1 }));
    await ctx.send.text(`Count: ${ctx.state.count}`);
    await ctx.send.text('Second message');
  },
  async onMenu(ctx) {
    await ctx.send.text(`Menu (count ${ctx.state.count})`);
  },
  async onEvent(ctx, event) {
    if (event.type === 'payment.captured') {
      const payment = event.data.payment as { reference_id: string };
      ctx.setState((state) => ({ ...state, lastPayment: payment.reference_id }));
      await ctx.send.text(`Paid ${payment.reference_id}`);
    }
  },
  flowEndpoints: {
    async pick(ctx, request) {
      if (request.action === 'INIT') {
        return { screen: 'PICK', data: { options: ['a', 'b'], count: ctx.state.count } };
      }
      ctx.setState((state) => ({ ...state, count: state.count + 10 }));
      return {
        screen: 'SUCCESS',
        data: {
          extension_message_response: {
            params: { flow_token: request.flow_token, picked: request.data?.choice },
          },
        },
      };
    },
  },
});

export const other = defineExample<null>({
  id: 'other',
  title: 'Other',
  startCode: 'DEMO OTHER',
  manifest: {},
  initialState: () => null,
  describe: () => ({ summary: 'Another demo.', metaFeatures: [] }),
  async onStart(ctx) {
    await ctx.send.text('Other started');
  },
  async onMessage(ctx) {
    await ctx.send.text('Other says hi');
  },
});
