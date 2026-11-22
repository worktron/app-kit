// The entries of scripts/kit-features.ts after one-tap sign-in (test/kit-features.test.ts), each read from made-up
// apps on both sides of it and one it does not apply to, laid out as the kit's apps are. Each app is a branch of one
// scratch repository under node_modules/.cache, written by a single git process, so the test's own processes are the
// entries' reads, which are what it checks. None of them asks Apple's servers.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { FEATURES, landedAt } from '../scripts/kit-features.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
let root: string;

const git = (stdin: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd: root, env, stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
};

beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-feature-entries-'));
  git('', 'init', '-q', '--bare');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

// One block of git fast-import's stream: its length in bytes, then the text.
const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;

let made = 0;
/** One entry's answer for a made-up app holding these files: has, lacks, or not asked when it does not apply. */
async function verdict(feature: string, files: Record<string, string>) {
  const entry = FEATURES.find((each) => each.feature === feature);
  if (!entry) throw new Error(`no entry named ${feature}`);
  const branch = `app-${++made}`;
  const written = Object.entries(files).map(([path, text]) => `M 100644 inline ${path}\n${data(text)}`);
  git(`commit refs/heads/${branch}\ncommitter Worktron <kit@example.com> 0 +0000\n${data('App')}${written.join('')}`, 'fast-import', '--quiet');
  const landed = landedAt(root, branch, env);
  return entry.appliesTo(landed) ? await entry.present(landed, async () => ({ failed: 'these entries never ask Apple' })) : 'not asked';
}

test('a server with Clerk on it has the kit decide hosted sign-in, as Friends and Family does, not a switch of its own, as Getter has', async () => {
  const HOSTED = 'hosted sign-in decided by the kit';
  const kit = "import { clerkServerSignIn } from 'app-kit/authentication/clerk/server';\nconst signIn = clerkServerSignIn({ env: process.env, port });\n";
  expect(await verdict(HOSTED, { 'server/index.ts': `import { getAuth } from '@clerk/hono';\n${kit}` })).toBe('has');
  const own = "import { createClerkClient } from '@clerk/backend';\nconst bypassAuth = process.env.DEV_BYPASS_AUTH === 'true';\n";
  expect(await verdict(HOSTED, { 'server/start.ts': own })).toBe('lacks');
  expect(await verdict(HOSTED, { 'apps/cloud/src/index.ts': "import { clerkMiddleware } from \"@hono/clerk-auth\";\n" })).toBe('lacks');
  // Clerk only in a test, or only on the page, is not a server with Clerk on it.
  expect(await verdict(HOSTED, { 'server/app.test.ts': "import { clerkMiddleware } from '@clerk/hono';\n", 'client/src/main.tsx': "import { ClerkProvider } from '@clerk/react';\n" })).toBe('not asked');
});

test("a server on the kit's listen and on Railway sets the draining time as Railway's variable, never in railway.json", async () => {
  const DRAINING = "Railway's draining time set for the kit's clean stop";
  const server = { 'server/index.ts': "import { listen } from 'app-kit/server/start';\nlisten(app, { onStop: () => db.close() });\n" };
  const settings = (env: string) => `import { defineRailway, project, service } from 'railway/iac';\nexport default defineRailway(() => project('app', { resources: [service('web', { healthcheck: '/api/health', env: { ${env} } })] }));\n`;
  expect(await verdict(DRAINING, { ...server, '.railway/railway.ts': settings("RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '10'") })).toBe('has');
  expect(await verdict(DRAINING, { ...server, 'apps/cloud/.railway/railway.ts': settings('"RAILWAY_DEPLOYMENT_DRAINING_SECONDS": "10"') })).toBe('has');
  expect(await verdict(DRAINING, { ...server, 'railway.json': '{}\n', 'README.md': 'Railway waits for the clean stop: RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10.\n' })).toBe('has');
  expect(await verdict(DRAINING, { ...server, 'scripts/railway-settings.ts': "await setVariable({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '10' });\n" })).toBe('has');
  // Railway stops reading railway.json and railway.toml on 2026-12-01, so a draining time there is none.
  expect(await verdict(DRAINING, { ...server, 'railway.json': '{ "deploy": { "healthcheckPath": "/api/health", "drainingSeconds": 10 } }\n' })).toBe('lacks');
  expect(await verdict(DRAINING, { ...server, 'railway.toml': '[deploy]\ndrainingSeconds = 10\n' })).toBe('lacks');
  expect(await verdict(DRAINING, { ...server, '.railway/railway.ts': settings("RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '0'") })).toBe('lacks');
  expect(await verdict(DRAINING, { ...server, '.railway/railway.ts': settings("NODE_ENV: 'production'") })).toBe('lacks');
  // On this machine only, with no Railway settings, nothing waits for it.
  expect(await verdict(DRAINING, server)).toBe('not asked');
  expect(await verdict(DRAINING, { 'server/index.ts': "import { appServer } from 'app-kit/server/start';\nBun.serve({ fetch: app.fetch });\n", 'railway.json': '{}\n' })).toBe('not asked');
});

