import { DESKTOP_SIGN_IN_PATH } from '../../tauri/sign-in/names';

/*
 * WebKit caps at 7 days any cookie that a DNS alias for another company's servers sets in reply to a script's request,
 * and Clerk's address for each app (clerk.<the app's domain>) is such an alias, so the cookie that names the signed-in
 * browser, which Clerk sets that way at sign-in, would end every sign-in in Safari and the Mac and iPhone windows after
 * a week. A page load through Clerk's renewal address sets the same cookie in reply to a page load, which WebKit does
 * not cap. Clerk takes that load itself only when the app moves on through Clerk after a sign-in, which the kit's
 * sign-in, all in the page, never does, so the kit takes it: as a page opens signed in, or right after a sign-in the
 * window took by ticket, always while the app's name is on screen and nothing of the app is drawn.
 */

/** Where the kit notes, in local storage, which session it last renewed Clerk's cookie for, and when. */
export const RENEWAL_KEY = 'app-kit.clerk-cookie-renewal';

/**
 * Where the page notes, in this tab's session storage, that it left for a renewal, when, and its address's query and
 * fragment, so the page Clerk sends back counts it and gets its address back byte for byte. Clerk is sent the address
 * without a fragment, since its development instance puts a `#` in the address it returns to into the path
 * (`/notes%23/items/3`), which opens an address the app does not know.
 */
export const LEAVING_KEY = 'app-kit.clerk-cookie-renewal.leaving';

/**
 * The query mark on the address Clerk is sent back to, whose value is the time the note holds. Only Clerk's redirect
 * reaches an address with it, so a person back by Back, a reload or the address bar after a trip that failed counts
 * nothing, and the hour's hold applies. It comes off as the kit loads, before an app's screen code reads the address.
 */
export const RETURN_MARK = 'app-kit-cookie-renewed';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How old a renewal may be before the next open renews again, in case a later reply from Clerk capped the cookie again. */
export const RENEW_AGAIN_AFTER_MS = 6 * DAY_MS;

/** How long a renewal that never came back holds off the next one, so one that fails never loops at every open. */
export const RETRY_AFTER_MS = HOUR_MS;

/** How long after the last renewal Clerk's own word that the cookie is close to running out is taken. */
export const CLERK_WORD_AFTER_MS = DAY_MS;

/** What the kit has noted about the last renewal on this browser. */
export interface RenewalRecord {
  sessionId: string;
  /** When the page last came back from a renewal for this session, or 0. */
  renewedAt: number;
  /** When the page last left for one. */
  attemptedAt: number;
}

/** Why a renewal is due, as the console line says it. */
export type RenewalReason = 'the first for this session' | 'the last was over six days ago' | 'Clerk says its cookie is close to running out';

/**
 * Whether this browser is WebKit: Safari, the Mac and iPhone app windows, and every browser on an iPhone. Chrome,
 * Edge and Firefox on a computer are not, and never see the cap.
 */
export function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(Chrome|Chromium|Edg)\//.test(userAgent);
}

/**
 * Whether a renewal is due on this page, and why. Never off WebKit, never signed out, and never on the browser page
 * that hands a sign-in to the app, whose cookie is the browser's and not the window's.
 */
export function renewalDue({
  webkit,
  path,
  sessionId,
  record,
  eligible,
  now,
}: {
  webkit: boolean;
  path: string;
  sessionId: string | null;
  record: RenewalRecord | null;
  /** Clerk's own word that its cookie runs out within 8 days. */
  eligible: boolean;
  now: number;
}): RenewalReason | null {
  if (!webkit || !sessionId || path === DESKTOP_SIGN_IN_PATH || path.startsWith(`${DESKTOP_SIGN_IN_PATH}/`)) return null;
  if (record?.sessionId === sessionId && record.renewedAt < record.attemptedAt && now - record.attemptedAt < RETRY_AFTER_MS) return null;
  if (!record || record.sessionId !== sessionId || !record.renewedAt) return 'the first for this session';
  if (now - record.renewedAt > RENEW_AGAIN_AFTER_MS) return 'the last was over six days ago';
  if (eligible && now - record.renewedAt > CLERK_WORD_AFTER_MS) return 'Clerk says its cookie is close to running out';
  return null;
}

