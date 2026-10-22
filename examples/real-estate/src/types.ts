import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import type { RealEstateConfig } from './config.js';
import type { RealEstateState } from './state.js';

export type Ctx = ExampleContext<RealEstateState>;

/** What handlers need beyond `ctx`: configuration, injected so tests control it. */
export interface Deps {
  readonly config: RealEstateConfig;
}