test("an app on railway.json or railway.toml moves its settings to Railway's settings file before Railway stops reading them", async () => {
  const SETTINGS = "Railway's settings in .railway/railway.ts";
  const file = "import { defineRailway, project, service } from 'railway/iac';\nexport default defineRailway(() => project('app', { resources: [service('web')] }));\n";
  expect(await verdict(SETTINGS, { 'railway.json': '{ "deploy": { "preDeployCommand": "bun run db:migrate" } }\n' })).toBe('lacks');
  expect(await verdict(SETTINGS, { 'railway.toml': '[build]\nbuildCommand = "bun run build"\n' })).toBe('lacks');
  expect(await verdict(SETTINGS, { 'apps/cloud/railway.json': '{}\n' })).toBe('lacks');
  // Half moved: the new file written beside the old one, which Railway still reads until the cutoff.
  expect(await verdict(SETTINGS, { 'railway.json': '{}\n', '.railway/railway.ts': file })).toBe('lacks');
  expect(await verdict(SETTINGS, { '.railway/railway.ts': file })).toBe('has');
  // Settings set through Railway's API by a script of the app's own, as Sightline's are, or no Railway at all.
  expect(await verdict(SETTINGS, { 'scripts/railway-settings.ts': 'await setSettings();\n' })).toBe('not asked');
  expect(await verdict(SETTINGS, { 'server/index.ts': 'export {};\n' })).toBe('not asked');
});

test('a Hono server starts from appServer, its routers made with new Hono() or not', async () => {
  const APP_SERVER = "server started with the kit's appServer";
  const routes = { 'server/routes/items.ts': "import { Hono } from 'hono';\nexport const itemRoutes = new Hono();\n" };
  expect(await verdict(APP_SERVER, { ...routes, 'server/app.ts': "import { appServer } from 'app-kit/server/start';\nexport const app = appServer({ service: 'app' });\n" })).toBe('has');
  expect(await verdict(APP_SERVER, { 'server/app.ts': "import { Hono } from 'hono';\nconst app = new Hono<AppEnv>();\n" })).toBe('lacks');
  expect(await verdict(APP_SERVER, { 'server/app.test.ts': "const app = new Hono();\n", 'src/main.tsx': 'render();\n' })).toBe('not asked');
});

test("serveBuiltPage comes with Vite's build manifest, wherever the Vite config is", async () => {
  const MANIFEST = "Vite's build manifest for serveBuiltPage";
  const server = { 'server/index.ts': "const page = serveBuiltPage(join(import.meta.dir, '../client/dist'));\n" };
  expect(await verdict(MANIFEST, { ...server, 'client/vite.config.ts': 'export default defineConfig({ build: { manifest: true } });\n' })).toBe('has');
  expect(await verdict(MANIFEST, { ...server, 'client/vite.config.ts': "export default defineConfig({ build: { outDir: 'dist' } });\n" })).toBe('lacks');
  expect(await verdict(MANIFEST, { 'client/vite.config.ts': 'export default defineConfig({});\n' })).toBe('not asked');
});

test("a project with bun tests names the kit's start-up file, not a copy of its own", async () => {
  const START_UP = "the kit's test start-up file";
  const tests = { 'server/app.test.ts': "import { expect, test } from 'bun:test';\n" };
  expect(await verdict(START_UP, { ...tests, 'bunfig.toml': '[test]\npreload = ["app-kit/testing/start-up"]\n' })).toBe('has');
  expect(await verdict(START_UP, { ...tests, 'apps/client/bunfig.toml': '[test]\npreload = ["app-kit/testing/start-up", "../../test-setup.ts"]\n' })).toBe('has');
  expect(await verdict(START_UP, { ...tests, 'bunfig.toml': '[test]\npreload = ["./scripts/test-preload.ts"]\n' })).toBe('lacks');
  expect(await verdict(START_UP, tests)).toBe('lacks');
  expect(await verdict(START_UP, { 'src/main.ts': 'run();\n' })).toBe('not asked');
});

