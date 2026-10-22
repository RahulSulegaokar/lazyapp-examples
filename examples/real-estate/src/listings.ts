/**
 * Seed inventory for Brickfield Homes, a fictional developer-cum-brokerage. Projects,
 * prices and agents are invented; localities, coordinates and price levels are real
 * enough that the conversation feels like a working property app.
 *
 * In production this module is your listings service; the rest of the example only
 * calls `findHomes`, `nearestHomes`, `getListing` and `agentFor`.
 */

export type Purpose = 'buy' | 'rent';

export const CITIES = ['bengaluru', 'pune', 'mumbai', 'hyderabad'] as const;
export type City = (typeof CITIES)[number];

export const CITY_NAMES: Readonly<Record<City, string>> = {
  bengaluru: 'Bengaluru',
  pune: 'Pune',
  mumbai: 'Mumbai',
  hyderabad: 'Hyderabad',
};

export interface Listing {
  readonly id: string;
  readonly name: string;
  readonly city: City;
  readonly locality: string;
  readonly purpose: Purpose;
  readonly bhk: number;
  /** Sale price, or monthly rent, in paise. */
  readonly pricePaise: number;
  readonly areaSqft: number;
  readonly possession: string;
  readonly highlights: readonly string[];
  readonly image: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly address: string;
  /** File in `public/`: the brochure WhatsApp downloads. */
  readonly brochure: string;
}

