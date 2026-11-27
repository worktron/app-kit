import { describe, expect, test } from 'bun:test';
import {
  CLERK_WORD_AFTER_MS,
  isWebKit,
  markedAddress,
  pageRenewal,
  readRecord,
  RENEW_AGAIN_AFTER_MS,
  RENEWAL_KEY,
  renewalDue,
  RETRY_AFTER_MS,
  unmarkedAddress,
  type RenewalPage,
  type RenewalRecord,
  type RenewingClerk,
} from '../authentication/clerk/renew';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15';
// The Mac app's window, which does not call itself Safari.
const MAC_WINDOW = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IPHONE_WINDOW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/131.0.0.0`;
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0';

const NOW = Date.UTC(2026, 10, 27, 20, 0);
const DAY = 24 * 60 * 60 * 1000;

test('WebKit is Safari, the Mac and iPhone windows and every iPhone browser, and never Chrome, Edge or Firefox on a computer', () => {
  for (const agent of [SAFARI, MAC_WINDOW, IPHONE_WINDOW, IPHONE_CHROME]) expect(isWebKit(agent)).toBe(true);
  for (const agent of [CHROME, EDGE, FIREFOX]) expect(isWebKit(agent)).toBe(false);
});

describe('when a renewal is due', () => {
  const due = (over: Partial<Parameters<typeof renewalDue>[0]> = {}) =>
    renewalDue({ webkit: true, path: '/', sessionId: 'sess_1', record: null, eligible: false, now: NOW, ...over });
  const renewed = (at: number, over: Partial<RenewalRecord> = {}): RenewalRecord => ({ sessionId: 'sess_1', renewedAt: at, attemptedAt: at - 1000, ...over });

  test('the first time for each session', () => {
    expect(due()).toBe('the first for this session');
    expect(due({ record: renewed(NOW - DAY, { sessionId: 'sess_0' }) })).toBe('the first for this session');
  });

  test('never off WebKit, signed out, or on the browser page that hands a sign-in to the app', () => {
    expect(due({ webkit: false })).toBeNull();
    expect(due({ sessionId: null })).toBeNull();
    expect(due({ path: '/desktop-sign-in' })).toBeNull();
    expect(due({ path: '/desktop-sign-in/back' })).toBeNull();
    expect(due({ path: '/desktop-sign-in-help' })).toBe('the first for this session');
  });

  test('again once the last is over six days old', () => {
    expect(due({ record: renewed(NOW - RENEW_AGAIN_AFTER_MS + 60_000) })).toBeNull();
    expect(due({ record: renewed(NOW - RENEW_AGAIN_AFTER_MS - 60_000) })).toBe('the last was over six days ago');
  });

  test("on Clerk's word that its cookie is close to running out, at most once a day", () => {
    expect(due({ eligible: true, record: renewed(NOW - CLERK_WORD_AFTER_MS + 60_000) })).toBeNull();
    expect(due({ eligible: true, record: renewed(NOW - CLERK_WORD_AFTER_MS - 60_000) })).toBe('Clerk says its cookie is close to running out');
  });

  test('a renewal that never came back holds off the next for an hour, so a failing one never loops', () => {
    const unfinished = { sessionId: 'sess_1', renewedAt: 0, attemptedAt: NOW - RETRY_AFTER_MS + 60_000 };
    expect(due({ record: unfinished })).toBeNull();
    expect(due({ record: { ...unfinished, attemptedAt: NOW - RETRY_AFTER_MS - 60_000 } })).toBe('the first for this session');
  });
});

test("the mark rides in the fragment beside what it holds, and comes off whole", () => {
  const marked = markedAddress('https://app.example.com/items/3?sort=new#tab=notes');
  expect(marked).toBe('https://app.example.com/items/3?sort=new#tab=notes&app-kit-cookie-renewed=');
  expect(unmarkedAddress(marked)).toBe('/items/3?sort=new#tab=notes');
  expect(unmarkedAddress(markedAddress('https://app.example.com/'))).toBe('/');
  expect(unmarkedAddress('https://app.example.com/#tab=notes')).toBeNull();
});

test('a record that is not one reads as none', () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  expect(readRecord(storage(null))).toBeNull();
  expect(readRecord(storage('not json'))).toBeNull();
  expect(readRecord(storage('{"sessionId":3}'))).toBeNull();
  expect(readRecord(storage('{"sessionId":"sess_1","renewedAt":1,"attemptedAt":2}'))).toEqual({ sessionId: 'sess_1', renewedAt: 1, attemptedAt: 2 });
});

/** A page with an address, storage and a clock, which records each load and console line. */
function fakePage(href: string, { userAgent = MAC_WINDOW, now = NOW, stored = {} as Record<string, string> } = {}) {
  const loads: string[] = [];
  const lines: string[] = [];
  let address = href;
  let clock = now;
  const page: RenewalPage = {
    userAgent,
    storage: { getItem: (key) => stored[key] ?? null, setItem: (key, value) => void (stored[key] = value) },
    href: () => address,
    replace: (to) => void (address = new URL(to, address).toString()),
    assign: (to) => void loads.push(to),
    log: (line) => void lines.push(line),
    now: () => clock,
  };
  return { page, loads, lines, stored, address: () => address, tick: (ms: number) => void (clock += ms) };
}

function fakeClerk(sessionId: string | null, eligible = false): RenewingClerk {
  return {
    session: sessionId ? { id: sessionId } : null,
    client: {
      isEligibleForTouch: () => eligible,
      buildTouchUrl: ({ redirectUrl }) => `https://clerk.app.example.com/v1/client/touch?redirect_url=${encodeURIComponent(redirectUrl.toString())}`,
    },
    buildUrlWithAuth: (to) => to,
  };
}