test('a Drizzle schema on Postgres is opened with openDb; one on SQLite is not asked', async () => {
  const OPEN_DB = "Postgres opened with the kit's openDb";
  const schema = { 'server/db/schema.ts': "import { pgTable, text } from 'drizzle-orm/pg-core';\n" };
  expect(await verdict(OPEN_DB, { ...schema, 'server/db/index.ts': "import { openDb } from 'app-kit/server/postgres';\n" })).toBe('has');
  expect(await verdict(OPEN_DB, { ...schema, 'server/db/index.ts': "import { drizzle } from 'drizzle-orm/postgres-js';\n" })).toBe('lacks');
  expect(await verdict(OPEN_DB, { 'server/db/schema.ts': "import { sqliteTable } from 'drizzle-orm/sqlite-core';\n" })).toBe('not asked');
});

test("with the sign-in gate, an error boundary has the placeholder, however its tag is written", async () => {
  const PLACEHOLDER = "the error boundary's placeholder";
  const gate = '<SignInGate provider={provider} placeholder={<Wordmark />} waitForFirstDraw>\n';
  expect(await verdict(PLACEHOLDER, { 'client/src/main.tsx': `<ErrorBoundary placeholder={<Wordmark />}>\n${gate}` })).toBe('has');
  // Another attribute holding a tag comes first, and the tag runs over lines.
  expect(await verdict(PLACEHOLDER, { 'src/main.tsx': `<ErrorBoundary\n  fallback={<Crash />}\n  placeholder={<Placeholder />}\n>\n${gate}` })).toBe('has');
  // One boundary with it is enough: an inner one around a part of the page needs none.
  expect(await verdict(PLACEHOLDER, { 'src/main.tsx': `<ErrorBoundary placeholder={<Wordmark />}>\n${gate}`, 'src/Panel.tsx': '<ErrorBoundary>\n' })).toBe('has');
  expect(await verdict(PLACEHOLDER, { 'client/src/main.tsx': `<ErrorBoundary>\n<SignInGate>\n` })).toBe('lacks');
  // A placeholder on something nested inside the boundary is not the boundary's.
  expect(await verdict(PLACEHOLDER, { 'client/src/main.tsx': `<ErrorBoundary fallback={crash}>\n${gate}` })).toBe('lacks');
  expect(await verdict(PLACEHOLDER, { 'client/src/App.tsx': '<ErrorBoundary>\n' })).toBe('not asked');
});

