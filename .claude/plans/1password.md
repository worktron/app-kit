# 1password

Approved by the owner on 2026-11-08 ("build and land").

## What every app on the kit can and cannot get from 1Password, and sign-in fields marked so password managers fill them right

### Why

When someone saves their Getter sign-in, 1Password names it "Worktron". Every other app under worktron.com gets the same name, so a vault ends up with several items called "Worktron" and nothing to tell them apart. Nothing on the page can change that. In 1Password's Chrome extension (8.12.44, read on 2026-11-07), the suggested title comes from the address alone. 1Password looks the main domain up in its own list of about 46,600 site names, which is keyed only by main domains such as `google.com` and never by subdomains. When the domain isn't in the list, it uses the domain's name. The page's `<title>` is collected with the form but not used for the name. Adding worktron.com to the Public Suffix List wouldn't help either, because the list ignores that file's private section.

The save you saw comes from the Google sign-in: 1Password offers to save a login for the site after Continue with Google. An emailed-code sign-in never brings up a save prompt, because 1Password's save needs a password field. It has a switched-off feature for emailed-code sign-ins that may change that later.

Icons are different. 1Password's icon server keeps icons per full address (`mail.google.com` has its own, `drive.google.com` falls back to `google.com`'s). Today it has none for worktron.com or getter.worktron.com, so each app can ask for its own.

Separately, the apps mark their sign-in fields inconsistently. Getter, reminder-x and Timescale mark the email field `email` instead of `username`, and argon-watcher, assay and lifeform mark neither field. So 1Password, Safari and the phone guess which field is the account when they fill a later visit, and which one takes the emailed code.

### The change

The README gains a section on password managers. It says:
- what 1Password will call an app's saved sign-in, and why;
- what the one route to the app's own name costs;
- how to ask 1Password for the app's icon, with a ready request naming the app's exact address and the 512 pixel icon `app-kit icons render` already writes;
- which markers the sign-in fields carry, and what they do and don't do.

The kit's sign-in test step then fails any app whose email field isn't marked `username` or whose code field isn't marked `one-time-code`. The release note tells every app, including those whose tests use their own sign-in step, to set both.

### Decisions

- **Each app's own name in 1Password's prompt needs its own domain, and I recommend not moving apps now.** Getter at its own domain (say getter.app) would be suggested as "Getter", and nothing short of that will be.
  - What a move takes, per app: a domain; changing its Clerk production instance's domain, which brings a new publishable key, new DNS records and Google's redirect addresses updated; and the Google consent screen's home page changing, which Google verifies again.
  - What people lose: saved 1Password items hold only the email or the Google link, so they stop being suggested on the new address until saved again. An entry in Apple's shared-credentials list, which 1Password reads, keeps them filling, but that is a submission outside the repo.
  - The honest case for moving: it is the only way to get what you asked for, and it is cheapest before more people have saved items.

  The README records the route and its cost either way, and moving any app is that app's own work.
- **The email field is marked `username`, not `email`.** `username` tells a password manager the field is the account. `email` means a contact address. Apple, Chromium and web.dev all give `type="email"` with `autocomplete="username"` for this case. The field keeps `type="email"` for the phone's keyboard.
- **The kit's test step checks the markers.** `signInByCode`, which the browser tests of reminder-x, argon-watcher, assay and lifeform call, checks both fields before it types and fails naming the marker and the README section. Getter and Timescale sign in through their own steps, so for them the release note's Apps line is what carries the change. Their upgrade adds the markers and a check of their own. The cost: this is a release apps must act on, for better filling rather than a save prompt. The alternative is the README and the Apps line alone, with no check, so a release apps need not act on, and markers that drift again unnoticed.
- **No Save in 1Password button.** It is the only documented way to set a title, but it saves the field values the site holds, and the kit's apps hold no password. A button that saves an email alone under the app's name would be a control on the screen for little.
- **The icon request is text in the README that you send, not a command.** Sending it is yours, and a command that prints one paragraph would be more to own than it saves.

### Risk

- Every app whose tests call the kit's step fails at the upgrade until its two fields carry the markers. The failure names both markers and the section, the fix is two attributes, and the Apps line says so.
- Persona walk-throughs (`app-kit web drive`) sign in through the same step, so a walk-through of an app not yet upgraded stops at sign-in with the same message.
- What 1Password's code does today comes from one version of its extension and can change. The README says which version and when it was read.
- 1Password promises no timing for an icon request, and recent ones became an internal work item with no date.

