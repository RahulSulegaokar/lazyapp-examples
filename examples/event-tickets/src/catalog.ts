/**
 * The events on sale: fictional events at real Indian venues. Dates are relative to "now" so
 * the demo never goes stale: one show is always tonight (or tomorrow night), the rest within
 * two weeks. Prices are paise.
 */

export interface Tier {
  readonly id: string;
  /** Short: it becomes a reply button title with the price (≤ 20 characters in total). */
  readonly name: string;
  readonly price: number;
  readonly capacity: number;
  /** Seats sold before the demo started, so availability looks like a real sale. */
  readonly soldAtStart: number;
  readonly perks: string;
}

export interface Venue {
  readonly name: string;
  readonly area: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly directions: string;
}

export interface EventInfo {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly about: string;
  readonly image: string;
  readonly venue: Venue;
  /** Days from today (IST) and local start time. `tonight` = today if it is before 6 pm, else tomorrow. */
  readonly when: { readonly days: number | 'tonight'; readonly hour: number; readonly minute: number };
  readonly durationMinutes: number;
  readonly doorsBeforeMinutes: number;
  readonly tiers: readonly Tier[];
  readonly schedule: readonly string[];
  readonly welcome: string;
  /** Three-letter prefix printed on tickets. */
  readonly code: string;
}

const unsplash = (id: string) => `https://images.unsplash.com/${id}?w=1200&h=628&fit=crop&fm=jpg&q=80`;

export const EVENTS: readonly EventInfo[] = [
  {
    id: 'laughs',
    title: 'Late Night Laughs',
    kind: 'Stand-up comedy',
    about:
      'Five of Delhi’s sharpest new comics, one tight hour each way of the clock. 18+, mostly English and Hindi.',
    image: unsplash('photo-1585699324551-f6c309eedeca'),
    venue: {
      name: 'Punchline Room',
      area: 'Hauz Khas Village',
      city: 'New Delhi',
      latitude: 28.5535,
      longitude: 77.1946,
      directions:
        'Green Park metro (Yellow line) is a 12-minute walk. Parking at the HKV deer park lot fills up by 8 pm.',
    },
    when: { days: 'tonight', hour: 20, minute: 30 },
    durationMinutes: 120,
    doorsBeforeMinutes: 30,
    code: 'LNL',
    tiers: [
      { id: 'std', name: 'Standard', price: 49_900, capacity: 120, soldAtStart: 87, perks: 'Open seating' },
      {
        id: 'front',
        name: 'Front row',
        price: 89_900,
        capacity: 20,
        soldAtStart: 14,
        perks: 'Front two rows, a drink on us',
      },
    ],
    schedule: [
      '8:00 pm · Doors and bar open',
      '8:30 pm · Opening act',
      '9:15 pm · Headliners',
      '10:30 pm · Close',
    ],
    welcome:
      'Grab a seat anywhere in your section; the bar takes UPI. Phones on silent, please: the comics will notice.',
  },
  {
    id: 'indie',
    title: 'Monsoon Indie Nights',
    kind: 'Live music',
    about: 'Four indie bands, one open-air stage by the sea. Rain or shine: there is a canopy over the pit.',
    image: unsplash('photo-1533174072545-7a4b6ad7a6c3'),
    venue: {
      name: 'Bandstand Amphitheatre',
      area: 'Bandra West',
      city: 'Mumbai',
      latitude: 19.0473,
      longitude: 72.8195,
      directions:
        'Bandra station (Western line), then a 15-minute auto ride. Drop-off at Mount Mary steps; no parking on site.',
    },
    when: { days: 2, hour: 19, minute: 0 },
    durationMinutes: 240,
    doorsBeforeMinutes: 60,
    code: 'MIN',
    tiers: [
      { id: 'ga', name: 'GA', price: 79_900, capacity: 300, soldAtStart: 212, perks: 'General admission' },
      {
        id: 'pit',
        name: 'Fan Pit',
        price: 149_900,
        capacity: 80,
        soldAtStart: 61,
        perks: 'Standing area by the stage',
      },
      {
        id: 'vip',
        name: 'VIP',
        price: 349_900,
        capacity: 40,
        soldAtStart: 40,
        perks: 'Lounge, bar and a seat',
      },
    ],
    schedule: [
      '6:00 pm · Gates open',
      '7:00 pm · The Lost Monsoons',
      '8:00 pm · Kites of Khar',
      '9:15 pm · Headliner',
      '11:00 pm · Close',
    ],
    welcome:
      'Water stations are by the left stairs and the bar takes UPI. Ponchos are free at the merch tent if it rains.',
  },
  {
    id: 'devday',
    title: 'Build with WhatsApp DevDay',
    kind: 'Developer conference',
    about: 'Talks and hands-on workshops on WhatsApp Flows, payments and AI agents. Bring a laptop.',
    image: unsplash('photo-1540575467063-178a50c2df87'),
    venue: {
      name: 'Bangalore International Centre',
      area: 'Domlur',
      city: 'Bengaluru',
      latitude: 12.9607,
      longitude: 77.6387,
      directions: 'Indiranagar metro (Purple line), then 10 minutes by auto. Basement parking for 60 cars.',
    },
    when: { days: 5, hour: 10, minute: 0 },
    durationMinutes: 420,
    doorsBeforeMinutes: 60,
    code: 'BWD',
    tiers: [
      {
        id: 'community',
        name: 'Community',
        price: 0,
        capacity: 200,
        soldAtStart: 143,
        perks: 'All talks, lunch',
      },
      {
        id: 'workshop',
        name: 'Workshop',
        price: 99_900,
        capacity: 40,
        soldAtStart: 31,
        perks: 'Talks + afternoon workshop',
      },
    ],
    schedule: [
      '9:00 am · Registration and coffee',
      '10:00 am · Keynote',
      '11:30 am · Flows deep dive',
      '2:00 pm · Workshops',
      '5:00 pm · Demos and close',
    ],
    welcome:
      'Wi-Fi: BIC-Guest, password devday2026. Lunch is on the terrace at 1 pm; workshop rooms are on level 2.',
  },
  {
    id: 'food',
    title: 'Hyderabad Street Food Carnival',
    kind: 'Food festival',
    about:
      '60 stalls from the Old City to Gachibowli: haleem, mirchi bajji, Irani chai, and a midnight biryani counter.',
    image: unsplash('photo-1555939594-58d7cb561ad1'),
    venue: {
      name: 'Shilparamam',
      area: 'Madhapur',
      city: 'Hyderabad',
      latitude: 17.4529,
      longitude: 78.3794,
      directions:
        'HITEC City metro (Blue line) is a 5-minute walk. Paid parking at the Shilparamam main gate.',
    },
    when: { days: 9, hour: 16, minute: 0 },
    durationMinutes: 360,
    doorsBeforeMinutes: 0,
    code: 'HSF',
    tiers: [
      {
        id: 'day',
        name: 'Day pass',
        price: 29_900,
        capacity: 1000,
        soldAtStart: 640,
        perks: 'Entry and ₹100 food credit',
      },
      {
        id: 'family',
        name: 'Family pack',
        price: 99_900,
        capacity: 150,
        soldAtStart: 96,
        perks: 'Four entries, ₹500 food credit',
      },
    ],
    schedule: [
      '4:00 pm · Gates open',
      '6:00 pm · Live dhol and qawwali',
      '8:00 pm · Biryani cook-off',
      '10:00 pm · Close',
    ],
    welcome:
      'Your food credit is on your wristband; top it up with UPI at any stall. The kids’ zone is by the pond.',
  },
];

