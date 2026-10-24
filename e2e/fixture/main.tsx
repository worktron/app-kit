import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ConnectionLine,
  ErrorBoundary,
  NavigateProvider,
  NewBuildLine,
  RowLink,
  SignInGate,
  configureConnection,
  onReconnect,
  reloadOnFailedLoad,
  request,
  useAppDrawn,
  useSignIn,
  useSignOut,
} from '../../src';
import { STAND_IN_CODE, standInSignIn } from '../../testing';

reloadOnFailedLoad();
configureConnection({ probePath: '/api/health' });

// Who is signed in lasts across page loads in this tab, as a provider's cookie would.
const provider = standInSignIn({ store: sessionStorage });

const Later = lazy(() => import('./Later'));

function SignInScreen() {
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <main>
      <h1>Sign in</h1>
      {signIn.notice && <p role="alert">{signIn.notice}</p>}
      {signIn.lastAccount && <button onClick={() => void signIn.google('remembered')}>Continue as {signIn.lastAccount}</button>}
      <button onClick={() => void signIn.google('choose')}>{signIn.lastAccount ? 'Use a different account' : 'Continue with Google'}</button>
      {sent ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const outcome = await signIn.checkEmailCode(code, email);
            if (!outcome.ok) setMessage(outcome.message);
          }}
        >
          <label>
            Code <input value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button type="submit">Sign in</button>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await signIn.sendEmailCode(email);
            setSent(true);
          }}
        >
          <label>
            Email <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit">Email me a code</button>
        </form>
      )}
      {message && <p>{message}</p>}
      <p hidden>{STAND_IN_CODE}</p>
    </main>
  );
}

function useAddress() {
  const [address, setAddress] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const moved = () => setAddress(window.location.pathname + window.location.search);
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, []);
  const navigate = (href: string) => {
    window.history.pushState(null, '', href);
    setAddress(href);
  };
  return [address, navigate] as const;
}

function Items() {
  const [items, setItems] = useState<{ id: string; title: string }[] | null>(null);
  const [failed, setFailed] = useState<string>();
  const appDrawn = useAppDrawn();
  const load = () =>
    request<{ items: { id: string; title: string }[] }>('/api/items')
      .then((r) => setItems(r.items))
      .catch((e: Error) => setFailed(e.message));
  useEffect(() => {
    void load();
    return onReconnect(() => void load());
  }, []);
  useLayoutEffect(() => {
    if (items) appDrawn();
  }, [items, appDrawn]);
  if (!items) return failed ? <p>{failed}</p> : null;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <RowLink href={`/items/${item.id}`}>{item.title}</RowLink>
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [address, navigate] = useAddress();
  const signOut = useSignOut();
  const item = /^\/items\/(\w+)/.exec(address)?.[1];
  return (
    <NavigateProvider navigate={navigate}>
      <header>
        <NewBuildLine appName="the fixture" />
        <ConnectionLine />
        {signOut && <button onClick={signOut}>Sign out</button>}
      </header>
      <main>
        <h1>The app at {address}</h1>
        {item ? <p>Item {item}</p> : address === '/later' ? <Suspense fallback={null}><Later /></Suspense> : <Items />}
        <RowLink href="/later">Later</RowLink>
      </main>
    </NavigateProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SignInGate provider={provider} placeholder={<div role="progressbar">fixture</div>} signedOut={<SignInScreen />} waitForFirstDraw>
        <App />
      </SignInGate>
    </ErrorBoundary>
  </StrictMode>,
);
