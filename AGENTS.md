# app-kit

The app baseline as one public package, which apps install from GitHub at a tag, with a part for each kind of app. Today it holds the web client kit, which apps import as `app-kit/web`, and the server check for keys for agents, `app-kit/agent-keys`. README.md says what each piece is and how an app takes it in; practices' rules files say why each exists.

## Layout

```
src/         the web kit (app-kit/web): fetch wrapper, connection, new build, preload reload, error boundary, row links, sign-in gate
agent-keys/  the server check that lets a person's key read the GET routes an app lists (app-kit/agent-keys), and the API reference that shows a key those routes (openapi.ts, app-kit/agent-keys/openapi)
clerk/       the Clerk adapter (index.tsx) and the Clerk reader for the key check (server.ts), the only code that imports Clerk
testing/     the stand-in sign-in provider, for the kit's tests and apps'
test/        unit tests in a simulated page (happy-dom); test/fixtures holds Clerk's recorded answers, ids replaced
e2e/         e2e/fixture, a small app built on the kit, run built in a hidden Chromium
```

## Rules for agents working here

- Nothing outside `clerk/` imports a sign-in provider. What the gate needs from one goes through `src/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`.
- A change an app would notice raises `package.json`'s version, and a release is the tag `v<version>` on main, made after the change merges.
- The repository is public: nothing here names a machine, a person, a personal email or a path into a home folder, and `test/public.test.ts` holds that for the files and the history. Test addresses are on example.com. Commits are authored and committed as Worktron. A change lands by moving main forward to the reviewed head through GitHub's API, never with the pull request's merge button, since every way that button merges commits as the merging account.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, hidden Chromium).