export function findEvent(id: string): EventInfo | undefined {
  return EVENTS.find((event) => event.id === id);
}

export function findTier(event: EventInfo, tierId: string): Tier | undefined {
  return event.tiers.find((tier) => tier.id === tierId);
}

// --- Time -----------------------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60_000;
const DAY = 86_400_000;

/** Start of the event in absolute time, for "now". */
export function startsAt(event: EventInfo, now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const midnight =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  const days = event.when.days === 'tonight' ? (shifted.getUTCHours() < 18 ? 0 : 1) : event.when.days;
  return new Date(midnight + days * DAY + (event.when.hour * 60 + event.when.minute) * 60_000);
}

export function endsAt(event: EventInfo, now: Date): Date {
  return new Date(startsAt(event, now).getTime() + event.durationMinutes * 60_000);
}

export function doorsAt(event: EventInfo, now: Date): Date {
  return new Date(startsAt(event, now).getTime() - event.doorsBeforeMinutes * 60_000);
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `7:00 pm`. */
export function formatTime(date: Date): string {
  return TIME_FORMAT.format(date).replace(
    /\s?([AP]M)$/i,
    (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`,
  );
}

/** `Sat, 25 Oct`, or `Today` / `Tomorrow`. */
export function formatDay(date: Date, now: Date): string {
  const day = (value: Date) => Math.floor((value.getTime() + IST_OFFSET_MS) / DAY);
  const diff = day(date) - day(now);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : DAY_FORMAT.format(date);
}

/** `Sat, 25 Oct · 7:00 pm`. */
export function formatWhen(event: EventInfo, now: Date): string {
  const start = startsAt(event, now);
  return `${formatDay(start, now)} · ${formatTime(start)}`;
}
