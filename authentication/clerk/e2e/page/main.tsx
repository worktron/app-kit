/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountMenu, SignInGate, usePerson } from '../../../../web';
import { iphoneSignInForGate } from '../../../../tauri/iphone-sign-in';
import { clerkSignIn } from '../..';

// An app's page on the kit's Clerk adapter: the sign-in gate, the account menu with Sign out, and who is signed in. The
// gate runs desktop sign-in's browser page as an app built for the Mac and the iPhone has it, so on that page, signed
// out, it goes to Google by itself.
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error('Build this page through scripts/e2e-clerk.sh, which gives it the publishable key.');
const provider = clerkSignIn({ publishableKey });

function App() {
  const person = usePerson();
  return (
    <main>
      <AccountMenu />
      <p data-testid="person">{person?.email}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SignInGate
      provider={provider}
      placeholder={null}
      placeholderWithLine={(line) => <p role="status">{line}</p>}
      iphoneSignIn={iphoneSignInForGate({ scheme: 'com.example.clerk-page' })}
      signedOut={<h1>Sign in</h1>}
    >
      <App />
    </SignInGate>
  </StrictMode>,
);
