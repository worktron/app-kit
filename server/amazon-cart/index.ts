// Reading one store's Amazon cart page: the page's HTML goes in and the cart's lines come out. Nothing here fetches;
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
