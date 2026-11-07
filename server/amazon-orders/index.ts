// Reading Amazon's order pages: the page's HTML goes in and orders come out. Nothing here fetches, since Amazon has no
// API and only the person's own browser can get these pages; whoever holds a page hands it over as text.
import { Window } from 'happy-dom';

const window = new Window();

/**
 * A page without one kind of element. Only the part up to the last closing tag is searched: past it every opening tag
 * would scan to the end of the page and find nothing, and a page of those takes time that grows with its size squared.
 */
function without(html: string, whole: RegExp, closing: RegExp): string {
  const last = [...html.matchAll(closing)].at(-1);
  if (!last) return html;
  const end = last.index + last[0].length;
  return html.slice(0, end).replace(whole, '') + html.slice(end);
}

/**
 * A page to search with querySelector and querySelectorAll. Scripts and styles are dropped first: nothing read lives in
 * them, and they are most of a page. It is parsed into a template, whose contents are never attached to a document: a
 * parsed document in happy-dom acts on some of what a page holds, sending a preload link's request or throwing where
 * nothing catches it on a relative one, and a page here may have been sent to a server by anyone.
 */
export function parse(html: string): DocumentFragment {
  const noScripts = without(html, /<script\b[\s\S]*?<\/script>/gi, /<\/script>/gi);
  const template = window.document.createElement('template');
  template.innerHTML = without(noScripts, /<style\b[\s\S]*?<\/style>/gi, /<\/style>/gi);
  return template.content as unknown as DocumentFragment;
}