describe("one page's renewal", () => {
  test('a page that opens signed in holds from its first render, leaves once through the renewal, and comes back renewed', () => {
    const first = fakePage('https://app.example.com/items/3?sort=new');
    const renewal = pageRenewal(first.page);
    const clerk = fakeClerk('sess_1');
    expect(renewal.renewing(clerk, false)).toBe(false);
    expect(renewal.renewing(clerk, true)).toBe(true);
    renewal.decideAtOpen(clerk);
    renewal.decideAtOpen(clerk);
    expect(first.loads).toEqual([
      `https://clerk.app.example.com/v1/client/touch?redirect_url=${encodeURIComponent('https://app.example.com/items/3?sort=new#app-kit-cookie-renewed=')}`,
    ]);
    expect(renewal.renewing(clerk, true)).toBe(true);
    expect(first.lines.join('\n')).toContain('renewing Clerk\'s cookie with a page load, since WebKit ends it a week after a sign-in otherwise: the first for this session');

    // Back at the address it left, with the mark taken off before anything reads it, and nothing more to renew.
    first.tick(800);
    const back = fakePage('https://app.example.com/items/3?sort=new#app-kit-cookie-renewed=', { now: NOW + 800, stored: first.stored });
    const again = pageRenewal(back.page);
    expect(back.address()).toBe('https://app.example.com/items/3?sort=new');
    expect(back.lines).toEqual(["[app-kit sign-in] back from renewing Clerk's cookie"]);
    expect(JSON.parse(back.stored[RENEWAL_KEY]!)).toEqual({ sessionId: 'sess_1', renewedAt: NOW + 800, attemptedAt: NOW });
    expect(again.renewing(clerk, true)).toBe(false);
    again.decideAtOpen(clerk);
    expect(back.loads).toEqual([]);
  });

  test('a page that opens signed out never renews, not even after a sign-in in the page', () => {
    const { page, loads } = fakePage('https://app.example.com/');
    const renewal = pageRenewal(page);
    renewal.decideAtOpen(fakeClerk(null));
    expect(renewal.renewing(fakeClerk('sess_1'), true)).toBe(false);
    renewal.decideAtOpen(fakeClerk('sess_1'));
    expect(loads).toEqual([]);
  });

  test('outside WebKit nothing holds and nothing loads', () => {
    const { page, loads } = fakePage('https://app.example.com/', { userAgent: CHROME });
    const renewal = pageRenewal(page);
    expect(renewal.renewing(fakeClerk('sess_1'), true)).toBe(false);
    renewal.decideAtOpen(fakeClerk('sess_1'));
    renewal.signingInByTicket();
    expect(renewal.afterSignIn(fakeClerk('sess_1'))).toBe(false);
    expect(loads).toEqual([]);
  });

  test('a ticket sign-in in the window holds from its start and leaves only once it has finished handing over', () => {
    const { page, loads } = fakePage('https://app.example.com/');
    const renewal = pageRenewal(page);
    renewal.decideAtOpen(fakeClerk(null));
    renewal.signingInByTicket();
    expect(renewal.renewing(fakeClerk('sess_2'), true)).toBe(true);
    expect(loads).toEqual([]);
    expect(renewal.afterSignIn(fakeClerk('sess_2'))).toBe(true);
    expect(loads).toHaveLength(1);
    expect(renewal.afterSignIn(fakeClerk('sess_2'))).toBe(true);
    expect(loads).toHaveLength(1);
  });

  test('a ticket that fails holds nothing up and loads nothing', () => {
    const { page, loads } = fakePage('https://app.example.com/');
    const renewal = pageRenewal(page);
    renewal.decideAtOpen(fakeClerk(null));
    renewal.signingInByTicket();
    renewal.ticketFailed();
    expect(renewal.renewing(fakeClerk(null), true)).toBe(false);
    expect(renewal.afterSignIn(fakeClerk(null))).toBe(false);
    expect(loads).toEqual([]);
  });
});
