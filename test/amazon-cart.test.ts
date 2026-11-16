// Reading Amazon's cart pages. The pages here keep the structure of real recordings, with every product, price, number
// and name made up (test/fixtures/amazon-cart/README.md says what each is and what is not yet known).
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { cartPath, NotTheCart, readCart } from '../server/amazon-cart';
import type { Store } from '../server/amazon-orders';

const FIXTURES = join(import.meta.dir, 'fixtures/amazon-cart');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const STORES: Store[] = ['Amazon Fresh', 'Whole Foods Market', 'Amazon'];

/** What readCart threw, as kind and message, or a failure when it threw nothing. */
function refusal(html: string, store: Store): { kind: string; message: string } {
  try {
    readCart(html, store);
  } catch (error) {
    if (!(error instanceof NotTheCart)) throw error;
    expect(error.store).toBe(store);
    expect(error.name).toBe('NotTheCart');
    return { kind: error.kind, message: error.message };
  }
  throw new Error(`readCart read the page as the ${store} cart`);
}

test("a grocery cart is its lines and Amazon's own count; the Buy it again suggestions are not lines", () => {
  expect(readCart(fixture('cart-fresh.html'), 'Amazon Fresh')).toEqual({
    store: 'Amazon Fresh',
    lines: [
      { asin: 'B0TEST0001', name: 'Example Greek Yogurt 32oz', price: 5.97, quantity: 1, lineId: '00000000-0000-4000-8000-000000000001' },
      { asin: 'B0TEST0007', name: 'Example Chicken Thighs, Weight Varies', price: 1.69, quantity: 2, lineId: '00000000-0000-4000-8000-000000000002' },
    ],
    items: 3,
    url: 'https://www.amazon.com/cart/localmarket?almBrandId=QW1hem9uIEZyZXNo',
    subtotal: 9.35,
    freeDelivery: { at: 5, reached: true },
  });
});

test("a Whole Foods line with no price in its data takes the shown price, and Amazon's count need not be the lines' sum", () => {
  expect(readCart(fixture('cart-wholefoods.html'), 'Whole Foods Market')).toEqual({
    store: 'Whole Foods Market',
    lines: [
      { asin: 'B0TEST0011', name: 'Example Sourdough Loaf', price: 3.49, quantity: 1, lineId: '00000000-0000-4000-8000-000000000011' },
      { asin: 'B0TEST0012', name: 'Example Bananas, Bunch', price: 2.66, quantity: 3, lineId: '00000000-0000-4000-8000-000000000012' },
    ],
    items: 4,
    url: 'https://www.amazon.com/cart/localmarket?almBrandId=VUZHIFdob2xlIEZvb2Rz',
    subtotal: 11.46,
    // This page's checkout box has no free-delivery box, as for someone whose delivery is never free.
    freeDelivery: null,
  });
});

test("the regular cart is its active lines, not saved ones, and not the collapsed grocery carts' counts", () => {
  expect(readCart(fixture('cart-regular.html'), 'Amazon')).toEqual({
    store: 'Amazon',
    lines: [{ asin: 'B0TEST0003', name: 'Example Tall Kitchen Bags, 13 Gallon, 60ct', price: 9.52, quantity: 2, lineId: '00000000-0000-4000-8000-000000000003' }],
    items: 2,
    url: 'https://www.amazon.com/gp/cart/view.html',
    // The collapsed grocery carts' boxes on this page show a subtotal and free delivery; neither is this cart's.
    subtotal: null,
    freeDelivery: null,
  });
});

/** The Fresh page with its free-delivery box showing the bar at `percentage` and the amount `amount`. */
function freshWithDelivery(percentage: string, amount: string): string {
  return fixture('cart-fresh.html')
    .replace('data-progress-percentage="100"', `data-progress-percentage="${percentage}"`)
    .replace('<span class="a-size-base a-color-secondary">$5</span>', `<span class="a-size-base a-color-secondary">${amount}</span>`);
}