const LAKH = 100_000 * 100;
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&q=80&fm=jpg`;

export const LISTINGS: readonly Listing[] = [
  {
    id: 'blr-aurora',
    name: 'Brickfield Aurora',
    city: 'bengaluru',
    locality: 'Whitefield',
    purpose: 'buy',
    bhk: 2,
    pricePaise: 92 * LAKH,
    areaSqft: 1150,
    possession: 'Ready to move',
    highlights: ['8 min walk to Kadugodi Tree Park metro', 'Clubhouse with lap pool', 'OC received'],
    image: unsplash('1545324418-cc1a3fa10c00'),
    latitude: 12.9698,
    longitude: 77.75,
    address: 'Hope Farm Junction, Whitefield, Bengaluru 560066',
    brochure: 'brickfield-aurora.pdf',
  },
  {
    id: 'blr-meadows',
    name: 'Brickfield Meadows',
    city: 'bengaluru',
    locality: 'Sarjapur Road',
    purpose: 'buy',
    bhk: 3,
    pricePaise: 148 * LAKH,
    areaSqft: 1640,
    possession: 'Dec 2027',
    highlights: [
      '6 acres, 70% open space',
      '10 min to Wipro Corporate Office',
      'Launch price for first 50 homes',
    ],
    image: unsplash('1600596542815-ffad4c1539a9'),
    latitude: 12.91,
    longitude: 77.687,
    address: 'Off Sarjapur Main Road, Kodathi, Bengaluru 560035',
    brochure: 'brickfield-meadows.pdf',
  },
  {
    id: 'blr-skyline',
    name: 'Brickfield Skyline',
    city: 'bengaluru',
    locality: 'Hebbal',
    purpose: 'buy',
    bhk: 3,
    pricePaise: 210 * LAKH,
    areaSqft: 1820,
    possession: 'Mar 2027',
    highlights: ['Lake-facing towers', '20 min to the airport', 'Private lift lobby'],
    image: unsplash('1486406146926-c627a92ad1ab'),
    latitude: 13.0358,
    longitude: 77.597,
    address: 'Kempapura Main Road, Hebbal, Bengaluru 560024',
    brochure: 'brickfield-skyline.pdf',
  },
  {
    id: 'blr-hsr-rent',
    name: 'Sector 2 Residency',
    city: 'bengaluru',
    locality: 'HSR Layout',
    purpose: 'rent',
    bhk: 2,
    pricePaise: 42_000 * 100,
    areaSqft: 1100,
    possession: 'Available from 1 Nov',
    highlights: ['Semi-furnished', 'Covered car park', 'Pets welcome'],
    image: unsplash('1502672260266-1c1ef2d93688'),
    latitude: 12.9116,
    longitude: 77.6474,
    address: '27th Main, Sector 2, HSR Layout, Bengaluru 560102',
    brochure: 'sector-2-residency.pdf',
  },
  {
    id: 'blr-indiranagar-rent',
    name: '100 Feet Road Homes',
    city: 'bengaluru',
    locality: 'Indiranagar',
    purpose: 'rent',
    bhk: 3,
    pricePaise: 85_000 * 100,
    areaSqft: 1750,
    possession: 'Available now',
    highlights: ['Fully furnished', 'Walk to Indiranagar metro', 'Rooftop garden'],
    image: unsplash('1493809842364-78817add7ffb'),
    latitude: 12.9784,
    longitude: 77.6408,
    address: '12th Main, HAL 2nd Stage, Indiranagar, Bengaluru 560038',
    brochure: '100-feet-road-homes.pdf',
  },
  {
    id: 'pune-baner',
    name: 'Brickfield Hillcrest',
    city: 'pune',
    locality: 'Baner',
    purpose: 'buy',
    bhk: 2,
    pricePaise: 105 * LAKH,
    areaSqft: 1080,
    possession: 'Ready to move',
    highlights: ['Baner hill views', 'EV charging in every bay', 'Co-working lounge'],
    image: unsplash('1460317442991-0ec209397118'),
    latitude: 18.559,
    longitude: 73.7868,
    address: 'Baner-Pashan Link Road, Baner, Pune 411045',
    brochure: 'brickfield-hillcrest.pdf',
  },
  {
    id: 'pune-hinjewadi',
    name: 'Brickfield Studio One',
    city: 'pune',
    locality: 'Hinjewadi',
    purpose: 'buy',
    bhk: 1,
    pricePaise: 48 * LAKH,
    areaSqft: 640,
    possession: 'Jun 2027',
    highlights: ['5 min to Phase 1 IT park', 'Assured rental programme', 'Gym and jogging track'],
    image: unsplash('1515263487990-61b07816b324'),
    latitude: 18.5913,
    longitude: 73.7389,
    address: 'Phase 1, Hinjewadi, Pune 411057',
    brochure: 'brickfield-studio-one.pdf',
  },
  {
    id: 'pune-kharadi-rent',
    name: 'EON Riverside',
    city: 'pune',
    locality: 'Kharadi',
    purpose: 'rent',
    bhk: 2,
    pricePaise: 32_000 * 100,
    areaSqft: 1020,
    possession: 'Available now',
    highlights: ['Walk to EON IT park', 'Semi-furnished', 'Gated, 24x7 security'],
    image: unsplash('1522708323590-d24dbb6b0267'),
    latitude: 18.5515,
    longitude: 73.9348,
    address: 'Kharadi South Main Road, Pune 411014',
    brochure: 'eon-riverside.pdf',
  },
  {
    id: 'mum-powai',
    name: 'Brickfield Lakeside',
    city: 'mumbai',
    locality: 'Powai',
    purpose: 'buy',
    bhk: 2,
    pricePaise: 235 * LAKH,
    areaSqft: 870,
    possession: 'Ready to move',
    highlights: ['Powai lake views', 'Walk to Hiranandani Gardens', 'Two covered car parks'],
    image: unsplash('1567496898669-ee935f5f647a'),
    latitude: 19.1176,
    longitude: 72.906,
    address: 'Central Avenue, Powai, Mumbai 400076',
    brochure: 'brickfield-lakeside.pdf',
  },
  {
    id: 'mum-thane',
    name: 'Brickfield Greens',
    city: 'mumbai',
    locality: 'Thane West',
    purpose: 'buy',
    bhk: 2,
    pricePaise: 118 * LAKH,
    areaSqft: 760,
    possession: 'Sep 2027',
    highlights: ['Next to Yeoor hills', 'Metro line 4 station 600 m away', 'Stamp duty offer this month'],
    image: unsplash('1574362848149-11496d93a7c7'),
    latitude: 19.2183,
    longitude: 72.9781,
    address: 'Ghodbunder Road, Thane West 400607',
    brochure: 'brickfield-greens.pdf',
  },
  {
    id: 'mum-andheri-rent',
    name: 'Lokhandwala Heights',
    city: 'mumbai',
    locality: 'Andheri West',
    purpose: 'rent',
    bhk: 1,
    pricePaise: 55_000 * 100,
    areaSqft: 560,
    possession: 'Available from 15 Nov',
    highlights: ['Furnished', '5 min to Lokhandwala market', 'Sea-facing balcony'],
    image: unsplash('1560448204-e02f11c3d0e2'),
    latitude: 19.1364,
    longitude: 72.8296,
    address: 'Lokhandwala Complex, Andheri West, Mumbai 400053',
    brochure: 'lokhandwala-heights.pdf',
  },
  {
    id: 'hyd-gachibowli',
    name: 'Brickfield Orbit',
    city: 'hyderabad',
    locality: 'Gachibowli',
    purpose: 'buy',
    bhk: 3,
    pricePaise: 165 * LAKH,
    areaSqft: 1950,
    possession: 'Ready to move',
    highlights: ['10 min to the Financial District', 'Indoor badminton courts', 'IGBC gold rated'],
    image: unsplash('1600585154340-be6161a56a0c'),
    latitude: 17.4401,
    longitude: 78.3489,
    address: 'Old Mumbai Highway, Gachibowli, Hyderabad 500032',
    brochure: 'brickfield-orbit.pdf',
  },
  {
    id: 'hyd-kokapet',
    name: 'Brickfield Villas',
    city: 'hyderabad',
    locality: 'Kokapet',
    purpose: 'buy',
    bhk: 4,
    pricePaise: 390 * LAKH,
    areaSqft: 4200,
    possession: 'Dec 2026',
    highlights: ['Private garden and pool', 'Gated villa community', 'Next to the Outer Ring Road'],
    image: unsplash('1613490493576-7fde63acd811'),
    latitude: 17.395,
    longitude: 78.333,
    address: 'Neopolis Road, Kokapet, Hyderabad 500075',
    brochure: 'brickfield-villas.pdf',
  },
  {
    id: 'hyd-kondapur-rent',
    name: 'Botanical Garden Towers',
    city: 'hyderabad',
    locality: 'Kondapur',
    purpose: 'rent',
    bhk: 2,
    pricePaise: 35_000 * 100,
    areaSqft: 1250,
    possession: 'Available now',
    highlights: ['Semi-furnished', 'Opposite Botanical Garden', 'Kids play area'],
    image: unsplash('1580587771525-78b9dba3b914'),
    latitude: 17.469,
    longitude: 78.364,
    address: 'Kothaguda Road, Kondapur, Hyderabad 500084',
    brochure: 'botanical-garden-towers.pdf',
  },
];

/** Welcome banner for the menu. */
export const BRAND_IMAGE = unsplash('1449844908441-8829872d2607');

export function getListing(id: string): Listing | undefined {
  return LISTINGS.find((listing) => listing.id === id);
}

export function localitiesIn(city: City): string[] {
  return [...new Set(LISTINGS.filter((listing) => listing.city === city).map((listing) => listing.locality))];
}

// --- Budgets ------------------------------------------------------------------

export interface BudgetBand {
  readonly id: string;
  readonly title: string;
  readonly purpose: Purpose;
  readonly minPaise: number;
  readonly maxPaise: number;
}

const RUPEE = 100;

export const BUDGETS: readonly BudgetBand[] = [
  { id: 'buy-75', title: 'Under ₹75 L', purpose: 'buy', minPaise: 0, maxPaise: 75 * LAKH },
  { id: 'buy-150', title: '₹75 L – ₹1.5 Cr', purpose: 'buy', minPaise: 75 * LAKH, maxPaise: 150 * LAKH },
  { id: 'buy-250', title: '₹1.5 Cr – ₹2.5 Cr', purpose: 'buy', minPaise: 150 * LAKH, maxPaise: 250 * LAKH },
  { id: 'buy-max', title: 'Above ₹2.5 Cr', purpose: 'buy', minPaise: 250 * LAKH, maxPaise: Infinity },
  { id: 'rent-35', title: 'Under ₹35,000/mo', purpose: 'rent', minPaise: 0, maxPaise: 35_000 * RUPEE },
  {
    id: 'rent-60',
    title: '₹35,000 – ₹60,000/mo',
    purpose: 'rent',
    minPaise: 35_000 * RUPEE,
    maxPaise: 60_000 * RUPEE,
  },
  {
    id: 'rent-max',
    title: 'Above ₹60,000/mo',
    purpose: 'rent',
    minPaise: 60_000 * RUPEE,
    maxPaise: Infinity,
  },
];

export const ANY = 'any';

export function budgetsFor(purpose: Purpose): BudgetBand[] {
  return BUDGETS.filter((band) => band.purpose === purpose);
}

// --- Search -------------------------------------------------------------------

export interface Preferences {
  readonly purpose: Purpose;
  readonly city: City;
  /** Locality name, or null for anywhere in the city. */
  readonly locality: string | null;
  /** Budget band id, or null for any budget. */
  readonly budget: string | null;
  /** Bedroom counts; 4 means 4 or more. Empty means any. */
  readonly bhk: readonly number[];
}

export interface SearchResult {
  readonly homes: readonly Listing[];
  /** Filters dropped to find anything, in the order they were relaxed. */
  readonly relaxed: readonly ('locality' | 'bhk' | 'budget')[];
}

/**
 * Exact matches first; when nothing matches, relaxes locality, then bedrooms, then budget,
 * and says which it relaxed so the reply can be honest about it.
 */
export function findHomes(prefs: Preferences, limit = 10): SearchResult {
  const steps: { relaxed: SearchResult['relaxed']; prefs: Preferences }[] = [
    { relaxed: [], prefs },
    { relaxed: ['locality'], prefs: { ...prefs, locality: null } },
    { relaxed: ['locality', 'bhk'], prefs: { ...prefs, locality: null, bhk: [] } },
    { relaxed: ['locality', 'bhk', 'budget'], prefs: { ...prefs, locality: null, bhk: [], budget: null } },
  ];
  for (const step of steps) {
    const homes = LISTINGS.filter((listing) => matches(listing, step.prefs))
      .sort((a, b) => a.pricePaise - b.pricePaise)
      .slice(0, limit);
    if (homes.length > 0) {
      return { homes, relaxed: step.relaxed };
    }
  }
  return { homes: [], relaxed: [] };
}

function matches(listing: Listing, prefs: Preferences): boolean {
  const band = prefs.budget === null ? undefined : BUDGETS.find((entry) => entry.id === prefs.budget);
  return (
    listing.purpose === prefs.purpose &&
    listing.city === prefs.city &&
    (prefs.locality === null || listing.locality === prefs.locality) &&
    (band === undefined || (listing.pricePaise >= band.minPaise && listing.pricePaise < band.maxPaise)) &&
    (prefs.bhk.length === 0 || prefs.bhk.some((bhk) => (bhk >= 4 ? listing.bhk >= 4 : listing.bhk === bhk)))
  );
}

export interface NearbyHome {
  readonly listing: Listing;
  readonly km: number;
}

export function nearestHomes(latitude: number, longitude: number, limit = 5): NearbyHome[] {
  return LISTINGS.map((listing) => ({
    listing,
    km: distanceKm(latitude, longitude, listing.latitude, listing.longitude),
  }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** Great-circle distance (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Formatting -----------------------------------------------------------------

/** `₹92 L`, `₹1.48 Cr`, `₹42,000/mo`: how Indian property prices are written. */
export function formatPrice(listing: Pick<Listing, 'pricePaise' | 'purpose'>): string {
  const rupees = listing.pricePaise / 100;
  if (listing.purpose === 'rent') {
    return `₹${rupees.toLocaleString('en-IN')}/mo`;
  }
  if (rupees >= 1_00_00_000) {
    return `₹${trimZeros((rupees / 1_00_00_000).toFixed(2))} Cr`;
  }
  return `₹${trimZeros((rupees / 1_00_000).toFixed(1))} L`;
}

function trimZeros(value: string): string {
  return value.replace(/\.?0+$/, '');
}

/** One line for list rows and cards: `2 BHK · 1,150 sq ft · ₹92 L`. */
export function summaryLine(listing: Listing): string {
  return `${listing.bhk} BHK · ${listing.areaSqft.toLocaleString('en-IN')} sq ft · ${formatPrice(listing)}`;
}

/** Google Street View at the project: a real "virtual tour" link that needs no hosting. */
export function streetViewUrl(listing: Pick<Listing, 'latitude' | 'longitude'>): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${listing.latitude},${listing.longitude}`;
}