describe('an app with the sign-in gate draws its name before the code, in one picture or two, never a blank page', () => {
  const NAME = 'the name drawn before the code, never a blank page';
  const page = (style: string, head = '') => `<!doctype html><html><head>${head}<style>${style}</style></head><body><div id="root"></div></body></html>\n`;
  const one = "#root:empty::before {\n  content: 'Shop';\n  padding-top: 20vh;\n}\n";
  const two = "html:not([data-signed-in-before]) #root:empty::before { content: 'Shop'; padding-top: 20vh; }\nhtml[data-signed-in-before] #root:empty::before { content: 'Shop'; padding: 12px 16px; }\n";
  const gate = (props = '') => `import { SignInGate } from 'app-kit/web';\n<SignInGate provider={provider} placeholder={<Wordmark />}${props} signedOut={<Home />}>\n`;
  const firstPaint = { 'vite.config.ts': "import { firstPaint } from 'app-kit/web/first-paint';\nplugins: [firstPaint({ schemes })]\n" };
  const renamed = "import { SignInGate as KitSignInGate } from 'app-kit/web';\n<KitSignInGate provider={provider} whileReturning={<BarName />}>\n";

  test("one picture, or two with the bar's picture given to the gate and the mark set", async () => {
    // One picture, held by the gate until the screen draws, as Getter's: right for a screen that never shows the name.
    expect(await verdict(NAME, { 'client/index.html': page(one), 'client/src/main.tsx': gate() })).toBe('has');
    // Two, with the bar's picture given to the gate and the mark set by firstPaint, or by the page's own line.
    expect(await verdict(NAME, { 'index.html': page(two), 'src/main.tsx': gate(' whileReturning={<BarName />}'), ...firstPaint })).toBe('has');
    const ownLine = "<script>try { if (localStorage.getItem('app-kit.signedIn') === '1') document.documentElement.setAttribute('data-signed-in-before', '') } catch {}</script>";
    expect(await verdict(NAME, { 'client/index.html': page(two, ownLine), 'client/src/main.tsx': gate(' whileReturning={<BarName />}') })).toBe('has');
    // The gate under another name, as Timescale renders it, read wherever the setting is.
    expect(await verdict(NAME, { 'index.html': page(two), 'src/Gate.tsx': renamed, ...firstPaint })).toBe('has');
  });

  test('nothing before the code, or a blank page while sign-in loads', async () => {
    // Nothing before the code, as Matter, or nothing at all.
    expect(await verdict(NAME, { 'index.html': page('body { margin: 0; }'), 'src/main.tsx': gate() })).toBe('lacks');
    expect(await verdict(NAME, { 'index.html': page('#root:empty::before { max-width: 560px; }'), 'src/main.tsx': gate() })).toBe('lacks');
    // A blank page while sign-in loads, as Timescale's, under its renamed gate.
    expect(await verdict(NAME, { 'client/index.html': page(one), 'client/src/SignInGate.tsx': renamed.replace('{<BarName />}', '{null}') })).toBe('lacks');
  });

  test("the bar's picture with no picture for the gate, or with nothing to set the mark", async () => {
    // The bar's picture with no picture for the gate, so the name jumps twice, or with nothing to set the mark.
    expect(await verdict(NAME, { 'index.html': page(two), 'src/main.tsx': gate(), ...firstPaint })).toBe('lacks');
    expect(await verdict(NAME, { 'index.html': page(two), 'src/main.tsx': gate(' whileReturning={<BarName />}') })).toBe('lacks');
  });

  test('a picture that draws nothing for one kind of browser', async () => {
    // Two rules, one of which draws nothing: that kind of browser opens blank.
    const barWithoutName = "html:not([data-signed-in-before]) #root:empty::before { content: 'Shop'; padding-top: 20vh; }\nhtml[data-signed-in-before] #root:empty::before { padding: 12px 16px; }\nhtml[data-signed-in-before] #root:empty::after { content: ''; }\n";
    const homeWithoutName = "html:not([data-signed-in-before]) #root:empty::before { padding-top: 20vh; }\nhtml[data-signed-in-before] #root:empty::before { content: 'Shop'; padding: 12px 16px; }\n";
    expect(await verdict(NAME, { 'index.html': page(barWithoutName), 'src/main.tsx': gate(' whileReturning={<BarName />}'), ...firstPaint })).toBe('lacks');
    expect(await verdict(NAME, { 'index.html': page(homeWithoutName), 'src/main.tsx': gate(' whileReturning={<BarName />}'), ...firstPaint })).toBe('lacks');
    // A rule whose content draws nothing, '' or none, is no name either.
    for (const nothing of ["''", 'none']) {
      const blankBar = two.replace("html[data-signed-in-before] #root:empty::before { content: 'Shop';", `html[data-signed-in-before] #root:empty::before { content: ${nothing};`);
      expect(await verdict(NAME, { 'index.html': page(blankBar), 'src/main.tsx': gate(' whileReturning={<BarName />}'), ...firstPaint })).toBe('lacks');
    }
    // A picture only for a browser not signed in last time, and none for one that was, which then opens blank.
    expect(await verdict(NAME, { 'index.html': page("html:not([data-signed-in-before]) #root:empty::before { content: 'Shop'; }\n"), 'src/main.tsx': gate(), ...firstPaint })).toBe('lacks');
  });

  test('an app without the gate is not asked', async () => {
    expect(await verdict(NAME, { 'index.html': page(one), 'src/main.tsx': "import { request } from 'app-kit/web';\n" })).toBe('not asked');
  });
});