test("a grocery cart's subtotal is the discounted one, and its free delivery counts only when the bar and the amounts agree", () => {
  // The recorded page: a full bar, with the amount at or below the subtotal of $9.35.
  expect(readCart(fixture('cart-fresh.html'), 'Amazon Fresh')).toMatchObject({ subtotal: 9.35, freeDelivery: { at: 5, reached: true } });
  expect(readCart(freshWithDelivery('100', '$9.35'), 'Amazon Fresh').freeDelivery).toEqual({ at: 9.35, reached: true });
  // A short bar with the amount above the subtotal and the bar its share ($9.35 of $25 is 37%): under the amount.
  expect(readCart(freshWithDelivery('37', '$25'), 'Amazon Fresh').freeDelivery).toEqual({ at: 25, reached: false });
  // The same bar beside the dollars still to go ($15.65), or beside an amount the bar is not the share of: none.
  expect(readCart(freshWithDelivery('37', '$15.65'), 'Amazon Fresh').freeDelivery).toBeNull();
  expect(readCart(freshWithDelivery('10', '$25'), 'Amazon Fresh').freeDelivery).toBeNull();
  // A full bar with the amount above the subtotal, or a short bar with it at or below: the numbers disagree, so none.
  expect(readCart(freshWithDelivery('100', '$25'), 'Amazon Fresh').freeDelivery).toBeNull();
  expect(readCart(freshWithDelivery('37', '$3.46'), 'Amazon Fresh').freeDelivery).toBeNull();
  expect(readCart(freshWithDelivery('37', '$9.35'), 'Amazon Fresh').freeDelivery).toBeNull();
  // A bar with no percentage, or an amount that is not dollars: none.
  expect(readCart(freshWithDelivery('', '$5'), 'Amazon Fresh').freeDelivery).toBeNull();
  expect(readCart(freshWithDelivery('100', 'FREE'), 'Amazon Fresh').freeDelivery).toBeNull();
});

test('a grocery cart whose checkout box has no free-delivery box has no free delivery, and keeps its subtotal', () => {
  const noBox = fixture('cart-fresh.html').replace(/<div class="sc-fresh-delivery-threshold">[\s\S]*?<\/span><\/div>\n/, '');
  expect(noBox).not.toContain('sc-fresh-delivery-threshold');
  expect(readCart(noBox, 'Amazon Fresh')).toMatchObject({ subtotal: 9.35, freeDelivery: null });
});

test('an empty grocery cart, whose box shows no subtotal, reads as no subtotal and no free delivery', () => {
  // The recorded page with its lines and subtotal taken out; an empty grocery cart has not been recorded (README).
  const empty = fixture('cart-fresh.html')
    .replace(/<div data-asin=[\s\S]*?<\/div>\n/g, '')
    .replace('data-quantity="3"', 'data-quantity="0"')
    .replace(/<span id="sc-subtotal-amount-buybox"[\s\S]*?<\/span><\/span>\n/, '')
    .replace('data-progress-percentage="100"', 'data-progress-percentage="0"');
  expect(empty).not.toContain('sc-subtotal-amount-buybox');
  expect(readCart(empty, 'Amazon Fresh')).toMatchObject({ lines: [], items: 0, subtotal: null, freeDelivery: null });
});

test("a page with the store's cart mark and no lines reads as that cart with no lines", () => {
  // Recorded pages with their lines taken out. Whether Amazon's own empty carts look like this is in the README.
  const regular = fixture('cart-regular.html').replace(/<div data-asin="B0TEST0003"[\s\S]*?<\/div>\n/, '').replace('data-cart-total-item-count="2"', 'data-cart-total-item-count="0"');
  expect(readCart(regular, 'Amazon')).toMatchObject({ lines: [], items: 0 });
  const fresh = fixture('cart-fresh.html').replace(/<div data-asin=[\s\S]*?<\/div>\n/g, '').replace('data-quantity="3"', 'data-quantity="0"');
  expect(readCart(fresh, 'Amazon Fresh')).toMatchObject({ lines: [], items: 0 });
});

