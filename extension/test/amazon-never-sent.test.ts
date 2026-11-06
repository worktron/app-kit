// The Amazon requests no extension ever sends. The cases are amazon-connector's, whose list this is.
import { describe, expect, test } from 'bun:test'
import { landedOutside, NEVER_SENT, plainText, refusal } from '../worker/amazon-never-sent.js'

describe('refusal', () => {
  test.each([
    ['GET', '/s?k=greek+yogurt&i=amazonfresh'],
    ['GET', '/s?k=address+book'],
    ['GET', '/dp/B000000001?almBrandId=QW1hem9uIEZyZXNo&fpw=alm'],
    ['GET', '/gp/buyagain?filterToBanner=QW1hem9uIEZyZXNo'],
    ['GET', '/your-orders/order-details?orderID=111-0000000-0000001'],
    ['GET', '/gp/your-account/order-history'],
    ['GET', '/cart/localmarket?almBrandId=QW1hem9uIEZyZXNo'],
    ['GET', '/auto-deliveries/subscriptionList'],
    ['POST', '/alm/addtofreshcart'],
    ['POST', '/cart/add-to-cart?ref=dp_start-bbf_1_glance'],
    ['POST', '/cart/localmarket/update?ref_=ox_sc_cart_update'],
    ['POST', '/cart/ref=ord_cart_shr?app-nav-type=none&dc=df'],
  ])('lets %s %s through', (method, path) => {
    expect(refusal(method, path)).toBeNull()
  })

  test.each([
    ['GET', '/checkout/entry/cart'],
    ['POST', '/checkout/p/place-order'],
    ['GET', '/gp/buy/spc/handlers/display.html'],
    ['POST', '/gp/cart/desktop/go-to-checkout.html'],
    ['GET', '/ap/signin'],
    ['GET', '/ax/claim'],
    ['GET', '/cpe/yourpayments/wallet'],
    ['GET', '/a/addresses'],
    ['GET', '/gp/css/account/address/view.html'],
    ['GET', '/dp/B000000001?redirect=/checkout'],
    ['GET', '/s?k=yogurt&ref=proceedToRetailCheckout'],
    ['POST', '/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance'],
    ['POST', '/cart/byc/ref=ox_sc_byg_proceed'],
    ['GET', '/gp/cart/mobile/go-to-checkout.html/ref=ox_sc_proceed'],
    ['GET', '/gp/your-account/order-details?orderID=111-0000000-0000001'],
    ['GET', '/hz/mycd/myx'],
    // Subscriptions are read at one address; every way of changing one is refused.
    ['GET', '/auto-deliveries'],
    ['GET', '/auto-deliveries/landing'],
    ['GET', '/auto-deliveries/checkout/subscribe'],
    ['GET', '/auto-deliveries/subscriptionList/edit'],
    ['POST', '/auto-deliveries/ajax/subscription/'],
    ['GET', '/gp/subscribe-and-save/manage'],
  ])('refuses %s %s', (method, path) => {
    expect(refusal(method, path)).toBe(NEVER_SENT)
  })

  test('an encoded path or query is read as Amazon reads it', () => {
    for (const [method, path] of [
      ['POST', '/check%6fut/entry/cart'],
      ['POST', '/%63heckout/p/pl%61ce-order'],
      ['GET', '/%61p/signin'],
      ['GET', '/%2561p/signin'],
      ['GET', '/dp/%2e%2e/ap/signin'],
      ['GET', '/dp/%2E%2E/%2E%2E/cpe/yourpayments/wallet'],
      ['GET', '/s?ref=pro%2563eedToRetailCheckout'],
    ] as const) {
      expect([method, path, refusal(method, path)]).toEqual([method, path, NEVER_SENT])
    }
  })

  test('only GET and POST are sent, only to paths on www.amazon.com, and a GET carries no body', () => {
    expect(refusal('DELETE', '/gp/cart/view.html')).toBe('DELETE is never sent')
    expect(refusal('GET', 'https://evil.example/s')).toBe('Only paths on www.amazon.com are sent')
    expect(refusal('GET', '//evil.example/s')).toBe('Only paths on www.amazon.com are sent')
    expect(refusal('GET', 's')).toBe('Only paths on www.amazon.com are sent')
    expect(refusal('GET', '/gp/buyagain', 'x=1')).toBe('A GET carries no body')
    expect(refusal('GET', '/gp/buyagain', '')).toBeNull()
  })

  test('a body that starts a purchase is refused, whatever the path', () => {
    expect(refusal('POST', '/cart/ref=ord_cart_shr', 'anti-csrftoken-a2z=x&proceedToRetailCheckout=Proceed+to+checkout')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/add-to-cart', 'items%5B0.base%5D%5Basin%5D=B000000001&submit.buy-now=1')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/add-to-cart', 'buyNow=1')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/localmarket/update', 'payload=%7B%7D&actionType=place-order')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/localmarket/update', 'placeYourOrder1=1')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/localmarket/update', '{"turbo":true}')).toBe(NEVER_SENT)
  })

  test('encoding does not hide a purchase field: a malformed escape beside it, double encoding, or a JSON escape', () => {
    expect(refusal('POST', '/cart/ref=ord_cart_shr', 'pro%63eed%54oRetail%43heckout=1&note=100%')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/ref=ord_cart_shr', 'x=%zz&proceedT%6fRetailCheckout=1')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/ref=ord_cart_shr', 'pro%2563eedToRetailCheckout=1')).toBe(NEVER_SENT)
    expect(refusal('POST', '/cart/localmarket/update', '{"actionType":"\\u0063heckout"}')).toBe(NEVER_SENT)
    expect(plainText('a+b%2541')).toBe('a bA')
  })

  test("a body that only names its marketplace is let through", () => {
    const body = JSON.stringify({ almCardContextJson: JSON.stringify({ deviceTypeId: 'desktop', marketplaceId: 'ATVPDKIKX0DER' }) })
    expect(refusal('POST', '/acp/buy-again-grid-desktop/instance-1/getGridAsins', body)).toBeNull()
  })
})

describe('landedOutside', () => {
  test('an answer that ended at checkout or another site is not handed back; one that ended at sign-in is', () => {
    expect(landedOutside('https://www.amazon.com/checkout/entry/cart')).toBe(true)
    expect(landedOutside('https://www.amazon.com/check%6fut/entry/cart')).toBe(true)
    expect(landedOutside('https://evil.example/')).toBe(true)
    expect(landedOutside('not an address')).toBe(true)
    expect(landedOutside('https://www.amazon.com/gp/buyagain')).toBe(false)
    expect(landedOutside('https://www.amazon.com/ap/signin?openid.return_to=x')).toBe(false)
  })
})
