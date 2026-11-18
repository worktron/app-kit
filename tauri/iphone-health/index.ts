/*
 * The page half of iPhone Health, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a shell
 * takes it). The page gives the plugin the address of its server once; the plugin asks for Health's sleep, and from then
 * on sends every new sleep stretch, and every one deleted in Health, to that address by itself: when the app opens,
 * each time it comes to the front, and when iOS wakes it in the background for new sleep. Anywhere but an iPhone app
 * none of this runs.
 */
import { isIphoneApp } from '../../web/installed-app';
import { COMMANDS, LOG_PREFIX, PLUGIN, type SleepOutcome } from './names';

export {
  BATCH_LIMIT,
  COMMANDS,
  KEPT_LIMIT,
  KEPT_OUTCOMES,
  KEYS,
  LOG_PREFIX,
  OUTCOMES,
  PLUGIN,
  TRIGGERS,
  type AppState,
  type SleepAttempt,
  type SleepOutcome,
  type SleepPayload,
  type SleepSample,
  type SleepTrigger,
  type SleepValue,
} from './names';

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** How the start's send ended. `no health`, `no permission text`, `bad address` and `health not asked` (iOS's Health question failed) mean nothing was saved or sent. */
export type HealthStart = {
  outcome: SleepOutcome | 'no health' | 'no permission text' | 'bad address' | 'health not asked';
  samples?: number;
  deleted?: number;
  status?: number | null;
};

// Whether this page runs in a Tauri app on an iPhone or iPad, the only place the plugin is.
export { isIphoneApp };

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

const plugin = (command: string) => `plugin:${PLUGIN}|${command}`;

/**
 * Send Health's sleep to `endpoint` from now on. The first call asks for Health's sleep, which shows iOS's sheet once;
 * every call sends what is new and resolves to how that ended. A new address starts Health's history over for it.
 * Anywhere but an iPhone app, or when the plugin fails, it does nothing and resolves to null.
 */
export async function startIphoneHealth(options: { endpoint: string; invoke?: Invoke }): Promise<HealthStart | null> {
  if (!isIphoneApp()) return null;
  const invoke = options.invoke ?? tauriInvoke;
  try {
    const answer = (await invoke(plugin(COMMANDS.start), { endpoint: options.endpoint })) as HealthStart;
    console.log(`${LOG_PREFIX} sending Health's sleep to ${options.endpoint}: ${answer.outcome}`);
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
 * Simulator, since nothing else puts sleep there; it needs `NSHealthUpdateUsageDescription` in the app's Info.plist.
 * On a phone it answers with an error.
 */
export async function simulatorSleep(action: 'add' | 'delete', options: { invoke?: Invoke } = {}): Promise<{ added?: string[]; deleted?: string; error?: string }> {
  if (!isIphoneApp()) return { error: 'not an iPhone app' };
  const invoke = options.invoke ?? tauriInvoke;
  return (await invoke(plugin(COMMANDS.simulatorSleep), { action })) as { added?: string[]; deleted?: string; error?: string };
}