/** The record as stored, or null when there is none or it is not one. */
export function readRecord(storage: Pick<Storage, 'getItem'>): RenewalRecord | null {
  try {
    const value = JSON.parse(storage.getItem(RENEWAL_KEY) ?? 'null') as Partial<RenewalRecord> | null;
    if (!value || typeof value.sessionId !== 'string' || typeof value.renewedAt !== 'number' || typeof value.attemptedAt !== 'number') return null;
    return { sessionId: value.sessionId, renewedAt: value.renewedAt, attemptedAt: value.attemptedAt };
  } catch {
    return null;
  }
}

function writeRecord(storage: Pick<Storage, 'setItem'>, record: RenewalRecord) {
  try {
    storage.setItem(RENEWAL_KEY, JSON.stringify(record));
  } catch {
    // Storage refused: the renewal does not run, since nothing would say it was done.
  }
}

/** What this tab noted as it left for a renewal. */
interface LeavingNote {
  at: number;
  search: string;
  hash: string;
}

/**
 * What this tab noted as it left for a renewal, taking the note off, or null when it did not leave for one. A note that
 * cannot be taken off is read again at the next load, whose address then has no mark, so it counts no return.
 */
function leftForRenewal(tabStorage: RenewalPage['tabStorage']): LeavingNote | null {
  let note: string | null;
  try {
    note = tabStorage?.getItem(LEAVING_KEY) ?? null;
  } catch {
    return null;
  }
  if (note === null) return null;
  try {
    tabStorage?.removeItem(LEAVING_KEY);
  } catch {
    // Left in place, as above.
  }
  try {
    const { at, search, hash } = JSON.parse(note) as Partial<LeavingNote>;
    return { at: typeof at === 'number' ? at : 0, search: typeof search === 'string' ? search : '', hash: typeof hash === 'string' ? hash : '' };
  } catch {
    return { at: 0, search: '', hash: '' };
  }
}

/** Notes in this tab that it is leaving for a renewal from an address with this query and fragment; false when refused. */
function noteLeaving(tabStorage: RenewalPage['tabStorage'], left: LeavingNote): boolean {
  const note = JSON.stringify(left);
  try {
    if (!tabStorage) return false;
    tabStorage.setItem(LEAVING_KEY, note);
    return tabStorage.getItem(LEAVING_KEY) === note;
  } catch {
    return false;
  }
}

/** The part of Clerk the renewal reads, so tests can pass a fake. */
export interface RenewingClerk {
  readonly session?: { readonly id: string } | null;
  readonly client?: {
    isEligibleForTouch(): boolean;
    buildTouchUrl(params: { redirectUrl: URL }): string;
  } | null;
  buildUrlWithAuth(to: string): string;
}

/** What the renewal needs of the page, so tests can pass their own. */
export interface RenewalPage {
  userAgent: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** This tab's session storage, which lasts through the trip to Clerk and back; null when the browser refuses it. */
  tabStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  href(): string;
  /** Replaces the address without a load, as `history.replaceState` does. */
  replace(address: string): void;
  /** Loads the address, as `location.assign` does. */
  assign(address: string): void;
  log(line: string): void;
  now(): number;
}

/**
 * Where this page stands: `undecided` until Clerk has loaded, `none` once it is decided there is none now, `leaving` once
 * the page has left for one, and `after-sign-in` from a ticket sign-in in the window until it has finished handing over.
 */
export type RenewalState = 'undecided' | 'none' | 'after-sign-in' | 'leaving';

const LOG_PREFIX = '[app-kit sign-in]';