/** An element's or a whole page's text with its whitespace collapsed. */
export function textOf(element: Node | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** "$5.97" as a number of dollars, or null. */
export function dollars(text: string | null | undefined): number | null {
  const match = text?.match(/\$\s?([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1]!.replace(/,/g, '')) : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 17, 2026" or "October 17, 2026" as "2026-10-17", or null. */
export function isoDate(text: string | null | undefined): string | null {
  const match = text?.match(/([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!);
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
}

// Amazon's three stores, by the names people see. A grocery store has a brand id, which Amazon puts in grocery URLs and
// data; regular Amazon is "retail" in that same data.
export const STORES = {
  'Amazon Fresh': { brandId: 'QW1hem9uIEZyZXNo', searchAlias: 'amazonfresh', grocery: true },
  'Whole Foods Market': { brandId: 'VUZHIFdob2xlIEZvb2Rz', searchAlias: 'wholefoods', grocery: true },
  Amazon: { brandId: 'retail', searchAlias: null, grocery: false },
} as const;

export type Store = keyof typeof STORES;

export const STORE_NAMES = ['Amazon Fresh', 'Whole Foods Market', 'Amazon'] as const satisfies readonly Store[];

export function storeOfBrand(brandId: string): Store | null {
  return STORE_NAMES.find((name) => STORES[name].brandId === brandId) ?? null;
}

export type OrderItem = { asin: string; name: string; store: Store };

export type Order = {
  orderNumber: string;
  /** Amazon's "Order placed", which for an evening order can be the next day. The order's own page has the day it was made. */
  placed: string | null;
  /** Bought in a Whole Foods Market store rather than delivered: the card says "Purchased at Whole Foods Market". */
  inStore: boolean;
  /**
   * The day the card says the order was delivered, when it names one day: null when it names none, names "today" or
   * "yesterday", whose day depends on a time zone, or names several, as a regular order shipped in parts can.
   */
  deliveredOn: string | null;
  total: number | null;
  /** Amazon's delivery line, such as "Delivered October 18" or "Arriving tomorrow". */
  status: string | null;
  items: OrderItem[];
  /** Products still not read: 0 when `items` holds the whole order. */
  moreItems: number;
  /** Why products are still not read, when the order's details page did not give them. */
  note?: string;
};

/** The periods Amazon's order history filters by. */
export const PERIODS: [string, ...string[]] = ['last30', 'months-3', ...Array.from({ length: 13 }, (_, n) => `year-${new Date().getFullYear() - n}`)];

// Amazon encrypts the order list and decrypts it in the browser; when its decryption library is missing, the page
// reloads itself with disableCsd=missing-library and is served in the clear. This asks for that page directly.
export function ordersPath(period: string, page: number): string {
  return `/your-orders/orders?${new URLSearchParams({ timeFilter: period, page: String(page), disableCsd: 'missing-library' })}`;
}

export const orderDetailsPath = (orderNumber: string) => `/your-orders/order-details?${new URLSearchParams({ orderID: orderNumber })}`;

const productNumber = (href: string) => href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
const brandOf = (href: string) => storeOfBrand(href.match(/almBrandId=([\w=]+)/)?.[1] ?? 'retail') ?? 'Amazon';

/** Reads one page of order history. */
export function readOrders(html: string): Order[] {
  const doc = parse(html);
  return [...doc.querySelectorAll('.order-card')].flatMap((card) => {
    const text = textOf(card);
    const orderNumber = text.match(/Order # ?(\d{3}-\d{7}-\d{7})/)?.[1];
    if (!orderNumber) return [];
    // An in-store purchase has no store in its links; its card says where it was bought.
    const inStore = /Purchased at Whole Foods Market/.test(text);
    const items = new Map<string, OrderItem>();
    for (const link of card.querySelectorAll('a[href*="/dp/"]')) {
      const href = link.getAttribute('href') ?? '';
      const asin = href.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
      const name = link.querySelector('img')?.getAttribute('alt')?.trim() || textOf(link);
      if (!asin || !name || items.has(asin)) continue;
      items.set(asin, { asin, name, store: inStore ? 'Whole Foods Market' : brandOf(href) });
    }
    const placed = isoDate(text.match(/Order placed ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1]);
    return [
      {
        orderNumber,
        placed,
        inStore,
        deliveredOn: deliveredOn(text, placed),
        total: dollars(text.match(/Total (\$[\d,.]+)/)?.[1]),
        status: text.match(/(Delivered [A-Z][a-z]+ \d{1,2}|Arriving [a-zA-Z0-9 ]+?(?= [A-Z])|Cancelled|Refunded)/)?.[1] ?? null,
        items: [...items.values()],
        moreItems: Number(text.match(/and (\d+) more/)?.[1] ?? 0),
      },
    ];
  });
}


const WEEKDAY = '(?:[A-Z][a-z]+day, )?';
const MONTH_DAY = '[A-Z][a-z]{2}[a-z]*\\.? \\d{1,2}';

/** "October 18", "Friday, January 3" or "Dec 9, 2023" as an ISO date; with no year, the order's, or the next when the month is earlier. */
function dayOf(text: string, placed: string | null): string | null {
  const match = text.match(/([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?/);
  const month = MONTHS.indexOf(match?.[1] ?? '');
  if (!match || month < 0) return null;
  let year = match[3] ? Number(match[3]) : null;
  if (year === null && placed) year = Number(placed.slice(0, 4)) + (month + 1 < Number(placed.slice(5, 7)) ? 1 : 0);
  if (year === null) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
}

/** The one day a card's "Delivered …" lines name, or null when they name none, a relative day, or more than one day. */
function deliveredOn(text: string, placed: string | null): string | null {
  const said = [...text.matchAll(new RegExp(`Delivered (today|yesterday|${WEEKDAY}${MONTH_DAY}(?:, \\d{4})?)`, 'g'))].map((match) => match[1]!);
  if (said.some((day) => day === 'today' || day === 'yesterday')) return null;
  const days = new Set(said.map((day) => dayOf(day, placed)));
  return days.size === 1 ? [...days][0]! : null;
}

export type OrderLine = {
  /** Amazon's product number, or null for a receipt line with no product link, such as loose produce. */
  asin: string | null;
  name: string;
  store: Store;
  /**
   * How many came: what was ordered less what Amazon marked out of stock, so 0 for a line that never came, which is kept
   * so a reader that saved the product when it was ordered knows to drop it. A line sold by weight counts 1.
   */
  count: number;
  /** The weight as Amazon prints it, such as "0.50 lb", when the line is priced by weight, else null. */
  weight: string | null;
  /** What the line cost, in cents, after promotions and less any out-of-stock credit, or null when the page shows none. */
  priceCents: number | null;
  /** The product this one was delivered in place of, as Amazon names it, or null. */
  replaces: string | null;
};

export type OrderPage = {
  /** The day the order was made ("Ordered September 10, 2026"), or bought in a store ("Purchased on …"), or null. */
  orderedOn: string | null;
  /** An in-store receipt rather than a delivery. */
  inStore: boolean;
  /** Every line, in the page's order, one wholly out of stock at count 0 and price 0. Two lines can share a name. */
  lines: OrderLine[];
};

const cents = (text: string | null | undefined) => {
  const amount = dollars(text);
  return amount === null ? null : Math.round(amount * 100);
};

/** "2.1 lb", "0.50 lb" or "12 oz" when the text is a weight. */
const weightIn = (text: string) => text.match(/^(\d+(?:\.\d+)?) ?(lb|lbs|oz|kg|g)$/)?.[0] ?? null;

/** One row of a Fresh or Whole Foods delivery's items. */
function deliveryLine(row: Element): OrderLine | null {
  const asin = row.id.match(/^([A-Z0-9]{10})-item-grid-row$/)?.[1];
  const link = row.querySelector('a[href*="/gp/product/"], a[href*="/dp/"]');
  const name = textOf(link) || row.querySelector('img')?.getAttribute('alt')?.trim();
  if (!asin || !name) return null;
  // The count column holds a count ("2"), or the weight of a line sold by weight ("0.50 lb").
  const quantity = textOf(row.querySelector('.a-column.a-span1:not(.ufpo-item-image-column)'));
  const soldByWeight = weightIn(quantity);
  const ordered = soldByWeight ? 1 : Number(quantity.match(/^\d+$/)?.[0] ?? 1);
  // The weight column holds a weight for every line priced by the pound, with the price per pound beside it.
  const weightColumn = row.querySelector('.ufpo-item-weight-column');
  const weighed = /\/\s?(lb|oz|kg|g)\b/.test(textOf(weightColumn)) ? weightIn(textOf(weightColumn?.querySelector('[id$="-item-priced-by-quantity"]'))) : null;
  let priceCents = cents(textOf(row.querySelector('[id$="-item-total-price"]')));
  let missing = 0;
  let credit = 0;
  let replaces: string | null = null;
  // Each status box says one thing. Only the box's own words count, never a product's name that happens to hold them.
  for (const box of row.querySelectorAll('.ufpo-item-status')) {
    const said = textOf(box);
    const out = said.match(/Out of stock(?: \((\d+)\))?/i);
    if (out) {
      missing += out[1] ? Number(out[1]) : ordered;
      credit += cents(textOf(box.querySelector('.ufpo-item-status-price'))) ?? 0;
    }
    replaces ??= said.match(/Replacement for:\s*(.+?)(?=\s+(?:Qty|Weight):|$)/)?.[1] ?? null;
  }
  const count = Math.max(0, ordered - missing);
  // The line's total is what was ordered. A credit beside the box says what was not charged; with none, the share that came.
  if (missing && priceCents !== null) priceCents = count === 0 ? 0 : credit ? priceCents - credit : Math.round((priceCents * count) / ordered);
  return { asin, name, store: brandOf(link?.getAttribute('href') ?? ''), count, weight: soldByWeight ?? weighed, priceCents, replaces };
}

/** One line of an in-store receipt: "Organic Banana $1.66 Qty: 2.1 lb @ $0.79/lb", with a product link or none. */
function receiptLine(row: Element): OrderLine | null {
  const text = textOf(row);
  const quantity = text.match(/Qty: (\d+(?:\.\d+)?(?: ?(?:lb|lbs|oz|kg|g)\b)?)/)?.[1];
  if (!quantity) return null;
  const link = row.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
  // A line without a link names itself in the column inside the line's own column, which also holds its price and Qty.
  const name = textOf(link) || textOf(row.querySelector('.a-span10 .a-span10')) || text.match(/^(.+?) \$/)?.[1];
  if (!name) return null;
  const weight = weightIn(quantity);
  // The line's own total comes before its "Qty", already less its promotions; the price after "@" is per unit.
  const priceCents = cents(textOf(row.querySelector('.a-text-right'))) ?? cents(text.split('Qty:')[0]);
  return { asin: productNumber(link?.getAttribute('href') ?? '') ?? null, name, store: 'Whole Foods Market', count: weight ? 1 : Number(quantity), weight, priceCents, replaces: null };
}

/**
 * Reads one order's own page: the day it was made and each line, with the count that came or its weight, its price and what
 * it replaced. A Fresh or Whole Foods delivery has a row per product. An in-store receipt lists its lines in one box,
 * loose produce among them with no product link. A regular order's page is neither, and reads as no lines. Only the
 * item rows are read: the page also shows the delivery address, the card's last digits and products Amazon recommends.
 */
export function readOrderPage(html: string): OrderPage {
  const doc = parse(html);
  const text = textOf(doc);
  const receipt = doc.querySelector('#f3_food_ItemList');
  if (receipt) {
    const rows = [...receipt.querySelectorAll('.a-row.a-spacing-base')].filter((row) => !row.querySelector('.a-row.a-spacing-base'));
    return {
      orderedOn: isoDate(text.match(new RegExp(`Purchased on ${WEEKDAY}(${MONTH_DAY}, \\d{4})`))?.[1]),
      inStore: true,
      lines: rows.flatMap((row) => receiptLine(row) ?? []),
    };
  }
  return {
    orderedOn: isoDate(text.match(new RegExp(`Ordered (?:on )?${WEEKDAY}(${MONTH_DAY}, \\d{4})`))?.[1]),
    inStore: false,
    lines: [...doc.querySelectorAll('[id$="-item-grid-row"]')].flatMap((row) => deliveryLine(row) ?? []),
  };
}

/** The products on one order's page that came and have a product number, each once: `readOrderPage`'s lines as products. */
export function readOrderDetails(html: string): OrderItem[] {
  const items = new Map<string, OrderItem>();
  for (const { asin, name, store, count } of readOrderPage(html).lines) if (asin && count > 0 && !items.has(asin)) items.set(asin, { asin, name, store });
  return [...items.values()];
}
