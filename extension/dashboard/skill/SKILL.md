---
name: chrome-web-store
description: Fill an extension's Chrome Web Store item from its store-listing.md with app-kit's dashboard command, prove every box by reading it back, and stop at Submit for review for the owner. Use when an extension with a store-listing.md is headed for the Chrome Web Store, its first release or a release after a visibility change; when the owner asks to fill, update or check the Store listing, privacy answers, screenshots or test instructions in the dashboard; or when the Store dashboard and store-listing.md may disagree.
---

# Chrome Web Store

Google's API uploads a zip and publishes; every other answer (listing text, privacy answers, images, visibility, test instructions) lives only in the developer dashboard. `app-kit extension dashboard` types those answers from the extension's committed `store-listing.md` into the dashboard and reads each one back. The owner's press of **Submit for review** is the line: the command never crosses it, and neither do you.

Run every command from the app's checkout, where app-kit is installed: `bun run app-kit extension dashboard …`. `--help` on `bun run app-kit` lists the flags.

## Steps

1. **Check the file.** `bun run app-kit extension listing` until it prints no `failed` line. A data use the dashboard has no box for, a missing reason, or a summary that is not the manifest's description fails here, before anything opens. The answers are the owner's statements to Google: fix wording the owner wrote only with their yes.
2. **Sign in, once per Mac.** Run `bun run app-kit extension dashboard read`. If it says the profile is not signed in, ask the owner to run `bun run app-kit extension dashboard sign-in` from the app's checkout in their own terminal (in metamax, the pane bar's shell), sign in to Google in the Chrome window it opens with the account that owns the item, and press Cmd+Q in that window. They type their own password; you type none and work around no Google check. You never run sign-in yourself, and the owner does not type it after `!` in this conversation's prompt, which runs it as you: run by a thread, it refuses and prints the line for the owner.
3. **Read.** `bun run app-kit extension dashboard read [--zip <zip>]` prints one `failed` line per box that differs from the file, and changes nothing. Show the owner what the fill would change.
4. **Ask before the first save.** The fill saves into the owner's draft. Ask once, naming what it will change. Visibility is its own question: pass `--visibility` only when the owner says yes to that change in this conversation, and only on an item never published (the command refuses it on a published one). An item's first release is Unlisted (practices' extensions rule; the README's "Going to market" has the steps): on an item never published, the fill stops before saving anything unless the listing's Visibility line says Unlisted.
5. **Fill.** `bun run app-kit extension dashboard fill [--zip <zip>] [--screenshots <folder>] [--visibility]`. It is done when it exits 0: every page saved, reloaded and every box read back as the file says. A `failed` line names the page and the box; the run's screenshots and accessibility trees are in the folder it prints, which is where a label Google renamed shows up.
6. **Hand over.** Tell the owner the item is filled and proven, what still is theirs (a test account's username and password, which the command leaves alone), and that pressing Submit for review in the dashboard is theirs. Testers are invited in the app itself and sent the Store link once the item is published. Later releases publish through the extension's own publish script and the API.

## What the command decides for you

- The item is the one the manifest's `key` gives; `--item <id>` names another.
- Images go only where the dashboard lacks them: the manifest's 128 icon into an empty icon slot, screenshots in file-name order after those already shown. To replace an image, the owner removes it in the dashboard first.
- The zip goes up only when it holds this extension at a version above the dashboard's; an equal version counts as already uploaded.
- Data-use boxes are ticked or cleared exactly as the file names them, and the three certifications only when the file says "all three".
