/*
 * The window onto the hosted site's Rust (tauri/window/plugin/) shares names with the page that no compiler checks
 * across them: desktop sign-in's, and the window's own. The kit has no app to link it into, so this reads the Rust and
 * holds each name to the TypeScript, runs the iPhone's window.open script in the simulated page, and tests the page
 * half's hooks.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  DESKTOP_SIGN_IN_EVENT,
  DESKTOP_SIGN_IN_LISTENING,
  DESKTOP_SIGN_IN_PATH,
  LINK_HOST,
  NONCE_PARAM,
  TICKET_PARAM,
} from '../tauri/sign-in/names';
import {
  FULL_SCREEN_EVENT,
  FULL_SCREEN_FLAG,
  MENU_EVENT,
  MENU_SETTINGS,
  MENU_SIGN_OUT,
  NEWER_BUILD_EVENT,
  NEWER_BUILD_FLAG,
  RESTART_HOST,
  restartLink,
  UPDATE_EVENT,
  UPDATE_FLAG,
  UPDATE_HOST,
  UPDATE_STATES,
  updateLink,
  useAppUpdate,
  useNewerBuildInstalled,
  useWindowFullScreen,
  useWindowMenu,
} from '../tauri/window';
import {
  MENU_CHECK_ANSWERED,
  MENU_CHECK_CHOOSING,
  MENU_CHECK_HOLDS,
  MENU_CHECK_KIT_ITEMS,
  MENU_CHECK_KIT_TARGET,
  MENU_CHECK_LEFT_ALONE,
  MENU_CHECK_LINE,
  MENU_CHECK_NEVER_ANSWERED,
  MENU_CHECK_STARTING,
  MENU_CHECK_STOPPED,
  MENU_CHECK_STOPPED_END,
  MENU_CHECK_VARIABLE,
  MAC_RELEASE_VARIABLE,
  OPEN_AT_LOGIN_COMMANDS,
  OPEN_AT_LOGIN_STATES,
  SETTINGS_PAGE,
  SETTINGS_PAGE_SETTINGS,
  SETTINGS_WINDOW,
  START_PAGE_HEALTH,
  START_PAGE_SETTINGS,
} from '../tauri/window/names';

const plugin = join(import.meta.dir, '../tauri/window/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const constant = (source: string, name: string) => source.match(new RegExp(`const ${name}: &str = "([^"]*)";`))?.[1];

const page = window as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete page[FULL_SCREEN_FLAG];
  delete page[NEWER_BUILD_FLAG];
  delete page[UPDATE_FLAG];
  delete page.__TAURI_INTERNALS__;
});

test("the shell hands the page its sign-in under desktop sign-in's names", () => {
  const rust = read('src/sign_in.rs');
  expect(constant(rust, 'SIGN_IN_PATH')).toBe(DESKTOP_SIGN_IN_PATH);
  expect(constant(rust, 'LINK_HOST')).toBe(LINK_HOST);
  expect(constant(rust, 'SIGN_IN_EVENT')).toBe(DESKTOP_SIGN_IN_EVENT);
  expect(constant(rust, 'SIGN_IN_LISTENING')).toBe(DESKTOP_SIGN_IN_LISTENING);
  expect(constant(rust, 'TICKET_PARAM')).toBe(TICKET_PARAM);
  expect(constant(rust, 'NONCE_PARAM')).toBe(NONCE_PARAM);
});

test('the Mac window tells the page under the names its hooks read', () => {
  const rust = read('src/mac.rs');
  expect(constant(rust, 'FULL_SCREEN_FLAG')).toBe(FULL_SCREEN_FLAG);
  expect(constant(rust, 'FULL_SCREEN_EVENT')).toBe(FULL_SCREEN_EVENT);
  expect(constant(rust, 'NEWER_BUILD_FLAG')).toBe(NEWER_BUILD_FLAG);
  expect(constant(rust, 'NEWER_BUILD_EVENT')).toBe(NEWER_BUILD_EVENT);
  expect(constant(rust, 'RESTART_HOST')).toBe(RESTART_HOST);
});

test('the Mac window tells the page where an update stands under the names its hook reads', () => {
  const rust = read('src/updates.rs');
  expect(constant(rust, 'UPDATE_FLAG')).toBe(UPDATE_FLAG);
  expect(constant(rust, 'UPDATE_EVENT')).toBe(UPDATE_EVENT);
  expect(constant(rust, 'UPDATE_HOST')).toBe(UPDATE_HOST);
  const states = [...rust.matchAll(/UpdateState::\w+ => "([^"]+)"/g)].map((match) => match[1]);
  expect(states).toEqual([...UPDATE_STATES]);
});

test("the Mac menu hands the page Settings and Sign Out under the names its hook reads", () => {
  const rust = read('src/menu.rs');
  expect(constant(rust, 'MENU_EVENT')).toBe(MENU_EVENT);
  expect(constant(rust, 'SETTINGS')).toBe(MENU_SETTINGS);
  expect(constant(rust, 'SIGN_OUT')).toBe(MENU_SIGN_OUT);
});

test("the menu check's lines are the words the release's judge reads, and each kit item's line is one the kit logs", () => {
  const rust = read('src/menu_check.rs');
  expect(constant(rust, 'MENU_CHECK_VARIABLE')).toBe(MENU_CHECK_VARIABLE);
  expect(constant(rust, 'MENU_CHECK_LINE')).toBe(MENU_CHECK_LINE);
  expect(constant(rust, 'STARTING')).toBe(MENU_CHECK_STARTING);
  expect(constant(rust, 'HOLDS')).toBe(MENU_CHECK_HOLDS);
  expect(constant(rust, 'CHOOSING')).toBe(MENU_CHECK_CHOOSING);
  expect(constant(rust, 'ANSWERED')).toBe(MENU_CHECK_ANSWERED);
  expect(constant(rust, 'LEFT_ALONE')).toBe(MENU_CHECK_LEFT_ALONE);
  expect(constant(rust, 'STOPPED')).toBe(MENU_CHECK_STOPPED);
  expect(constant(rust, 'STOPPED_END')).toBe(MENU_CHECK_STOPPED_END);
  expect(constant(rust, 'NEVER_ANSWERED')).toBe(MENU_CHECK_NEVER_ANSWERED);
  // The crate's name, which the log plugin writes as each line's target.
  expect(read('Cargo.toml')).toContain(`name = "${MENU_CHECK_KIT_TARGET.replaceAll('_', '-')}"`);
  const sources = readdirSync(join(plugin, 'src'))
    .filter((name) => name.endsWith('.rs'))
    .map((name) => read(join('src', name)))
    .join('\n');
  for (const item of MENU_CHECK_KIT_ITEMS) {
    // The menu's title, as Rust writes it: whole in a string, or the end of a format string.
    expect(sources).toContain(item.end ? `${item.title}"` : `"${item.title}"`);
    for (const words of item.lines) expect(sources).toContain(words);
  }
});

test('the window hands the start page its settings under the name the page reads, with the health route every kit server answers', () => {
  const rust = read('src/lib.rs');
  expect(constant(rust, 'START_PAGE_SETTINGS')).toBe(START_PAGE_SETTINGS);
  expect(constant(rust, 'START_PAGE_HEALTH')).toBe(START_PAGE_HEALTH);
  expect(constant(rust, 'START_PAGE')).toBe('index.html');
  const startPage = readFileSync(join(import.meta.dir, '../tauri/window/start/index.html'), 'utf8');
  expect(startPage).toContain(`window.${START_PAGE_SETTINGS};`);
  for (const key of ['address', 'health', 'name', 'background', 'text']) {
    expect(startPage).toContain(`settings.${key}`);
    expect(rust).toContain(`"${key}": `);
  }
  expect(readFileSync(join(import.meta.dir, '../server/start/index.ts'), 'utf8')).toContain(`app.get('${START_PAGE_HEALTH}'`);
});

test('the Settings window, its page and its commands go by the names the page and the build use', () => {
  const settings = read('src/settings.rs');
  expect(constant(settings, 'SETTINGS_WINDOW')).toBe(SETTINGS_WINDOW);
  expect(constant(settings, 'SETTINGS_PAGE')).toBe(SETTINGS_PAGE);
  expect(constant(settings, 'SETTINGS_PAGE_SETTINGS')).toBe(SETTINGS_PAGE_SETTINGS);
  const build = read('build.rs');
  expect(build).toContain(`const COMMANDS: &[&str] = &[${OPEN_AT_LOGIN_COMMANDS.map((command) => `"${command}"`).join(', ')}];`);
  // Tauri names each command's permission allow-<command, with dashes>, which the window's grant names.
  for (const command of OPEN_AT_LOGIN_COMMANDS) {
    expect(settings).toContain(`"app-kit-window:allow-${command.replaceAll('_', '-')}"`);
    expect(settings).toMatch(new RegExp(`pub\\(crate\\) fn ${command}[<(]`));
  }
  const page = readFileSync(join(import.meta.dir, '../tauri/window/start', SETTINGS_PAGE), 'utf8');
  expect(page).toContain(`window.${SETTINGS_PAGE_SETTINGS}`);
  expect(page).toContain('`plugin:app-kit-window|${command}`');
  for (const command of OPEN_AT_LOGIN_COMMANDS) expect(page).toContain(`invoke('${command}'`);
  for (const state of OPEN_AT_LOGIN_STATES) expect(page).toContain(`'${state}'`);
  // The Rust's states, as serde names them from the enum's variants in kebab case.
  const loginItem = read('src/login_item.rs');
  // Only a copy the release command built turns open at login on by itself: the plugin reads the variable it sets.
  expect(constant(loginItem, 'MAC_RELEASE_VARIABLE')).toBe(MAC_RELEASE_VARIABLE);
  expect(loginItem).toContain(`option_env!("${MAC_RELEASE_VARIABLE}")`);
  const variants = loginItem.match(/pub\(crate\) enum State \{([^}]*)\}/)![1]!.match(/\w+/g)!;
  expect(variants.map((variant) => variant.replace(/(?<!^)[A-Z]/g, (letter) => `-${letter}`).toLowerCase())).toEqual([...OPEN_AT_LOGIN_STATES]);
});

test("the README's frontendDist is the start page's folder in the kit bun installed, which holds the two pages alone", () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const dist = readme.match(/"frontendDist": "\.\.\/node_modules\/app-kit\/([^"]+)"/)![1]!;
  expect(dist).toBe('tauri/window/start');
  // Tauri bundles the whole folder into every app.
  expect(readdirSync(join(import.meta.dir, '..', dist)).sort()).toEqual(['index.html', SETTINGS_PAGE]);
});

/** What the Mac window does to tell the page: sets the flag, then dispatches the event. */
function tell(flag: string, event: string, value: boolean) {
  page[flag] = value;
  window.dispatchEvent(new Event(event));
}

