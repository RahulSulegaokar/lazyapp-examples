import type { CatalogInfo } from '@lazyapp-examples/demo-kit';

/**
 * Indigo Loom: a fictional Jaipur handloom brand. The seed below is the store's
 * source of truth for names, prices and sizes. When the number has a Meta catalog
 * containing these retailer ids (see `src/cli/sync-catalog.ts`), the shop shows
 * native catalog messages for them; otherwise it uses interactive lists.
 */
export const BRAND = {
  name: 'Indigo Loom',
  tagline: 'Handloom from Jaipur, delivered across India',
  banner: unsplash('1617627143750-d86bc21e42bb', 1200),
  supportPhone: '+918045671234',
  supportEmail: 'care@indigoloom.example',
  /** Registered address Meta needs on order_details for physical goods sold outside a catalog. */
  importer: {
    name: 'Indigo Loom Crafts Pvt Ltd',
    address: {
      address_line1: 'Plot 14, Sitapura Industrial Area',
      city: 'Jaipur',
      zone_code: 'RJ',
      postal_code: '302022',
      country_code: 'IN',
    },
  },
} as const;

export const CATEGORIES = [
  { id: 'sarees', title: 'Sarees', description: 'Banarasi and Kanjivaram silks' },
  { id: 'wear', title: 'Dresses & jackets', description: 'Hand-block prints, everyday cotton' },
  { id: 'home', title: 'Home & bedding', description: 'Percale sheets, rugs, pillows' },
  { id: 'bags', title: 'Bags', description: 'Leather, made in Jaipur' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly category: CategoryId;
  /** Selling price, paise. */
  readonly pricePaise: number;
  /** Strike-through price, paise. */
  readonly mrpPaise: number | null;
  readonly imageUrl: string;
  /** Empty for one-size products. */
  readonly sizes: readonly string[];
  /** Extra words that should match a search. */
  readonly keywords: readonly string[];
}

const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

export const PRODUCTS: readonly Product[] = [
  {
    sku: 'il-saree-banarasi-plum',
    name: 'Banarasi silk saree, plum',
    description: 'Handwoven Banarasi silk with a zari border and an unstitched blouse piece.',
    category: 'sarees',
    pricePaise: 449_900,
    mrpPaise: 599_900,
    imageUrl: unsplash('1610030469983-98e550d6193c'),
    sizes: [],
    keywords: ['purple', 'silk', 'wedding', 'festive', 'zari'],
  },
  {
    sku: 'il-saree-kanjivaram-red',
    name: 'Kanjivaram silk saree, crimson',
    description: 'Pure silk with a gold temple border. Comes with a matching blouse piece.',
    category: 'sarees',
    pricePaise: 599_900,
    mrpPaise: 749_900,
    imageUrl: unsplash('1617627143750-d86bc21e42bb'),
    sizes: [],
    keywords: ['red', 'silk', 'wedding', 'bridal', 'festive', 'gold'],
  },
  {
    sku: 'il-dress-bandhani-red',
    name: 'Bandhani maxi dress, red',
    description: 'Tie-dyed cotton mulmul, tiered skirt, fabric belt. Hand wash.',
    category: 'wear',
    pricePaise: 189_900,
    mrpPaise: 249_900,
    imageUrl: unsplash('1572804013309-59a88b7e92f1'),
    sizes: APPAREL_SIZES,
    keywords: ['red', 'cotton', 'summer', 'print', 'women'],
  },
  {
    sku: 'il-jacket-rust',
    name: 'Cotton bomber jacket, rust',
    description: 'Handloom cotton twill with a ribbed collar and hem. Unisex fit.',
    category: 'wear',
    pricePaise: 229_900,
    mrpPaise: null,
    imageUrl: unsplash('1591047139829-d91aecb6caea'),
    sizes: APPAREL_SIZES,
    keywords: ['orange', 'brown', 'men', 'unisex', 'winter', 'outerwear'],
  },
  {
    sku: 'il-trousers-blush',
    name: 'Linen trousers, blush',
    description: 'Relaxed-fit pure linen with an elastic back and deep pockets.',
    category: 'wear',
    pricePaise: 129_900,
    mrpPaise: 159_900,
    imageUrl: unsplash('1594633312681-425c7b97ccd1'),
    sizes: APPAREL_SIZES,
    keywords: ['pink', 'pants', 'linen', 'women', 'summer'],
  },
  {
    sku: 'il-bedsheet-rust',
    name: 'Percale bedsheet set, rust',
    description: '300-thread-count cotton percale. King flat sheet with two pillow covers.',
    category: 'home',
    pricePaise: 249_900,
    mrpPaise: 299_900,
    imageUrl: unsplash('1616627561839-074385245ff6'),
    sizes: [],
    keywords: ['bed', 'sheet', 'king', 'cotton', 'orange', 'bedding'],
  },
  {
    sku: 'il-bedding-charcoal',
    name: 'Charcoal bedding + cushion set',
    description: 'Duvet cover, two shams and a mustard block-print cushion cover.',
    category: 'home',
    pricePaise: 319_900,
    mrpPaise: null,
    imageUrl: unsplash('1586105251261-72a756497a11'),
    sizes: [],
    keywords: ['bed', 'duvet', 'grey', 'black', 'cushion', 'bedding'],
  },
  {
    sku: 'il-pillow-cotton',
    name: 'Organic cotton pillows (pair)',
    description: 'Kapok-filled, organic cotton cover, medium firm. Set of two.',
    category: 'home',
    pricePaise: 99_900,
    mrpPaise: 129_900,
    imageUrl: unsplash('1584100936595-c0654b55a2e2'),
    sizes: [],
    keywords: ['pillow', 'white', 'sleep', 'bedding'],
  },
  {
    sku: 'il-rug-ivory',
    name: 'Hand-knotted rug, ivory 5x7',
    description: 'Wool and cotton, knotted by artisans in Bhadohi. 5 x 7 ft.',
    category: 'home',
    pricePaise: 799_900,
    mrpPaise: 999_900,
    imageUrl: unsplash('1600166898405-da9535204843'),
    sizes: [],
    keywords: ['carpet', 'rug', 'white', 'cream', 'wool', 'living room'],
  },
  {
    sku: 'il-bag-coral',
    name: 'Top-handle leather bag, coral',
    description: 'Vegetable-tanned leather, brass clasp, detachable strap.',
    category: 'bags',
    pricePaise: 279_900,
    mrpPaise: 349_900,
    imageUrl: unsplash('1584917865442-de89df76afd3'),
    sizes: [],
    keywords: ['handbag', 'purse', 'red', 'orange', 'leather', 'women'],
  },
];

/** Products on today's deal carousel. */
export const DEALS: readonly string[] = ['il-saree-banarasi-plum', 'il-dress-bandhani-red', 'il-rug-ivory'];

const BY_SKU = new Map(PRODUCTS.map((product) => [product.sku, product]));

export function findProduct(sku: string): Product | undefined {
  return BY_SKU.get(sku);
}

export function productsIn(category: CategoryId): Product[] {
  return PRODUCTS.filter((product) => product.category === category);
}

export function isCategory(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

/**
 * Ranks products for a free-text query: every word must match somewhere,
 * name hits outrank keyword hits. "red silk saree" → the Kanjivaram first.
 */
export function searchProducts(query: string, limit = 10): Product[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)
    .map(singular);
  if (words.length === 0) {
    return [];
  }
  const scored = PRODUCTS.flatMap((product) => {
    const name = product.name.toLowerCase();
    const rest = [product.description, product.category, ...product.keywords].join(' ').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (name.includes(word)) {
        score += 3;
      } else if (rest.includes(word)) {
        score += 1;
      } else {
        return [];
      }
    }
    return [{ product, score }];
  });
  return scored
    .sort((a, b) => b.score - a.score || a.product.pricePaise - b.product.pricePaise)
    .slice(0, limit)
    .map((entry) => entry.product);
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/**
 * What the number's Meta catalog can show right now: the catalog id plus the
 * seed SKUs that exist in it. Products outside the seed are ignored, so a shared
 * number with an unrelated catalog never leaks foreign products into the demo.
 */
export interface StorefrontCatalog {
  readonly catalogId: string;
  readonly skus: ReadonlySet<string>;
}

export function storefrontCatalog(info: CatalogInfo | null): StorefrontCatalog | null {
  if (info === null) {
    return null;
  }
  const skus = new Set(
    info.products.flatMap((product) =>
      product.retailer_id !== null &&
      BY_SKU.has(product.retailer_id) &&
      product.availability !== 'out of stock'
        ? [product.retailer_id]
        : [],
    ),
  );
  return skus.size === 0 ? null : { catalogId: info.catalogId, skus };
}

function unsplash(id: string, width = 800): string {
  return `https://images.unsplash.com/photo-${id}?w=${width}&q=80&fm=jpg&fit=crop`;
}
