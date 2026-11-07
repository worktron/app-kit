// Reading Amazon's order pages. The pages here keep the structure of real recordings, with every product, price, number
// and name made up (test/fixtures/amazon-orders/README.md).
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import packageJson from '../package.json';
import { dollars, isoDate, orderDetailsPath, ordersPath, parse, PERIODS, readOrderDetails, readOrderPage, readOrders, STORE_NAMES, storeOfBrand, textOf, type OrderLine } from '../server/amazon-orders';

const FIXTURES = join(import.meta.dir, 'fixtures/amazon-orders');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

test('an order reads as number, date, total, delivery, its products with their store, and how many more it left out', () => {
  expect(readOrders(fixture('orders.html'))).toEqual([
    {
      orderNumber: '111-0000000-0000001',
      placed: '2026-10-17',
      inStore: false,
      deliveredOn: '2026-10-18',
      total: 84.1,
      status: 'Delivered October 18',
      items: [
        { asin: 'B0TEST0001', name: 'Example Greek Yogurt 32oz', store: 'Amazon Fresh' },
        { asin: 'B0TEST0005', name: 'Example Bok Choy, 3 Count', store: 'Amazon Fresh' },
      ],
      moreItems: 6,
    },
    {
      orderNumber: '111-0000000-0000002',
      placed: '2026-10-08',
      inStore: false,
      deliveredOn: null,
      total: 22.4,
      status: 'Arriving tomorrow',
      items: [{ asin: 'B0TEST0003', name: 'Example Tall Kitchen Bags, 13 Gallon, 60ct', store: 'Amazon' }],
      moreItems: 0,
    },
  ]);
});

test('a cancelled or refunded order says so, and a card with no order number or a page with no cards reads as none', () => {
  const page = fixture('orders.html');
  expect(readOrders(page.replace('Delivered October 18', 'Cancelled'))[0]!.status).toBe('Cancelled');
  expect(readOrders(page.replace('Delivered October 18', 'Refunded'))[0]!.status).toBe('Refunded');
  expect(readOrders(page.replace('111-0000000-0000001', 'no number')).map((order) => order.orderNumber)).toEqual(['111-0000000-0000002']);
  expect(readOrders('<html><body><h1>Sign in</h1></body></html>')).toEqual([]);
});

test('a details page gives products from its item rows, with their store, not the products Amazon recommends beside them', () => {
  const items = readOrderDetails(fixture('order-details-fresh.html'));
  expect(items.map((item) => item.asin)).toEqual(['B0TEST0001', 'B0TEST0005', 'B0TEST0007', 'B0TEST0008', 'B0TEST0009', 'B0TEST0010', 'B0TEST0011', 'B0TEST0012']);
  expect(items.every((item) => item.store === 'Amazon Fresh')).toBe(true);
});

test('a replacement reads as the product delivered, not the one it replaced', () => {
  const names = readOrderDetails(fixture('order-details-fresh.html')).map((item) => item.name);
  expect(names).toContain('Example Lemon');
  expect(names).not.toContain('Example Lime');
});

test("the delivery address and the card's digits on a details page never reach an answer", () => {
  for (const name of ['order-details-fresh.html', 'order-details-instore.html', 'order-details-regular.html', 'order-details-wholefoods.html', 'order-details-out-of-stock.html']) {
    const answer = JSON.stringify([readOrderDetails(fixture(name)), readOrderPage(fixture(name))]);
    for (const secret of ['123 Example Street', 'Example Person', '4242', 'Visa', 'Driver tip']) expect(answer).not.toContain(secret);
  }
});

test('an in-store purchase is labelled by the store its card names, and reads the receipt lines with a product link only', () => {
  expect(readOrders(fixture('orders-instore.html'))[0]).toMatchObject({
    orderNumber: '111-0000000-0000003',
    placed: '2025-11-25',
    inStore: true,
    deliveredOn: null,
    total: 50,
    items: [{ asin: 'B0TEST0021', name: 'Example Protein Powder', store: 'Whole Foods Market' }],
    moreItems: 3,
  });
  expect(readOrderDetails(fixture('order-details-instore.html'))).toEqual([
    { asin: 'B0TEST0021', name: 'Example Protein Powder', store: 'Whole Foods Market' },
    { asin: 'B0TEST0022', name: 'Example Garlic Bulbs, 3 Count', store: 'Whole Foods Market' },
    { asin: 'B0TEST0023', name: 'Example Ramen Noodles, 3 Pack', store: 'Whole Foods Market' },
    { asin: 'B0TEST0024', name: 'Example Baby Bok Choy, 1 Each', store: 'Whole Foods Market' },
  ]);
});