test("one store's cart page is never read as another store's cart", () => {
  expect(refusal(fixture('cart-fresh.html'), 'Whole Foods Market')).toEqual({ kind: 'not-this-cart', message: 'The page is the Amazon Fresh cart, not the Whole Foods Market cart' });
  expect(refusal(fixture('cart-wholefoods.html'), 'Amazon Fresh')).toEqual({ kind: 'not-this-cart', message: 'The page is the Whole Foods Market cart, not the Amazon Fresh cart' });
  expect(refusal(fixture('cart-fresh.html'), 'Amazon')).toEqual({ kind: 'not-this-cart', message: 'The page has no active cart, so it is not the Amazon cart' });
  // Regular Amazon's page shows both grocery carts collapsed, each with its checkout box naming its store.
  expect(refusal(fixture('cart-regular.html'), 'Amazon Fresh')).toEqual({ kind: 'not-this-cart', message: 'The page has no grocery cart open, so it is not the Amazon Fresh cart' });
  expect(refusal(fixture('cart-regular.html'), 'Whole Foods Market').kind).toBe('not-this-cart');
});

test('a signed-out page throws as signed out for every store, never reading as an empty cart', () => {
  for (const name of ['signed-out-cart.html', 'signed-out-grocery.html']) {
    for (const store of STORES) {
      expect(refusal(fixture(name), store)).toEqual({ kind: 'signed-out', message: `Amazon showed the ${store} cart page to someone not signed in` });
    }
  }
});

test('a page refusing the request, a page of nothing, and a grocery cart with no checkout box naming its store all throw', () => {
  for (const store of STORES) {
    expect(refusal(fixture('refused.html'), store).kind).toBe('not-this-cart');
    expect(refusal('', store).kind).toBe('not-this-cart');
  }
  const noBox = fixture('cart-fresh.html').replace(/<div id="sc-fresh-buy-box"[\s\S]*?<\/form><\/div>/, '');
  expect(refusal(noBox, 'Amazon Fresh')).toEqual({
    kind: 'not-this-cart',
    message: "The page's grocery cart has no checkout box naming its store, so it cannot be told to be the Amazon Fresh cart",
  });
});

test('a cart Amazon counts items in, with no line the reader knows, throws instead of reading as empty', () => {
  // Lines whose shape changed at Amazon: the cart's mark and count stay, and its lines lose the attribute read.
  const regular = fixture('cart-regular.html').replace('data-itemtype="active"', 'data-itemtype="changed"');
  expect(refusal(regular, 'Amazon')).toEqual({ kind: 'not-this-cart', message: 'Amazon counts 2 items in the Amazon cart, but the page has no line the reader knows' });
  const fresh = fixture('cart-fresh.html').replaceAll('data-itemtype="active"', 'data-itemtype="changed"');
  expect(refusal(fresh, 'Amazon Fresh')).toEqual({ kind: 'not-this-cart', message: 'Amazon counts 3 items in the Amazon Fresh cart, but the page has no line the reader knows' });
});

test('each cart has its own address', () => {
  expect(cartPath('Amazon Fresh')).toBe('/cart/localmarket?almBrandId=QW1hem9uIEZyZXNo');
  expect(cartPath('Whole Foods Market')).toBe('/cart/localmarket?almBrandId=VUZHIFdob2xlIEZvb2Rz');
  expect(cartPath('Amazon')).toBe('/gp/cart/view.html');
});

test('the part has its own import name', async () => {
  const byName = await import('app-kit/amazon-cart');
  expect(byName.readCart).toBe(readCart);
  expect(byName.NotTheCart).toBe(NotTheCart);
});

test('every fixture holds only made-up product numbers, line ids, names and places', () => {
  const pages = readdirSync(FIXTURES).filter((name) => name.endsWith('.html'));
  expect(pages).toHaveLength(11);
  for (const name of pages) {
    const text = fixture(name);
    for (const [, product] of text.matchAll(/(?:data-asin="|amzn1\.asin\.|\/dp\/|\/clp\/|&quot;asin&quot;:&quot;|"ASIN" value="|\[asin\]" value=")([A-Z0-9]{10})\b/g)) expect(product).toStartWith('B0TEST');
    for (const [id] of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g)) expect(id).toStartWith('00000000-0000-4000-8000-');
    for (const [, title] of text.matchAll(/data-producttitle="([^"]+)"/g)) expect(title!.trim()).toStartWith('Example ');
    for (const [, hello] of text.matchAll(/>Hello, ([^<]+)</g)) expect(['Example', 'sign in']).toContain(hello!);
    for (const [, place] of text.matchAll(/Delivering to ([^<]+)</g)) expect(place).toBe('Exampletown 00000');
  }
});