test('the full-screen hook reads a flag set before it listened, then follows each event', () => {
  expect(renderHook(() => useWindowFullScreen()).result.current).toBe(false);
  cleanup();
  page[FULL_SCREEN_FLAG] = true;
  const { result } = renderHook(() => useWindowFullScreen());
  expect(result.current).toBe(true);
  act(() => tell(FULL_SCREEN_FLAG, FULL_SCREEN_EVENT, false));
  expect(result.current).toBe(false);
  act(() => tell(FULL_SCREEN_FLAG, FULL_SCREEN_EVENT, true));
  expect(result.current).toBe(true);
});

test('the newer-build hook is false until the window says so, and true from then on', () => {
  const { result } = renderHook(() => useNewerBuildInstalled());
  expect(result.current).toBe(false);
  act(() => tell(NEWER_BUILD_FLAG, NEWER_BUILD_EVENT, true));
  expect(result.current).toBe(true);
  cleanup();
  // A page that loads after the window told the last one reads the flag the window sets again on each load.
  expect(renderHook(() => useNewerBuildInstalled()).result.current).toBe(true);
});

test("the restart and update links are the app's own scheme with the hosts the window takes", () => {
  expect(restartLink('com.example.app')).toBe('com.example.app://restart');
  expect(updateLink('com.example.app')).toBe('com.example.app://update');
});

