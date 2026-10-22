/**
 * Masala Mile: a fictional Bengaluru cloud kitchen with three outlets. The menu
 * below is the source of truth for names, prices and options; a Meta catalog
 * with the same retailer ids (`ml-…`) unlocks native product messages.
 */
export const BRAND = {
  name: 'Masala Mile',
  tagline: 'Biryani, curries and street food from three Bengaluru kitchens',
  banner: unsplash('1631515243349-e0cb75fb8d3a', 1200),
  diningRoom: unsplash('1590846406792-0adc7f938f1d', 1200),
  phone: '+918041234567',
  /** Registered kitchen address for `order_details` (Meta needs it for goods outside a catalog). */
  importer: {
    name: 'Masala Mile Foods LLP',
    address: {
      address_line1: '5th Block, Koramangala',
      city: 'Bengaluru',
      zone_code: 'KA',
      postal_code: '560095',
      country_code: 'IN',
    },
  },
} as const;

/** Kitchens deliver within this radius, in kilometres. */
export const DELIVERY_RADIUS_KM = 6;
export const OPENING_HOUR = 11;
export const CLOSING_HOUR = 23;

export interface Outlet {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly pincode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly dineIn: boolean;
}

export const OUTLETS: readonly Outlet[] = [
  {
    id: 'indiranagar',
    name: 'Indiranagar',
    address: '80 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038',
    pincode: '560038',
    latitude: 12.9719,
    longitude: 77.6412,
    dineIn: true,
  },
  {
    id: 'koramangala',
    name: 'Koramangala',
    address: '80 Feet Road, 5th Block, Koramangala, Bengaluru 560095',
    pincode: '560095',
    latitude: 12.9352,
    longitude: 77.6245,
    dineIn: true,
  },
  {
    id: 'hsr',
    name: 'HSR Layout',
    address: '27th Main, Sector 1, HSR Layout, Bengaluru 560102',
    pincode: '560102',
    latitude: 12.9116,
    longitude: 77.6474,
    dineIn: false,
  },
];

/** Typed neighbourhoods, for people who would rather not share a location. */
export const AREAS: readonly {
  readonly names: readonly string[];
  readonly latitude: number;
  readonly longitude: number;
}[] = [
  { names: ['indiranagar', 'hal'], latitude: 12.9784, longitude: 77.6408 },
  { names: ['koramangala'], latitude: 12.9352, longitude: 77.6245 },
  { names: ['hsr', 'hsr layout'], latitude: 12.9121, longitude: 77.6446 },
  { names: ['domlur'], latitude: 12.961, longitude: 77.6387 },
  { names: ['btm', 'btm layout'], latitude: 12.9166, longitude: 77.6101 },
  { names: ['ejipura', 'viveknagar'], latitude: 12.9447, longitude: 77.6253 },
  { names: ['jayanagar'], latitude: 12.925, longitude: 77.5938 },
  { names: ['whitefield'], latitude: 12.9698, longitude: 77.75 },
  { names: ['mg road', 'brigade road'], latitude: 12.9756, longitude: 77.6066 },
];

export function findOutlet(id: string | null): Outlet | undefined {
  return OUTLETS.find((outlet) => outlet.id === id);
}

export function areaFromText(text: string): { latitude: number; longitude: number; name: string } | null {
  const lower = text.toLowerCase();
  const area = AREAS.find((entry) => entry.names.some((name) => lower.includes(name)));
  return area === undefined
    ? null
    : { latitude: area.latitude, longitude: area.longitude, name: area.names[0] ?? text };
}

/** Great-circle distance (haversine), km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestOutlet(latitude: number, longitude: number): { outlet: Outlet; km: number } {
  const ranked = OUTLETS.map((outlet) => ({
    outlet,
    km: distanceKm(latitude, longitude, outlet.latitude, outlet.longitude),
  })).sort((a, b) => a.km - b.km);
  const [nearest] = ranked;
  if (nearest === undefined) {
    throw new Error('No outlets configured');
  }
  return nearest;
}

/** 20 minutes in the kitchen plus 4 minutes a kilometre on a scooter. */
export function etaMinutes(km: number): number {
  return Math.round((20 + km * 4) / 5) * 5;
}

