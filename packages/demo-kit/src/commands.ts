import type { Inbound } from './inbound.js';
import { RESERVED_IDS } from './example.js';

/** What the router understood an inbound message to be, before any example sees it. */
export type Command =
  | { readonly type: 'start'; readonly exampleId: string }
  | { readonly type: 'hub'; readonly page: number }
  | { readonly type: 'menu' }
  | { readonly type: 'exit' }
  | { readonly type: 'stop' }
  | { readonly type: 'none' };

export interface StartCodeEntry {
  readonly exampleId: string;
  readonly startCode: string;
  readonly command?: string | undefined;
}

/** Upper-cases, folds whitespace and trims punctuation: `"  demo   shop! "` → `"DEMO SHOP"`. */
export function normalizeCommandText(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’.,!?:;*_~-]+|[\s"'“”‘’.,!?:;*_~-]+$/g, '');
}

/**
 * Matches start codes as the whole message or its leading words, so a QR prefill
 * ("DEMO SHOP - I want to see the store") and a `/shop` command both start the demo.
 * The longest code wins, so "DEMO SHOP" beats a hub code "DEMO".
 */
export class CommandParser {
  private readonly codes: { readonly code: string; readonly exampleId: string }[];

  constructor(
    entries: readonly StartCodeEntry[],
    private readonly hubCodes: readonly string[] = ['DEMO', 'DEMOS'],
  ) {
    this.codes = entries
      .flatMap((entry) => [
        { code: normalizeCommandText(entry.startCode), exampleId: entry.exampleId },
        ...(entry.command === undefined
          ? []
          : [{ code: normalizeCommandText(`/${entry.command}`), exampleId: entry.exampleId }]),
      ])
      .sort((a, b) => b.code.length - a.code.length);
    const seen = new Map<string, string>();
    for (const { code, exampleId } of this.codes) {
      const owner = seen.get(code);
      if (owner !== undefined && owner !== exampleId) {
        throw new Error(`Start code "${code}" is used by both "${owner}" and "${exampleId}"`);
      }
      seen.set(code, exampleId);
    }
  }

  /** Recognises start codes and the hub code. Safe to call for anyone: it never implies a session. */
  parseEntry(inbound: Inbound): Command {
    const id = interactiveId(inbound);
    if (id?.startsWith(RESERVED_IDS.startPrefix) === true) {
      return { type: 'start', exampleId: id.slice(RESERVED_IDS.startPrefix.length) };
    }
    if (id?.startsWith(RESERVED_IDS.hub) === true) {
      return { type: 'hub', page: Number(id.slice(RESERVED_IDS.hub.length + 1)) || 1 };
    }
    if (inbound.kind !== 'text') {
      return { type: 'none' };
    }
    const text = normalizeCommandText(inbound.text);
    for (const { code, exampleId } of this.codes) {
      if (text === code || startsWithWord(text, code)) {
        return { type: 'start', exampleId };
      }
    }
    if (this.hubCodes.some((code) => text === normalizeCommandText(code))) {
      return { type: 'hub', page: 1 };
    }
    return { type: 'none' };
  }

  /** Global commands, honoured only inside an active session. */
  parseInSession(inbound: Inbound): Command {
    const entry = this.parseEntry(inbound);
    if (entry.type !== 'none') {
      return entry;
    }
    const id = interactiveId(inbound);
    if (id === RESERVED_IDS.menu) {
      return { type: 'menu' };
    }
    if (id === RESERVED_IDS.exit) {
      return { type: 'exit' };
    }
    // Typed commands, and template quick replies whose label is the command.
    const text = inbound.kind === 'text' ? inbound.text : inbound.kind === 'button' ? inbound.title : null;
    if (text === null) {
      return { type: 'none' };
    }
    switch (normalizeCommandText(text)) {
      case 'MENU':
        return { type: 'menu' };
      case 'EXIT':
        return { type: 'exit' };
      case 'STOP':
        return { type: 'stop' };
      default:
        return { type: 'none' };
    }
  }
}

function startsWithWord(text: string, code: string): boolean {
  if (!text.startsWith(code)) {
    return false;
  }
  const next = text.charAt(code.length);
  return next === ' ' || /[:\-–—,.!|]/.test(next);
}

function interactiveId(inbound: Inbound): string | null {
  return inbound.kind === 'button' || inbound.kind === 'list' ? inbound.id : null;
}