// --- Agents ---------------------------------------------------------------------

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly city: City;
}

export const AGENTS: readonly Agent[] = [
  {
    id: 'priya',
    name: 'Priya Nair',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya.nair@example.com',
    city: 'bengaluru',
  },
  {
    id: 'rohan',
    name: 'Rohan Kulkarni',
    firstName: 'Rohan',
    lastName: 'Kulkarni',
    email: 'rohan.kulkarni@example.com',
    city: 'pune',
  },
  {
    id: 'ayesha',
    name: 'Ayesha Khan',
    firstName: 'Ayesha',
    lastName: 'Khan',
    email: 'ayesha.khan@example.com',
    city: 'mumbai',
  },
  {
    id: 'karthik',
    name: 'Karthik Reddy',
    firstName: 'Karthik',
    lastName: 'Reddy',
    email: 'karthik.reddy@example.com',
    city: 'hyderabad',
  },
];

/** Agents own a city: the same buyer always reaches the same person there. */
export function agentFor(city: City): Agent {
  const agent = AGENTS.find((entry) => entry.city === city);
  if (agent === undefined) {
    throw new Error(`No agent covers ${city}`);
  }
  return agent;
}

export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

// --- Free text ------------------------------------------------------------------

const CITY_ALIASES: Readonly<Record<string, City>> = {
  bengaluru: 'bengaluru',
  bangalore: 'bengaluru',
  blr: 'bengaluru',
  pune: 'pune',
  mumbai: 'mumbai',
  bombay: 'mumbai',
  thane: 'mumbai',
  powai: 'mumbai',
  hyderabad: 'hyderabad',
  hyd: 'hyderabad',
};

/**
 * Understands the way people type a property search: "2 bhk to rent in bangalore",
 * "3BHK Baner". Returns null unless it finds a city (or a locality, which implies one).
 */
export function parseQuery(text: string): Preferences | null {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((word) => word !== '');
  const locality = LISTINGS.find((listing) => lower.includes(listing.locality.toLowerCase()));
  const city = locality?.city ?? words.map((word) => CITY_ALIASES[word]).find((entry) => entry !== undefined);
  if (city === undefined) {
    return null;
  }
  const bhk = [...lower.matchAll(/(\d)\s*(?:\+\s*)?bhk/g)].map((match) => Math.min(4, Number(match[1])));
  return {
    purpose: /\b(rent|rental|lease|renting)\b/.test(lower) ? 'rent' : 'buy',
    city,
    locality: locality?.locality ?? null,
    budget: null,
    bhk: [...new Set(bhk.filter((count) => count >= 1))],
  };
}
