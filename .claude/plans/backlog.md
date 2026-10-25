# Backlog

Unclaimed tickets for app-kit, one `## ` section each, in the record's shape:
work someone wrote down and nobody has started, a fork the user named or an idea
a thread noticed on its way. A ticket here is not approved: building one waits
for the user's yes to that ticket, and its worker plans first.
`/spawn <id>` starts one; its landing commit deletes the section.

## extension-install-host · An `app-kit extension install-host` command registers an app's native host with Chrome

Goal: an extension app with a native host registers it with Chrome by hand today. amazon-connector's `scripts/install.sh` writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json` with a bash heredoc and a hardcoded extension ID, though the kit already has `writeHostManifest` and `chromeHostsDir` in `extension/host/install.ts` and `app-kit extension id` derives the ID from the manifest's `key`. Add `app-kit extension install-host <name> <host executable> [<folder>]` to `bin/app-kit.ts`: it reads the ID from `<folder>/manifest.json`'s key (the folder defaults to `.`), writes the manifest into `chromeHostsDir()` through `writeHostManifest`, and prints the file it wrote. The description is a required flag or a field the app passes, not a fixed string. Done when: a test in `extension/test/` runs the command against a fixture extension folder with a temporary home and asserts the JSON written, `allowed_origins` included; the README's extension section and the command's usage name it; and the release's commit message says apps can replace a hand-written host manifest with it.
