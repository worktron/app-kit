/*
 * `app-kit play upload`, from a Tauri app's checkout: builds its Android App Bundle signed with the app's upload key,
 * numbered one past every build Google holds for it, and puts it on the internal testing track, which reaches the
 * app's testers within minutes.
 *
 * - The build number is the highest of every bundle and APK the app ever uploaded, plus one: a track's releases name
 *   only the builds still on it, and Google refuses any number it has seen. A number taken meanwhile (another Mac's
 *   upload) is read again and the app built once more. Uploads of one app on this Mac take a lock, one at a time.
 * - Google takes the first build of a new app only by hand, in Play Console. So for an app Google does not know yet,
 *   the bundle is built and signed all the same, as build 1, and the steps to upload it there are printed.
 * - The service account's JSON key and the app's upload key are read from 1Password (play/key.ts). The upload key
 *   goes into a folder of the build's own for the build alone, named by gen/android/keystore.properties, the file the
 *   app's build.gradle.kts signs from as Tauri's guide writes it; both are deleted however the build ends, a stop by
 *   signal included.
 * - Google re-signs each build with the app's own key (Play App Signing), so a lost upload key is reset in Play
 *   Console, not the app lost.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';
import { buildEnv, type Env } from '../build-env.ts';
import { lastLine } from '../testflight/key.ts';
import { lock, stateFolder } from '../state.ts';
import { GooglePlay, PlayError, type PlayOptions, type ServiceAccount } from './google-play.ts';
import { ANDROID_PROJECT, BUILD_GRADLE, readApp } from './app.ts';
import { readServiceAccount, readUploadKey, type UploadKey } from './key.ts';

export { ANDROID_PROJECT, BUILD_GRADLE };
export const KEYSTORE_PROPERTIES = `${ANDROID_PROJECT}/keystore.properties`;
export const BUNDLE = `${ANDROID_PROJECT}/app/build/outputs/bundle/universalRelease/app-universal-release.aab`;
export const TRACK = 'internal';
/** What Android's build needs from the shell, which fleet's machine setup sets. */
export const ANDROID_TOOLS = ['ANDROID_HOME', 'NDK_HOME', 'JAVA_HOME'] as const;

export type PlayUploadOptions = {
  cwd: string;
  env?: Env;
  run?: Run;
  print?: (line: string) => void;
  /** Reads the service account and the upload key; replaced in tests. */
  serviceAccount?: () => Promise<ServiceAccount | string>;
  uploadKey?: (productName: string) => Promise<UploadKey | string>;
  play?: PlayOptions;
  stateEnv?: Env;
};

/** What stops an Android build before it starts: tools the shell lacks, no Android project, no signing from keystore.properties. */
export function androidProblem(cwd: string, env: Env, { signed }: { signed: boolean }): string | null {
  const missing = ANDROID_TOOLS.filter((name) => !env[name]);
  if (missing.length) return `this shell has no ${missing.join(', ')}: the Android tools come from fleet's machine setup, and a new login shell sets them`;
  if (!existsSync(join(cwd, ANDROID_PROJECT))) return `${cwd} has no ${ANDROID_PROJECT}: run bunx tauri android init and commit it`;
  if (!signed) return null;
  const gradle = existsSync(join(cwd, BUILD_GRADLE)) ? readFileSync(join(cwd, BUILD_GRADLE), 'utf8') : '';
  if (!gradle.includes('keystore.properties') || !/signingConfig\s*=\s*signingConfigs\.getByName\("release"\)/.test(gradle)) {
    return `${BUILD_GRADLE} does not sign its release build from keystore.properties: add the signing block from the README's "Shipping to Google Play"`;
  }
  if (existsSync(join(cwd, KEYSTORE_PROPERTIES))) return `${KEYSTORE_PROPERTIES} is already there; the upload writes its own for the build and deletes it, so move that one away`;
  return null;
}

/** Builds the signed bundle numbered `versionCode`, giving its path or why it could not. */
async function build(cwd: string, env: Env, run: Run, key: UploadKey, versionCode: number, print: (line: string) => void): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-play-'));
  const keystore = join(folder, 'upload.keystore');
  const properties = join(cwd, KEYSTORE_PROPERTIES);
  const removeKey = () => {
    rmSync(properties, { force: true });
    rmSync(folder, { recursive: true, force: true });
  };
  // A stop by signal (Ctrl-C, or a supervisor's SIGTERM) skips the finally below, so it stops the build, each program in
  // a process group of its own, and removes the key before exiting, as testflight upload does.
  const onSignal = (signal: NodeJS.Signals) => {
    print(`[play] stopped by ${signal}; stopping the build and removing the upload key`);
    stopRunning('SIGTERM');
    removeKey();
    stopRunning('SIGKILL');
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    writeFileSync(keystore, Buffer.from(key.keystore, 'base64'), { mode: 0o600 });
    writeFileSync(properties, `password=${key.password}\nkeyAlias=${key.alias}\nstoreFile=${keystore}\n`, { mode: 0o600, flag: 'wx' });
    rmSync(join(cwd, BUNDLE), { force: true });
    print(`[play] building build ${versionCode}`);
    const config = JSON.stringify({ bundle: { android: { versionCode } } });
    const built = await run(['bunx', 'tauri', 'android', 'build', '--ci', '--aab', '--config', config], { cwd, env: buildEnv(env), timeoutMs: 60 * 60 * 1000 });
    if (built.code !== 0) throw new Error(`the Android build of build ${versionCode} failed: ${lastLine(built.out)}`);
    if (!existsSync(join(cwd, BUNDLE))) throw new Error(`the Android build made no ${BUNDLE}`);
    return join(cwd, BUNDLE);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    removeKey();
  }
}

