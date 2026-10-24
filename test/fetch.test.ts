import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { ApiError, request, SIGN_IN_LOOP_MS } from '../src/fetch';
import { resetConnection, serverReachable } from '../src/connection';
import { setCurrentSession, type CurrentSession } from '../src/sign-in/current';

const realFetch = globalThis.fetch;
type Answer = { status: number; body: string };
let answers: Answer[];
let sent: { url: string; headers: Headers }[];

function answer(...next: Answer[]) {
  answers = next;
}

beforeEach(() => {
  sent = [];
  answers = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers) });
    const next = answers.shift();
    if (!next) throw new TypeError('Failed to fetch');
    return new Response(next.body, { status: next.status });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setCurrentSession(null);
  resetConnection();
});

function session(overrides: Partial<CurrentSession> = {}): CurrentSession & { refusals: number } {
  const s = {
    refusals: 0,
    signedInAt: 0,
    token: async (options?: { fresh?: boolean }) => (options?.fresh ? 'fresh-token' : 'cached-token'),
    refused() {
      s.refusals++;
    },
    ...overrides,
  };
  return s;
}

test('sends the session token and a JSON content type, and returns the parsed body', async () => {
  setCurrentSession(session());
  answer({ status: 200, body: '{"tasks":[1]}' });
  const body = await request<{ tasks: number[] }>('/api/tasks', { method: 'POST', body: '{}' });
  expect(body).toEqual({ tasks: [1] });
  expect(sent[0]!.headers.get('Authorization')).toBe('Bearer cached-token');
  expect(sent[0]!.headers.get('Content-Type')).toBe('application/json');
});

test('an empty body is null', async () => {
  answer({ status: 204, body: '' });
  expect(await request('/api/thing', { method: 'DELETE' })).toBeNull();
});

test('a proxy page with an error keeps its status rather than failing to parse', async () => {
  answer({ status: 500, body: '<html>Internal error</html>' });
  const error = await request('/api/tasks').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(500);
  expect((error as ApiError).body).toBe('<html>Internal error</html>');
});

test("the server's own error message is the error's", async () => {
  answer({ status: 422, body: '{"error":"Title is required"}' });
  expect(request('/api/tasks')).rejects.toThrow('Title is required');
});

test('a 401 asks again with a fresh token, and an answer then is the answer', async () => {
  const s = session();
  setCurrentSession(s);
  answer({ status: 401, body: '' }, { status: 200, body: '{"ok":true}' });
  expect(await request('/api/tasks')).toEqual({ ok: true });
  expect(sent.map((r) => r.headers.get('Authorization'))).toEqual(['Bearer cached-token', 'Bearer fresh-token']);
  expect(s.refusals).toBe(0);
});

test('refused with the fresh token too, sign-in comes up, once', async () => {
  const s = session();
  setCurrentSession(s);
  answer({ status: 401, body: '' }, { status: 401, body: '' });
  const error = await request('/api/tasks').catch((e: unknown) => e);
  expect((error as ApiError).status).toBe(401);
  expect(s.refusals).toBe(1);
  expect(sent).toHaveLength(2);
});

test('refused right after a sign-in on this page, it is an error rather than sign-in again, so it never loops', async () => {
  const s = session({ signedInAt: Date.now() - SIGN_IN_LOOP_MS / 2 });
  setCurrentSession(s);
  answer({ status: 401, body: '{"error":"Session not accepted"}' }, { status: 401, body: '{"error":"Session not accepted"}' });
  expect(request('/api/tasks')).rejects.toThrow('Session not accepted');
  await Bun.sleep(0);
  expect(s.refusals).toBe(0);
});

test('with no sign-in gate, a 401 is an error and nothing else', async () => {
  answer({ status: 401, body: '' });
  const error = await request('/api/tasks').catch((e: unknown) => e);
  expect((error as ApiError).status).toBe(401);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.headers.has('Authorization')).toBe(false);
});

test('no answer at all marks the server unreachable, and its next answer marks it back', async () => {
  const error = await request('/api/tasks').catch((e: unknown) => e);
  expect((error as ApiError).status).toBe(0);
  expect(serverReachable()).toBe(false);
  answer({ status: 200, body: '{}' });
  await request('/api/tasks');
  expect(serverReachable()).toBe(true);
});

test("a proxy's 502 marks the server unreachable", async () => {
  answer({ status: 502, body: 'Bad gateway' });
  await request('/api/tasks').catch(() => undefined);
  expect(serverReachable()).toBe(false);
});

test('an answer that is not JSON is an error that says so', async () => {
  answer({ status: 200, body: '<html>the index page</html>' });
  expect(request('/api/tasks')).rejects.toThrow('not JSON');
});