test('a delivered date is the one day a card names, with the year of the order, or the next when its month is earlier', () => {
  const days = Object.fromEntries(readOrders(fixture('orders-delivered.html')).map((order) => [order.orderNumber.slice(-2), order.deliveredOn]));
  expect(days).toEqual({
    // A Whole Foods card past its first weeks names no delivery.
    '10': null,
    // A regular order shipped in parts names two days, which one date would misstate; two parts on one day are one day.
    '11': null,
    '12': '2026-10-10',
    // "Delivered Friday, January 3 at 8:04 PM" on an order placed December 30, 2025.
    '13': '2026-01-03',
    '14': '2023-12-09',
    // "today" and "yesterday" are days in a time zone the page does not name.
    '15': null,
    '16': null,
  });
  expect(readOrders(fixture('orders-delivered.html')).every((order) => !order.inStore)).toBe(true);
});

const line = (fields: Partial<OrderLine> & Pick<OrderLine, 'asin' | 'name'>): OrderLine => ({ store: 'Whole Foods Market', count: 1, weight: null, priceCents: null, replaces: null, ...fields });

test("a delivery's page reads the day it was ordered, and each line's count, weight, price and what it replaced", () => {
  expect(readOrderPage(fixture('order-details-wholefoods.html'))).toEqual({
    orderedOn: '2026-09-10',
    inStore: false,
    lines: [
      // Sold by weight: the count column holds the weight.
      line({ asin: 'B0TEST0031', name: 'Example Pasture Raised Ground Beef', weight: '2.40 lb', priceCents: 1920 }),
      // The replaced product's own "Qty: 2 (0.48 lb)" in the status box is not this line's.
      line({ asin: 'B0TEST0032', name: 'Example Red Plum', weight: '0.50 lb', priceCents: 125, replaces: 'Example Black Plum' }),
      // Counted and priced by the pound: both.
      line({ asin: 'B0TEST0033', name: 'Example Honeycrisp Apple', count: 2, weight: '0.80 lb', priceCents: 280 }),
      line({ asin: 'B0TEST0034', name: 'Example Organic Ground Beef', weight: '2.00 lb', priceCents: 2000, replaces: 'Example Ground Beef 85/15' }),
      line({ asin: 'B0TEST0035', name: 'Example Trimmed Green Beans, 12 OZ', count: 2, priceCents: 800 }),
      line({ asin: 'B0TEST0036', name: 'Example Sparkling Hop Water, 6 Pack', priceCents: 1100 }),
    ],
  });
  // The summary's "Ordered September 10, 2026 5:02PM" gives the same day when the status line is gone.
  const summaryOnly = fixture('order-details-wholefoods.html').replace('Ordered on Thursday, September 10, 2026', '');
  expect(readOrderPage(summaryOnly).orderedOn).toBe('2026-09-10');
});

test('a line out of stock in full is kept at count 0 and price 0, and one partly filled keeps the count and price that came', () => {
  const page = readOrderPage(fixture('order-details-out-of-stock.html'));
  expect(page.orderedOn).toBe('2026-10-03');
  expect(page.lines).toEqual([
    // Two ordered, one out of stock, its credit beside the box: the other one, at what it cost.
    line({ asin: 'B0TEST0041', name: 'Example Jasmine Rice, 30 Ounce', priceCents: 700 }),
    line({ asin: 'B0TEST0042', name: 'Example Frozen Dessert Bars', count: 0, priceCents: 0 }),
    // The credit in a bare span, as an older recording has it.
    line({ asin: 'B0TEST0043', name: 'Example Large Avocado', count: 0, priceCents: 0 }),
    // No credit shown: the share that came.
    line({ asin: 'B0TEST0044', name: 'Example Lime, 1 Each', count: 2, priceCents: 120 }),
    // Words in a product's name are not a status.
    line({ asin: 'B0TEST0045', name: 'Example Out of Stock Notebook (Out of stock)', priceCents: 500 }),
  ]);
  expect(readOrderDetails(fixture('order-details-out-of-stock.html')).map((item) => item.asin)).toEqual(['B0TEST0041', 'B0TEST0044', 'B0TEST0045']);
});

