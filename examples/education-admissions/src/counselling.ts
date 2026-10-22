import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { COUNSELLORS, counsellorFor } from './catalog.js';
import type { Counsellor } from './catalog.js';
import type { Ctx } from './context.js';
import { counsellorCard, firstName } from './context.js';
import { TEMPLATE_PAYLOADS, TEMPLATES } from './manifest.js';
import { MENU_IDS } from './menu.js';
import type { Counselling } from './state.js';

export const COUNSEL_IDS = {
  slotPrefix: 'counsel:slot:',
  modePrefix: 'counsel:mode:',
  change: 'counsel:change',
  remind: 'counsel:remind',
} as const;

/** BrightPath's Pune office, for in-person sessions. */
export const OFFICE = {
  latitude: 18.5158,
  longitude: 73.9272,
  name: 'BrightPath Overseas Education',
  address: '5th floor, Pentagon P2, Magarpatta City, Hadapsar, Pune 411013',
} as const;

const SESSION_TIMES = ['11:00', '15:00', '18:30'] as const;
const LEAD_MS = 2 * 60 * 60 * 1000;
const IST = 'Asia/Kolkata';

const slotKey = (counsellorId: string, date: string, time: string) =>
  `counsel:${counsellorId}:${date}:${time}`;
const startOf = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export function slotLabel(date: string, time: string): string {
  const instant = startOf(date, time);
  const day = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(instant);
  const clock = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(instant)
    .toUpperCase();
  return `${day} · ${clock}`;
}

function timeOnly(date: string, time: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(startOf(date, time))
    .toUpperCase();
}

/** Free sessions on the next three working days (Mon–Sat) for this counsellor. */
export function openSessions(ctx: Ctx, counsellor: Counsellor): { date: string; time: string }[] {
  const sessions: { date: string; time: string }[] = [];
  for (let offset = 0; offset < 7 && new Set(sessions.map((entry) => entry.date)).size < 3; offset += 1) {
    const day = new Date(ctx.now().getTime() + offset * 24 * 60 * 60 * 1000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(day);
    if (startOf(date, '12:00').getUTCDay() === 0) {
      continue;
    }
    for (const time of SESSION_TIMES) {
      const taken = ctx.kv.get<{ address: string }>(slotKey(counsellor.id, date, time));
      const future = startOf(date, time).getTime() >= ctx.now().getTime() + LEAD_MS;
      if (future && (taken === undefined || taken.address === ctx.user.address)) {
        sessions.push({ date, time });
      }
    }
  }
  return sessions.slice(0, 9);
}

export async function showCounselling(ctx: Ctx): Promise<void> {
  const booked = ctx.state.counselling;
  if (booked?.confirmed === true) {
    const counsellor = COUNSELLORS.find((entry) => entry.id === booked.counsellorId) ?? counsellorFor(null);
    await ctx.send.buttons({
      body: `Your counselling session with *${counsellor.name}* is on *${slotLabel(booked.date, booked.time)}* (${booked.mode === 'office' ? 'at our Pune office' : 'phone call'}).`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: COUNSEL_IDS.change, title: 'Change time' },
        ...(booked.remindersOn ? [] : [{ id: COUNSEL_IDS.remind, title: 'Remind me' }]),
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  return showSessions(ctx);
}

async function showSessions(ctx: Ctx): Promise<void> {
  const counsellor = counsellorFor(ctx.state.profile.country);
  const sessions = openSessions(ctx, counsellor);
  ctx.setState((state) => ({ ...state, step: 'counselling' }));
  if (sessions.length === 0) {
    await ctx.send.buttons({
      body: `${counsellor.name} is fully booked this week. Leave your documents and we will find a time.`,
      footer: DEMO_FOOTER,
      buttons: [{ id: MENU_IDS.documents, title: 'Documents' }],
    });
    return;
  }
  await ctx.send.list({
    header: 'Free counselling (30 min)',
    body: `You'll talk to *${counsellor.name}*. ${counsellor.bio}\n\nWe'll review your profile, shortlist universities, and plan your SOP, tests and visa timeline. Pick a time (IST):`,
    button: 'Pick a time',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Next 3 working days',
        rows: sessions.map(({ date, time }) => ({
          id: `${COUNSEL_IDS.slotPrefix}${date}:${time}`,
          title: slotLabel(date, time),
        })),
      },
    ],
  });
}

export async function onSession(ctx: Ctx, value: string): Promise<void> {
  const match = /^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(value);
  const [, date, time] = match ?? [];
  if (date === undefined || time === undefined) {
    return showSessions(ctx);
  }
  const counsellor = counsellorFor(ctx.state.profile.country);
  const previous = ctx.state.counselling;
  const pick: Counselling = {
    counsellorId: counsellor.id,
    date,
    time,
    mode: null,
    confirmed: false,
    remindersOn: previous?.remindersOn ?? false,
  };
  ctx.setState((state) => ({ ...state, counselling: pick, step: 'counselling' }));
  await ctx.send.buttons({
    body: `${slotLabel(date, time)} with ${counsellor.name}. How would you like to meet?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${COUNSEL_IDS.modePrefix}phone`, title: 'Phone call' },
      { id: `${COUNSEL_IDS.modePrefix}office`, title: 'Visit Pune office' },
    ],
  });
}

