// The request that adds a product to an Amazon cart, read from its product page. The pages here keep the structure of
// real recordings, with every product, token and name made up (test/fixtures/amazon-cart/README.md says what each is).
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { addRequest, NotTheProduct, productPath } from '../server/amazon-cart';
import type { Store } from '../server/amazon-orders';
import { refusal as neverSent } from '../extension/worker/amazon-never-sent.js';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/amazon-cart', name), 'utf8');
const STORES: Store[] = ['Amazon Fresh', 'Whole Foods Market', 'Amazon'];

/** What addRequest threw, as kind and message, or a failure when it threw nothing. */
function thrown(html: string, asin: string, store: Store): { kind: string; message: string } {
  try {
    addRequest(html, asin, store);
  } catch (error) {
    if (!(error instanceof NotTheProduct)) throw error;
    expect(error).toMatchObject({ name: 'NotTheProduct', asin, store });
    return { kind: error.kind, message: error.message };
  }
  throw new Error(`addRequest read the page as the page of ${asin} at ${store}`);
}

test("a grocery store's add is its button's own data, posted as JSON to the grocery cart", () => {
  const request = addRequest(fixture('product-fresh.html'), 'B0TEST0001', 'Amazon Fresh');
  expect(request).toEqual({
    path: '/alm/addtofreshcart',
    body: expect.any(String),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!('body' in request)) throw new Error('no request');
  expect(JSON.parse(request.body)).toMatchObject({ asin: 'B0TEST0001', brandId: 'QW1hem9uIEZyZXNo', csrfToken: 'TOKEN-PRODUCT', offerListingID: 'OFFER-0001' });
});

test("regular Amazon's add posts only the add button's fields, for one, never to the form's address that takes Buy Now", () => {
  const request = addRequest(fixture('product-regular.html'), 'B0TEST0003', 'Amazon');
  expect(request).toEqual({
    path: '/cart/add-to-cart?ref=dp_start-bbf_1_glance',
    body: 'anti-csrftoken-a2z=TOKEN-PRODUCT&clientName=OffersX_OfferDisplay_DetailPage&items%5B0.base%5D%5Basin%5D=B0TEST0003&items%5B0.base%5D%5BofferListingId%5D=OFFER-0003&items%5B0.base%5D%5Bquantity%5D=1',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
});

test('every add request passes the never-sent list', () => {
  for (const [page, asin, store] of [
    ['product-fresh.html', 'B0TEST0001', 'Amazon Fresh'],
    ['product-grocery-on-regular.html', 'B0TEST0001', 'Whole Foods Market'],
    ['product-regular.html', 'B0TEST0003', 'Amazon'],
  ] as const) {
    const request = addRequest(fixture(page), asin, store);
    if (!('body' in request)) throw new Error(`${page} gave no request`);
    expect(neverSent('POST', request.path, request.body)).toBeNull();
  }
});

test('a product the store does not sell right now is not for sale, in plain words', () => {
  expect(addRequest(fixture('product-not-sold.html'), 'B0TEST0003', 'Whole Foods Market')).toEqual({ notForSale: 'Whole Foods Market does not sell it right now' });
  expect(addRequest(fixture('product-not-sold.html'), 'B0TEST0003', 'Amazon')).toEqual({ notForSale: 'Amazon does not sell it right now' });
  expect(addRequest(fixture('product-regular.html'), 'B0TEST0003', 'Amazon Fresh')).toEqual({ notForSale: 'Amazon Fresh does not sell it right now' });
});

test("a grocery product's regular page carries another store's button, which is never posted for the store asked", () => {
  // Recorded 2026-11-05: an Amazon Fresh product's page on regular Amazon offered it for delivery with a form for a
  // grocery cart and for pickup with Whole Foods Market's button.
  const page = fixture('product-grocery-on-regular.html');
  expect(addRequest(page, 'B0TEST0001', 'Amazon')).toEqual({ notForSale: 'Amazon sells it only through Amazon Fresh or Whole Foods Market' });
  // A grocery button with no regular offer beside it.
  const onlyButton = fixture('product-fresh.html');
  expect(addRequest(onlyButton, 'B0TEST0001', 'Amazon')).toEqual({ notForSale: 'Amazon sells it only through Amazon Fresh' });
  expect(addRequest(page, 'B0TEST0001', 'Amazon Fresh')).toEqual({ notForSale: 'Amazon Fresh does not sell it right now; Whole Foods Market does' });
  expect(addRequest(page, 'B0TEST0001', 'Whole Foods Market')).toMatchObject({ path: '/alm/addtofreshcart' });
});

test("a page that is not the product's page throws, whatever it holds", () => {
  for (const store of STORES) {
    expect(thrown(fixture('product-regular.html'), 'B0TEST0001', store)).toEqual({ kind: 'not-this-product', message: 'The page is the page of B0TEST0003, not of B0TEST0001' });
    expect(thrown(fixture('refused.html'), 'B0TEST0001', store)).toEqual({ kind: 'not-this-product', message: 'The page names no product, so it is not the page of B0TEST0001' });
    expect(thrown(fixture('cart-fresh.html'), 'B0TEST0001', store).kind).toBe('not-this-product');
    expect(thrown('', 'B0TEST0001', store).kind).toBe('not-this-product');
  }
});

test('a signed-out page throws as signed out, though it has the whole add form', () => {
  for (const store of STORES) {
    expect(thrown(fixture('product-signed-out.html'), 'B0TEST0003', store)).toEqual({ kind: 'signed-out', message: 'Amazon showed the product page to someone not signed in' });
  }
});

test('an add button or form that names another product, or carries no token, throws rather than adding', () => {
  const otherButton = fixture('product-fresh.html').replace('&quot;asin&quot;:&quot;B0TEST0001', '&quot;asin&quot;:&quot;B0TEST0002');
  expect(thrown(otherButton, 'B0TEST0001', 'Amazon Fresh').message).toBe("The page's add button adds B0TEST0002, not B0TEST0001");
  const brokenButton = fixture('product-fresh.html').replace(/data-fresh-add-to-cart="[^"]*"/, 'data-fresh-add-to-cart="not data"');
  expect(thrown(brokenButton, 'B0TEST0001', 'Amazon Fresh').message).toBe("The page's add button has no asin, brandId, csrfToken, offerListingID, so its request is not one recorded");
  const noOffer = fixture('product-fresh.html').replace('&quot;offerListingID&quot;:&quot;OFFER-0001&quot;', '&quot;offerListingID&quot;:&quot;&quot;');
  expect(thrown(noOffer, 'B0TEST0001', 'Amazon Fresh').message).toBe("The page's add button has no offerListingID, so its request is not one recorded");
  const noToken = fixture('product-fresh.html').replace('&quot;csrfToken&quot;:&quot;TOKEN-PRODUCT&quot;,', '');
  expect(thrown(noToken, 'B0TEST0001', 'Amazon Fresh').message).toBe("The page's add button has no csrfToken, so its request is not one recorded");
  const otherForm = fixture('product-regular.html').replace('name="items[0.base][asin]" value="B0TEST0003"', 'name="items[0.base][asin]" value="B0TEST0004"');
  expect(thrown(otherForm, 'B0TEST0003', 'Amazon').message).toBe("The page's add form adds B0TEST0004, not B0TEST0003");
  const noFormToken = fixture('product-regular.html').replace('name="anti-csrftoken-a2z" value="TOKEN-PRODUCT"', 'name="anti-csrftoken-a2z" value=""');
  expect(thrown(noFormToken, 'B0TEST0003', 'Amazon').message).toBe("The page's add form carries no token to add with");
});

test("each store's product page has its own address", () => {
  expect(productPath('B0TEST0001', 'Amazon Fresh')).toBe('/dp/B0TEST0001?almBrandId=QW1hem9uIEZyZXNo&fpw=alm');
  expect(productPath('B0TEST0001', 'Whole Foods Market')).toBe('/dp/B0TEST0001?almBrandId=VUZHIFdob2xlIEZvb2Rz&fpw=alm');
  expect(productPath('B0TEST0003', 'Amazon')).toBe('/dp/B0TEST0003');
});

test('the add is part of the cart import name', async () => {
  const byName = await import('app-kit/amazon-cart');
  expect(byName.addRequest).toBe(addRequest);
  expect(byName.productPath).toBe(productPath);
  expect(byName.NotTheProduct).toBe(NotTheProduct);
});