test("an in-store receipt reads the day in its status, and every line, loose produce too, at the line's own total", () => {
  expect(readOrderPage(fixture('order-details-instore.html'))).toEqual({
    orderedOn: '2026-02-18',
    inStore: true,
    lines: [
      line({ asin: null, name: 'Example Organic Banana', weight: '2.1 lb', priceCents: 168 }),
      line({ asin: 'B0TEST0021', name: 'Example Protein Powder', count: 2, priceCents: 2000 }),
      line({ asin: 'B0TEST0022', name: 'Example Garlic Bulbs, 3 Count', priceCents: 300 }),
      // "Qty: 2 @ $6.00 each" with $3.60 off: the line's $8.40, never 2 times $6.00.
      line({ asin: 'B0TEST0023', name: 'Example Ramen Noodles, 3 Pack', count: 2, priceCents: 840 }),
      line({ asin: 'B0TEST0024', name: 'Example Baby Bok Choy, 1 Each', weight: '1.07 lb', priceCents: 321 }),
      line({ asin: null, name: 'Example Organic Strawberries', priceCents: 800 }),
      // Two lines with one name stay two lines: what to make of them is the reader's.
      line({ asin: null, name: 'Example Organic Banana', weight: '1.0 lb', priceCents: 80 }),
    ],
  });
  // The receipt's summary says "Purchased Wednesday, February 18, 2026" too; the status's "Purchased on" is the one read.
  const summaryOnly = fixture('order-details-instore.html').replace('Purchased on Wednesday, February 18, 2026', '');
  expect(readOrderPage(summaryOnly).orderedOn).toBeNull();
});

test("a regular order's page, and a page that is not an order's, read as no lines and no day", () => {
  expect(readOrderPage(fixture('order-details-regular.html'))).toEqual({ orderedOn: null, inStore: false, lines: [] });
  expect(readOrderPage('<html><body><h1>Sign in</h1></body></html>')).toEqual({ orderedOn: null, inStore: false, lines: [] });
});

test("a regular order's details page reads as none", () => {
  expect(readOrderDetails(fixture('order-details-regular.html'))).toEqual([]);
});

test("order history is asked for in the clear, through the page's own fallback for its decryption", () => {
  expect(ordersPath('months-3', 2)).toBe('/your-orders/orders?timeFilter=months-3&page=2&disableCsd=missing-library');
  expect(orderDetailsPath('111-0000000-0000001')).toBe('/your-orders/order-details?orderID=111-0000000-0000001');
});

test('the periods are the last 30 days, three months and thirteen years back from this one', () => {
  const year = new Date().getFullYear();
  expect(PERIODS.slice(0, 3)).toEqual(['last30', 'months-3', `year-${year}`]);
  expect(PERIODS).toHaveLength(15);
  expect(PERIODS.at(-1)).toBe(`year-${year - 12}`);
});

test('dates, dollars, text and stores read as Amazon prints them, and what is not there reads as null', () => {
  expect(isoDate('Oct 7, 2026')).toBe('2026-10-07');
  expect(isoDate('October 17, 2026')).toBe('2026-10-17');
  expect([isoDate('Someday 7, 2026'), isoDate('tomorrow'), isoDate(undefined)]).toEqual([null, null, null]);
  expect(dollars('Total $1,284.10')).toBe(1284.1);
  expect([dollars('no price'), dollars(null)]).toEqual([null, null]);
  expect(textOf(parse('<p id="a">  one \n  two </p>').querySelector('#a'))).toBe('one two');
  expect(textOf(null)).toBe('');
  expect(STORE_NAMES.map((name) => name)).toEqual(['Amazon Fresh', 'Whole Foods Market', 'Amazon']);
  expect(storeOfBrand('QW1hem9uIEZyZXNo')).toBe('Amazon Fresh');
  expect(storeOfBrand('VUZHIFdob2xlIEZvb2Rz')).toBe('Whole Foods Market');
  expect(storeOfBrand('retail')).toBe('Amazon');
  expect(storeOfBrand('unknown')).toBeNull();
});

