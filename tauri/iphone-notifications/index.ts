/*
 * The page half of iPhone notifications, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a
 * shell takes it). It asks iOS for permission, gives the server this phone's device token, and opens the page a tapped
 * notification is about. The plugin keeps a tapped notification's page until the page takes it, so the page takes it
 * when it starts (a tap that launched the app), each time it comes back in front (a tap with the app in the background),
 * and when the plugin's event says a tap came in (a tap on a banner with the app in front). Only a page on the app's
 * own site opens. `keepIphoneNotifications` removes the delivered notifications handled elsewhere, and the plugin keeps a
 * record of each removal, which `readIphoneKeepRecord` reads and `clearIphoneKeepRecord` clears. Anywhere but an iPhone
 * app none of this runs.
 */
import { isIphoneApp } from '../../web/installed-app';
import { COMMANDS, LOG_PREFIX, PLUGIN, TAPPED_EVENT } from './names';

export { ADDRESS_KEY, COMMANDS, COVERS_KEY, KEEP_KEY, KEEP_RECORD_KEY, KEEP_RECORD_LIMIT, LOG_PREFIX, PLUGIN, SENT_KEY, TAPPED_EVENT } from './names';

/** Which of Apple's push services a device token belongs to. The plugin says: a debug build is development. */
export type AppleEnvironment = 'development' | 'production';

/** What the server keeps to send to this phone. */
export type IphoneDevice = { token: string; environment: AppleEnvironment };

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface IphoneNotificationsOptions {
  /** Give the server this phone's device token. Called on every launch, which also covers Apple changing the token. */
  register: (device: IphoneDevice) => Promise<unknown>;
  /** Open a page of the app: its path, query and fragment. Pass the router's navigate; the default loads the page. */
  open?: (page: string) => void;
  /** Tauri's invoke. The default imports `@tauri-apps/api/core`; tests pass their own. */
  invoke?: Invoke;
}

// Whether this page runs in a Tauri app on an iPhone or iPad, the only place the plugin is.
export { isIphoneApp };

/**
 * The page a tapped notification's address names, as a path, query and fragment, or null when it is on another site
 * than `origin` or does not parse. A path is read against `origin`. A path that starts with `//` is refused too, since
 * a browser reads it as another site's address.
 */
export function tappedPage(address: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(address, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const page = `${url.pathname}${url.search}${url.hash}`;
  return page.startsWith('//') ? null : page;
}

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

const plugin = (command: string) => `plugin:${PLUGIN}|${command}`;

/**
 * Register this iPhone for notifications and open each tapped notification's page. Anywhere else it does nothing.
 * Returns a function that stops listening for taps.
 */
export function startIphoneNotifications(options: IphoneNotificationsOptions): () => void {
  if (!isIphoneApp()) return () => {};
  const invoke = options.invoke ?? tauriInvoke;
  const open = options.open ?? ((page: string) => window.location.assign(page));

  const takeTap = async () => {
    let address: unknown;
    try {
      address = await invoke(plugin(COMMANDS.takeTappedAddress));
    } catch (err) {
      console.error(`${LOG_PREFIX} could not take a tapped address`, err);
      return;
    }
    if (typeof address !== 'string') return;
    const page = tappedPage(address, window.location.origin);
    if (page === null) {
      console.warn(`${LOG_PREFIX} refused a tap on ${address}: not a page of ${window.location.origin}`);
      return;
    }
    console.log(`${LOG_PREFIX} opened ${page} from a tap`);
    open(page);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void takeTap();
  };
  const onTapped = () => void takeTap();

  // Listening first and taking at once, apart from registration, whose permission question can wait on the person.
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener(TAPPED_EVENT, onTapped);
  void takeTap();
  void registerIphone(invoke, options.register);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener(TAPPED_EVENT, onTapped);
  };
}

async function registerIphone(invoke: Invoke, register: IphoneNotificationsOptions['register']): Promise<void> {
  try {
    // iOS asks the person once; after that this answers from Settings.
    const { granted } = (await invoke(plugin(COMMANDS.requestPermission))) as { granted: boolean };
    console.log(`${LOG_PREFIX} notifications ${granted ? 'allowed' : 'not allowed'}`);
    // Registered either way: if they are allowed later in Settings, the server already has the phone.
    const device = (await invoke(plugin(COMMANDS.getToken))) as IphoneDevice;
    if (!device.token) {
      console.log(`${LOG_PREFIX} no device token from Apple: not registered`);
      return;
    }
    await register(device);
    console.log(`${LOG_PREFIX} registered this phone for ${device.environment}`);
  } catch (err) {
    // No push entitlement (an unsigned build) or no network: the app works without notifications.
    console.error(`${LOG_PREFIX} registration failed`, err);
  }
}

