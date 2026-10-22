import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import type { LeadGenConfig } from './config.js';
import type { LeadState } from './state.js';

export type Ctx = ExampleContext<LeadState>;

/** What handlers need beyond `ctx`: configuration, injected so tests control it. */
export interface Deps {
  readonly config: LeadGenConfig;
}
