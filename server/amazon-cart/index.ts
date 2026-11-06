// Reading one store's Amazon cart page: the page's HTML goes in and the cart's lines come out. Below it, reading a product's
// page into the request that adds one to a cart (addRequest). Nothing here fetches or sends;
// whoever holds the page, such as a person's own browser, hands it over as text.
//
// A page that is not that store's cart throws NotTheCart instead of reading as an empty cart, so a caller never takes a
// sign-in page, a blocked request or another store's cart for a cart emptied. Each store's cart is known by a mark
// recorded on real pages (test/fixtures/amazon-cart/README.md says which, and what is not yet known):
// - a grocery store's cart page (Amazon Fresh, Whole Foods Market) is one expanded grocery cart,
//   #sc-expanded-cart-localmarket, whose checkout box carries the store's brand id as data-brand-id. Regular Amazon's
//   cart page shows the grocery carts too, collapsed, each with its own checkout box, so only the expanded one counts.
// - regular Amazon's cart page has its active cart, #sc-active-cart. A signed-out page has one too, empty, so a page
//   whose header says "Hello, sign in" throws first.
// A cart whose count Amazon gives as more than none, with no line the reader knows, throws too: its lines changed shape.
import { dollars, parse, STORES, storeOfBrand, textOf, type Store } from '../amazon-orders/index.ts';

export type CartLine = { asin: string; name: string; price: number | null; quantity: number; lineId: string };

export type Cart = {
  store: Store;
  lines: CartLine[];
  /**
   * Amazon's own count of the items in this store's cart ("Subtotal (13 items)"), or the sum of the lines' quantities
   * when the page shows none. Amazon's count can differ from that sum: it counted 13 for 11 grocery lines.
   */
  items: number;
  /** The cart's address, where the person checks out. */
  url: string;
};

/**
 * Why a page is not the store's cart: `signed-out` when Amazon showed it to someone not signed in, `not-this-cart` for
 * anything else, such as another store's cart, a page that refuses automated requests, or a change at Amazon.
 */
export type NotTheCartKind = 'signed-out' | 'not-this-cart';

/** Thrown by readCart for a page that is not the store's cart. The message is the reason, fit for a log. */
export class NotTheCart extends Error {
  override name = 'NotTheCart';
  constructor(
    readonly store: Store,
    readonly kind: NotTheCartKind,
    message: string,
  ) {
    super(message);
  }
}

/** The path on amazon.com of one store's cart page. */
export function cartPath(store: Store): string {
  return STORES[store].grocery ? `/cart/localmarket?almBrandId=${STORES[store].brandId}` : '/gp/cart/view.html';
}

/** "13", or "Subtotal (13 items):", as 13, or null. */
function itemCount(text: string | null | undefined): number | null {
  const found = text?.match(/^(\d+)$/)?.[1] ?? text?.match(/\((\d+) items?\)/)?.[1];
  return found === undefined ? null : Number(found);
}

/**
 * The active lines of one store's cart and Amazon's count of its items. "Buy it again" suggestions, saved-for-later
 * items and the other stores' carts on the same page are not lines. Throws NotTheCart for a page that is not this
 * store's cart.
 */
