import { publicAssetUrl } from '@lazyapp-examples/demo-kit';
import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import type { ClinicState } from './state.js';

export type Ctx = ExampleContext<ClinicState>;

export const EXAMPLE_ID = 'clinic-appointments';

/** Public URL of a file in `examples/clinic-appointments/public/`, served by the demo server at `/public/clinic-appointments/<file>`. */
export function assetUrl(ctx: Ctx, file: string): string {
  return publicAssetUrl(ctx.config.publicBaseUrl, EXAMPLE_ID, file);
}

/** First name for a friendly greeting, when WhatsApp shared one. */
export function firstName(ctx: Ctx): string | null {
  return ctx.user.displayName?.trim().split(/\s+/)[0] ?? null;
}