test('a page that draws the name before the code has no body tag before its root, with the gate or without', async () => {
  const NO_FRAME = 'no blank frame between the body and the name';
  const style = "<style>#root:empty::before { content: 'Shop'; }</style>";
  const head = `<!doctype html><html><head>${style}</head>`;
  const root = '<div id="root"></div><script type="module" src="/src/main.tsx"></script>';
  // A comment that names the tag, as an app's saying why it left it out, is not one.
  expect(await verdict(NO_FRAME, { 'client/index.html': `${head}\n<!-- the root's tag makes the body -->\n${root}</html>\n` })).toBe('has');
  expect(await verdict(NO_FRAME, { 'client/index.html': `${head}\n<!-- no <body> here -->\n${root}</html>\n` })).toBe('has');
  // The guide's page until now, with the gate or without: AI Buddy draws the name with no gate.
  expect(await verdict(NO_FRAME, { 'index.html': `${head}<body>\n${root}</body></html>\n`, 'src/main.tsx': "import { SignInGate } from 'app-kit/web';\n" })).toBe('lacks');
  expect(await verdict(NO_FRAME, { 'client/index.html': `${head}<BODY class="app">${root}</BODY></html>\n` })).toBe('lacks');
  // A page that draws no name has nothing to paint between the body and it.
  expect(await verdict(NO_FRAME, { 'index.html': `<!doctype html><html><head></head><body>${root}</body></html>\n` })).toBe('not asked');
});

test("a server calling Google's APIs with a grant reads the answers through the kit; fonts, Books and scope names are not calls", async () => {
  const GOOGLE = "Google's answers read by the kit";
  const gmail = "const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';\n";
  expect(await verdict(GOOGLE, { 'server/gmail.ts': `import { readGoogleResponse } from 'app-kit/server/google';\n${gmail}` })).toBe('has');
  expect(await verdict(GOOGLE, { 'server/gmail.ts': gmail })).toBe('lacks');
  expect(await verdict(GOOGLE, { 'server/calendar.ts': "const API = 'https://www.googleapis.com/calendar/v3';\n" })).toBe('lacks');
  expect(await verdict(GOOGLE, { 'server/sign-in.ts': "const TOKEN_URL = 'https://oauth2.googleapis.com/token';\n" })).toBe('lacks');
  const notCalls = {
    'server/layout.ts': "const FONTS = 'https://fonts.googleapis.com/css2?family=Figtree';\n",
    'server/covers.ts': 'fetch(`https://www.googleapis.com/books/v1/volumes?${q}`);\n',
    'shared/scopes.ts': "export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';\n",
    'extension/lib/google.js': 'export const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";\n',
  };
  expect(await verdict(GOOGLE, notCalls)).toBe('not asked');
});