/** One page's renewal: what it decides, once, as Clerk loads, and after a ticket sign-in. */
export function pageRenewal(page: RenewalPage) {
  let state: RenewalState = 'undecided';
  const listeners = new Set<() => void>();
  const set = (next: RenewalState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const webkit = isWebKit(page.userAgent);

  // Back from a renewal: Clerk's return carries the mark the note's time, which counts it, and the address comes back
  // as it left, query and fragment byte for byte. A note with no mark is a person back by hand after a trip that did not
  // finish, which counts nothing, so the hour's hold applies; a mark with no note, as in a link copied from Clerk's
  // return, comes off and counts nothing.
  const left = leftForRenewal(page.tabStorage);
  const back = new URL(page.href());
  const mark = back.searchParams.get(RETURN_MARK);
  if (mark !== null) {
    back.searchParams.delete(RETURN_MARK);
    const counted = left !== null && mark === String(left.at);
    page.replace(back.pathname + (counted ? left.search : back.search) + (back.hash || (counted ? left.hash : '')));
    if (counted) {
      const record = readRecord(page.storage);
      if (record) writeRecord(page.storage, { ...record, renewedAt: page.now() });
      page.log(`${LOG_PREFIX} back from renewing Clerk's cookie`);
      // A page back from a renewal never leaves for another, even when local storage refused the record of it.
      state = 'none';
    }
  }
  if (left && !(mark !== null && mark === String(left.at))) {
    page.log(`${LOG_PREFIX} a renewal of Clerk's cookie did not come back: this load is not Clerk's return`);
  }

  const due = (clerk: RenewingClerk) =>
    renewalDue({
      webkit,
      path: new URL(page.href()).pathname,
      sessionId: clerk.session?.id ?? null,
      record: readRecord(page.storage),
      eligible: clerk.client?.isEligibleForTouch() ?? false,
      now: page.now(),
    });

  const leave = (clerk: RenewingClerk, reason: string): boolean => {
    const sessionId = clerk.session?.id;
    if (!clerk.client || !sessionId) return false;
    const now = page.now();
    const record = readRecord(page.storage);
    writeRecord(page.storage, { sessionId, renewedAt: record?.sessionId === sessionId ? record.renewedAt : 0, attemptedAt: now });
    // Without the record the next open would renew again, and without the note in this tab the page Clerk sends back
    // could not tell it had renewed and would leave again: with either refused, no renewal.
    const here = new URL(page.href());
    if (readRecord(page.storage)?.attemptedAt !== now || !noteLeaving(page.tabStorage, { at: now, search: here.search, hash: here.hash })) {
      page.log(`${LOG_PREFIX} not renewing Clerk's cookie: this browser refuses the storage that would say it was done`);
      return false;
    }
    here.hash = '';
    here.search = `${here.search ? `${here.search}&` : '?'}${RETURN_MARK}=${now}`;
    const touch = clerk.buildUrlWithAuth(clerk.client.buildTouchUrl({ redirectUrl: here }));
    page.log(`${LOG_PREFIX} renewing Clerk's cookie with a page load, since WebKit ends it a week after a sign-in otherwise: ${reason}`);
    set('leaving');
    page.assign(touch);
    return true;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    state: () => state,
    /**
     * Whether the page is leaving, or about to, for a renewal: read on every render, so the gate holds its placeholder
     * from the first render that has the session, before the decision is made.
     */
    renewing(clerk: RenewingClerk, loaded: boolean): boolean {
      if (state === 'leaving' || state === 'after-sign-in') return true;
      return state === 'undecided' && loaded && due(clerk) !== null;
    },
    /** As Clerk has loaded: renews now when one is due, and otherwise decides there is none on this page. */
    decideAtOpen(clerk: RenewingClerk) {
      if (state !== 'undecided') return;
      const reason = due(clerk);
      if (reason === null || !leave(clerk, reason)) set('none');
    },
    /** As a ticket sign-in in the window starts, in WebKit: the gate holds its placeholder from the session's arrival. */
    signingInByTicket() {
      if (webkit && state !== 'leaving') set('after-sign-in');
    },
    /** A ticket sign-in that failed: nothing to renew. */
    ticketFailed() {
      if (state === 'after-sign-in') set('none');
    },
    /** Once a ticket sign-in has finished handing over: renews when it asked to, and says whether the page is leaving. */
    afterSignIn(clerk: RenewingClerk): boolean {
      if (state !== 'after-sign-in') return state === 'leaving';
      const reason = due(clerk);
      if (reason !== null && leave(clerk, reason)) return true;
      set('none');
      return false;
    },
  };
}

export type PageRenewal = ReturnType<typeof pageRenewal>;
