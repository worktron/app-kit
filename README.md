# web-client-kit

The baseline every web app of ours ships with, written once instead of copied from the last app. Practices' `rules/web-apps.md` says why each piece exists; this package is the code. React and MUI, with sign-in behind an adapter so the provider can change without the apps changing.

| Piece | Import | What it does |
| --- | --- | --- |
| Fetch wrapper | `request` | Sends the session's token, reads the status before the body, and returns the parsed JSON. A 401 is asked once more with a fresh token; refused again, sign-in comes up over the current address, once, never in a loop. |
| Server-unreachable line | `ConnectionLine`, `useServerReachable`, `onReconnect` | No answer, or a proxy's 502, 503 or 504, shows a line until the server answers again. While down it looks every five seconds and when the browser comes back online or the page back in front. |
| New-deploy line | `NewBuildLine`, `useNewBuild` | An open page looks for a newer build when it comes back in front, at most once a minute, and shows a quiet line with Reload. It reloads by itself only once hidden, or after ten idle minutes with nothing typed. |
| Reload after a failed screen load | `reloadOnFailedLoad` | A tab open across a deploy asks for screen code that is gone; Vite's `vite:preloadError` reloads the page once, with a guard so it never loops. |
| Error boundary | `ErrorBoundary` | A crash shows what failed and a Reload button, or the app's own `fallback`. |
| Links for rows and cards | `RowLink`, `NavigateProvider` | A whole row as a real `<a href>`: ⌘-click and middle-click open a new tab, a plain click moves through the app's navigate. |
| Sign-in gate | `SignInGate`, `useSignIn`, `useSignOut`, `usePerson`, `useAppDrawn` | One steady placeholder until the provider knows who is signed in and, with `waitForFirstDraw`, until the app has drawn its first data. The app's sign-in screen at whatever address was asked for, so sign-in lands there. Sign-in and sign-out with no page load beyond the provider's own trip to Google. Continue as the account last used on this device, or Use a different account, which asks Google for its list. |
| Clerk | `web-client-kit/clerk` | `clerkSignIn({ publishableKey })`, the first adapter. |
| Stand-in | `web-client-kit/testing` | `standInSignIn()`, a provider with no network for tests of the kit and of apps built on it. |

## Taking it in

An app installs the kit at a tagged version, with Bun 1.4.4 or later:

```sh
bun add git+ssh://git@github.com/worktron/web-client-kit.git#v0.1.0
```

The kit ships TypeScript sources, which Vite and Bun compile with the app; it needs React 19 and MUI 9, and `@clerk/react` 6 for the Clerk adapter. To upgrade, run the same `bun add` at the new tag. Older Bun keeps one clone of the kit per machine and never sees a tag pushed after that clone.

## An app built on it

```tsx
import { ErrorBoundary, SignInGate, reloadOnFailedLoad, configureConnection } from 'web-client-kit';
import { clerkSignIn } from 'web-client-kit/clerk';

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

The app draws its own sign-in screen with `useSignIn()`: `lastAccount` for Continue as that account, `google('remembered')` and `google('choose')`, `sendEmailCode` and `checkEmailCode`, and `notice` for what to say above the buttons. Its server answers `/sso-callback` (or the gate's `callbackPath`) with the app, since Google returns there. The app calls `useAppDrawn()`'s function once its first screen has its data, and every request goes through `request`.

`e2e/fixture` is a whole one, which the kit's own browser test runs.

## The adapter

A provider is `{ Root, useSession, GoogleReturn }` (`src/sign-in/provider.ts`): its own context around the app; a hook giving whether it has loaded, who is signed in, a token (fresh on demand), Google sign-in to a callback path naming an account or asking for the list, an emailed code sent and checked, and sign-out that stays on the page; and a component that finishes the return from Google. Another provider is another adapter, and the apps change only which one they pass to the gate.

Clerk-specific, by design: the Clerk adapter starts Google through Clerk's classic sign-in resource, since its newer one takes no account to sign in as. A part of an app that needs more of Clerk than the adapter asks for, such as signing in with a one-time token, uses Clerk's own hooks inside the gate, whose provider is Clerk's.

## Develop

`bun test`, `bun run typecheck`, `bun run lint`, and `bun run test:e2e` for the fixture in a hidden Chromium (`bunx playwright install chromium` first). `scripts/gates.sh` runs all four.

Releases are tags, `v<version>`, matching `package.json`'s version, made on main after the change merges, so a release is always a commit main holds.
