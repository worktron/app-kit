import { noAccountFor, type Outcome } from '../../web/sign-in/provider';

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
  create(params: { identifier: string; signUpIfMissing?: boolean }): Result;
  emailCode: {
    sendCode(params: { emailAddress: string }): Result;
    verifyCode(params: { code: string }): Result;
  };
  finalize(): Result;
}

/** The part of Clerk's sign-up object that makes the account once a sign-in's code shows the address has none. */
export interface EmailCodeSignUp {
  readonly status: string | null;
  readonly missingFields: readonly string[];
  create(params: { transfer: true }): Result;
  finalize(): Result;
}

/** What the person is told when the account was started but Clerk wants more than the email to finish it. */
export const SIGN_UP_UNFINISHED = 'Making your account did not finish. Try again.';

/** Clerk's answer to a right code for an address with no account, when the sign-in was started to sign up if missing. */
const TRANSFER_TO_SIGN_UP = 'sign_up_if_missing_transfer';

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
      return noAccountFor(email);
    case 'sign_up_mode_restricted':
    case 'sign_up_restricted_waitlist':
    case 'not_allowed_access':
      return `This app is not taking new accounts for ${email}.`;
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

/**
 * Starts a sign-in for the address and emails it a code. With `signUp`, Clerk's sign-in goes on to the code whether
 * the address has an account or not, and only the checked code says which, so nobody learns from this step who has one.
 */
export async function sendEmailCode(signIn: EmailCodeSignIn, email: string, options: { signUp?: boolean } = {}): Promise<Outcome> {
  const created = await signIn.create(options.signUp ? { identifier: email, signUpIfMissing: true } : { identifier: email });
  if (created.error) return { ok: false, message: messageFor(created.error, email) };
  const sent = await signIn.emailCode.sendCode({ emailAddress: email });
  if (sent.error) return { ok: false, message: messageFor(sent.error, email) };
  return { ok: true };
}

/**
 * Checks the code and, once Clerk says the sign-in is complete, makes its session the active one. A right code for an
 * address with no account, on a sign-in started with sign-up on, makes the account through `signUp` and signs in to it.
 */
export async function checkEmailCode(
  signIn: EmailCodeSignIn,
  code: string,
  email: string,
  signUp?: EmailCodeSignUp,
  log: (line: string) => void = console.log,
): Promise<Outcome> {
  const verified = await signIn.emailCode.verifyCode({ code });
  if (verified.error && signUp && errorCode(verified.error) === TRANSFER_TO_SIGN_UP) return makeAccount(signUp, email, log);
  if (verified.error) return { ok: false, message: messageFor(verified.error, email) };
  if (signIn.status !== 'complete') return { ok: false, message: messageFor(undefined, email) };
  const finalized = await signIn.finalize();
  if (finalized.error) return { ok: false, message: messageFor(finalized.error, email) };
  return { ok: true };
}

/** Makes the account the checked code was for, and makes its session the active one. */
async function makeAccount(signUp: EmailCodeSignUp, email: string, log: (line: string) => void): Promise<Outcome> {
  const created = await signUp.create({ transfer: true });
  if (created.error) return { ok: false, message: messageFor(created.error, email) };
  if (signUp.status !== 'complete') {
    // The instance asks for more than an email, such as a name or a password, or its bot check wants a challenge
    // (protect_check): the kit's sign-up collects only the address.
    log(`[sign-in] sign-up for a new account did not finish: Clerk is ${signUp.status} and still wants ${signUp.missingFields.join(', ') || 'nothing it names'}`);
    return { ok: false, message: SIGN_UP_UNFINISHED };
  }
  const finalized = await signUp.finalize();
  if (finalized.error) return { ok: false, message: messageFor(finalized.error, email) };
  return { ok: true };
}

/** What Clerk passes to Google: the account to sign in as, or the ask to list its accounts. */
export function googleAccountParams(account: string | null): { oidcLoginHint: string } | { oidcPrompt: string } {
  return account ? { oidcLoginHint: account } : { oidcPrompt: 'select_account' };
}