test('the update hook reads a state set before it listened, follows each one, and ignores what it does not know', () => {
  expect(renderHook(() => useAppUpdate()).result.current).toBeNull();
  cleanup();
  page[UPDATE_FLAG] = 'available';
  const { result } = renderHook(() => useAppUpdate());
  expect(result.current).toBe('available');
  const tellUpdate = (state: unknown) => {
    page[UPDATE_FLAG] = state;
    window.dispatchEvent(new Event(UPDATE_EVENT));
  };
  act(() => tellUpdate('installing'));
  expect(result.current).toBe('installing');
  act(() => tellUpdate('failed'));
  expect(result.current).toBe('failed');
  act(() => tellUpdate('something newer'));
  expect(result.current).toBeNull();
});

test("on the iPhone, window.open hands its address, made whole, to the opener and opens nothing in the page", async () => {
  const script = read('src/iphone.rs').match(/WINDOW_OPEN_SCRIPT: &str = r#"([\s\S]*?)"#;/)![1];
  const calls: [string, unknown][] = [];
  let refuse = false;
  page.__TAURI_INTERNALS__ = {
    invoke: (command: string, args: unknown) => {
      calls.push([command, args]);
      return refuse ? Promise.reject(new Error('not allowed')) : Promise.resolve();
    },
  };
  const opened = window.open;
  const inPlace: unknown[][] = [];
  window.open = (...args: unknown[]) => {
    inPlace.push(args);
    return window;
  };
  try {
    new Function(script)();
    expect(window.open('https://mail.example.com/thread/1')).toBeNull();
    expect(window.open('/settings', '_blank')).toBeNull();
    expect(window.open()).toBeNull();
    // A target naming this window, or one holding it, moves the app's own window, as the web view does by itself.
    expect(window.open('/settings', '_self')).toBe(window);
    expect(window.open('/inbox', '_TOP', 'noopener')).toBe(window);
    expect(calls).toEqual([
      ['plugin:opener|open_url', { url: 'https://mail.example.com/thread/1' }],
      ['plugin:opener|open_url', { url: new URL('/settings', location.href).href }],
    ]);
    expect(inPlace).toEqual([
      ['/settings', '_self', undefined],
      ['/inbox', '_TOP', 'noopener'],
    ]);
    // An address the opener refuses is warned about, never thrown into the page.
    refuse = true;
    const warn = console.warn;
    try {
      const warned = new Promise<unknown[]>((resolve) => {
        console.warn = (...line: unknown[]) => resolve(line);
      });
      expect(window.open('file:///etc/passwd')).toBeNull();
      expect(await warned).toEqual(['[app-kit-window] could not open a new window:', 'Error: not allowed']);
    } finally {
      console.warn = warn;
    }
  } finally {
    window.open = opened;
  }
});

// iOS keeps the web view's swipe back off, and Tauri has no setting for it, so the plugin turns it on for its own window
// as each web view is made. The kit has no iPhone app to link the plugin into, so this reads the Rust; the iPhone
// Simulator build compiles it.
test('the iPhone window turns on the swipe back for the main window only', () => {
  const lib = read('src/lib.rs');
  expect(lib).toMatch(/\.on_webview_ready\(\|webview\| \{\s*#\[cfg\(target_os = "ios"\)\]\s*if on_main\(webview\.label\(\)\) \{\s*iphone::allow_swipe_back\(&webview\);/);
  const iphone = read('src/iphone.rs');
  expect(iphone).toContain('msg_send![view, setAllowsBackForwardNavigationGestures: true]');
  expect(iphone).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*pub\(crate\) fn allow_swipe_back/);
});

// A shake after typing raised iOS's "Undo Typing" alert over the page, so the plugin turns shake to undo off for the
// app as the main window's web view is made, on the main thread. Read from the Rust for the same reason as above.
test('the iPhone app turns off shake to undo as the main window is made', () => {
  const lib = read('src/lib.rs');
  expect(lib).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*if on_main\(webview\.label\(\)\) \{\s*iphone::allow_swipe_back\(&webview\);\s*iphone::turn_off_shake_to_undo\(\);/);
  const iphone = read('src/iphone.rs');
  expect(iphone).toContain('msg_send![application, setApplicationSupportsShakeToEdit: false]');
  expect(iphone).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*pub\(crate\) fn turn_off_shake_to_undo/);
});

test('the README shows the shell that plugin/tests/readme.rs compiles', () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const section = readme.split('### A window onto the hosted site')[1]!.split('\n### ')[0]!;
  const shell = section.match(/```rust\n([\s\S]*?)```/)![1]!;
  expect(read('tests/readme.rs')).toContain(shell);
});

// On Windows a second copy of the app runs every plugin registered before single-instance before it quits, and the
// window plugin finds the sign-in link through the deep-link plugin, so the shell apps copy registers them in that order.
test("the README's shell registers single-instance before every plugin on Windows, and deep-link before the window", () => {
  const shell = read('tests/readme.rs');
  const singleInstance = shell.indexOf('let builder = tauri_plugin_app_kit_window::single_instance(builder);');
  expect(singleInstance).toBeGreaterThan(-1);
  expect(shell.slice(0, singleInstance).split('\n').at(-2)).toBe('    #[cfg(target_os = "windows")]');
  expect(shell.slice(0, singleInstance)).not.toContain('.plugin(');
  expect(shell.indexOf('.plugin(tauri_plugin_deep_link::init())')).toBeLessThan(shell.indexOf('.plugin(site.plugin())'));
  expect(shell.indexOf('tauri_plugin_window_state::Builder')).toBeLessThan(shell.indexOf('.plugin(site.plugin())'));
});

test('a menu hook runs for its own item each time it is chosen, with the newest act, and stops when the page leaves', () => {
  const choose = (item: string) => window.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: item }));
  const chosen: string[] = [];
  const { rerender, unmount } = renderHook(({ label }) => useWindowMenu(MENU_SETTINGS, () => chosen.push(label)), {
    initialProps: { label: 'first' },
  });
  choose(MENU_SETTINGS);
  choose(MENU_SIGN_OUT);
  rerender({ label: 'second' });
  choose(MENU_SETTINGS);
  unmount();
  choose(MENU_SETTINGS);
  expect(chosen).toEqual(['first', 'second']);
});

