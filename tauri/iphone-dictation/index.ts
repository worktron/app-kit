/*
 * The page half of iPhone dictation, for a Tauri app's iPhone build with the plugin in plugin/ (README says how a shell
 * takes it). The web's SpeechRecognition on an iPhone hands back bare words, with no period or question mark, and
 * WebKit has no switch for them; Apple's own recognizer adds them. `AppRecognition` has the web SpeechRecognition's
 * shape, so a page's dictation written against the web takes it unchanged: its results carry `[0].transcript` and
 * `isFinal`, and it ends with `onend`. It asks the plugin what it heard about every 150 ms while it listens, as the
 * kit's other plugins talk to the page, by a command rather than a pushed event.
 */
import { isIphoneApp } from '../../web/installed-app';
import { COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export { COMMANDS, LOG_PREFIX, PLUGIN } from './names';

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Run `run` every `ms` milliseconds until the returned function is called. */
export type Every = (ms: number, run: () => void) => () => void;

/** How often the page asks the plugin what it heard while listening. */
export const POLL_EVERY = 150;

/**
 * How long a caller waits for the last words after `stop()` before it gives up with what it has, and calls `abort()`.
 * Apple's recognizer works out the end of what was said after the microphone goes off, which takes longer than the
 * web's recognizer on the phone.
 */
export const STOP_WAIT = 3000;

export interface AppRecognitionAlternative {
  transcript: string;
  confidence: number;
}

/** One result, as the web's SpeechRecognitionResult: its alternatives, of which there is one, and whether it is final. */
export type AppRecognitionResult = AppRecognitionAlternative[] & { isFinal: boolean };

/**
 * What `onresult` gets, as the web's SpeechRecognitionEvent. Its one result holds everything heard since the start,
 * punctuated, so a page that joins the results' transcripts, as the web's continuous recognition needs, gets it whole.
 */
export interface AppRecognitionResultEvent {
  resultIndex: number;
  results: AppRecognitionResult[];
}

/**
 * What `onerror` gets. `error` is the web's name where there is one (`not-allowed`, `service-not-allowed`,
 * `audio-capture`, `language-not-supported`, `no-speech`, `network`, `aborted`), or the system's own words.
 */
export interface AppRecognitionErrorEvent {
  error: string;
}

export interface AppRecognitionOptions {
  /** Tauri's invoke. The default imports `@tauri-apps/api/core`; tests pass their own. */
  invoke?: Invoke;
  /** The timer the page asks the plugin by. The default is setInterval; tests pass their own. */
  every?: Every;
}

interface Heard {
  words: string;
  ended: boolean;
  error: string | null;
}

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

const realEvery: Every = (ms, run) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
};

const plugin = (command: string) => `plugin:${PLUGIN}|${command}`;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function result(words: string, isFinal: boolean): AppRecognitionResultEvent {
  const one = Object.assign([{ transcript: words, confidence: 1 }], { isFinal });
  return { resultIndex: 0, results: [one] };
}

/**
 * Dictation through Apple's speech recognizer, in the web SpeechRecognition's shape. Each object listens once, as the
 * web's does: `start()` a second time throws. Apple's recognizer listens until `stop()`, through pauses, whatever
 * `continuous` says.
 */
export class AppRecognition {
  continuous = true;
  interimResults = true;
  /** A BCP 47 tag such as `en-US`; empty for the phone's own language. */
  lang = '';
  onresult: ((event: AppRecognitionResultEvent) => void) | null = null;
  onerror: ((event: AppRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  /** How long to wait for the last words after `stop()`: `STOP_WAIT`. */
  readonly stopWait = STOP_WAIT;

  private readonly invoke: Invoke;
  private readonly every: Every;
  private phase: 'new' | 'listening' | 'ended' = 'new';
  private token: number | null = null;
  private stopAsked = false;
  private abortAsked = false;
  private stopPolling: (() => void) | null = null;
  private asking = false;
  private lastWords = '';

  constructor(options: AppRecognitionOptions = {}) {
    this.invoke = options.invoke ?? tauriInvoke;
    this.every = options.every ?? realEvery;
  }

  start(): void {
    if (this.phase !== 'new') throw new Error('AppRecognition has already started; make a new one to listen again');
    this.phase = 'listening';
    this.invoke(plugin(COMMANDS.start), { lang: this.lang || null }).then(
      (answer) => this.started((answer as { token: number }).token),
      (err) => this.end(`could not start: ${reason(err)}`, reason(err)),
    );
  }

  /** Turn the microphone off and wait for the last words, which come before `onend`. */
  stop(): void {
    if (this.phase !== 'listening' || this.stopAsked) return;
    this.stopAsked = true;
    if (this.token !== null) this.send(COMMANDS.stop);
  }

  /** End at once, keeping no more words. */
  abort(): void {
    if (this.phase !== 'listening') return;
    this.abortAsked = true;
    if (this.token !== null) this.send(COMMANDS.cancel);
    this.end('aborted', 'aborted');
  }

  private started(token: number) {
    this.token = token;
    if (this.abortAsked) {
      this.send(COMMANDS.cancel);
      return;
    }
    console.log(`${LOG_PREFIX} listening (start ${token})`);
    if (this.stopAsked) this.send(COMMANDS.stop);
    this.stopPolling = this.every(POLL_EVERY, () => void this.ask());
  }

  private send(command: string) {
    this.invoke(plugin(command), { token: this.token }).catch((err) => {
      console.warn(`${LOG_PREFIX} ${command} for start ${this.token} failed: ${reason(err)}`);
    });
  }

  private async ask() {
    if (this.asking || this.phase !== 'listening') return;
    this.asking = true;
    let heard: Heard;
    try {
      heard = (await this.invoke(plugin(COMMANDS.heard), { token: this.token })) as Heard;
    } catch (err) {
      this.asking = false;
      if (this.phase !== 'listening') return;
      this.send(COMMANDS.cancel);
      this.end(`could not read what it heard: ${reason(err)}`, reason(err));
      return;
    }
    this.asking = false;
    if (this.phase !== 'listening') return;
    if (heard.ended) {
      // The last words come once more, final, as the web's last result does.
      if (heard.words) this.onresult?.(result(heard.words, true));
      this.lastWords = heard.words;
      this.end(heard.error ? `ended: ${heard.error}` : 'ended', heard.error);
      return;
    }
    if (this.interimResults && heard.words !== this.lastWords) {
      this.lastWords = heard.words;
      this.onresult?.(result(heard.words, false));
    }
  }

  /** The one way out: stop asking, say why, and end once. */
  private end(why: string, error: string | null) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.stopPolling?.();
    this.stopPolling = null;
    console.log(`${LOG_PREFIX} ${why}${this.token === null ? '' : ` (start ${this.token})`}`);
    if (error) this.onerror?.({ error });
    this.onend?.();
  }
}

/**
 * Whether this page can dictate through Apple's recognizer: it runs in the iPhone app and the installed build has the
 * plugin. A build from before it answers no, and the page keeps the web's SpeechRecognition.
 */
export async function iphoneDictationReady(options: { invoke?: Invoke } = {}): Promise<boolean> {
  if (!isIphoneApp()) return false;
  try {
    await (options.invoke ?? tauriInvoke)(plugin(COMMANDS.heard), { token: 0 });
    return true;
  } catch (err) {
    console.log(`${LOG_PREFIX} this build has no dictation plugin, so the page keeps the web's: ${reason(err)}`);
    return false;
  }
}