/**
 * Remove the notifications on this phone that were handled elsewhere: each delivered one the server sent before
 * `before`, in milliseconds since 1970 on the server's clock, whose tag is not in `keep`. A notification that covers
 * several tags stays while any of them is in `keep`. It is the same removal a keep list pushed by the server makes,
 * for the page to make as soon as it knows what is still waiting, such as when it comes to the front. Resolves to how
 * many it removed; anywhere but an iPhone app, or when the plugin fails, it removes nothing and resolves to 0.
 */
export async function keepIphoneNotifications(keep: string[], before: number, options: { invoke?: Invoke } = {}): Promise<number> {
  if (!isIphoneApp()) return 0;
  const invoke = options.invoke ?? tauriInvoke;
  try {
    const removed = (await invoke(plugin(COMMANDS.keepNotifications), { ids: keep, before })) as number;
    console.log(`${LOG_PREFIX} removed ${removed} handled elsewhere, keeping ${keep.length}`);
    return removed;
  } catch (err) {
    console.error(`${LOG_PREFIX} could not remove the notifications handled elsewhere`, err);
    return 0;
  }
}

/**
 * What one keep list did on the phone, as the plugin records it: a silent push's list (`keep list`) or the page's own
 * `keepIphoneNotifications` call (`page`). The plugin keeps the newest 50, and they stay until the page clears them.
 */
export type KeepRecord = {
  /** When the app handled it, in milliseconds since 1970 on the phone's clock. */
  at: number;
  source: 'keep list' | 'page';
  /** The app's state then. A list iOS held until the app opened reads `coming to the front` or `in front`. */
  state: 'in front' | 'coming to the front' | 'in the background';
  /** When the server sent the list, in milliseconds since 1970 on the server's clock; missing for a push without one. */
  sent?: number;
  /** How many tags the list kept; missing for a push without a list. */
  keep?: number;
  /** Why nothing was looked at: a push with no keep list, or a list with no send time, which removes nothing. */
  skipped?: 'no keep list' | 'no send time';
  /** How many notifications iOS listed as delivered. */
  delivered: number;
  /** The identifiers of the notifications removed, each a tag cut to 64 bytes or one iOS made. */
  removed: string[];
  /** How many delivered notifications stayed, by why: a tag on the list, sent after the list, or made on the phone. */
  kept: { onList: number; sentAfter: number; notFromPush: number };
  /** How many of the removed iOS still listed five seconds later. */
  left: number;
};

/**
 * The plugin's records of each keep list, oldest first. They stay on the phone until `clearIphoneKeepRecord` clears
 * them, so a page that sends them somewhere clears only once that worked. Anywhere but an iPhone app, or when the
 * plugin fails, it resolves to none.
 */
export async function readIphoneKeepRecord(options: { invoke?: Invoke } = {}): Promise<KeepRecord[]> {
  if (!isIphoneApp()) return [];
  const invoke = options.invoke ?? tauriInvoke;
  try {
    return (await invoke(plugin(COMMANDS.keepRecord), { through: 0 })) as KeepRecord[];
  } catch (err) {
    console.error(`${LOG_PREFIX} could not read the record of keep lists`, err);
    return [];
  }
}

/**
 * Clear the records handled at or before `through`, the `at` of the newest record the page has dealt with, so a record
 * that lands meanwhile stays. Anywhere but an iPhone app, or when the plugin fails, it clears nothing.
 */
export async function clearIphoneKeepRecord(through: number, options: { invoke?: Invoke } = {}): Promise<void> {
  if (!isIphoneApp() || !(through > 0)) return;
  const invoke = options.invoke ?? tauriInvoke;
  try {
    const left = (await invoke(plugin(COMMANDS.keepRecord), { through })) as KeepRecord[];
    console.log(`${LOG_PREFIX} cleared the record of keep lists through ${through}, ${left.length} left`);
  } catch (err) {
    console.error(`${LOG_PREFIX} could not clear the record of keep lists`, err);
  }
}
