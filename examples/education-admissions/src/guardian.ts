import { createHash } from 'node:crypto';
import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { COUNSELLORS, counsellorFor } from './catalog.js';
import { slotLabel } from './counselling.js';
import type { Ctx, StudentSnapshot } from './context.js';
import { counsellorCard, snapshotKey } from './context.js';
import { intakeLabel, parseIntakeKey } from './finder.js';
import { showMenu } from './menu.js';

/**
 * Parents follow a student's application without the shared number ever messaging them
 * first: the student forwards a private link, the parent sends its prefilled text, and from
 * then on the parent pulls status on demand. Parents see progress, never the documents.
 */

export const GUARDIAN_IDS = {
  refresh: 'guardian:refresh',
  counsellor: 'guardian:counsellor',
} as const;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const inviteKey = (code: string) => `guardian-invite:${code}`;

interface Invite {
  readonly studentAddress: string;
  readonly studentName: string;
  readonly guardianName: string;
  /** Digits only; null when the student did not share a number. */
  readonly guardianPhone: string | null;
  readonly expiresAt: string;
}

export async function startInvite(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'guardian-invite' }));
  await ctx.send.text(
    "Let a parent or guardian follow your application.\n\nShare their contact card (tap 📎 → *Contact*), or type their WhatsApp number. I'll make a private link that only they can use. We never message them unless they open it.",
  );
}

export async function onGuardianContact(
  ctx: Ctx,
  contacts: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  const [card] = contacts;
  const name = readName(card) ?? 'your parent';
  const phone = readPhone(card);
  return createInvite(ctx, name, phone);
}

export async function onGuardianNumber(ctx: Ctx, text: string): Promise<void> {
  const digits = text.replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 13) {
    await ctx.send.text(
      'That does not look like a phone number. Share a contact card, or type a number like +91 98765 43210.',
    );
    return;
  }
  return createInvite(ctx, 'your parent', digits.length === 10 ? `91${digits}` : digits);
}

async function createInvite(ctx: Ctx, guardianName: string, guardianPhone: string | null): Promise<void> {
  if (
    guardianPhone !== null &&
    ctx.user.phone !== null &&
    guardianPhone === ctx.user.phone.replace(/\D/g, '')
  ) {
    await ctx.send.text("That's your own number. Share your parent's contact instead.");
    return;
  }
  const code = inviteCode(ctx.idempotencyKey('guardian-invite'));
  const invite: Invite = {
    studentAddress: ctx.user.address,
    studentName: ctx.user.displayName ?? 'Your child',
    guardianName,
    guardianPhone,
    expiresAt: new Date(ctx.now().getTime() + INVITE_TTL_MS).toISOString(),
  };
  ctx.kv.set(inviteKey(code), invite);
  ctx.setState((state) => ({
    ...state,
    step: 'menu',
    guardianInvite: { code, name: guardianName, phone: guardianPhone },
  }));
  const prefill = `DEMO ADMISSIONS PARENT ${code}`;
  const business = ctx.state.businessNumber?.replace(/\D/g, '') ?? '';
  const who = guardianName === 'your parent' ? 'your parent' : guardianName;
  if (business === '') {
    await ctx.send.text(`Ask ${who} to send *${prefill}* to this number. The code works for 7 days.`);
    return;
  }
  await ctx.send.cta({
    header: 'Parent link',
    body: `Forward this message to ${who}. When they tap the button and send the pre-filled message, they'll see your application progress: shortlist, counselling, documents and fees.${guardianPhone === null ? '' : ` Only ${maskPhone(guardianPhone)} can use it.`} The link expires in 7 days.`,
    displayText: 'Follow application',
    url: `https://wa.me/${business}?text=${encodeURIComponent(prefill)}`,
    footer: DEMO_FOOTER,
  });
}

/** The start code carried a parent code: link this session to the student, if the code is theirs to use. */
export async function startAsGuardian(ctx: Ctx, code: string): Promise<boolean> {
  const invite = ctx.kv.get<Invite>(inviteKey(code));
  if (invite === undefined || new Date(invite.expiresAt) <= ctx.now()) {
    await ctx.send.text(
      'This parent link has expired or is not valid. Ask your child to send a new one from their chat.',
    );
    return false;
  }
  if (invite.studentAddress === ctx.user.address) {
    await ctx.send.text('That is your own parent link: forward it to your parent instead.');
    return false;
  }
  const phone = ctx.user.phone?.replace(/\D/g, '') ?? null;
  if (invite.guardianPhone !== null && phone !== invite.guardianPhone) {
    await ctx.send.text(
      `This link was created for ${maskPhone(invite.guardianPhone)}. Ask ${invite.studentName} to share your contact again.`,
    );
    return false;
  }
  ctx.setState((state) => ({
    ...state,
    role: 'guardian',
    linkedStudent: { address: invite.studentAddress, name: invite.studentName, code },
  }));
  await showGuardianStatus(
    ctx,
    `Welcome! You're following *${invite.studentName}*'s study-abroad application with BrightPath.`,
  );
  return true;
}

