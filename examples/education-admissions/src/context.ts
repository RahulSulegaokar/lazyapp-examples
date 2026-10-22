import { publicAssetUrl } from '@lazyapp-examples/demo-kit';
import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import type { ContactCard } from '@lazyapp-examples/sdk';
import { documentsFor, findProgram } from './catalog.js';
import type { Counsellor } from './catalog.js';
import type { AdmissionsState, Application } from './state.js';

export type Ctx = ExampleContext<AdmissionsState>;

export const EXAMPLE_ID = 'education-admissions';

/** Public URL of a file in `examples/education-admissions/public/`, served by the demo server at `/public/education-admissions/<file>`. */
export function assetUrl(ctx: Ctx, file: string): string {
  return publicAssetUrl(ctx.config.publicBaseUrl, EXAMPLE_ID, file);
}

export function firstName(ctx: Ctx): string | null {
  return ctx.user.displayName?.trim().split(/\s+/)[0] ?? null;
}

/** Tags a LazyApp contact for segments and broadcasts. Best effort: never blocks the chat. */
export async function tagContact(
  ctx: Ctx,
  add: readonly string[],
  remove: readonly string[] = [],
): Promise<void> {
  const contact = ctx.user.contactUuid;
  if (contact === null) {
    return;
  }
  try {
    if (remove.length > 0) {
      await ctx.api.contacts.removeTags(contact, remove);
    }
    if (add.length > 0) {
      await ctx.api.contacts.addTags(contact, add);
    }
  } catch (error) {
    ctx.log.warn('could not tag the contact', { error, add, remove });
  }
}

/** The counsellor's card. Calls and chats go to the demo number itself, never a made-up one. */
export function counsellorCard(ctx: Ctx, counsellor: Counsellor): ContactCard | null {
  const number = ctx.state.businessNumber;
  if (number === null) {
    return null;
  }
  const [first = counsellor.name, ...rest] = counsellor.name.split(' ');
  return {
    name: { formatted_name: `${counsellor.name} (BrightPath)`, first_name: first, last_name: rest.join(' ') },
    org: { company: 'BrightPath Overseas Education', title: 'Admissions counsellor' },
    phones: [{ phone: number, type: 'WORK', wa_id: number.replace(/\D/g, '') }],
  };
}

/** What a parent may see: progress, never the documents themselves. */
export interface StudentSnapshot {
  readonly studentName: string;
  readonly program: string | null;
  readonly intake: string | null;
  readonly applicationStatus: Application['status'] | null;
  readonly feePaid: boolean;
  readonly documentsDone: number;
  readonly documentsTotal: number;
  readonly counselling: {
    readonly date: string;
    readonly time: string;
    readonly counsellorId: string;
  } | null;
  readonly updatedAt: string;
}

export const snapshotKey = (address: string) => `student:${address}`;

/** Keeps the parent view current. Called after every student turn once a parent link exists. */
export function publishSnapshot(ctx: Ctx): void {
  const state = ctx.state;
  if (state.role !== 'student' || state.guardianInvite === null) {
    return;
  }
  const application = state.application;
  const program = application === null ? undefined : findProgram(application.programId);
  const required = documentsFor(state.profile.level);
  const snapshot: StudentSnapshot = {
    studentName: ctx.user.displayName ?? 'Your child',
    program: program === undefined ? null : `${program.name}, ${program.university}`,
    intake: application?.intake ?? null,
    applicationStatus: application?.status ?? null,
    feePaid: application?.status === 'submitted' && application.payMode === 'online',
    documentsDone: required.filter((document) => state.documents[document.id] !== undefined).length,
    documentsTotal: required.length,
    counselling:
      state.counselling?.confirmed === true
        ? {
            date: state.counselling.date,
            time: state.counselling.time,
            counsellorId: state.counselling.counsellorId,
          }
        : null,
    updatedAt: ctx.now().toISOString(),
  };
  ctx.kv.set(snapshotKey(ctx.user.address), snapshot);
}
