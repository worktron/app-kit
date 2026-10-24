// Copied from app-kit 0.4.0 by `app-kit extension copy`. Change it in the kit.
// Which build is this profile running, and since when?
//
// Chrome shows a build's identity only inside chrome://extensions, which
// nothing outside the browser can read. The worker knows it for free:
// getManifest() returns the version_name the build stamped with its commit.
//
// A repository root load has no stamp: its version_name is the committed
// "<version>-src" at every commit. self-reload.js reads the commit the worker
// loaded from, and buildName() adds it the way a build's stamp would,
// "1.1.0-src (abc1234)", which is what a popup or a status command shows.
//
// recordBuild() keeps that name in storage.local, where it can be read per
// profile without the browser. firstSeenAt dates the build's arrival in this
// profile, so it is written only when the build changes: an alarm revives the
// worker every minute, and a time refreshed on each start would always read
// "about a minute ago". Writing only on change also keeps it off the hot path;
// always-be-closing measured ~1,400 writes per profile per day before it did.

const KEY = "buildIdentity";

/** @typedef {{ version: string, versionName: string, firstSeenAt: number, commit?: string }} BuildIdentity */

/**
 * The build this worker runs: the manifest's version_name, with the commit it
 * loaded from when there is one.
 * @param {string | null} [commit]
 */
export function buildName(commit = null) {
  const manifest = chrome.runtime.getManifest();
  // Falls back to version for a build that skipped the stamp.
  const stamped = manifest.version_name ?? manifest.version;
  return commit ? `${stamped} (${commit.slice(0, 7)})` : stamped;
}

/**
 * Records the running build in storage.local, with when this profile first ran it.
 * @param {string | null} [commit]
 * @returns {Promise<BuildIdentity>}
 */
export async function recordBuild(commit = null) {
  const version = chrome.runtime.getManifest().version;
  const versionName = buildName(commit);
  const existing = await getRecordedBuild();
  if (existing?.version === version && existing.versionName === versionName) return existing;
  /** @type {BuildIdentity} */
  const identity = { version, versionName, firstSeenAt: Date.now() };
  if (commit) identity.commit = commit;
  await chrome.storage.local.set({ [KEY]: identity });
  return identity;
}

/** @returns {Promise<BuildIdentity | null>} */
export async function getRecordedBuild() {
  const { [KEY]: identity } = /** @type {{ [KEY]?: BuildIdentity }} */ (await chrome.storage.local.get(KEY));
  return identity ?? null;
}
