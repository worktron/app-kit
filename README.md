# app-kit

The baseline every app of ours ships with, written once instead of copied from the last app. One package with a part for each kind of app; the web client kit is the first, and the extension and Tauri kits are to follow. Practices' rules files say why each piece exists; this package is the code.

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
bun add github:worktron/app-kit#v0.1.1
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
    readableByKey: ['GET /api/profiles/:id/decisions', 'GET /api/profiles/:id/matters'],
    openPaths: ['/api/oauth/gmail/callback'],
  }),
);

app.get('/api/profiles/:id/decisions', (c) => listDecisions(callerOf(c).personId, c.req.param('id')));
```

- **The list decides.** Each entry is the method and the path as the app registered it. The check reads every route Hono matched after it, in the order Hono runs them: the first must be listed, and after it only listed routes and catch-alls (an `app.all` not-found answer, a `*` page fallback) may follow, since a listed route could pass the request on with `next()`. So a literal route such as `/api/items/export`, registered beside a listed `/api/items/:id`, is never let through by mistake. A key is refused on anything but GET (and HEAD, which runs the GET route), but a GET can still write, so a listed route must never write, not even behind a query flag such as `?check=1`.
- **Mount the check last.** After `clerkMiddleware()` and every other middleware, right before the routes: middleware mounted after it, the app's or a sub-app's, could answer a key's request, so a key is refused wherever any matches, and the log names it.
- **Handlers read the person with `callerOf(c).personId`.** A handler that asks Clerk for a session itself, such as `getAuth(c, { acceptsToken: 'session_token' })`, refuses every key the check let through. An app swaps its one helper for `callerOf`.
- **The answers.** A key on a write or on a route not listed gets 403 with why. No sign-in, or a revoked, expired or unknown key, gets 401. A key Clerk could not check, because Clerk could not be reached or answered with an error, gets 503, so an agent does not report a working key as revoked. Every decision about a key is logged with the key's name and id, never its secret.
- **Only a person's own keys.** A key owned by an organization, and Clerk's other kinds of machine token, are refused.
- **Revoking takes about a minute.** Measured on 2026-10-24: Clerk's key check kept accepting a revoked key for 55 seconds, though its key lookup said revoked at once.
- **Switching it on.** In the Clerk Dashboard, for each instance: Configure, Developers, API keys, Enable API keys, with user API keys on and organization keys off. The page under Instance, also called API keys, is the app's own Clerk secret keys, not this.
- **The agent's side.** The person pastes the key into 1Password, and the agent reads it where it calls: `curl -H "Authorization: Bearer $(op read 'op://<vault>/<item>/credential')" https://<app>/api/...`.

Needs `hono` 4.12 or later and `@clerk/hono` 0.1.93 or later.

## Develop

`bun test`, `bun run typecheck`, `bun run lint`, and `bun run test:e2e` for the fixture in a hidden Chromium (`bunx playwright install chromium` first). `scripts/gates.sh` runs all four.

Releases are tags, `v<version>`, matching `package.json`'s version, made on main after the change merges, so a release is always a commit main holds. A tag never moves; a fix is a new tag. While the version is 0.x, a patch release needs no change in the apps and a minor one may, which its release notes say.

The repository is public. A change lands by moving main forward to the reviewed branch's head through GitHub's API (`gh api -X PATCH repos/worktron/app-kit/git/refs/heads/main -f sha=<head>`), which adds no commit, so every commit keeps Worktron as its author and committer; GitHub marks the pull request merged. Its merge buttons write a new committer, the merging account, for every commit, merge, squash and rebase alike. `test/public.test.ts` fails on any personal email, home folder or name in the files or the history.