export async function onMode(ctx: Ctx, mode: string): Promise<void> {
  const pick = ctx.state.counselling;
  if (pick === null || (mode !== 'phone' && mode !== 'office')) {
    return showSessions(ctx);
  }
  const key = slotKey(pick.counsellorId, pick.date, pick.time);
  const holder = ctx.kv.get<{ address: string }>(key);
  if (holder !== undefined && holder.address !== ctx.user.address) {
    await ctx.send.text(`Sorry, ${slotLabel(pick.date, pick.time)} was just booked by someone else.`);
    return showSessions(ctx);
  }
  releasePreviousSession(ctx, pick);
  ctx.kv.set(key, { address: ctx.user.address, mode, at: ctx.now().toISOString() });
  const booked: Counselling = { ...pick, mode, confirmed: true };
  ctx.setState((state) => ({ ...state, counselling: booked, step: 'menu' }));
  if (booked.remindersOn) {
    await scheduleCounsellingReminder(ctx, booked);
  }
  const counsellor = COUNSELLORS.find((entry) => entry.id === booked.counsellorId) ?? counsellorFor(null);
  if (mode === 'office') {
    await ctx.send.location(OFFICE);
  } else {
    const card = counsellorCard(ctx, counsellor);
    if (card !== null) {
      await ctx.send.contacts([card]);
    }
  }
  await ctx.send.buttons({
    header: 'Counselling booked ✅',
    body: `*${slotLabel(booked.date, booked.time)}* with ${counsellor.name}, ${mode === 'office' ? 'at our Pune office (pin above). Bring your marksheets and passport.' : `by phone on ${ctx.user.phone ?? 'your WhatsApp number'}. Save ${counsellor.name.split(' ')[0] ?? ''}'s card above.`}\n\nSend your documents before the call and we can shortlist universities on the spot.`,
    footer: DEMO_FOOTER,
    buttons: [
      ...(booked.remindersOn ? [] : [{ id: COUNSEL_IDS.remind, title: 'Remind me' }]),
      { id: MENU_IDS.documents, title: 'Upload documents' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

function releasePreviousSession(ctx: Ctx, next: Counselling): void {
  const booked = ctx.kv
    .list<{ address: string }>('counsel:')
    .filter((entry) => entry.value.address === ctx.user.address);
  for (const entry of booked) {
    if (entry.key !== slotKey(next.counsellorId, next.date, next.time)) {
      ctx.kv.delete(entry.key);
    }
  }
}

export async function onChangeSession(ctx: Ctx): Promise<void> {
  return showSessions(ctx);
}

async function scheduleCounsellingReminder(ctx: Ctx, booked: Counselling): Promise<boolean> {
  const sendAt = new Date(startOf(booked.date, booked.time).getTime() - 60 * 60 * 1000);
  if (sendAt.getTime() <= ctx.now().getTime() + 5 * 60 * 1000) {
    return false;
  }
  const counsellor = COUNSELLORS.find((entry) => entry.id === booked.counsellorId) ?? counsellorFor(null);
  await ctx.followUps.schedule({
    key: 'counselling-reminder',
    category: 'utility',
    sendAt,
    template: {
      name: TEMPLATES.counselling,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName(ctx) ?? 'there' },
            { type: 'text', text: counsellor.name },
            { type: 'text', text: timeOnly(booked.date, booked.time) },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.documents }],
        },
      ],
    },
  });
  return true;
}

export async function onRemindCounselling(ctx: Ctx): Promise<void> {
  const booked = ctx.state.counselling;
  if (booked?.confirmed !== true) {
    return showSessions(ctx);
  }
  const scheduled = await scheduleCounsellingReminder(ctx, booked);
  ctx.setState((state) => ({ ...state, counselling: { ...booked, remindersOn: scheduled } }));
  await ctx.send.buttons({
    body: scheduled
      ? `Done. I'll remind you an hour before your ${timeOnly(booked.date, booked.time)} session, with an approved WhatsApp template.`
      : 'Your session starts within the hour, so no reminder needed. Talk soon!',
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.documents, title: 'Upload documents' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}
