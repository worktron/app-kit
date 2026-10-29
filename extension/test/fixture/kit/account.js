// Copied from app-kit 0.27.0 by `app-kit extension copy`. Change it in the kit.
// The browser account this profile is signed into.
//
// chrome.identity.getProfileUserInfo needs the "identity" permission, which
// has no install warning. The email in its answer also needs "identity.email",
// which Chrome warns about at install ("Know your email address"), so the
// manifest lists it under optional_permissions and askForEmail() asks for it
// when a feature first needs the email. Without it the email comes back empty
// and the account's id still comes back.

/** @typedef {{ accountId: string, email: string }} Account */

/**
 * The signed-in account's id and email, each empty when the profile is
 * signed out or the email was not granted.
 * @returns {Promise<Account>}
 */
export async function account() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: chrome.identity.AccountStatus.ANY });
    return { accountId: info?.id ?? "", email: info?.email ?? "" };
  } catch {
    return { accountId: "", email: "" };
  }
}

/** Whether the email permission is granted. */
export function hasEmailPermission() {
  return chrome.permissions.contains({ permissions: ["identity.email"] });
}

/**
 * Asks for the email permission. Chrome allows the question only from a
 * person's click in an extension page, such as the popup or the settings page.
 */
export function askForEmail() {
  return chrome.permissions.request({ permissions: ["identity.email"] });
}