test('an iPhone app on MUI keeps its fields from zooming with the kit; a web app alone is not asked', async () => {
  const ZOOM = 'fields that never zoom on the iPhone';
  const iphone = { 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': '<plist/>\n' };
  expect(await verdict(ZOOM, { ...iphone, 'src/theme.ts': "import { createTheme } from '@mui/material/styles';\nimport { fieldsNeverZoom } from 'app-kit/web';\n" })).toBe('has');
  expect(await verdict(ZOOM, { ...iphone, 'src/SignIn.tsx': "import { TextField } from '@mui/material';\nconst field = { fontSize: FIELD_FONT_SIZE };\n" })).toBe('has');
  // Sixteen pixels by hand stops the zoom but no longer grows with Text Size.
  expect(await verdict(ZOOM, { ...iphone, 'src/theme.ts': "import { createTheme } from '@mui/material/styles';\nconst input = { fontSize: 16 };\n" })).toBe('lacks');
  expect(await verdict(ZOOM, { 'src/theme.ts': "import { createTheme } from '@mui/material/styles';\n" })).toBe('not asked');
});


test('an app on the kit with a privacy or terms address writes them at build and has its server send them', async () => {
  const PUBLIC = 'public pages sent as finished HTML';
  const app = {
    'client/src/main.tsx': "import { SignInGate } from 'app-kit/web';\nconst PUBLIC_PAGES = { '/privacy': Privacy, '/terms': Terms };\n",
  };
  const built = {
    ...app,
    'scripts/public-pages.tsx': "import { writePublicPages } from 'app-kit/web/public-pages';\nawait writePublicPages({ folder: 'dist', appName: 'shop', pages });\n",
    'server/app.ts': "const page = serveBuiltPage('dist', { publicPages: true });\n",
  };
  expect(await verdict(PUBLIC, built)).toBe('has');
  expect(await verdict(PUBLIC, app)).toBe('lacks');
  // Written at build but never sent: the server still answers /privacy with the empty index page.
  expect(await verdict(PUBLIC, { ...built, 'server/app.ts': "const page = serveBuiltPage('dist');\n" })).toBe('lacks');
  expect(await verdict(PUBLIC, { 'client/src/Footer.tsx': "import { RowLink } from 'app-kit/web';\n<a href=\"/terms\">Terms</a>;\n", 'server/app.ts': 'serveBuiltPage(dist);\n' })).toBe('lacks');
  // A privacy page in an app not on the kit's web part, or none at all.
  expect(await verdict(PUBLIC, { 'src/App.tsx': "const routes = ['/privacy'];\n" })).toBe('not asked');
  expect(await verdict(PUBLIC, { 'client/src/main.tsx': "import { SignInGate } from 'app-kit/web';\n" })).toBe('not asked');
});

test("a window onto the site opens on the kit's start page, not straight on the site, and a shell with its own bundled page is not asked", async () => {
  const START = "the window opens on the kit's start page";
  const cargo = { 'src-tauri/Cargo.toml': 'tauri-plugin-app-kit-window = { path = "../node_modules/app-kit/tauri/window/plugin" }\n' };
  // Argon's and Getter's shells, before.
  const direct = 'let window = site.window(app, WebviewUrl::External(site.address().clone())).build()?;\n';
  expect(await verdict(START, { ...cargo, 'src-tauri/src/lib.rs': direct })).toBe('lacks');
  expect(await verdict(START, { ...cargo, 'desktop/src-tauri/src/lib.rs': direct })).toBe('lacks');
  const onStartPage = 'let window = site.start_page_window(app, StartPage::new(Color(10, 14, 31, 255), Color(224, 226, 235, 255))).build()?;\n';
  expect(await verdict(START, { ...cargo, 'src-tauri/src/lib.rs': onStartPage })).toBe('has');
  // Timescale's own start page.
  expect(await verdict(START, { ...cargo, 'src-tauri/src/lib.rs': 'let window = site.window(app, WebviewUrl::App("index.html".into())).build()?;\n' })).toBe('not asked');
  // A Tauri app not on the window plugin.
  expect(await verdict(START, { 'src-tauri/Cargo.toml': 'tauri = "2"\n', 'src-tauri/src/lib.rs': direct })).toBe('not asked');
});

test("a Mac app that opens on the kit's start page opens at login from the kit's Settings window, and one whose bundle is its site is not asked", async () => {
  const OPEN_AT_LOGIN = 'opens at login on the Mac, from Settings';
  const cargo = { 'src-tauri/Cargo.toml': 'tauri-plugin-app-kit-window = { path = "../node_modules/app-kit/tauri/window/plugin" }\n' };
  const onStartPage = { 'src-tauri/tauri.conf.json': '{ "build": { "frontendDist": "../node_modules/app-kit/tauri/window/start" } }\n' };
  // Matter's shell, before and after.
  const before = 'let menu = AppMenu::new().sign_out().commit(COMMIT).build(app)?;\n';
  const after = 'let menu = AppMenu::new().settings_window().sign_out().commit(COMMIT).build(app)?;\n';
  expect(await verdict(OPEN_AT_LOGIN, { ...cargo, ...onStartPage, 'src-tauri/src/lib.rs': before })).toBe('lacks');
  expect(await verdict(OPEN_AT_LOGIN, { ...cargo, ...onStartPage, 'src-tauri/src/lib.rs': after })).toBe('has');
  // The autostart plugin is not counted.
  expect(
    await verdict(OPEN_AT_LOGIN, {
      'src-tauri/Cargo.toml': `${cargo['src-tauri/Cargo.toml']}tauri-plugin-autostart = "2"\n`,
      ...onStartPage,
      'src-tauri/src/lib.rs': before,
    }),
  ).toBe('lacks');
  // Argon's shell, whose bundle is its hosted site, so no settings page ships in it.
  const remote = { 'src-tauri/tauri.conf.json': '{ "build": { "frontendDist": "https://app.example.com" } }\n' };
  expect(await verdict(OPEN_AT_LOGIN, { ...cargo, ...remote, 'src-tauri/src/lib.rs': 'AppMenu::new().settings().sign_out().build(app)\n' })).toBe('not asked');
  // An iPhone shell on the start page, with no Mac menu.
  expect(await verdict(OPEN_AT_LOGIN, { ...cargo, ...onStartPage, 'src-tauri/src/lib.rs': 'let window = site.start_page_window(app, page).build()?;\n' })).toBe('not asked');
});

test("an extension drawn in one toolbar colour turns on the toolbar icon for dark mode in its worker; the kit's copies alone are not it", async () => {
  const TOOLBAR_ICON = 'toolbar icon that follows dark mode';
  const icons = { 'package.json': JSON.stringify({ scripts: { icons: "app-kit icons render --extension extension/icons --toolbar-color '#1f1f1f'" } }) };
  const copies = {
    'extension/kit/toolbar-icon.js': '// Copied from app-kit\nexport function toolbarIconFollowsMode() {}\n',
    'extension/kit/color-scheme.js': '// Copied from app-kit\nimport { CHECK_MS, COLOR_SCHEME_MESSAGE } from "./toolbar-icon.js";\n',
  };
  const worker = 'import { toolbarIconFollowsMode } from "./kit/toolbar-icon.js";\n\ntoolbarIconFollowsMode();\n';
  const manifest = { 'manifest.json': JSON.stringify({ manifest_version: 3, permissions: ['offscreen'] }) };
  expect(await verdict(TOOLBAR_ICON, { ...icons, ...copies, ...manifest, 'extension/background.js': worker })).toBe('has');
  // No extension manifest to hold its pages and permissions to.
  expect(await verdict(TOOLBAR_ICON, { ...icons, ...copies, 'extension/background.js': worker })).toBe('lacks');
  expect(await verdict(TOOLBAR_ICON, { ...icons, ...copies, 'extension/background.js': 'import { every } from "./kit/alarms.js";\n' })).toBe('lacks');
  // Icons in the mark's own colours have no dark one-colour icon to swap.
  expect(await verdict(TOOLBAR_ICON, { 'package.json': JSON.stringify({ scripts: { icons: 'app-kit icons render --extension extension/icons' } }), ...copies })).toBe('not asked');
});

test("the toolbar icon hears Chrome's own mode: each page the manifest names loads color-scheme.js, and site access comes with scripting", async () => {
  const TOOLBAR_ICON = 'toolbar icon that follows dark mode';
  const base = {
    'package.json': JSON.stringify({ scripts: { icons: "app-kit icons render --extension extension/icons --toolbar-color '#1f1f1f'" } }),
    'extension/kit/toolbar-icon.js': '// Copied from app-kit\nexport function toolbarIconFollowsMode() {}\n',
    'extension/worker.js': 'import { toolbarIconFollowsMode } from "./kit/toolbar-icon.js";\ntoolbarIconFollowsMode();\n',
  };
  const manifest = (more: Record<string, unknown>) => JSON.stringify({ manifest_version: 3, permissions: ['offscreen'], action: { default_popup: 'extension/popup.html' }, ...more });
  const tagged = '<script type="module" src="kit/color-scheme.js"></script>\n<script type="module" src="popup.js"></script>\n';
  const plain = '<script type="module" src="popup.js"></script>\n';
  // Loaded by a tag of its own, or imported by the page's script.
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({}), 'extension/popup.html': tagged })).toBe('has');
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({}), 'extension/popup.html': plain, 'extension/popup.js': 'import "./kit/color-scheme.js";\n' })).toBe('has');
  // A popup that never loads it, or an options page that does not while the popup does.
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({}), 'extension/popup.html': plain, 'extension/popup.js': 'import "./kit/show.js";\n' })).toBe('lacks');
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({ options_page: 'extension/options.html' }), 'extension/popup.html': tagged, 'extension/options.html': plain })).toBe('lacks');
  // Access to websites without "scripting", and with it.
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({ host_permissions: ['https://*/*'] }), 'extension/popup.html': tagged })).toBe('lacks');
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({ host_permissions: ['https://*/*'], permissions: ['offscreen', 'scripting'] }), 'extension/popup.html': tagged })).toBe('has');
  // A test's fixture extension is no part of what the app ships.
  const fixture = { 'test/fixture/manifest.json': manifest({}), 'test/fixture/extension/popup.html': plain };
  expect(await verdict(TOOLBAR_ICON, { ...base, ...fixture, 'manifest.json': manifest({}), 'extension/popup.html': tagged })).toBe('has');
  // Access it may ask for later counts the same.
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({ optional_host_permissions: ['https://*/*'] }), 'extension/popup.html': tagged })).toBe('lacks');
  expect(await verdict(TOOLBAR_ICON, { ...base, 'manifest.json': manifest({ optional_host_permissions: ['https://*/*'], permissions: ['offscreen', 'scripting'] }), 'extension/popup.html': tagged })).toBe('has');
});
