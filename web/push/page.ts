/*
 * The page half of notifications for a web app on a phone's Home Screen. It says whether this phone can have them,
 * turns them on from a tap and off, and at every start checks this phone in with the server, making a fresh
 * subscription when Safari dropped the old one or the app's key changed. The server half (server.ts) sends, and the
 * kit's worker (worker.js) shows each notification and opens its page on a tap.
 *
 * An iPhone or iPad has Web Push only in a web app opened from the Home Screen, never in a browser tab, so a tab there
 * is `needs-home-screen`, for the app to show how to add it. A Tauri app's window is `unsupported`: its iPhone build
 * has the kit's iPhone notifications instead.
 */
import { isInstalledApp, isTauriApp } from '../installed-app';
import { local, read, write } from '../storage';
import { LOG_PREFIX, WORKER_ADDRESS, type WebPushSubscription } from './names';

export { WORKER_ADDRESS, type WebPushSubscription } from './names';

/**
 * - `unsupported`: this browser has no Web Push, or this is a Tauri app's window.
 * - `needs-home-screen`: an iPhone or iPad browser tab; added to the Home Screen and opened from there, it can ask.
 * - `off`: it can be turned on, from a tap.
 * - `denied`: the person said no; only the phone's settings can change it.
 * - `on`: this phone has a subscription.
 */
export type WebPushState = 'unsupported' | 'needs-home-screen' | 'off' | 'denied' | 'on';

export interface WebPushOptions {
  /** The app's public key (the server's `WEB_PUSH_PUBLIC_KEY`), or a function that asks the server for it. */
  publicKey: string | (() => Promise<string>);
  /**
   * Give the server this phone's subscription. Called on turning on and at every start, so the server can keep when it
   * last heard from the phone. A refusal with status 409 (the kit's `request` throws an `ApiError` with it) says the
   * subscription belongs to another account, and the page makes a fresh one and gives that once.
   */
  register: (subscription: WebPushSubscription) => Promise<unknown>;
  /**
   * The app has a service worker of its own, which takes the kit's in with `importScripts('/push-worker.js')`. The page
   * then uses that worker rather than registering the kit's, which would replace it.
   */
  ownWorker?: boolean;
}

/** Set when the person turns notifications off, so a start never turns them back on while permission stays granted. */
const TURNED_OFF_KEY = 'app-kit.webPushOff';

/** An iPhone or iPad, including an iPad that names itself a Mac but has a touch screen. */
function onApplePhone(): boolean {
  const agent = navigator.userAgent;
  return /\b(iPhone|iPad|iPod)\b/.test(agent) || (/\bMacintosh\b/.test(agent) && navigator.maxTouchPoints > 1);
}

function hasWebPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The state that does not need the worker: none of these can have a subscription. */
function before(): WebPushState | null {
  if (isTauriApp()) return 'unsupported';
  if (onApplePhone() && !isInstalledApp()) return 'needs-home-screen';
  if (!hasWebPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

/** Whether this phone can have notifications, and whether it has them. Asks the person nothing. */
export async function webPushState(): Promise<WebPushState> {
  const known = before();
  if (known) return known;
  if (Notification.permission !== 'granted') return 'off';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return subscription ? 'on' : 'off';
}

const bytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

function sameKey(key: ArrayBuffer | null | undefined, publicKey: Uint8Array): boolean {
  if (!key) return false;
  const held = new Uint8Array(key);
  return held.length === publicKey.length && held.every((byte, i) => byte === publicKey[i]);
}

async function workerRegistration(ownWorker: boolean | undefined): Promise<ServiceWorkerRegistration> {
  if (!ownWorker) await navigator.serviceWorker.register(WORKER_ADDRESS);
  // A subscription needs an active worker; ready waits for the one that controls this page's scope.
  return navigator.serviceWorker.ready;
}

const subscribe = (registration: ServiceWorkerRegistration, publicKey: Uint8Array<ArrayBuffer>) =>
  registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });

