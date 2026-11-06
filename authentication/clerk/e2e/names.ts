// The throwaway users' addresses in the Clerk browser test, and the address of the counting pass-through to Clerk's
// Backend API for one project's users, which global-setup.ts starts.
export const DOMAIN = 'example.com';
export const PREFIX = 'kit';

export function countedApi(project: 'shared' | 'own' | 'each'): string {
  const url = process.env.CLERK_COUNTED_API;
  if (!url) throw new Error('Run the Clerk browser test through scripts/e2e-clerk.sh, whose global setup counts its calls to Clerk.');
  return `${url}/${project}`;
}

export const secretKey = (): string => {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error('Run the Clerk browser test through scripts/e2e-clerk.sh, which reads the instance key from 1Password.');
  return key;
};
