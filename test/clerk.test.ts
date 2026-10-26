import { describe, expect, test } from 'bun:test';
import { checkEmailCode, cleanCode, googleAccountParams, messageFor, sendEmailCode, SIGN_UP_UNFINISHED, type EmailCodeSignIn, type EmailCodeSignUp } from '../authentication/clerk/email-code';
import { signInWithTicket, type TicketSignIn } from '../authentication/clerk/ticket';
import { TICKET_FAILED } from '../web/sign-in/provider';
import recorded from './fixtures/clerk-sign-up.json';

const apiError = (code: string) => ({ errors: [{ code, message: 'from Clerk' }] });

/** A stand-in for Clerk's sign-in object that records each call and fails the ones it is told to. */
function fakeSignIn(fail: Partial<Record<'create' | 'sendCode' | 'verifyCode' | 'finalize', unknown>> = {}) {
  const calls: string[] = [];
  const signIn: EmailCodeSignIn & { status: string } = {
    status: 'needs_identifier',
    async create({ identifier, signUpIfMissing }) {
      calls.push(`create ${identifier}${signUpIfMissing ? ' signUpIfMissing' : ''}`);
      if (!fail.create) signIn.status = 'needs_first_factor';
      return { error: fail.create ?? null };
    },
    emailCode: {
      async sendCode({ emailAddress }) {
        calls.push(`sendCode ${emailAddress}`);
        return { error: fail.sendCode ?? null };
      },
      async verifyCode({ code }) {
        calls.push(`verifyCode ${code}`);
        if (!fail.verifyCode) signIn.status = 'complete';
        return { error: fail.verifyCode ?? null };
      },
    },
    async finalize() {
      calls.push('finalize');
      return { error: fail.finalize ?? null };
    },
  };
  return { signIn, calls };
}

test('a code keeps its digits only, up to six', () => {
  expect(cleanCode('48 12-07')).toBe('481207');
  expect(cleanCode('4812079')).toBe('481207');
});

describe('what the person is told', () => {
  test('which address has no account', () => {
    expect(messageFor(apiError('form_identifier_not_found'), 'someone@example.com')).toBe('There is no account for someone@example.com.');
  });

  test('read off the error itself when there is no list', () => {
    expect(messageFor({ code: 'verification_expired' }, 'a@example.com')).toBe('That code has expired. Send a new one.');
  });

  test("anything else is a plain retry line, never Clerk's own text", () => {
    expect(messageFor(apiError('something_new'), 'a@example.com')).toBe('Signing in did not work. Try again.');
  });
});

test('an emailed code starts a sign-in for the address, then emails it', async () => {
  const { signIn, calls } = fakeSignIn();
  expect(await sendEmailCode(signIn, 'a@example.com')).toEqual({ ok: true });
  expect(calls).toEqual(['create a@example.com', 'sendCode a@example.com']);
});

test('an unknown address stops before any email goes out', async () => {
  const { signIn, calls } = fakeSignIn({ create: apiError('form_identifier_not_found') });
  expect(await sendEmailCode(signIn, 'x@example.com')).toEqual({ ok: false, message: 'There is no account for x@example.com.' });
  expect(calls).toEqual(['create x@example.com']);
});

test('a right code makes the session active, a wrong one leaves it alone', async () => {
  const right = fakeSignIn();
  await sendEmailCode(right.signIn, 'a@example.com');
  expect(await checkEmailCode(right.signIn, '481207', 'a@example.com')).toEqual({ ok: true });
  expect(right.calls.slice(2)).toEqual(['verifyCode 481207', 'finalize']);

  const wrong = fakeSignIn({ verifyCode: apiError('form_code_incorrect') });
  await sendEmailCode(wrong.signIn, 'a@example.com');
  expect((await checkEmailCode(wrong.signIn, '000000', 'a@example.com')).ok).toBe(false);
  expect(wrong.calls).not.toContain('finalize');
});

test('Google is told the account to sign in as, or asked for its list', () => {
  expect(googleAccountParams('ana@example.com')).toEqual({ oidcLoginHint: 'ana@example.com' });
  expect(googleAccountParams(null)).toEqual({ oidcPrompt: 'select_account' });
});

describe('a one-time ticket from the browser', () => {
  /** Clerk's sign-in object as a ticket uses it, failing the step it is told to. */
  function fakeTicketSignIn(fail: Partial<Record<'ticket' | 'finalize', unknown>> = {}, completes = true) {
    const calls: string[] = [];
    const signIn: TicketSignIn & { status: string } = {
      status: 'needs_identifier',
      async ticket({ ticket }) {
        calls.push(`ticket ${ticket}`);
        if (!fail.ticket && completes) signIn.status = 'complete';
        return { error: fail.ticket ?? null };
      },
      async finalize() {
        calls.push('finalize');
        return { error: fail.finalize ?? null };
      },
    };
    return { signIn, calls };
  }

  test('signs in with the ticket and makes its session the active one', async () => {
    const { signIn, calls } = fakeTicketSignIn();
    expect(await signInWithTicket(signIn, 'tkt_1')).toEqual({ ok: true });
    expect(calls).toEqual(['ticket tkt_1', 'finalize']);
  });

  test('a ticket Clerk refuses, as an expired or used one, makes no session and says to try again', async () => {
    const { signIn, calls } = fakeTicketSignIn({ ticket: apiError('sign_in_token_expired') });
    expect(await signInWithTicket(signIn, 'tkt_1')).toEqual({ ok: false, message: TICKET_FAILED });
    expect(calls).toEqual(['ticket tkt_1']);
  });

  test('a sign-in left unfinished, or a session that will not become active, says the same', async () => {
    expect(await signInWithTicket(fakeTicketSignIn({}, false).signIn, 'tkt_1')).toEqual({ ok: false, message: TICKET_FAILED });
    expect(await signInWithTicket(fakeTicketSignIn({ finalize: apiError('session_exists') }).signIn, 'tkt_1')).toEqual({ ok: false, message: TICKET_FAILED });
  });
});

