# web-client-kit

The web app baseline as one package, which apps install from GitHub at a tag. README.md says what each piece is and how an app takes it in; practices' `rules/web-apps.md` says why each exists.

## Layout

```
src/         the kit: fetch wrapper, connection, new build, preload reload, error boundary, row links, sign-in gate
clerk/       the Clerk adapter, the only code that imports Clerk
testing/     the stand-in sign-in provider, for the kit's tests and apps'
test/        unit tests in a simulated page (happy-dom)
e2e/         e2e/fixture, a small app built on the kit, run built in a hidden Chromium
```

## Rules for agents working here

- Nothing outside `clerk/` imports a sign-in provider. What the gate needs from one goes through `src/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`.
- A change an app would notice raises `package.json`'s version, and a release is the tag `v<version>` on main, made after the change merges.
- Nothing here names a machine, a person or a path into a home folder.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, hidden Chromium).
