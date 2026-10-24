# app-kit

The baseline every app of ours ships with, written once instead of copied from the last app. One package with a part for each kind of app: the web client kit, the server check for keys for agents, and the extension kit, with the Tauri kit to follow. Practices' rules files say why each piece exists; this package is the code.

## The web client kit

`app-kit/web`: React and MUI, with sign-in behind an adapter so the provider can change without the apps changing. `rules/web-apps.md` is its list.

| Piece | Import | What it does |
| --- | --- | --- |
| Fetch wrapper | `request` | Sends the session's token, reads the status before the body, and returns the parsed JSON. A 401 is asked once more with a fresh token; refused again, sign-in comes up over the current address, once, never in a loop. |
| Server-unreachable line | `ConnectionLine`, `useServerReachable`, `onReconnect` | No answer, or a proxy's 502, 503 or 504, shows a line until the server answers again. While down it looks every five seconds and when the browser comes back online or the page back in front. |
| New-deploy line | `NewBuildLine`, `useNewBuild`, `lookForNewBuild` | An open page looks for a newer build when it comes back in front, at most once a minute, or at once on a pull to refresh, and shows a quiet line with Reload. It reloads by itself only once hidden, or after ten idle minutes, with nothing entered, unless the app passes `reloadsItself: false` to `useNewBuild`, or `reloadsItself={false}` to `NewBuildLine`, because its view holds something only in memory. |
| Reload after a failed screen load | `reloadOnFailedLoad` | A tab open across a deploy asks for screen code that is gone; Vite's `vite:preloadError` reloads the page once, with a guard so it never loops. |
| Error boundary | `ErrorBoundary` | A crash shows what failed and a Reload button, or the app's own `fallback`. |
| Links for rows and cards | `RowLink`, `NavigateProvider` | A whole row as a real `<a href>`: ⌘-click and middle-click open a new tab, a plain click moves through the app's navigate. |
| Sign-in gate | `SignInGate`, `useSignIn`, `useSignOut`, `usePerson`, `useAppDrawn` | One steady placeholder until the provider knows who is signed in and, with `waitForFirstDraw`, until the app has drawn its first data. The app's sign-in screen at whatever address was asked for, so sign-in lands there. Sign-in and sign-out with no page load beyond the provider's own trip to Google. Continue as the account last used on this device, or Use a different account, which asks Google for its list. |
| Clerk | `app-kit/web/clerk` | `clerkSignIn({ publishableKey })`, the first adapter. |
| Stand-in | `app-kit/web/testing` | `standInSignIn()`, a provider with no network for tests of the kit and of apps built on it. |

## Taking it in

An app installs the kit at a release tag, straight from GitHub, which needs no credentials since the repository is public:

```sh
bun add github:worktron/app-kit#v0.4.0
```

`bun.lock` then holds the exact commit and a hash of its download, so a build from the lockfile, such as Railway's `bun install --frozen-lockfile`, installs that commit and nothing newer. The kit ships TypeScript sources, which Vite and Bun compile with the app; the web part needs React 19 and MUI 9, and `@clerk/react` 6 for the Clerk adapter. To upgrade, run the same `bun add` at the new tag and commit `package.json` and `bun.lock`; each app upgrades when it chooses.

## An app built on it

```tsx
import { ErrorBoundary, SignInGate, reloadOnFailedLoad, configureConnection } from 'app-kit/web';
import { clerkSignIn } from 'app-kit/web/clerk';

reloadOnFailedLoad();
configureConnection({ probePath: '/api/health' });
const provider = clerkSignIn({ publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY });

createRoot(root).render(
  <ErrorBoundary>
    <SignInGate provider={provider} placeholder={<Wordmark />} signedOut={<SignInScreen />} waitForFirstDraw>
      <App />
    </SignInGate>
  </ErrorBoundary>,
);
```