// The Rust registers the Kotlin half by its package and class name, which Tauri's Android build finds only if they match
// what the Kotlin and its Gradle file declare; nothing here builds the Android app, so this reads the three. The
// emulator check (scripts/android-e2e.ts) measures the page between the bars.
test('the Android half is registered by the package and class its Kotlin declares, and padded by the bars', () => {
  const identifier = /pub\(crate\) const IDENTIFIER: &str = "([^"]+)";/.exec(read('src/android.rs'))?.[1];
  expect(identifier).toBe('app.kit.window');
  expect(read('android/build.gradle.kts')).toContain(`namespace = "${identifier}"`);
  const kotlin = read('android/src/main/java/WindowPlugin.kt');
  expect(kotlin).toContain(`package ${identifier}\n`);
  expect(kotlin).toMatch(/@TauriPlugin\s*class WindowPlugin\(/);
  expect(read('src/lib.rs')).toContain('register_android_plugin(android::IDENTIFIER, "WindowPlugin")');
  expect(read('build.rs')).toContain('.android_path("android")');
  expect(kotlin).toContain('WindowInsetsCompat.Type.systemBars()');
  // A recreated activity gets a new web view, but Tauri calls `load` once: the content frame is padded as each activity
  // resumes too, and a new frame takes the old one's background, which the Rust half painted.
  expect(kotlin).toContain('override fun onResume(activity: AppCompatActivity) = pad(activity)');
  expect(kotlin).toContain('activity.findViewById<View>(android.R.id.content)');
  expect(kotlin).toMatch(/if \(before === frame\) return\s*if \(before != null\) \{\s*frame\.background = before\.background/);
});