/** This phone's subscription, made again when there is none or it was made with another key than the app's now. */
async function currentSubscription(registration: ServiceWorkerRegistration, publicKey: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  const held = await registration.pushManager.getSubscription();
  if (held && sameKey(held.options.applicationServerKey, publicKey)) return held;
  if (held) {
    console.log(`${LOG_PREFIX} the app's key changed: subscribing again`);
    await held.unsubscribe();
  } else {
    console.log(`${LOG_PREFIX} no subscription on this phone: subscribing`);
  }
  return subscribe(registration, publicKey);
}

function record(subscription: PushSubscription): WebPushSubscription {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error(`${LOG_PREFIX} the browser gave a subscription with no keys`);
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

const refusedAsTaken = (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409;

/** Give the server the subscription; one another account holds is dropped and a fresh one given, once. */
async function checkIn(options: WebPushOptions, registration: ServiceWorkerRegistration, subscription: PushSubscription, publicKey: Uint8Array<ArrayBuffer>) {
  try {
    await options.register(record(subscription));
  } catch (error) {
    if (!refusedAsTaken(error)) throw error;
    console.log(`${LOG_PREFIX} the server says another account holds this subscription: subscribing afresh`);
    await subscription.unsubscribe();
    await options.register(record(await subscribe(registration, publicKey)));
  }
}

const keyOf = async (publicKey: WebPushOptions['publicKey']) => bytes(typeof publicKey === 'string' ? publicKey : await publicKey());

/**
 * Turn notifications on, from a tap: the browser asks the person only while a tap is fresh, so call it straight from
 * the button's click handler. Asks for permission before anything else, subscribes and gives the server the
 * subscription. Returns the state it ends in; throws when the browser or the server fails, for the app to say so.
 */
export async function turnOnWebPush(options: WebPushOptions): Promise<WebPushState> {
  const known = before();
  if (known) return known;
  // First, with nothing awaited before it, so the tap still counts.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log(`${LOG_PREFIX} notifications ${permission === 'denied' ? 'refused' : 'not answered'}`);
    return permission === 'denied' ? 'denied' : 'off';
  }
  write(local, TURNED_OFF_KEY, null);
  const registration = await workerRegistration(options.ownWorker);
  const publicKey = await keyOf(options.publicKey);
  await checkIn(options, registration, await currentSubscription(registration, publicKey), publicKey);
  console.log(`${LOG_PREFIX} turned on for this phone`);
  return 'on';
}

/**
 * At every start: registers the kit's worker (unless the app has its own), and when the person has notifications on,
 * checks this phone in with the server, subscribing afresh if Safari dropped the subscription or the app's key changed.
 * Asks the person nothing and never throws: a phone without notifications still runs the app.
 */
export async function startWebPush(options: WebPushOptions): Promise<void> {
  if (before() !== null) return;
  try {
    const registration = await workerRegistration(options.ownWorker);
    if (Notification.permission !== 'granted' || read(local, TURNED_OFF_KEY) !== null) return;
    const publicKey = await keyOf(options.publicKey);
    await checkIn(options, registration, await currentSubscription(registration, publicKey), publicKey);
    console.log(`${LOG_PREFIX} checked this phone in`);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not check this phone in`, error);
  }
}

/**
 * Turn notifications off on this phone, and have the server forget it. Call it before signing out too, so the next
 * person on the phone never gets the last one's notifications. A failed `forget` is logged: the server learns the
 * subscription is gone at its next send.
 */
export async function turnOffWebPush(options: { forget: (endpoint: string) => Promise<unknown> }): Promise<WebPushState> {
  const known = before();
  if (known) return known;
  write(local, TURNED_OFF_KEY, '1');
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return 'off';
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  try {
    await options.forget(endpoint);
  } catch (error) {
    console.error(`${LOG_PREFIX} the server did not forget this phone`, error);
  }
  console.log(`${LOG_PREFIX} turned off for this phone`);
  return 'off';
}