// --- Menu ------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'starters', title: 'Starters', description: 'Kebabs, fried chicken, samosas' },
  { id: 'biryani', title: 'Biryani', description: 'Hyderabadi dum, half or full' },
  { id: 'curries', title: 'Curries & bowls', description: 'Served with naan or rice' },
  { id: 'street', title: 'South & street', description: 'Idli, pav bhaji, puri bhaji' },
  { id: 'desserts', title: 'Desserts', description: 'Tiramisu, brownie sundae' },
  { id: 'drinks', title: 'Drinks', description: 'Lassi, chaas' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Choice {
  readonly id: string;
  readonly label: string;
  /** Price for a size, extra cost for an add-on, paise. */
  readonly pricePaise: number;
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: CategoryId;
  readonly veg: boolean;
  /** Price of the default portion, paise. */
  readonly pricePaise: number;
  readonly imageUrl: string | null;
  readonly bestseller: boolean;
  /** Present when the dish can be customised (size, spice, add-ons). */
  readonly options: {
    readonly sizes: readonly Choice[];
    readonly addOns: readonly Choice[];
  } | null;
}

export const SPICE_LEVELS = [
  { id: 'mild', label: 'Mild' },
  { id: 'medium', label: 'Medium' },
  { id: 'spicy', label: 'Spicy' },
  { id: 'extra', label: 'Extra hot' },
] as const;

const RAITA: Choice = { id: 'raita', label: 'Extra raita', pricePaise: 3_000 };
const EGG: Choice = { id: 'egg', label: 'Boiled egg', pricePaise: 2_500 };
const SALAN: Choice = { id: 'salan', label: 'Mirchi ka salan', pricePaise: 4_000 };
const NAAN: Choice = { id: 'naan', label: 'Extra butter naan', pricePaise: 4_500 };

const regular = (pricePaise: number): Choice => ({ id: 'regular', label: 'Regular', pricePaise });

export const MENU: readonly MenuItem[] = [
  {
    id: 'ml-samosa',
    name: 'Punjabi samosa (2 pcs)',
    description: 'Potato and pea filling, mint and tamarind chutneys.',
    category: 'starters',
    veg: true,
    pricePaise: 9_900,
    imageUrl: unsplash('1601050690597-df0568f70950'),
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-seekh',
    name: 'Mutton seekh kebab',
    description: 'Four charcoal-grilled minced mutton kebabs, onion rings, green chutney.',
    category: 'starters',
    veg: false,
    pricePaise: 32_900,
    imageUrl: unsplash('1599487488170-d11ec9c172f0'),
    bestseller: true,
    options: {
      sizes: [regular(32_900)],
      addOns: [{ id: 'rumali', label: 'Rumali roti', pricePaise: 3_500 }],
    },
  },
  {
    id: 'ml-fried-chicken',
    name: 'Crispy fried chicken',
    description: 'Four pieces, buttermilk-brined and double fried, with garlic mayo.',
    category: 'starters',
    veg: false,
    pricePaise: 24_900,
    imageUrl: unsplash('1626082927389-6cd097cdc6ec'),
    bestseller: false,
    options: {
      sizes: [regular(24_900)],
      addOns: [{ id: 'mayo', label: 'Extra garlic mayo', pricePaise: 3_000 }],
    },
  },
  {
    id: 'ml-chicken-biryani',
    name: 'Chicken dum biryani',
    description: 'Hyderabadi-style: aged basmati and bone-in chicken, slow-cooked in a sealed handi.',
    category: 'biryani',
    veg: false,
    pricePaise: 29_900,
    imageUrl: unsplash('1631515243349-e0cb75fb8d3a'),
    bestseller: true,
    options: {
      sizes: [
        { id: 'half', label: 'Half (serves 1)', pricePaise: 29_900 },
        { id: 'full', label: 'Full (serves 2)', pricePaise: 44_900 },
      ],
      addOns: [RAITA, EGG, SALAN],
    },
  },
  {
    id: 'ml-veg-biryani',
    name: 'Subz dum biryani',
    description: 'Seasonal vegetables, paneer, saffron and fried onions.',
    category: 'biryani',
    veg: true,
    pricePaise: 24_900,
    imageUrl: unsplash('1563379091339-03b21ab4a4f8'),
    bestseller: false,
    options: {
      sizes: [
        { id: 'half', label: 'Half (serves 1)', pricePaise: 24_900 },
        { id: 'full', label: 'Full (serves 2)', pricePaise: 37_900 },
      ],
      addOns: [RAITA, SALAN],
    },
  },
  {
    id: 'ml-butter-chicken',
    name: 'Butter chicken + 2 naan',
    description: 'Tandoori chicken in a tomato-butter gravy, two butter naan.',
    category: 'curries',
    veg: false,
    pricePaise: 34_900,
    imageUrl: unsplash('1565557623262-b51c2513a641'),
    bestseller: true,
    options: { sizes: [regular(34_900)], addOns: [NAAN] },
  },
  {
    id: 'ml-paneer-makhani',
    name: 'Paneer makhani + 2 naan',
    description: 'Malai paneer in a velvety makhani gravy, two butter naan.',
    category: 'curries',
    veg: true,
    pricePaise: 28_900,
    imageUrl: unsplash('1631452180519-c014fe946bc7'),
    bestseller: false,
    options: { sizes: [regular(28_900)], addOns: [NAAN] },
  },
  {
    id: 'ml-chicken-curry',
    name: 'Chicken curry + rice',
    description: 'Home-style Mangalorean kori gassi with jeera rice.',
    category: 'curries',
    veg: false,
    pricePaise: 29_900,
    imageUrl: unsplash('1596797038530-2c107229654b'),
    bestseller: false,
    options: {
      sizes: [regular(29_900)],
      addOns: [{ id: 'rice', label: 'Extra jeera rice', pricePaise: 6_000 }],
    },
  },
  {
    id: 'ml-tikka-bowl',
    name: 'Chicken tikka bowl',
    description: 'Chicken tikka masala over basmati, with pickled onions.',
    category: 'curries',
    veg: false,
    pricePaise: 31_900,
    imageUrl: unsplash('1585937421612-70a008356fbe'),
    bestseller: false,
    options: {
      sizes: [regular(31_900)],
      addOns: [{ id: 'gravy', label: 'Extra gravy', pricePaise: 4_000 }],
    },
  },
  {
    id: 'ml-idli',
    name: 'Ghee podi idli (4 pcs)',
    description: 'Soft idlis tossed in ghee and gunpowder, coconut chutney.',
    category: 'street',
    veg: true,
    pricePaise: 12_900,
    imageUrl: unsplash('1589301760014-d929f3979dbc'),
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-pav-bhaji',
    name: 'Mumbai pav bhaji',
    description: 'Butter-loaded bhaji, two toasted pav, onions and lemon.',
    category: 'street',
    veg: true,
    pricePaise: 17_900,
    imageUrl: unsplash('1606491956689-2ea866880c84'),
    bestseller: true,
    options: null,
  },
  {
    id: 'ml-puri-bhaji',
    name: 'Puri bhaji thali',
    description: 'Four puris, potato bhaji, chole, pickle and a sweet.',
    category: 'street',
    veg: true,
    pricePaise: 19_900,
    imageUrl: unsplash('1567337710282-00832b415979'),
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-tiramisu',
    name: 'Coffee tiramisu',
    description: 'Mascarpone and Chikmagalur filter coffee, in a jar.',
    category: 'desserts',
    veg: true,
    pricePaise: 18_900,
    imageUrl: unsplash('1571877227200-a0d98ea607e9'),
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-brownie',
    name: 'Brownie sundae',
    description: 'Warm walnut brownie, vanilla ice cream, salted caramel.',
    category: 'desserts',
    veg: true,
    pricePaise: 16_900,
    imageUrl: unsplash('1551024506-0bccd828d307'),
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-mango-lassi',
    name: 'Mango lassi',
    description: 'Alphonso mango, thick curd, a pinch of cardamom.',
    category: 'drinks',
    veg: true,
    pricePaise: 9_900,
    imageUrl: null,
    bestseller: false,
    options: null,
  },
  {
    id: 'ml-chaas',
    name: 'Masala chaas',
    description: 'Spiced buttermilk with roasted cumin and curry leaves.',
    category: 'drinks',
    veg: true,
    pricePaise: 5_900,
    imageUrl: null,
    bestseller: false,
    options: null,
  },
];

const BY_ID = new Map(MENU.map((item) => [item.id, item]));

export function findItem(id: string): MenuItem | undefined {
  return BY_ID.get(id);
}

export function itemsIn(category: CategoryId): MenuItem[] {
  return MENU.filter((item) => item.category === category);
}

export function isCategory(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

export function vegMark(item: MenuItem): string {
  return item.veg ? '🟢' : '🔴';
}

function unsplash(id: string, width = 800): string {
  return `https://images.unsplash.com/photo-${id}?w=${width}&q=80&fm=jpg&fit=crop`;
}