test('a sign-in that comes back while the start page waits is kept, and handed to the site once its page loads', () => {
  const lib = read('src/lib.rs');
  // Kept, not loaded straight away, when the window is missing or not on the site yet.
  const handOver = lib.slice(lib.indexOf('fn hand_over<'), lib.indexOf('fn hand_over_kept<'));
  expect(handOver).toMatch(/get_webview_window\(MAIN\) else \{[^}]*keep\(sign_in\);\s*return;/);
  expect(handOver).toMatch(/if window\.url\(\)\.is_ok_and\(\|url\| site\.on_site\(&url\)\) \{[^}]*window\.eval\(sign_in::sign_in_script[\s\S]*\} else \{[^}]*keep\(sign_in\);/);
  // Handed over as a page of the site finishes loading, on every platform that takes sign-in back.
  expect(lib).toMatch(/\.on_page_load\(move \|webview, payload\| \{\s*if on_main\(webview\.label\(\)\) && payload\.event\(\) == PageLoadEvent::Finished \{[\s\S]*?#\[cfg\(any\(target_os = "macos", target_os = "ios", target_os = "android", target_os = "windows"\)\)\]\s*if for_load\.on_site\(payload\.url\(\)\) \{\s*hand_over_kept\(webview, &for_load\);/);
  expect(lib).toMatch(/fn hand_over_kept<R: Runtime>\(webview: &Webview<R>, site: &Site\) \{\s*let Some\(sign_in\) = webview\.app_handle\(\)\.try_state::<KeptSignIn>\(\)\.and_then\(\|kept\| kept\.0\.lock\(\)\.unwrap\(\)\.take\(\)\)/);
});
