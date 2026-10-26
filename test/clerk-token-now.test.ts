import { expect, test } from 'bun:test';
import { TOKEN_MARGIN_MS, tokenStillGood } from '../authentication/clerk/token-now';

const NOW = 1_800_000_000_000;
const held = (exp: number | undefined, raw = 'jwt') => ({ getRawString: () => raw, jwt: exp === undefined ? undefined : { claims: { exp } } });

test('a token good for longer than the margin is handed out as it is', () => {
  expect(tokenStillGood(held(NOW / 1000 + 60), NOW)).toBe('jwt');
});

test('a token expired, or expiring within the margin, is none', () => {
  expect(tokenStillGood(held(NOW / 1000 - 1), NOW)).toBeNull();
  expect(tokenStillGood(held((NOW + TOKEN_MARGIN_MS) / 1000), NOW)).toBeNull();
});

test('no token, one Clerk has not decoded, or an empty one is none', () => {
  expect(tokenStillGood(null, NOW)).toBeNull();
  expect(tokenStillGood(undefined, NOW)).toBeNull();
  expect(tokenStillGood(held(undefined), NOW)).toBeNull();
  expect(tokenStillGood(held(NOW / 1000 + 60, ''), NOW)).toBeNull();
});