### Left alone

- No app is moved to its own domain, and no app's code changes here. Each app adds the markers in its own upgrade.
- Passkeys: the kit's apps offer none.
- Sending the icon requests to 1Password, and any submission to Apple's shared-credentials list.
- Practices' web-apps rule and the setup skill's domain step, which are outside this repo. After this lands I'll propose one line in each pointing at the README section, for you to say yes to.

### Done when

The README's web section has a "Password managers" part saying all of the above, with the icon request ready to fill in. The kit's own browser test signs in on the fixture app with both markers set, and a page whose fields lack them fails with a message naming each. Proven by the web fixture's browser tests in `scripts/gates.sh`.

### After yes

I build it on this branch, run the gates and the branch review, and come back with the results and the landing ask. I stop and ask if a gate fails for a reason outside this change.

### Details

- `authentication/stand-in/playwright.js` `signInByCode`: before filling, read `autocomplete` of `emailField`; after the Enter, read it for `codeField`. Each attribute is read as tokens, so `username webauthn` passes. On a mismatch it throws `signInByCode: the Email field's autocomplete is "<found>"; mark it autocomplete="username" (README, Password managers)`, and the same for Code with `one-time-code`. This holds for `emailField` and `codeField` passed as options too. Its `.d.ts` comment says so.
- `web/e2e/fixture/app.tsx`: the email input gets `type="email" autoComplete="username"`, the code input `autoComplete="one-time-code" inputMode="numeric"`.
- `web/e2e/kit.e2e.ts`: two new tests, on a page set with `page.setContent`. One page has an Email field with no marker, and `signInByCode` must reject with the message. The other has the code field unmarked. The existing sign-in tests prove the check passes on the fixture.
- `README.md`: a `### Password managers` section under `## web/`, after "An app built on it". It holds:
  - the naming rule, with the evidence and the extension version read;
  - that the save comes from the Google sign-in or a manual save, never the emailed code;
  - that the Public Suffix List doesn't help;
  - the own-domain route and its costs, including Apple's shared-credentials entry;
  - the icon request: to support+forum@1password.com or a post in 1Password's community, with the app's name, its exact address such as `getter.worktron.com`, and the attached `icon-512.png` from `app-kit icons render`'s web folder, asking that the icon be shown for that address, with no timing promised;
  - the two markers, with MUI's `slotProps={{ htmlInput: { autoComplete: 'one-time-code', inputMode: 'numeric' } }}`, citing Apple, Chromium and web.dev;
  - that the Save in 1Password button doesn't fit an app with no password.

  The `signInByCode` bullet in "Browser tests" gains one sentence on the check.
- The branch's commit carries `Release: minor`, `Urgency: next round`, and `Apps: on the sign-in screen, mark the email field autocomplete="username" (keeping type="email") and the code field autocomplete="one-time-code"; signInByCode fails until both are set, and an app whose tests sign in through their own step checks the two markers there.`
- Apps today, read 2026-11-07:
  - Getter: `email` and `one-time-code`, and its tests use their own step (getter/e2e/steps.ts:31).
  - reminder-x: `email` and `one-time-code`.
  - Timescale: `email` and `one-time-code`, with its own step (timescale/e2e/sign-in.e2e.ts:37).
  - argon-watcher, assay and lifeform: neither marker, and their tests use the kit's step.
- Evidence for the naming rule comes from the extension, downloaded from the Chrome Web Store (version 8.12.44.33) into the scratchpad:
  - `inline/injected.js` collects `title: document.title` with the form;
  - the core WebAssembly holds `utils/op-url-item-title/src/lib.rs` and a list of 46,578 `"<domain>":{"ranking":…,"title":…}` entries, none keyed by a subdomain under .com, .org, .net, .io or .app;
  - `background/background.js` gives the login save `triggers:[CurrentPassword,NewPassword], pendingTriggers:[Username]`, with `b5x-universal-sign-on-sign-in-with-email` off;
  - icons: `https://c.1password.com/richicons/images/login/120/<host>.png` answers 404 for worktron.com and getter.worktron.com, and mail.google.com's icon differs from google.com's.
- Clerk's domain change: https://clerk.com/docs/guides/development/deployment/changing-domains (read 2026-11-07).