The app draws its own sign-in screen with `useSignIn()`: `lastAccount` for Continue as that account, `google('remembered')`, `google('choose')` and `google({ account })` for an account chosen in another window, `sendEmailCode` and `checkEmailCode`, and `notice` for what to say above the buttons. Its server answers `/sso-callback` (or the gate's `callbackPath`) with the app, since Google returns there. With `waitForFirstDraw`, the app is rendered from the start, so its requests go out, but none of it shows until it calls `useAppDrawn()`'s function, so the whole screen appears at once. Every screen calls it once its first data is in or has failed to come, and a screen with nothing to load calls it at once: a screen that never calls it stays hidden. Every request goes through `request`.

`e2e/fixture` is a whole one, which the kit's own browser test runs.

## The adapter

A provider is `{ Root, useSession, GoogleReturn }` (`src/sign-in/provider.ts`): its own context around the app; a hook giving whether it has loaded, who is signed in, a token (fresh on demand), Google sign-in to a callback path naming an account or asking for the list, an emailed code sent and checked, and sign-out that stays on the page; and a component that finishes the return from Google. Another provider is another adapter, and the apps change only which one they pass to the gate.

Clerk-specific, by design: the Clerk adapter starts Google through Clerk's classic sign-in resource, since its newer one takes no account to sign in as. A part of an app that needs more of Clerk than the adapter asks for, such as signing in with a one-time token, uses Clerk's own hooks inside the gate, whose provider is Clerk's.

## Keys for agents

`app-kit/agent-keys`: a person makes a key in the app's Settings, and an agent or script sends it as `Authorization: Bearer <key>` to read that person's own data. The app's server names the GET routes a key may read; every other route stays session-only. Clerk holds the keys: it makes, lists and revokes them in the API keys tab of its own profile screen (or its `<APIKeys />` component), and checks each one on every request.

```ts
import { clerkMiddleware } from '@clerk/hono';
import { requireCaller, callerOf } from 'app-kit/agent-keys';
import { clerkCaller } from 'app-kit/agent-keys/clerk';

app.use('/api/*', clerkMiddleware());
app.use(
  '/api/*',
  requireCaller({
    caller: clerkCaller,
    readableByKey: ['GET /api/profiles/:id/decisions', 'GET /api/profiles/:id/matters', 'ALL /api/*'],
    openPaths: ['/api/oauth/gmail/callback'],
  }),
);

app.get('/api/profiles/:id/decisions', (c) => listDecisions(callerOf(c).personId, c.req.param('id')));
// ...
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
```

- **The list decides.** Each entry is the method and the path as the app registered it. The check reads every route Hono matched for the request after it, and lets a key through only when all of them are listed, since any of them could run: the first unless it passes the request on with `next()`, and an `app.all` handler cannot be told from middleware. So the app lists its catch-alls too, such as a not-found answer `ALL /api/*` and a page fallback registered as `*`, which Hono records as `GET /*`. A literal route such as `/api/items/export`, registered beside a listed `/api/items/:id`, is never let through by mistake. A refusal's log line names the unlisted route. A key is refused on anything but GET (and HEAD, which runs the GET route), but a GET can still write, so a listed route must never write, not even behind a query flag such as `?check=1`.
- **Mount the check last.** After `clerkMiddleware()` and every other middleware, right before the routes: middleware mounted after it, the app's or a sub-app's, could answer a key's request, so a key is refused wherever any matches, and the log names it. Hono records middleware and an `app.all` route the same way, method `ALL` and its path, so a listed `ALL /api/*` also lets through middleware mounted at `/api/*` after the check.
- **Handlers read the person with `callerOf(c).personId`.** A handler that asks Clerk for a session itself, such as `getAuth(c, { acceptsToken: 'session_token' })`, refuses every key the check let through. An app swaps its one helper for `callerOf`.
- **The answers.** A key on a write or on a route not listed gets 403 with why. No sign-in, or a revoked, expired or unknown key, gets 401. A key Clerk could not check, because Clerk could not be reached or answered with an error, gets 503, so an agent does not report a working key as revoked. Every decision about a key is logged with the key's name and id, never its secret.
- **Only a person's own keys.** A key owned by an organization, and Clerk's other kinds of machine token, are refused.
- **Revoking takes about a minute.** Measured on 2026-10-24: Clerk's key check kept accepting a revoked key for 55 seconds, though its key lookup said revoked at once.
- **Switching it on.** In the Clerk Dashboard, for each instance: Configure, Developers, API keys, Enable API keys, with user API keys on and organization keys off. The page under Instance, also called API keys, is the app's own Clerk secret keys, not this.
- **The agent's side.** The person pastes the key into 1Password, and the agent reads it where it calls: `curl -H "Authorization: Bearer $(op read 'op://<vault>/<item>/credential')" https://<app>/api/...`. An agent starts at the app's `/api/reference.json` (below), which lists what its key may read.

Needs `hono` 4.12 or later and `@clerk/hono` 0.1.93 or later.

## API reference

`app-kit/agent-keys/openapi`: the app describes its routes next to their code with `hono-openapi`, and the kit generates two OpenAPI descriptions from them: the whole one for a signed-in person, and one holding only the GET routes a key may read, for an agent. Both end with a section on calling the API with a key, written from the key's description, so no app writes that prose by hand. People read it on a Scalar reference page.

```ts
import { describeRoute, resolver, validator } from 'hono-openapi';
import { z } from 'zod';
import { Scalar } from '@scalar/hono-api-reference';
import { callerOf } from 'app-kit/agent-keys';
import { openApiDescriptions, REFERENCE_PAGE_SETTINGS } from 'app-kit/agent-keys/openapi';

const READABLE = ['GET /api/reference.json', 'GET /api/profiles/:id/decisions', 'ALL /api/*'];
// ...requireCaller({ caller: clerkCaller, readableByKey: READABLE }) as above, then the routes:

app.get(
  '/api/profiles/:id/decisions',
  describeRoute({ summary: 'List the decisions on a profile', responses: { 200: { description: 'The decisions', content: { 'application/json': { schema: resolver(Decisions) } } } } }),
  validator('param', z.object({ id: z.string().uuid() })),
  (c) => listDecisions(callerOf(c).personId, c.req.valid('param').id),
);

const descriptions = openApiDescriptions(app, { title: 'Argon', description: 'What the app keeps for you.', readableByKey: READABLE });
app.get('/api/reference.json', describeRoute({ summary: "This API's OpenAPI description" }), async (c) =>
  c.json(await descriptions.forCaller(callerOf(c))),
);
app.get('/api/reference', Scalar({ ...REFERENCE_PAGE_SETTINGS, pageTitle: 'Argon API', url: '/api/reference.json' }));
// ...then the not-found catch-all, last.
```

- **One list.** The same `READABLE` goes to `requireCaller` and to `openApiDescriptions`, and lists `GET /api/reference.json`, so an agent with a key reads its own description there and a signed-in person reads the whole one. The page itself is not listed: only a signed-in person opens it. A signed-out person sees `{"error":"unauthorized"}`, so the app links the page from its own signed-in screens.
- **Generated once.** Each description is generated on first use, after every route is registered, and kept for the life of the server.
- **A key's description is generated from only its routes**, the same strings the key check compares, so it holds no schema that only another route uses.
- **The test.** `undescribedForKey(app, READABLE)` names each listed GET route a key would not see described: no `describeRoute`, only a `validator`, or a route the generator drops. Catch-alls are skipped. An app's test expects `[]`.
- **Describing a route.** `describeRoute` gives the summary; `validator` from `hono-openapi` replaces `zValidator` from `@hono/zod-validator` and puts the schema in the description. Its 400 answer differs: `{ success: false, error: [issues], data }`, which echoes the input back. Zod 4, or Zod 3.25 with `zod-to-json-schema`.
- **The reference page stays on the app's host.** `REFERENCE_PAGE_SETTINGS` turns off what Scalar does by default that leaves it:
  - its AI agent, on by default on localhost, which uploads the description to Scalar;
  - its hosted proxy, through which a test request from a deployed app goes to Scalar's server with any key typed into the page;
  - its developer toolbar, whose Share and Deploy send the description to Scalar's cloud;
  - its fonts and its telemetry.

  It also pins Scalar's script to one release on jsDelivr, so a page that carries the session never runs a newer script than the one checked, and draws its first frame in the system's light or dark. The page asks only the app and `cdn.jsdelivr.net`. An app with a content security policy allows `https://cdn.jsdelivr.net/npm/@scalar/` and inline scripts on that page, or passes Scalar its nonce (`nonce: c.get('secureHeadersNonce')`).

Needs `hono-openapi` 1.5 or later, and `@scalar/hono-api-reference` for the page.

## The extension kit

`app-kit/extension`: what every browser extension of ours ships with. `rules/extensions.md` is its list. The worker files are plain JavaScript Chrome loads with no build step; the rest is TypeScript run by Bun on the Mac.

| Piece | Where | What it does |
| --- | --- | --- |
| Self-reload | `extension/worker/self-reload.js` | An extension loaded unpacked from its checkout reloads itself when the checkout's commit changes, when a file it loads is deleted, or, for a built folder, when the build on disk changes. A Web Store install never does. |
| Build identity | `extension/worker/build.js` | The version and the commit the worker loaded from, as `0.1.0-src (abc1234)`, and a record in `storage.local` of when this profile first ran that build. |
| Account identity | `extension/worker/account.js` | The profile's signed-in account from `chrome.identity.getProfileUserInfo`, with `identity.email` an optional permission asked for when a feature needs it. |
| Timers | `extension/worker/alarms.js` | Work on a clock runs on `chrome.alarms`, which survive Chrome stopping the worker, unlike `setInterval`. |
| Recorded errors | `extension/worker/errors.js` | The worker's uncaught errors, each with its time and build, kept in `storage.local`. |
| Native port | `extension/worker/port.js` | The worker's port to a native host, which reconnects, says hello with its build, and answers the host's status question with its build, commit and errors. |
| Native host | `app-kit/extension/host` | The host Chrome starts: it serves a unix socket for callers on the Mac (a command line, an MCP server, a server) and relays their requests to the extension. Also the client callers use, the status they read, the extension's ID from its key, and the manifest that tells Chrome about the host. |
| Status command | `app-kit extension status <socket>` | Prints what the host says: whether the extension is connected, its build, its commit and its kept errors. |
| Harness | `app-kit/extension/harness` | Loads the real extension in a hidden Chromium from a scratch git checkout, with its native host, for the extension's own tests: fire an alarm, commit, wait for the reload, count tabs. |
| Chrome stand-in | `app-kit/extension/testing/chrome` | An in-memory `chrome` for unit tests of a worker built on the kit. |

An extension installs app-kit the same way an app does, then copies the files Chrome loads into a folder of its own and commits them, because an unpacked extension loads from its checkout and a landing updates a checkout with git alone:

```sh
bun add github:worktron/app-kit#v0.4.0
bun run app-kit extension copy extension/kit
```

`bun run` runs the installed command and never downloads one, as `bunx` would from npm when the kit is not installed. Each copy's first line names the kit version it came from. A test in the extension keeps the copy current, comparing the code below that line, so a release that changes no worker file asks for no new copy:

```ts
import { workerCopyDiffers } from 'app-kit/extension/copy'
test('the kit copy is current', () => expect(workerCopyDiffers('extension/kit')).toEqual([]))
```

To upgrade, run the same `bun add` at the new tag, then the copy command again.

A worker built on it:

```js
import { every } from "./kit/alarms.js";
import { buildName, recordBuild } from "./kit/build.js";
import { watchWorkerErrors } from "./kit/errors.js";
import { nativePort } from "./kit/port.js";
import { checkForNewCheckout } from "./kit/self-reload.js";

const LOADED_FILES = ["extension/worker.js", "extension/kit/self-reload.js" /* every file the worker loads */];
let commit = null;

const port = nativePort({
  host: "com.example.tool",
  describe: () => ({ version: buildName(commit), commit }),
  answer: async (message) => ({ type: "answer", id: message.id /* , what the extension found */ }),
});

async function start() {
  const checked = await checkForNewCheckout(LOADED_FILES);
  commit = checked.commit;
  if (checked.reloading) return;
  await recordBuild(commit);
  port.connect();
}

watchWorkerErrors(self, () => buildName(commit));
every("check", 1, start);
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
start();
```

`extension/test/fixture/worker.js` is a whole one, which the kit's own hidden-Chromium test loads.

The host:

```ts
import { serveHost } from 'app-kit/extension/host'
await serveHost({ socketPath, logPath, refuse: (request) => (allowed(request) ? null : 'never sent') })
```

A caller writes one JSON line with an `id` and a `type` to the socket and reads one line back with the same `id`; `ask(socketPath, line)` does both. The type `status` is the host's own. The socket belongs in the tool's Application Support folder (`applicationSupport(name)`), and its path must stay under 104 bytes.

## Develop

`bun test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e` for the web fixture in a hidden Chromium, and `bun test ./extension/e2e/harness.e2e.ts` for the extension fixture through the harness (`bunx playwright install chromium` first). `scripts/gates.sh` runs all five. A change to `extension/worker/` is followed by `bun bin/app-kit.ts extension copy extension/test/fixture/kit`, which a test checks.

Releases are tags, `v<version>`, matching `package.json`'s version, made on main after the change merges, so a release is always a commit main holds. A tag never moves; a fix is a new tag. While the version is 0.x, a patch release needs no change in the apps and a minor one may, which its release notes say.

The repository is public. A change lands by moving main forward to the reviewed branch's head through GitHub's API (`gh api -X PATCH repos/worktron/app-kit/git/refs/heads/main -f sha=<head>`), which adds no commit, so every commit keeps Worktron as its author and committer; GitHub marks the pull request merged. Its merge buttons write a new committer, the merging account, for every commit, merge, squash and rebase alike. `test/public.test.ts` fails on any personal email, home folder or name in the files or the history.