/** The steps for a new app's first build, which Google takes only in Play Console. */
export function firstUploadSteps(productName: string, packageName: string, bundle: string): string {
  return [
    `Google Play does not know ${packageName} yet, and takes a new app's first build only in Play Console. Build 1 is built and signed:`,
    `  ${bundle}`,
    `1. In Play Console (https://play.google.com/console), Create app: name ${productName}, then finish the questions it asks.`,
    `2. Testing, Internal testing, Create new release: upload the file above, and let Google sign the app (Play App Signing).`,
    `3. Testers: add a list of testers' Google addresses, and send them the link Play shows.`,
    `4. Users and permissions: invite the service account with "Release apps to testing tracks" for ${productName}.`,
    `Every build after it goes up with app-kit play upload.`,
  ].join('\n');
}

/** Runs the upload; 0 when the build is on internal testing (or built for its first upload by hand), 1 when it failed, 3 when a person must act first. */
export async function playUpload(options: PlayUploadOptions): Promise<0 | 1 | 3> {
  const { cwd } = options;
  const env = options.env ?? process.env;
  const run = options.run ?? runCommand;
  const print = options.print ?? ((line: string) => console.log(line));
  const fail = (why: string, code: 1 | 3 = 1) => {
    print(`[play] ${why}`);
    return code;
  };
  const app = readApp(cwd);
  if (typeof app === 'string') return fail(app, 3);
  const problem = androidProblem(cwd, env, { signed: true });
  if (problem) return fail(problem, 3);

  const account = await (options.serviceAccount ?? (() => readServiceAccount(run, env)))();
  if (typeof account === 'string') return fail(account, 3);
  const key = await (options.uploadKey ?? ((name: string) => readUploadKey(run, env, name)))(app.productName);
  if (typeof key === 'string') return fail(key, 3);

  const lockFile = join(stateFolder('play', options.stateEnv ?? env), `${app.packageName}.lock`);
  if (!lock(lockFile)) return fail(`another upload of ${app.packageName} is running on this Mac; run this again once it ends`);
  const play = new GooglePlay(account, app.packageName, options.play);
  let edit: string | null = null;
  try {
    /** The next build number, or null for an app Google does not know yet. */
    const nextNumber = async (): Promise<number | null> => {
      let opened: string;
      try {
        opened = await play.openEdit();
      } catch (error) {
        if (error instanceof PlayError && error.packageNotFound) return null;
        throw error;
      }
      try {
        return (await play.highestNumber(opened)) + 1;
      } finally {
        await play.deleteEdit(opened);
      }
    };
    let number = await nextNumber();
    if (number === null) {
      const bundle = await build(cwd, env, run, key, 1, print);
      print(firstUploadSteps(app.productName, app.packageName, bundle));
      return 0;
    }
    for (let attempt = 1; ; attempt++) {
      const bundle = await build(cwd, env, run, key, number, print);
      edit = await play.openEdit();
      print(`[play] uploading build ${number}`);
      try {
        await play.uploadBundle(edit, readFileSync(bundle));
      } catch (error) {
        if (!(error instanceof PlayError && error.numberTaken) || attempt > 1) throw error;
        await play.deleteEdit(edit);
        edit = null;
        const next = await nextNumber();
        print(`[play] Google already holds build ${number}, which another upload took meanwhile; building ${next} instead`);
        number = next ?? number + 1;
        continue;
      }
      break;
    }
    let draft = false;
    try {
      await play.release(edit, TRACK, number, 'completed');
    } catch (error) {
      if (!(error instanceof PlayError && error.draftApp)) throw error;
      print(`[play] ${app.productName} is still a draft in Play Console, which takes only a draft release: build ${number} goes up as one. Roll it out in Play Console once the app's setup there is finished.`);
      await play.release(edit, TRACK, number, 'draft');
      draft = true;
    }
    await play.commit(edit);
    edit = null;
    print(
      draft
        ? `[play] build ${number} of ${app.productName} is a draft release on ${TRACK} testing, which testers get once it is rolled out in Play Console`
        : `[play] build ${number} of ${app.productName} is on ${TRACK} testing`,
    );
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (edit) await play.deleteEdit(edit);
    rmSync(lockFile, { force: true });
  }
}
