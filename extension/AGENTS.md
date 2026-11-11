# extension/

extension/ browser extensions: worker/ (plain JavaScript Chrome loads, copied into each extension, with amazon-never-sent.js, the Amazon requests no extension sends), look.css (the plain look's rules for an extension's pages, copied beside the worker files with its variables written from look/ and the extension's look.json beside its manifest), host/ (the Mac side), harness/ (hidden Chromium), testing/ (a chrome stand-in, and a native host run as Chrome runs it), copy.ts, layout.ts (the check that an extension's manifest is at its checkout's root, which install-host makes too), listing.ts (`app-kit extension listing`, the Chrome Web Store listing, store-listing.md, held to the manifest), dashboard/ (`app-kit extension dashboard`, which types store-listing.md into the Store's developer dashboard in a Google Chrome profile of its own and reads it back, never pressing Submit for review, and skill/, the chrome-web-store skill that offers it), and its own test/ and e2e/

## Rules for agents working here

- `extension/worker/` loads in Chrome with no build step: plain JavaScript modules, relative imports among themselves only, no packages. After any change to it, run `bun bin/app-kit.ts extension copy extension/test/fixture/kit`; a test fails until the fixture's copy matches.
