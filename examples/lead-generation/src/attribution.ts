import { DIRECT } from './state.js';
import type { Attribution } from './state.js';

/**
 * Where a lead came from, from what WhatsApp hands us on the first message:
 *
 * - a Click-to-WhatsApp ad adds a `referral` (ad id, headline, `ctwa_clid`) to the message;
 * - QR codes and website chat links carry tags in the prefilled text, e.g.
 *   `DEMO LEADS src=qr-expo cmp=gst-week` or `DEMO LEADS utm_source=linkedin`.
 *
 * Ads win over text, because the referral is set by Meta and cannot be typed.
 */
export function parseAttribution(
  referral: Readonly<Record<string, unknown>> | null,
  text: string | null,
): Attribution {
  if (referral !== null && Object.keys(referral).length > 0) {
    return {
      channel: 'ad',
      source: adPlatform(str(referral.source_url)),
      medium: str(referral.source_type) ?? 'ad',
      campaign: null,
      adId: str(referral.source_id),
      headline: str(referral.headline),
      ctwaClid: str(referral.ctwa_clid),
    };
  }
  const params = new Map<string, string>();
  for (const match of (text ?? '').matchAll(/\b([a-z_]+)=([\w.-]{1,64})/gi)) {
    params.set((match[1] ?? '').toLowerCase(), match[2] ?? '');
  }
  const source = params.get('utm_source') ?? params.get('src') ?? null;
  const medium = params.get('utm_medium') ?? params.get('med') ?? null;
  const campaign = params.get('utm_campaign') ?? params.get('cmp') ?? null;
  if (source === null && medium === null && campaign === null) {
    return DIRECT;
  }
  const isQr = medium === 'qr' || source?.startsWith('qr') === true;
  return { ...DIRECT, channel: isQr ? 'qr' : 'link', source, medium, campaign };
}

function adPlatform(url: string | null): string {
  if (url === null) {
    return 'meta';
  }
  return url.includes('instagram.com') ? 'instagram' : /fb\.me|facebook\.com/.test(url) ? 'facebook' : 'meta';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** One line for the welcome message, so the lead sees we know the context. */
export function greetingFor(attribution: Attribution): string {
  switch (attribution.channel) {
    case 'ad':
      return attribution.headline === null
        ? 'Thanks for tapping our ad.'
        : `Thanks for tapping our ad “${attribution.headline}”.`;
    case 'qr':
      return 'Thanks for scanning our QR code.';
    case 'link':
      return attribution.source === null
        ? 'Thanks for reaching out.'
        : `Thanks for coming over from ${attribution.source}.`;
    case 'direct':
      return 'Thanks for reaching out.';
  }
}
