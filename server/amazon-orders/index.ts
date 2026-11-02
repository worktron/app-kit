// Reading Amazon's order pages: the page's HTML goes in and orders come out. Nothing here fetches, since Amazon has no
// API and only the person's own browser can get these pages; whoever holds a page hands it over as text.
import { Window } from 'happy-dom';

const window = new Window();

/**
 * A page to search with querySelector and querySelectorAll, its scripts and styles taken out, since a card's text is read
 * and nothing read lives in them. It is parsed into a template, whose contents are never attached to a document: a parsed
 * document in happy-dom acts on some of what a page holds, sending a preload link's request or throwing where nothing
 * catches it on a relative one, and a page here may have been sent to a server by anyone. They come out after the parse
 * because a pattern run before it takes time that grows with the square of a page of unclosed script tags.
 */
export function parse(html: string): DocumentFragment {
  const template = window.document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('script, style')) element.remove();
  return template.content as unknown as DocumentFragment;
}

/** An element's text with its whitespace collapsed. */
export function textOf(element: Element | null | undefined): string {
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
  placed: string | null;
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
    return [
      {
        orderNumber,
        placed: isoDate(text.match(/Order placed ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1]),
        total: dollars(text.match(/Total (\$[\d,.]+)/)?.[1]),
        status: text.match(/(Delivered [A-Z][a-z]+ \d{1,2}|Arriving [a-zA-Z0-9 ]+?(?= [A-Z])|Cancelled|Refunded)/)?.[1] ?? null,
        items: [...items.values()],
        moreItems: Number(text.match(/and (\d+) more/)?.[1] ?? 0),
      },
    ];
  });
}

/**
 * Reads the products on one order's details page, from its item rows only: the page also shows the delivery address, the
 * card's last digits and products Amazon recommends. A Fresh or Whole Foods delivery has a row per product. An in-store
 * receipt lists its lines in one box, and loose produce has no product link, so those lines are not read. A regular
 * order's page is neither, and reads as none.
 */
export function readOrderDetails(html: string): OrderItem[] {
  const doc = parse(html);
  const items = new Map<string, OrderItem>();
  for (const row of doc.querySelectorAll('[id$="-item-grid-row"]')) {
    const asin = row.id.match(/^([A-Z0-9]{10})-item-grid-row$/)?.[1];
    const link = row.querySelector('a[href*="/gp/product/"], a[href*="/dp/"]');
    const name = textOf(link) || row.querySelector('img')?.getAttribute('alt')?.trim();
    if (asin && name) items.set(asin, { asin, name, store: brandOf(link?.getAttribute('href') ?? '') });
  }
  for (const link of doc.querySelectorAll('#f3_food_ItemList a[href*="/dp/"], #f3_food_ItemList a[href*="/gp/product/"]')) {
    const asin = productNumber(link.getAttribute('href') ?? '');
    const name = textOf(link);
    if (asin && name) items.set(asin, { asin, name, store: 'Whole Foods Market' });
  }
  return [...items.values()];
}
