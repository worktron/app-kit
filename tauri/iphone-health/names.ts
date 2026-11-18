/*
 * The names the iPhone Health page half shares with the plugin's Rust and Swift (plugin/), and the shape of what the
 * plugin sends to the app's server. test/iphone-health-names.test.ts reads the plugin's sources and holds each to these.
 */

/** The plugin's name, as an app's shell registers it, and the start of its permission, `iphone-health:default`. */
export const PLUGIN = 'iphone-health';

/** The page's commands, each `plugin:iphone-health|<command>`. */
export const COMMANDS = {
  start: 'start',
  simulatorSleep: 'simulator_sleep',
} as const;

/** The keys in the app's UserDefaults the plugin saves the address, its place in Health's history and kept attempts under. */
export const KEYS = {
  address: 'app-kit.iphone-health.address',
  anchor: 'app-kit.iphone-health.anchor',
  earlier: 'app-kit.iphone-health.earlier',
} as const;

/** How many attempts that delivered nothing the phone keeps for the next send, the oldest dropped first. */
export const KEPT_LIMIT = 50;

/** How many stretches and deletions one request carries at most. */
export const BATCH_LIMIT = 1000;

/** What every log line of the page half and the plugin starts with. */
export const LOG_PREFIX = '[iphone-health]';

/** What started a send: the app opening (or the page's start), coming to the front, or Health's watcher. */
export const TRIGGERS = ['open', 'front', 'background wake'] as const;
export type SleepTrigger = (typeof TRIGGERS)[number];

/** The app's state when the trigger came. Health's watcher also runs at every launch, so a background wake is proven
 * only by `background wake` with `in the background`. */
export type AppState = 'in front' | 'coming to the front' | 'in the background';

/** How a send ended, as the page's start hears it. */
export const OUTCOMES = ['sent', 'nothing new', 'locked', 'server refused', 'no answer', 'read failed', 'no address', 'not unlocked since restart'] as const;
export type SleepOutcome = (typeof OUTCOMES)[number];

/** The outcomes kept on the phone and carried as `earlier` by the next send that succeeds. */
export const KEPT_OUTCOMES = ['locked', 'server refused', 'no answer', 'read failed'] as const;

/** Apple's sleep values (HKCategoryValueSleepAnalysis), by their case names. */
export type SleepValue = 'inBed' | 'asleepUnspecified' | 'asleepCore' | 'asleepDeep' | 'asleepREM' | 'awake';

/** One sleep stretch in Health. */
export type SleepSample = {
  /** Health's id for it, the same in `deleted` once it is deleted. The same stretch can arrive twice, so keep by it. */
  uuid: string;
  /** Milliseconds since 1970. */
  start: number;
  end: number;
  /**
   * The Apple Watch writes `awake` only between two sleep stretches, so the night's final wake is the end of its last
   * sleep stretch.
   */
  value: SleepValue;
  /** The bundle id of the app that wrote it. The Watch's own sleep is `com.apple.health.` followed by an id. */
  source: string;
  /**
   * The device that wrote it, as Health gives it, such as `Watch7,1` or `iPhone17,1` (Apple's own example is
   * `watch2,4`, so compare without case), or null when Health does not say.
   */
  device: string | null;
};

/** A send that delivered nothing, kept on the phone until one succeeds. */
export type SleepAttempt = {
  /** When it ended, in milliseconds since 1970 on the phone's clock. */
  at: number;
  trigger: SleepTrigger;
  state: AppState;
  outcome: (typeof KEPT_OUTCOMES)[number];
  /** The server's answer, for `server refused`. */
  status: number | null;
};

/** What the plugin POSTs to the app's server, as JSON. Only a 2xx answer counts as delivered. */
export type SleepPayload = {
  trigger: SleepTrigger;
  state: AppState;
  samples: SleepSample[];
  /** The ids of stretches deleted in Health. Best effort: Health may drop its record of a deletion before a send. */
  deleted: string[];
  earlier: SleepAttempt[];
};
