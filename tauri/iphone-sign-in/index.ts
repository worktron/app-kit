/*
 * The page half of iPhone sign-in, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a shell
 * takes it). Google refuses to sign in inside an app's web view, so the iPhone app runs the desktop sign-in's browser
 * page in Apple's sign-in sheet (ASWebAuthenticationSession) instead of the default browser: the sheet slides over the
 * app, shares Safari's Google sign-in, and closes when that page opens the app's sign-in link, which it hands back here
 * instead of to iOS. The link goes to the window's desktop sign-in, which signs in only when its nonce is the window's.
 */
import { desktopSignInArrived, type DesktopSignInLink } from '../sign-in';
import { LINK_HOST } from '../sign-in/names';
import { ANSWER_KEY, COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export { ANSWER_KEY, ARGUMENTS, COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface SheetSignInOptions {
  /** The app's own link scheme, the one its sign-in link opens, such as `com.example.app`. */
  scheme: string;
  /** Tauri's invoke. The default imports `@tauri-apps/api/core`; tests pass their own. */
  invoke?: Invoke;
}

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

/** The ticket and nonce of the app's own sign-in link, or null for any other link. iOS reads a scheme in any case. */
function sheetSignInLink(link: string, scheme: string): DesktopSignInLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== `${scheme.toLowerCase()}:` || url.host !== LINK_HOST) return null;
  const ticket = url.searchParams.get('ticket');
  const nonce = url.searchParams.get('nonce');
  return ticket && nonce ? { ticket, nonce } : null;
}

/**
 * Open `address`, from `desktopSignInAddress`, in Apple's sign-in sheet, and hand the sign-in link it closes on to the
 * window's desktop sign-in. Resolves true when it handed one over, and false when the sheet was closed without signing
 * in, failed, or closed on any other link; each logs why.
 */
export async function signInInSheet(address: string, options: SheetSignInOptions): Promise<boolean> {
  const invoke = options.invoke ?? tauriInvoke;
  let answer: unknown;
  try {
    answer = await invoke(`plugin:${PLUGIN}|${COMMANDS.authenticate}`, { payload: { url: address, callbackScheme: options.scheme } });
  } catch (err) {
    // Cancel in the sheet lands here too.
    console.log(`${LOG_PREFIX} sheet closed without signing in`, err);
    return false;
  }
  const returned = (answer as Record<string, unknown> | null)?.[ANSWER_KEY];
  const link = typeof returned === 'string' ? sheetSignInLink(returned, options.scheme) : null;
  if (!link) {
    console.warn(`${LOG_PREFIX} sheet returned a link that is not this app's sign-in: nothing handed over`);
    return false;
  }
  console.log(`${LOG_PREFIX} sheet returned a sign-in link: handed to the window`);
  desktopSignInArrived(link);
  return true;
}