test('reading a page sent to a server fetches nothing it names, runs nothing in it, and leaves the process free to end', () => {
  const run = Bun.spawnSync(['bun', join(import.meta.dir, 'amazon-orders-child.ts')], { stdout: 'pipe', stderr: 'pipe' });
  expect(run.stderr.toString()).toBe('');
  expect(run.exitCode).toBe(0);
  const seen = JSON.parse(run.stdout.toString());
  expect(seen.elements).toBeGreaterThan(5);
  expect(seen).toEqual({ page: 'undefined', orders: [], details: [], elements: seen.elements, attached: 0, asked: ['/after'], thrown: [], ran: false });
});

test('what a script or style holds is not read as part of an order, wherever it sits', () => {
  const page = fixture('orders.html');
  const script = '<script>var words = "Cancelled and 9 more";</script>';
  const style = '<style>.x::after { content: "and 9 more"; }</style>';
  const inCard = readOrders(page.replace('Delivered October 18', `Delivered October 18${script}${style}`));
  expect(inCard[0]).toMatchObject({ status: 'Delivered October 18', moreItems: 6 });
  // happy-dom's parser, given these itself, stops reading at the first in an svg and reads the body of the second as text.
  const inSvg = readOrders(page.replace('Delivered October 18', `Delivered October 18<svg>${style}${script}</svg>`));
  expect(inSvg.map((order) => order.orderNumber)).toEqual(['111-0000000-0000001', '111-0000000-0000002']);
  const inTable = readOrders(page.replace('Delivered October 18', `Delivered October 18<table><tr>${script}<td>x</td></tr></table>`));
  expect(inTable[0]).toMatchObject({ status: 'Delivered October 18', moreItems: 6 });
  expect(parse(page.replace('<div', `${script}${style}<div`)).querySelectorAll('script, style')).toHaveLength(0);
});

test('a page of unclosed script and style tags reads as none, and at once', () => {
  // A pattern over the whole page took half a minute on this size, far past the test's limit; this takes milliseconds.
  expect(readOrders('<script '.repeat(25_000))).toEqual([]);
  expect(readOrders('<style '.repeat(25_000))).toEqual([]);
  expect(readOrders(`${'<script></script>'.repeat(100)}${'<script '.repeat(25_000)}`)).toEqual([]);
});

test('the part has one import name, and happy-dom is an optional peer only it imports, so an app without it needs none', async () => {
  const byName = await import('app-kit/amazon-orders');
  expect(byName.readOrders).toBe(readOrders);
  expect(packageJson.peerDependencies['happy-dom']).toBeDefined();
  expect(packageJson.peerDependenciesMeta['happy-dom']).toEqual({ optional: true });
  expect('happy-dom' in packageJson.dependencies).toBe(false);
  const tracked = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.tsx', '*.js', '*.jsx'], { stdout: 'pipe' }).stdout.toString().trim().split('\n');
  const shipped = tracked.filter((path) => !path.startsWith('server/amazon-orders/') && !path.startsWith('test/'));
  expect(shipped.length).toBeGreaterThan(50);
  const importsHappyDom = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]happy-dom/m;
  expect(shipped.filter((path) => importsHappyDom.test(readFileSync(path, 'utf8')))).toEqual([]);
});

test('every fixture holds only made-up order numbers, product numbers, names and card digits', () => {
  const pages = readdirSync(FIXTURES).filter((name) => name.endsWith('.html'));
  expect(pages).toHaveLength(8);
  for (const name of pages) {
    const text = fixture(name);
    for (const [number] of text.matchAll(/\b\d{3}-\d{7}-\d{7}\b/g)) expect(number).toStartWith('111-0000000-');
    for (const [, product] of text.matchAll(/(?:\/dp\/|\/gp\/product\/|id=")([A-Z0-9]{10})\b/g)) expect(product).toStartWith('B0TEST');
    for (const [, digits] of text.matchAll(/ending in (\d+)/g)) expect(digits).toBe('4242');
    for (const product of text.matchAll(/alt="([^"]+)"/g)) expect(product[1]).toStartWith('Example ');
  }
});