export async function showGuardianStatus(ctx: Ctx, intro?: string): Promise<void> {
  const linked = ctx.state.linkedStudent;
  if (linked === null) {
    return showMenu(ctx);
  }
  const snapshot = ctx.kv.get<StudentSnapshot>(snapshotKey(linked.address));
  const intake =
    snapshot?.intake === null || snapshot?.intake === undefined ? null : parseIntakeKey(snapshot.intake);
  const counsellor =
    snapshot?.counselling === null || snapshot?.counselling === undefined
      ? null
      : COUNSELLORS.find((entry) => entry.id === snapshot.counselling?.counsellorId);
  const lines =
    snapshot === undefined
      ? ['No updates yet. Check back after the first counselling call.']
      : [
          `🎓 ${snapshot.program ?? 'Still shortlisting programs'}${intake === null ? '' : ` · ${intakeLabel(intake)} intake`}`,
          `📝 Application: ${statusLabel(snapshot)}`,
          `📄 Documents: ${snapshot.documentsDone} of ${snapshot.documentsTotal}`,
          snapshot.counselling === null
            ? '🗣️ Counselling: not booked yet'
            : `🗣️ Counselling with ${counsellor?.name ?? 'a counsellor'}: ${slotLabel(snapshot.counselling.date, snapshot.counselling.time)}`,
          `Updated ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(snapshot.updatedAt))}`,
        ];
  await ctx.send.buttons({
    header: `${linked.name}'s application`,
    body: `${intro === undefined ? '' : `${intro}\n\n`}${lines.join('\n')}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: GUARDIAN_IDS.refresh, title: 'Refresh status' },
      { id: GUARDIAN_IDS.counsellor, title: 'Counsellor contact' },
      { id: RESERVED_IDS.exit, title: 'Done' },
    ],
  });
}

export async function onGuardianCounsellor(ctx: Ctx): Promise<void> {
  const linked = ctx.state.linkedStudent;
  const snapshot = linked === null ? undefined : ctx.kv.get<StudentSnapshot>(snapshotKey(linked.address));
  const counsellor =
    COUNSELLORS.find((entry) => entry.id === snapshot?.counselling?.counsellorId) ?? counsellorFor(null);
  const card = counsellorCard(ctx, counsellor);
  if (card === null) {
    await ctx.send.text(`Your counsellor is ${counsellor.name}. Reply here and the team will connect you.`);
    return;
  }
  await ctx.send.contacts([card]);
}

function statusLabel(snapshot: StudentSnapshot): string {
  switch (snapshot.applicationStatus) {
    case 'submitted':
      return snapshot.feePaid ? 'being filed (fee paid)' : 'being filed (fee due at counselling)';
    case 'awaiting_payment':
    case 'fee_pending':
      return 'started, fee pending';
    case null:
      return 'not started';
  }
}

function inviteCode(seed: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    createHash('sha256').update(seed).digest().subarray(0, 6),
    (byte) => alphabet[byte % alphabet.length],
  ).join('');
}

function readName(card: Readonly<Record<string, unknown>> | undefined): string | null {
  const name = card?.name;
  if (typeof name === 'object' && name !== null) {
    const record = name as Record<string, unknown>;
    const value = record.formatted_name ?? record.first_name;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  return null;
}

function readPhone(card: Readonly<Record<string, unknown>> | undefined): string | null {
  const phones = card?.phones;
  if (!Array.isArray(phones)) {
    return null;
  }
  for (const entry of phones as unknown[]) {
    if (typeof entry === 'object' && entry !== null) {
      const record = entry as Record<string, unknown>;
      const value = record.wa_id ?? record.phone;
      if (typeof value === 'string') {
        const digits = value.replace(/\D/g, '');
        if (digits.length >= 10) {
          return digits.length === 10 ? `91${digits}` : digits;
        }
      }
    }
  }
  return null;
}

function maskPhone(digits: string): string {
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)}••••${digits.slice(-3)}`;
}
