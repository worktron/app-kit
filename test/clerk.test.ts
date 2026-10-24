import { describe, expect, test } from 'bun:test';
import { checkEmailCode, cleanCode, googleAccountParams, messageFor, sendEmailCode, type EmailCodeSignIn } from '../clerk/email-code';

const apiError = (code: string) => ({ errors: [{ code, message: 'from Clerk' }] });

/** A stand-in for Clerk's sign-in object that records each call and fails the ones it is told to. */
function fakeSignIn(fail: Partial<Record<'create' | 'sendCode' | 'verifyCode' | 'finalize', unknown>> = {}) {
  const calls: string[] = [];
  const signIn: EmailCodeSignIn & { status: string } = {
    status: 'needs_identifier',
    async create({ identifier }) {
      calls.push(`create ${identifier}`);
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
