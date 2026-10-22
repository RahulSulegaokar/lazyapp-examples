import { DEMO_FOOTER, formatInr, ui } from '@lazyapp-examples/demo-kit';
import { BRAND, CATEGORIES, DEALS, findProduct, productsIn, searchProducts } from './catalog.js';
import type { CategoryId, Product, StorefrontCatalog } from './catalog.js';
import { plainPrice, priceTag } from './pricing.js';
import { nudge, storefront } from './views.js';
import type { ShopCtx } from './views.js';

const CART_HINT = 'Add what you like to the cart and tap *Send* in the cart: I will take it from there.';

/** Collections: one multi-product message with a catalog, a list of collections without. */
export async function browse(ctx: ShopCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browsing' }));
  const catalog = await storefront(ctx);
  if (catalog !== null) {
    const sections = CATEGORIES.map((category) => ({
      title: category.title,
      retailerIds: productsIn(category.id)
        .map((product) => product.sku)
        .filter((sku) => catalog.skus.has(sku)),
    })).filter((section) => section.retailerIds.length > 0);
    await ctx.send.interactive(
      ui.productList({
        header: `${BRAND.name} collections`,
        body: `Handwoven in Jaipur. ${CART_HINT}`,
        footer: DEMO_FOOTER,
        catalogId: catalog.catalogId,
        sections,
      }),
    );
    return;
  }
  await ctx.send.list({
    header: `${BRAND.name} collections`,
    body: 'Pick a collection. Everything ships in 2–4 days, free above ₹1,499.',
    button: 'See collections',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Collections',
        rows: CATEGORIES.map((category) => {
          const products = productsIn(category.id);
          const from = Math.min(...products.map((product) => product.pricePaise));
          return {
            id: `cat:${category.id}`,
            title: category.title,
            description: `${products.length} items from ${formatInr(from)} · ${category.description}`,
          };
        }),
      },
    ],
  });
}

export async function category(ctx: ShopCtx, id: CategoryId): Promise<void> {
  const meta = CATEGORIES.find((entry) => entry.id === id);
  const products = productsIn(id);
  if (meta === undefined || products.length === 0) {
    return browse(ctx);
  }
  const catalog = await storefront(ctx);
  const inCatalog = catalog === null ? [] : products.filter((product) => catalog.skus.has(product.sku));
  if (catalog !== null && inCatalog.length > 0) {
    await ctx.send.interactive(
      ui.productList({
        header: meta.title,
        body: CART_HINT,
        footer: DEMO_FOOTER,
        catalogId: catalog.catalogId,
        sections: [{ title: meta.title, retailerIds: inCatalog.map((product) => product.sku) }],
      }),
    );
    return;
  }
  await productRows(ctx, meta.title, `${meta.description}. Tap one to see photos and sizes.`, products);
}

/** One product: the native product card from the catalog, or a photo card with buttons. */
export async function productCard(ctx: ShopCtx, sku: string): Promise<void> {
  const product = findProduct(sku);
  if (product === undefined) {
    return nudge(ctx, 'That product is no longer available. Here is what you can do next:');
  }
  const catalog = await storefront(ctx);
  if (catalog?.skus.has(sku) === true) {
    await ctx.send.interactive({
      type: 'product',
      body: { text: `${product.name}. ${CART_HINT}` },
      footer: { text: DEMO_FOOTER },
      action: { catalog_id: catalog.catalogId, product_retailer_id: sku },
    });
    return;
  }
  await ctx.send.buttons({
    header: { image: product.imageUrl },
    body: [
      `*${product.name}*`,
      priceTag(product),
      '',
      product.description,
      ...(product.sizes.length === 0 ? [] : ['', `Sizes: ${product.sizes.join(' · ')}`]),
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `cart:add:${sku}`, title: 'Add to cart' },
      { id: `cat:${product.category}`, title: 'More like this' },
      { id: 'cart:view', title: 'View cart' },
    ],
  });
}

/**
 * Today's deals as a carousel: native product cards with a catalog, image cards
 * with "Add to cart" quick replies without one. Then the coupon offer.
 */
export async function deals(ctx: ShopCtx): Promise<void> {
  const catalog = await storefront(ctx);
  const products = DEALS.flatMap((sku) => findProduct(sku) ?? []);
  await ctx.send.interactive(dealsCarousel(products, catalog));
  await ctx.send.buttons({
    body: 'Want an extra ₹200 off orders above ₹1,999? Get the festive coupon here in the chat.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'offer:claim', title: 'Get the coupon' },
      { id: 'cart:view', title: 'View cart' },
    ],
  });
}

function dealsCarousel(products: readonly Product[], catalog: StorefrontCatalog | null) {
  const body = "Today's deals: handpicked, up to 25% off until midnight.";
  const inCatalog = catalog === null ? [] : products.filter((product) => catalog.skus.has(product.sku));
  if (catalog !== null && inCatalog.length === products.length) {
    return ui.productCarousel(
      body,
      catalog.catalogId,
      products.map((product) => product.sku),
    );
  }
  return ui.mediaCarousel(
    body,
    products.map((product) => ({
      image: product.imageUrl,
      body: `${product.name}\n${plainPrice(product)}`,
      quickReplies: [
        { id: `cart:add:${product.sku}`, title: 'Add to cart' },
        { id: `product:${product.sku}`, title: 'Details' },
      ],
    })),
  );
}

export async function askForSearch(ctx: ShopCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'searching' }));
  await ctx.send.text(
    'What are you looking for? Type a few words, like *silk saree*, *king bedsheet* or *linen trousers*.',
  );
}

/** Free text in the shop is a search. No match → suggestions instead of a dead end. */
export async function search(ctx: ShopCtx, query: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browsing' }));
  const results = searchProducts(query);
  if (results.length === 0) {
    await ctx.send.buttons({
      body: `I couldn't find anything for "${query}". Try a colour or a fabric (_silk_, _linen_, _cotton_), or browse the collections.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: 'home:browse', title: 'Shop collections' },
        { id: 'home:deals', title: "Today's deals" },
        { id: 'menu:search', title: 'Search again' },
      ],
    });
    return;
  }
  if (results.length === 1 && results[0] !== undefined) {
    return productCard(ctx, results[0].sku);
  }
  const catalog = await storefront(ctx);
  if (catalog !== null && results.every((product) => catalog.skus.has(product.sku))) {
    await ctx.send.interactive(
      ui.productList({
        header: `Results for "${query}"`,
        body: CART_HINT,
        footer: DEMO_FOOTER,
        catalogId: catalog.catalogId,
        sections: [{ title: 'Best matches', retailerIds: results.map((product) => product.sku) }],
      }),
    );
    return;
  }
  await productRows(
    ctx,
    `Results for "${query}"`,
    `${results.length} matches. Tap one for details.`,
    results,
  );
}

async function productRows(
  ctx: ShopCtx,
  header: string,
  body: string,
  products: readonly Product[],
): Promise<void> {
  await ctx.send.list({
    header,
    body,
    button: 'See products',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Products',
        rows: products.slice(0, 10).map((product) => ({
          id: `product:${product.sku}`,
          title: product.name,
          description: `${plainPrice(product)} · ${product.description}`,
        })),
      },
    ],
  });
}
