/*
 * The page half of iPhone notifications, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a
 * shell takes it). It asks iOS for permission, gives the server this phone's device token, and opens the page a tapped
 * notification is about. The plugin keeps a tapped notification's page until the page takes it, so the page takes it
 * when it starts (a tap that launched the app), each time it comes back in front (a tap with the app in the background),
 * and when the plugin's event says a tap came in (a tap on a banner with the app in front). Only a page on the app's
 * own site opens. Anywhere but an iPhone app none of this runs.
 */
import { isIphoneApp } from '../../web/installed-app';
import { COMMANDS, LOG_PREFIX, PLUGIN, TAPPED_EVENT } from './names';

export { ADDRESS_KEY, COMMANDS, LOG_PREFIX, PLUGIN, TAPPED_EVENT } from './names';

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
