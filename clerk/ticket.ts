import type { Outcome } from '../src/sign-in/provider';
import { TICKET_FAILED } from '../src/sign-in/SignInGate';

type Result = Promise<{ error: unknown }>;

/** The part of Clerk's sign-in object a one-time ticket uses, so tests can pass a fake. */
export interface TicketSignIn {
  readonly status: string;
  ticket(params: { ticket: string }): Result;
  finalize(): Result;
}

/** Signs in with a one-time ticket, Clerk's sign-in token, and makes its session the active one. */
export async function signInWithTicket(signIn: TicketSignIn, ticket: string): Promise<Outcome> {
  const used = await signIn.ticket({ ticket });
  if (used.error || signIn.status !== 'complete') return { ok: false, message: TICKET_FAILED };
  const finalized = await signIn.finalize();
  if (finalized.error) return { ok: false, message: TICKET_FAILED };
  return { ok: true };
}