export function readCart(html: string, store: Store): Cart {
  const doc = parse(html);
  if (textOf(doc.querySelector('#nav-link-accountList-nav-line-1')).startsWith('Hello, sign in'))
    throw new NotTheCart(store, 'signed-out', `Amazon showed the ${store} cart page to someone not signed in`);
  const { brandId, grocery } = STORES[store];
  let lines: Element[];
  let counted: number | null;
  if (grocery) {
    const cart = doc.querySelector('#sc-expanded-cart-localmarket');
    if (!cart) throw new NotTheCart(store, 'not-this-cart', `The page has no grocery cart open, so it is not the ${store} cart`);
    const box = cart.querySelector('[data-brand-id]');
    const shown = box?.getAttribute('data-brand-id');
    if (!box || !shown) {
      // No grocery cart without one has been recorded; an empty grocery cart may be one (the README says what is known).
      throw new NotTheCart(store, 'not-this-cart', `The page's grocery cart has no checkout box naming its store, so it cannot be told to be the ${store} cart`);
    }
    if (shown !== brandId) throw new NotTheCart(store, 'not-this-cart', `The page is the ${storeOfBrand(shown) ?? `brand ${shown}`} cart, not the ${store} cart`);
    lines = [...cart.querySelectorAll(`[data-itemtype="active"][data-itemid][data-localmarket-brand="${brandId}"]`)];
    counted = itemCount(box.getAttribute('data-quantity')) ?? itemCount(textOf(cart.querySelector('#sc-subtotal-label-buybox')));
  } else {
    const cart = doc.querySelector('#sc-active-cart');
    if (!cart) throw new NotTheCart(store, 'not-this-cart', `The page has no active cart, so it is not the ${store} cart`);
    lines = [...cart.querySelectorAll('[data-itemtype="active"][data-itemid]:not([data-localmarket-brand])')];
    counted = itemCount(cart.getAttribute('data-cart-total-item-count'));
  }
  // Amazon counting items the page shows no line for means the lines changed shape, not that the cart is empty.
  if (counted && !lines.length) throw new NotTheCart(store, 'not-this-cart', `Amazon counts ${counted} items in the ${store} cart, but the page has no line the reader knows`);
  const read = lines.map((line) => ({
    asin: line.getAttribute('data-asin') ?? '',
    name: (line.getAttribute('data-producttitle') ?? '').trim(),
    price: line.hasAttribute('data-price') ? Number(line.getAttribute('data-price')) : dollars(textOf(line.querySelector('.sc-product-price'))),
    quantity: Number(line.getAttribute('data-quantity') ?? 1),
    lineId: line.getAttribute('data-itemid') ?? '',
  }));
  return {
    store,
    lines: read,
    items: counted ?? read.reduce((sum, line) => sum + line.quantity, 0),
    url: `https://www.amazon.com${cartPath(store)}`,
  };
}

// Adding to a cart: a product page's HTML goes in and the one request Amazon's own add button makes for one of that
// product comes out, for the person's own browser to send. A grocery store's page (Amazon Fresh, Whole Foods Market)
// carries its button's request as data, which is posted as it is; regular Amazon's page has a form, of which only the
// fields its add button needs are posted, to the address the search results' add button posts to, never the form's own
// address, which also takes Buy Now.
//
// A page that is not that product's page throws NotTheProduct. A product's page is known by its canonical link, which
// ends in the product number on every page recorded, a store's page of a product it does not sell included. A page
// signed out has the whole add form too, so its header is checked first, as readCart does.

/** The path on amazon.com of one product's page as one store sells it. */
export function productPath(asin: string, store: Store): string {
  return STORES[store].grocery ? `/dp/${asin}?almBrandId=${STORES[store].brandId}&fpw=alm` : `/dp/${asin}`;
}

/** The one POST Amazon's add button makes, with the headers it sends; the browser adds its cookies. */
export type AddRequest = { path: string; body: string; headers: Record<string, string> };

/** Why a page is not the product's page: `signed-out` when Amazon showed it to someone not signed in, `not-this-product` for anything else. */
export type NotTheProductKind = 'signed-out' | 'not-this-product';

/** Thrown by addRequest for a page that is not the product's page. The message is the reason, fit for a log. */
export class NotTheProduct extends Error {
  override name = 'NotTheProduct';
  constructor(
    readonly asin: string,
    readonly store: Store,
    readonly kind: NotTheProductKind,
    message: string,
  ) {
    super(message);
  }
}

/** The grocery add button's request data, with the store and product it names, or null when the page has none. */
function groceryButton(doc: DocumentFragment): { payload: string; data: Record<string, unknown> } | null {
  const payload = doc.querySelector('[data-action="fresh-add-to-cart"]')?.getAttribute('data-fresh-add-to-cart');
  if (!payload) return null;
  try {
    const data: unknown = JSON.parse(payload);
    return { payload, data: typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {} };
  } catch {
    return { payload, data: {} };
  }
}

