// Copied from app-kit 0.4.0 by `app-kit extension copy`. Change it in the kit.
// An unpacked install reloads itself when the checkout it was loaded from moves.
//
// Chrome reads an unpacked extension's worker once, at load, and keeps running
// that copy whatever happens to the files afterwards. A landing on main reaches
// the checkout within seconds and then sits there until someone opens
// chrome://extensions and clicks reload. The worker can close that gap itself:
// an extension may fetch any file under its own root, and for a repository root
// that includes .git, so the commit on disk is one fetch away.
//
// The commit seen at load lives in storage.session, which Chrome clears on
// every extension reload. A missing key means "first look since the load", and
// the commit is recorded. A present key that differs from the disk means the
// checkout moved under a running worker, and the worker reloads.
//
// A built folder (dist/) has no .git to read. There the on-disk manifest's
// version_name, which the build stamps with its commit, is compared with the
// one Chrome parsed at load.
//
// A file the worker loads that is gone from disk reloads it too, so Chrome
// shows the load's error instead of running code the checkout no longer has.
//
// Only unpacked installs do any of this. A Chrome Web Store install carries an
// update_url in its manifest, never reads the disk and never reloads.

const KEY = "loadedCheckout";
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REF = /^ref: (refs\/[\w./-]+)$/;

/** @typedef {{ commit: string | null, reloading: boolean }} CheckoutCheck */

// The start-up check and the alarm's check overlap on every revival. They
// share one run, so a moved checkout is answered with one reload.
/** @type {Promise<CheckoutCheck> | null} */
let inFlight = null;

/**
 * Resolves to the commit this worker was loaded from (null when there is no
 * .git to say) and whether a reload is on its way.
 * @param {string[]} [loadedFiles] every file the worker loads, from the extension's root
 * @returns {Promise<CheckoutCheck>}
 */
export function checkForNewCheckout(loadedFiles = []) {
  inFlight ??= check(loadedFiles)
    // A failed check must never cost the worker its start-up.
    .catch(() => ({ commit: null, reloading: false }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * @param {string[]} loadedFiles
 * @returns {Promise<CheckoutCheck>}
 */
async function check(loadedFiles) {
  const manifest = chrome.runtime.getManifest();
  if (manifest.update_url) return { commit: null, reloading: false };

  const { [KEY]: loaded } = /** @type {{ [KEY]?: string }} */ (await chrome.storage.session.get(KEY));
  const loadedCommit = loaded?.startsWith("git:") ? loaded.slice(4) : null;

  const present = await Promise.all(loadedFiles.map(async (path) => (await readText(path)) !== null));
  if (present.includes(false)) {
    chrome.runtime.reload();
    return { commit: loadedCommit, reloading: true };
  }

  const commit = await readCheckoutCommit();
  const onDisk = commit ? `git:${commit}` : await readDiskVersionName();
  if (!onDisk) return { commit: loadedCommit, reloading: false };

  if (!loaded) {
    if (commit) {
      await chrome.storage.session.set({ [KEY]: onDisk });
      return { commit, reloading: false };
    }
    // Chrome already holds what a built folder started as, so nothing is stored.
    const running = `version:${manifest.version_name ?? manifest.version}`;
    if (onDisk === running) return { commit: null, reloading: false };
  } else if (loaded === onDisk || kind(loaded) !== kind(onDisk)) {
    // A .git that comes and goes is not a new build. Only like is compared with like.
    return { commit: loadedCommit, reloading: false };
  }

  // Chrome clears this on reload. Writing it first means that even if it did
  // not, the next start would see a match instead of reloading forever.
  await chrome.storage.session.set({ [KEY]: onDisk });
  chrome.runtime.reload();
  return { commit: loadedCommit, reloading: true };
}

/** @param {string} identity */
function kind(identity) {
  return identity.slice(0, identity.indexOf(":"));
}

// HEAD names a ref, or holds the commit itself when detached. The ref is a
// loose file until git packs it, and then a line in packed-refs.
async function readCheckoutCommit() {
  const head = (await readText(".git/HEAD"))?.trim();
  if (!head) return null;
  if (SHA.test(head)) return head;

  const ref = head.match(REF)?.[1];
  if (!ref || ref.includes("..")) return null;

  const loose = (await readText(`.git/${ref}`))?.trim();
  if (loose && SHA.test(loose)) return loose;

  for (const line of (await readText(".git/packed-refs"))?.split("\n") ?? []) {
    const [sha, name] = line.trim().split(" ");
    if (name === ref && sha && SHA.test(sha)) return sha;
  }
  return null;
}

async function readDiskVersionName() {
  const text = await readText("manifest.json");
  if (!text) return null;
  try {
    const onDisk = JSON.parse(text);
    const name = onDisk.version_name ?? onDisk.version;
    return name ? `version:${name}` : null;
  } catch {
    // Caught mid-write by a build. The next look reads it whole.
    return null;
  }
}

// A missing file rejects the fetch instead of answering 404.
/** @param {string} path */
async function readText(path) {
  try {
    const response = await fetch(chrome.runtime.getURL(path), { cache: "no-store" });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}
