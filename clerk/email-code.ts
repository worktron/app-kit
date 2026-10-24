import type { Outcome } from '../src/sign-in/provider';

/** Clerk's emailed codes are six digits. */
export const CODE_LENGTH = 6;

/** The code as typed or pasted, kept to its digits. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

type Result = Promise<{ error: unknown }>;

/** The part of Clerk's sign-in object the email code flow uses, so tests can pass a fake. */
export interface EmailCodeSignIn {
  readonly status: string;
  create(params: { identifier: string }): Result;
  emailCode: {
    sendCode(params: { emailAddress: string }): Result;
    verifyCode(params: { code: string }): Result;
  };
  finalize(): Result;
}

/** Clerk puts the reason in the first of its API errors, or on the error itself. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { errors, code } = error as { errors?: { code?: string }[]; code?: string };
  return errors?.[0]?.code ?? code;
}

/** What to tell the person, in words that say what to do next. */
export function messageFor(error: unknown, email: string): string {
  switch (errorCode(error)) {
    case 'form_identifier_not_found':
      return `There is no account for ${email}.`;
    case 'form_param_format_invalid':
      return 'That is not an email address.';
    case 'form_code_incorrect':
      return 'That code did not match. Use the newest email, or send a new code.';
    case 'verification_expired':
      return 'That code has expired. Send a new one.';
    case 'verification_failed':
    case 'too_many_requests':
      return 'Too many tries. Wait a minute, then send a new code.';
    default:
      return 'Signing in did not work. Try again.';
  }
}

/** Starts a sign-in for the address and emails it a code. */
export async function sendEmailCode(signIn: EmailCodeSignIn, email: string): Promise<Outcome> {
  const created = await signIn.create({ identifier: email });
  if (created.error) return { ok: false, message: messageFor(created.error, email) };
  const sent = await signIn.emailCode.sendCode({ emailAddress: email });
  if (sent.error) return { ok: false, message: messageFor(sent.error, email) };
  return { ok: true };
}

/** Checks the code and, once Clerk says the sign-in is complete, makes its session the active one. */
export async function checkEmailCode(signIn: EmailCodeSignIn, code: string, email: string): Promise<Outcome> {
  const verified = await signIn.emailCode.verifyCode({ code });
  if (verified.error) return { ok: false, message: messageFor(verified.error, email) };
  if (signIn.status !== 'complete') return { ok: false, message: messageFor(undefined, email) };
  const finalized = await signIn.finalize();
  if (finalized.error) return { ok: false, message: messageFor(finalized.error, email) };
  return { ok: true };
}

/** What Clerk passes to Google: the account to sign in as, or the ask to list its accounts. */
export function googleAccountParams(account: string | null): { oidcLoginHint: string } | { oidcPrompt: string } {
  return account ? { oidcLoginHint: account } : { oidcPrompt: 'select_account' };
}
