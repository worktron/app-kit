/*
 * The page half of iPhone Health, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a shell
 * takes it). The page gives the plugin the address of its server once, and a second one for heart rate if it wants
 * that too; the plugin asks for Health's sleep (and heart rate), and from then on sends every new sleep stretch and
 * heart rate reading, and every one deleted in Health, to its address by itself: when the app opens, each time it comes
 * to the front, and when iOS wakes it in the background for new samples. Anywhere but an iPhone app none of this runs.
 */
import { isIphoneApp } from '../../web/installed-app';
import { COMMANDS, LOG_PREFIX, PLUGIN, type SleepOutcome } from './names';

export {
  BATCH_LIMIT,
  COMMANDS,
  HEART_RATE_BATCH_LIMIT,
  KEPT_LIMIT,
  KEPT_OUTCOMES,
  KEYS,
  LOG_PREFIX,
  OUTCOMES,
  PLUGIN,
  TRIGGERS,
  type AppState,
  type HeartRatePayload,
  type HeartRateSample,
  type SleepAttempt,
  type SleepOutcome,
  type SleepPayload,
  type SleepSample,
  type SleepTrigger,
  type SleepValue,
} from './names';

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** How one of the start's sends ended, with how many samples and deletions it sent and the server's last answer. */
export type HealthSend = {
  outcome: SleepOutcome;
  samples: number;
  deleted: number;
  status: number | null;
};

/**
 * How the start's sleep send ended, and with `heartRateEndpoint` its heart rate send in `heartRate`. `no health`,
 * `no permission text`, `bad address` and `health not asked` (iOS's Health question failed) mean nothing was saved or
 * sent. iOS never says whether heart rate was allowed, so a refusal reads as a heart rate send that sends nothing.
 */
export type HealthStart = {
  outcome: SleepOutcome | 'no health' | 'no permission text' | 'bad address' | 'health not asked';
  samples?: number;
  deleted?: number;
  status?: number | null;
  heartRate?: HealthSend;
};

// Whether this page runs in a Tauri app on an iPhone or iPad, the only place the plugin is.
export { isIphoneApp };

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

const plugin = (command: string) => `plugin:${PLUGIN}|${command}`;

/**
 * Send Health's sleep to `endpoint` from now on, and with `heartRateEndpoint` its heart rate there too. The first call
 * asks Health for them, which shows iOS's sheet once, and a call that adds heart rate later shows it once more, for
 * heart rate alone; every call sends what is new and resolves to how that ended. A new address starts Health's history
 * over for it, and a call without `heartRateEndpoint` stops heart rate's sends. Anywhere but an iPhone app, or when the
 * plugin fails, it does nothing and resolves to null.
 */
export async function startIphoneHealth(options: { endpoint: string; heartRateEndpoint?: string; invoke?: Invoke }): Promise<HealthStart | null> {
  if (!isIphoneApp()) return null;
  const invoke = options.invoke ?? tauriInvoke;
  const args: Record<string, unknown> = { endpoint: options.endpoint };
  if (options.heartRateEndpoint !== undefined) args.heartRateEndpoint = options.heartRateEndpoint;
  try {
    const answer = (await invoke(plugin(COMMANDS.start), args)) as HealthStart;
    console.log(`${LOG_PREFIX} sending Health's sleep to ${options.endpoint}: ${answer.outcome}`);
    if (answer.heartRate) {
      console.log(`${LOG_PREFIX} sending Health's heart rate to ${options.heartRateEndpoint}: ${answer.heartRate.outcome}, ${answer.heartRate.samples} readings`);
    }
    return answer;
  } catch (err) {
    // An installed build from before the plugin, or a shell that did not grant it.
    console.error(`${LOG_PREFIX} could not start`, err);
    return null;
  }
}

/**
 * On the iPhone Simulator, `add` a made-up night to Health (in bed from 22:45, with core, deep, REM, a short wake and
 * core again, ending at 4:45), or `delete` the newest stretch the app wrote. For checking an app's Health sending on a
 * Simulator, since nothing else puts sleep there; it needs `NSHealthUpdateUsageDescription` in the app's Info.plist,
 * and with it the Simulator's start asks to write as well, so this shows no second sheet.
 * On a phone it answers with an error.
 */
export async function simulatorSleep(action: 'add' | 'delete', options: { invoke?: Invoke } = {}): Promise<{ added?: string[]; deleted?: string; error?: string }> {
  if (!isIphoneApp()) return { error: 'not an iPhone app' };
  const invoke = options.invoke ?? tauriInvoke;
  return (await invoke(plugin(COMMANDS.simulatorSleep), { action })) as { added?: string[]; deleted?: string; error?: string };
}

/**
 * On the iPhone Simulator, `add` the made-up night's heart rate to Health (a reading every 5 minutes from 22:45 to 4:40,
 * then a condensed series of 60 readings 5 seconds apart, rising to the wake at 4:45), or `delete` the newest heart
 * rate sample the app wrote. `series` lists what Health made of the series, which it may split. Like `simulatorSleep`,
 * it needs `NSHealthUpdateUsageDescription`, and on a phone it answers with an error.
 */
export async function simulatorHeartRate(
  action: 'add' | 'delete',
  options: { invoke?: Invoke } = {},
): Promise<{ added?: number; series?: { uuid: string; count: number }[]; deleted?: string; error?: string }> {
  if (!isIphoneApp()) return { error: 'not an iPhone app' };
  const invoke = options.invoke ?? tauriInvoke;
  return (await invoke(plugin(COMMANDS.simulatorHeartRate), { action })) as { added?: number; series?: { uuid: string; count: number }[]; deleted?: string; error?: string };
}
