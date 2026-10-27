/*
 * The page half of iPhone sign-in, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a shell
 * takes it). Google refuses to sign in inside an app's web view, so the iPhone app runs the desktop sign-in's browser
 * page in Apple's sign-in sheet (ASWebAuthenticationSession) instead of the default browser: the sheet slides over the
 * app, shares Safari's Google sign-in, and closes when that page opens the app's sign-in link, which it hands back here
 * instead of to iOS. The link goes to the window's desktop sign-in, which signs in only when its nonce is the window's.
 * An app whose build is associated with its site can have the sheet wait for an address on that site instead, which
 * iOS gives only to the app the site names, and then the browser page hands over with no click.
 */
import { desktopSignInArrived, type DesktopSignInLink } from '../sign-in';
import { DESKTOP_SIGN_IN_BACK_PATH, LINK_HOST } from '../sign-in/names';
import { ANSWER_KEY, COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export { ANSWER_KEY, ARGUMENTS, COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface SheetSignInOptions {
  /** The app's own link scheme, the one its sign-in link opens, such as `com.example.app`. */
  scheme: string;
  /**
   * Wait for the hand-back at the app's own site over https, on iOS 17.4 and later, so the browser page needs no click.
   * Only once the installed build has the `webcredentials:` entitlement for the site, and the site serves
   * apple-app-site-association naming the app (README says how). Older iOS, a build whose plugin predates it, and a
   * hand-back iOS refuses, as for a site that does not name the app, keep the app's link and the click.
   */
  handBackOverHttps?: boolean;
  /** Tauri's invoke. The default imports `@tauri-apps/api/core`; tests pass their own. */
  invoke?: Invoke;
}

/** Where the sheet waits over https: the browser page's own site, at the kit's path. */
interface Back {
  origin: string;
  path: string;
}

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

/**
 * The ticket and nonce of the app's own sign-in link, or of the address the sheet waited for over https, or null for
 * any other link. iOS reads a scheme in any case. It matches an https address loosely, ignoring the port, the case of
 * the path and a slash at its end, so that one is taken only exactly as the browser page writes it.
 */
function sheetSignInLink(link: string, scheme: string, back: Back | null): DesktopSignInLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  let fields: URLSearchParams;
  if (url.protocol === `${scheme.toLowerCase()}:` && url.host === LINK_HOST) fields = url.searchParams;
  else if (back && url.origin === back.origin && url.pathname === back.path && !url.username && !url.search) {
    fields = new URLSearchParams(url.hash.slice(1));
  } else return null;
  const ticket = fields.get('ticket');
  const nonce = fields.get('nonce');
  return ticket && nonce ? { ticket, nonce } : null;
}

/**
 * Open `address`, from `desktopSignInAddress`, in Apple's sign-in sheet, and hand the sign-in link it closes on to the
 * window's desktop sign-in. Resolves true when it handed one over, and false when the sheet was closed without signing
 * in, failed, or closed on any other link; each logs why.
 */
export async function signInInSheet(address: string, options: SheetSignInOptions): Promise<boolean> {
  const invoke = options.invoke ?? tauriInvoke;
  // A plugin from before the https hand-back ignores the host and path, and waits for the app's link as it always has.
  const page = options.handBackOverHttps && URL.canParse(address) ? new URL(address) : null;
  const back = page?.protocol === 'https:' ? { origin: page.origin, path: DESKTOP_SIGN_IN_BACK_PATH } : null;
  const payload = { url: address, callbackScheme: options.scheme, ...(page && back && { callbackHost: page.hostname, callbackPath: back.path }) };
  let answer: unknown;
  try {
    answer = await invoke(`plugin:${PLUGIN}|${COMMANDS.authenticate}`, { payload });
  } catch (err) {
    // Cancel in the sheet lands here too.
    console.log(`${LOG_PREFIX} sheet closed without signing in`, err);
    return false;
  }
  const returned = (answer as Record<string, unknown> | null)?.[ANSWER_KEY];
  const link = typeof returned === 'string' ? sheetSignInLink(returned, options.scheme, back) : null;
  if (!link) {
    console.warn(`${LOG_PREFIX} sheet returned a link that is not this app's sign-in: nothing handed over`);
    return false;
  }
  console.log(`${LOG_PREFIX} sheet returned a sign-in link: handed to the window`);
  desktopSignInArrived(link);
  return true;
}
