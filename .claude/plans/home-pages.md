# home-pages

Approved by the user on 2026-11-06 (build and land).

## New apps put their home page at the signed-out root, never on a separate about page

### Why

Agents keep building a separate about page for each app, as getter did at /about, while the app's root shows a stranger only a sign-in form. A visitor, or Google's reviewer, has to find a second address to learn what the app is. The cause is the rules: the Google skill says moving a consent screen to production "needs a home page", and nothing says where that page goes, so an agent adds one. Six app threads that [portfolio](metamax://thread/worktron/portfolio) started this afternoon are already fixing the apps themselves, each putting a home page at its own root. Nothing yet stops the next new app from repeating the mistake.

### The change

Practices' web apps rule says every web app's root, signed out, is its home page: what the app does, sign-in (and a new account where the app takes them), and links to privacy and terms; never a separate about page. The Google skill names the root as the home page a consent screen points to, and lists what Google's check reads. App-kit's README shows how an app draws its home page with the sign-in gate it already has. The gate itself does not change.

### Decisions

- **No new setting in the sign-in gate.** An app already draws its home page through the gate's signed-out screen with a one-line check of the address, which is how getter's new home page does it. The six apps built it that way, and three of them chose slightly different rules (reminder-x shows it at every signed-out address, getter also shows it in a web app added to the home screen), each approved by you. Alternative: a gate setting that owns the rule once, so every app behaves the same. That would move six working apps onto it and override choices you approved, for a difference you would only see by comparing two apps signed out.
- **The rule names the root only, and leaves other addresses and installed apps to each app.** Same reason: the apps already differ there, and none of those differences is wrong.
- **The rule lists what Google's check reads, not "a few lines".** Google says the home page must name the app exactly as the consent screen does, fully describe what it does, say which Google data it reads and why, and link the same privacy policy, and that it "can not be only a login page". A form on a page that does all that is allowed. The rule also asks for the app's name and one-line purpose in the served page's title and meta description, so a checker that does not run the page still reads them.
- **Signing out at the root shows the home page, with the sign-in form on it.** The rule's line "sign-out goes straight to the sign-in screen" gains "or, at the root, the home page that holds it", so the two rules agree. Getter's new home page already does this on purpose.
- **An app whose consent screen names /about keeps /about as it is until the consent screen names the root and Google's brand verification passes again.** Google says any change to the home page link needs verification again, and that the home page address must not redirect. So /about is never turned into a redirect while the consent screen names it. Changing the address in Google's form is your step.

### Risk

- Google's check may fail a page drawn in the browser, since its raw page is empty; people report this in 2026 forum posts, and Google does not say whether its checker runs scripts. The title and meta description lower that risk without new code. If an app fails the check anyway, the fix is a home page served as plain HTML, which would be a kit piece, built then.
- The practices change lands in practices, not here, so until it lands a new app still follows the old wording.

### Left alone

The six apps' home pages, which their own threads are building and landing. The sign-in gate's code and tests. Getter's /about and its consent screen. The [app-clients](metamax://thread/app-kit/app-clients) thread, which I told that there is no gate rollout to carry.

### Done when

An agent starting a new web app reads, in practices' web apps rule and the Google skill, that the root is the home page and what it must hold, and in app-kit's README how to draw it. Proven by the landed text in both repositories, quoted in the report.

### After yes

I add the README section here and start a thread in practices, with your yes to this plan as its go-ahead, for the rule and the Google skill wording. Each landing still waits for your own go.

