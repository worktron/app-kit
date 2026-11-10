// The entries of scripts/kit-features.ts after one-tap sign-in (test/kit-features.test.ts), each read from made-up
// apps on both sides of it and one it does not apply to, laid out as the kit's apps are and committed to scratch
// repositories under node_modules/.cache, as test/apps.test.ts makes them. None of them asks Apple's servers.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { FEATURES, landedAt } from '../scripts/kit-features.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
let root: string;

beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-feature-entries-'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
};

let made = 0;
/** One entry's answer for a made-up app holding these files: has, lacks, or not asked when it does not apply. */
async function verdict(feature: string, files: Record<string, string>) {
  const entry = FEATURES.find((each) => each.feature === feature);
  if (!entry) throw new Error(`no entry named ${feature}`);
  const dir = join(root, `app-${++made}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'App');
  const landed = landedAt(dir, 'HEAD');
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

