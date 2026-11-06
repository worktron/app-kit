// Copied from app-kit 0.41.0 by `app-kit extension copy`. Change it in the kit.
// The Amazon requests no extension of ours ever sends: checkout, placing an
// order, payment, addresses, sign-in and changes to subscriptions, in the path,
// the query or the body. Each extension that reaches Amazon keeps its own short
// list of the paths it asks for and checks every request against this list as
// well, so a mistake in its own list, or a request handed to it whole by its
// server, still never starts a purchase.

export const AMAZON_ORIGIN = "https://www.amazon.com";

// Refused on the path or anywhere in the query.
const NEVER = [
  /checkout/i,
  /place-?order/i,
  /\/gp\/buy\//i,
  /\/spc\//i,
  /^\/ap\//i,
  /^\/ax\//i,
  /^\/cpe\//i,
  /payment/i,
  /wallet/i,
  /address/i,
  /handle-buy-box/i,
  /buy-?now/i,
  /proceed/i,
  /^\/cart\/byc/i,
  /^\/cart\/luxury/i,
  /^\/gp\/css\/account\//i,
  /^\/gp\/your-account\/(?!order-history)/i,
  /^\/hz\/mycd/i,
  /subscribe-?and-?save/i,
  // The subscription list is a page to read. Everything else here edits,
  // starts or sells a subscription, and it changes what the person is charged.
  /^\/auto-deliveries(?!\/subscriptionList$)/i,
];

// Refused in a request's body: the fields and phrases that start a purchase.
// Whole phrases only, since bodies carry words like "marketplaceId".
const NEVER_IN_BODY = [/checkout/i, /place-?order/i, /placeYourOrder/i, /buy-?now/i, /handle-buy-box/i, /proceedTo/i, /turbo/i];

export const NEVER_SENT = "Checkout, placing an order, payment, addresses, sign-in and changes to subscriptions are never sent";

/**
 * Why `method` on `path` (a path on www.amazon.com, with its query) with `body`
 * is never sent, or null when nothing in it is on the list. Only GET and POST
 * are ever sent, and a GET carries no body. Search words (the `k` field of the
 * query) are left out of the check, since a search for "address book" is a search.
 * @param {string} method
 * @param {string} path
 * @param {string | null | undefined} [body]
 * @returns {string | null}
 */
export function refusal(method, path, body) {
  if (method !== "GET" && method !== "POST") return `${method} is never sent`;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return "Only paths on www.amazon.com are sent";
  /** @type {URL} */
  let url;
  try {
    url = new URL(path, AMAZON_ORIGIN);
  } catch {
    return "Only paths on www.amazon.com are sent";
  }
  if (url.origin !== AMAZON_ORIGIN) return "Only paths on www.amazon.com are sent";
  const query = plainText([...url.searchParams].filter(([name]) => name !== "k").map(([name, value]) => `${name}=${value}`).join("&"));
  if (onTheList(url.pathname) || NEVER.some((rule) => rule.test(query))) return NEVER_SENT;
  if (body !== undefined && body !== null) {
    if (typeof body !== "string") return "A body is text";
    if (method === "GET" && body) return "A GET carries no body";
    if (NEVER_IN_BODY.some((rule) => rule.test(plainText(body)))) return NEVER_SENT;
  }
  return null;
}

/**
 * Whether a path is on the list as Amazon would read it: as written, decoded as
 * plainText decodes a body (so /check%6fut is /checkout), and decoded with its
 * dot segments resolved (so /dp/%2e%2e/ap/signin is /ap/signin).
 * @param {string} pathname
 * @returns {boolean}
 */
function onTheList(pathname) {
  const decoded = plainText(pathname);
  /** @type {string[]} */
  const forms = [pathname, decoded];
  try {
    forms.push(new URL(decoded.replace(/^\/+/, "/"), AMAZON_ORIGIN).pathname);
  } catch {
    // A decoded path the URL parser refuses is checked as written and decoded.
  }
  return forms.some((form) => NEVER.some((rule) => rule.test(form)));
}

/**
 * A body as Amazon would read it, whatever its encoding: each %XX escape and
 * each JSON \uXXXX escape decoded on its own (so one malformed escape cannot
 * stop the rest from decoding), again until nothing changes, and + as a space.
 * Purchase words are ASCII, so decoding byte by byte is enough to see them.
 * @param {string} body
 * @returns {string}
 */
export function plainText(body) {
  let text = body;
  for (let round = 0; round < 5; round++) {
    const next = text
      .replace(/\+/g, " ")
      .replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (next === text) return text;
    text = next;
  }
  return text;
}

/**
 * Whether an answer that ended at `url`, after its redirects, left
 * www.amazon.com or ended on a page from the list, so its text is not handed
 * back. A redirect to sign-in is not counted: it is how Amazon answers someone
 * signed out, which the reader of the page says.
 * @param {string} url
 * @returns {boolean}
 */
export function landedOutside(url) {
  try {
    const { origin, pathname } = new URL(url);
    if (origin !== AMAZON_ORIGIN) return true;
    return onTheList(pathname) && !pathname.startsWith("/ap/");
  } catch {
    return true;
  }
}