/** The fields every recorded grocery add button carries, each a word: without one the request is not one recorded. */
const GROCERY_FIELDS = ['asin', 'brandId', 'csrfToken', 'offerListingID'] as const;

/**
 * The request that puts one of a product in one store's cart, read from that product's page at `productPath(asin,
 * store)`, or `{ notForSale }` with the reason in plain words when the store does not sell it right now. Throws
 * NotTheProduct for a page that is not the product's page, a signed-out page included, and for an add button whose
 * request is not the shape recorded, so a caller never sends a request it cannot vouch for.
 */
export function addRequest(html: string, asin: string, store: Store): AddRequest | { notForSale: string } {
  const doc = parse(html);
  if (textOf(doc.querySelector('#nav-link-accountList-nav-line-1')).startsWith('Hello, sign in'))
    throw new NotTheProduct(asin, store, 'signed-out', `Amazon showed the product page to someone not signed in`);
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let shown: string | undefined;
  try {
    shown = canonical ? new URL(canonical, 'https://www.amazon.com').pathname.split('/').at(-1) : undefined;
  } catch {
    shown = undefined;
  }
  if (!shown) throw new NotTheProduct(asin, store, 'not-this-product', `The page names no product, so it is not the page of ${asin}`);
  if (shown !== asin) throw new NotTheProduct(asin, store, 'not-this-product', `The page is the page of ${shown}, not of ${asin}`);
  const button = groceryButton(doc);
  const { brandId, grocery } = STORES[store];
  if (grocery) {
    if (!button) return { notForSale: `${store} does not sell it right now` };
    const missing = GROCERY_FIELDS.filter((name) => typeof button.data[name] !== 'string' || !button.data[name]);
    if (missing.length)
      throw new NotTheProduct(asin, store, 'not-this-product', `The page's add button has no ${missing.join(', ')}, so its request is not one recorded`);
    if (button.data.asin !== asin) throw new NotTheProduct(asin, store, 'not-this-product', `The page's add button adds ${String(button.data.asin)}, not ${asin}`);
    if (button.data.brandId !== brandId) {
      const other = storeOfBrand(String(button.data.brandId));
      return { notForSale: other ? `${store} does not sell it right now; ${other} does` : `${store} does not sell it right now` };
    }
    return { path: '/alm/addtofreshcart', body: button.payload, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } };
  }
  const form = doc.querySelector('#addToCart');
  const field = (name: string) => form?.querySelector(`input[name="${name}"]`)?.getAttribute('value') ?? '';
  const offer = field('items[0.base][offerListingId]');
  // A grocery product's page on regular Amazon offers it for delivery with a form whose cartType puts it in a grocery
  // cart (recorded as LOCAL_MARKET), and for pickup with a grocery store's button: neither adds to the regular cart.
  if (field('cartType')) return { notForSale: 'Amazon sells it only through Amazon Fresh or Whole Foods Market' };
  if (!offer) {
    const other = button && typeof button.data.brandId === 'string' ? storeOfBrand(button.data.brandId) : null;
    return { notForSale: other ? `Amazon sells it only through ${other}` : 'Amazon does not sell it right now' };
  }
  const token = field('anti-csrftoken-a2z');
  const formAsin = field('items[0.base][asin]');
  if (!token || formAsin !== asin)
    throw new NotTheProduct(asin, store, 'not-this-product', `The page's add form ${token ? `adds ${formAsin || 'no product'}, not ${asin}` : 'carries no token to add with'}`);
  const body = new URLSearchParams({
    'anti-csrftoken-a2z': token,
    clientName: field('clientName'),
    'items[0.base][asin]': asin,
    'items[0.base][offerListingId]': offer,
    'items[0.base][quantity]': '1',
  }).toString();
  return { path: '/cart/add-to-cart?ref=dp_start-bbf_1_glance', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
}