describe('sign-up by emailed code', () => {
  const NEW = 'new-person+clerk_test@example.com';
  /** Clerk's errors as its SDK hands them over: the API's list, with each one's code. */
  const fromApi = (answer: { body: { errors?: unknown[] } }) => ({ errors: answer.body.errors });
  // Clerk's documented answer to a right code for an address with no account; the instance recorded against did not
  // give it for the test code, so it is Clerk's documentation here, not a recording (fixtures/clerk-sign-up.json).
  const transfer = apiError('sign_up_if_missing_transfer');

  /** Clerk's sign-up object as the transfer uses it, ending at the status it is told. */
  function fakeSignUp(ends: { status: string; missingFields?: string[] } = { status: 'complete' }) {
    const calls: string[] = [];
    const signUp: EmailCodeSignUp & { status: string | null; missingFields: string[] } = {
      status: null,
      missingFields: [],
      async create(params) {
        calls.push(`signUp.create ${JSON.stringify(params)}`);
        signUp.status = ends.status;
        signUp.missingFields = ends.missingFields ?? [];
        return { error: null };
      },
      async finalize() {
        calls.push('signUp.finalize');
        return { error: null };
      },
    };
    return { signUp, calls };
  }

  test("with sign-up off, an address with no account stops at Clerk's recorded answer and is told it has none", async () => {
    expect(recorded.signInUnknown.body.errors?.[0]?.code).toBe('form_identifier_not_found');
    const { signIn, calls } = fakeSignIn({ create: fromApi(recorded.signInUnknown) });
    expect(await sendEmailCode(signIn, NEW)).toEqual({ ok: false, message: `There is no account for ${NEW}.` });
    expect(calls).toEqual([`create ${NEW}`]);
  });

  test('with sign-up on, the sign-in is started to sign up if missing and goes on to the code, as Clerk answered it', async () => {
    // Recorded: an address with no account is offered an emailed code just as one with an account is.
    expect(recorded.signInSignUpIfMissing.body.response?.status).toBe('needs_first_factor');
    expect(recorded.signInSignUpIfMissing.body.response?.supported_first_factors.map((f) => f.strategy)).toContain('email_code');
    const { signIn, calls } = fakeSignIn();
    expect(await sendEmailCode(signIn, NEW, { signUp: true })).toEqual({ ok: true });
    expect(calls).toEqual([`create ${NEW} signUpIfMissing`, `sendCode ${NEW}`]);
  });

  test("a wrong code, as Clerk recorded it, says so and makes no account", async () => {
    const { signIn } = fakeSignIn({ verifyCode: fromApi(recorded.wrongCode) });
    const { signUp, calls } = fakeSignUp();
    expect(await checkEmailCode(signIn, '000000', NEW, signUp)).toEqual({ ok: false, message: 'That code did not match. Use the newest email, or send a new code.' });
    expect(calls).toEqual([]);
  });

  test("on Clerk's documented answer to a right code for a new address (not recorded), the account is made and signed in to", async () => {
    const { signIn } = fakeSignIn({ verifyCode: transfer });
    const { signUp, calls } = fakeSignUp();
    expect(await checkEmailCode(signIn, '424242', NEW, signUp)).toEqual({ ok: true });
    expect(calls).toEqual(['signUp.create {"transfer":true}', 'signUp.finalize']);
  });

  test('an account Clerk wants more for, such as a password, is told it did not finish, and the log names what is missing', async () => {
    const logged: string[] = [];
    const { signIn } = fakeSignIn({ verifyCode: transfer });
    const { signUp, calls } = fakeSignUp({ status: 'missing_requirements', missingFields: ['password'] });
    expect(await checkEmailCode(signIn, '424242', NEW, signUp, (line) => logged.push(line))).toEqual({ ok: false, message: SIGN_UP_UNFINISHED });
    expect(calls).toEqual(['signUp.create {"transfer":true}']);
    expect(logged).toEqual(['[sign-in] sign-up for a new account did not finish: Clerk is missing_requirements and still wants password']);
  });

  test('an app that takes no new accounts says so, rather than to try again', () => {
    for (const code of ['sign_up_mode_restricted', 'sign_up_restricted_waitlist', 'not_allowed_access']) {
      expect(messageFor(apiError(code), NEW)).toBe(`This app is not taking new accounts for ${NEW}.`);
    }
  });
});
