import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ConnectionLine,
  ErrorBoundary,
  NavigateProvider,
  NewBuildLine,
  NotFound,
  RowLink,
  SignInGate,
  configureConnection,
  nameApp,
  onPageReturn,
  onReconnect,
  reloadOnFailedLoad,
  request,
  savedCopies,
  useAppDrawn,
  useScreenData,
  useSignIn,
  useSignOut,
  useTitle,
} from '../..';
import { STAND_IN_CODE, standInSignIn } from '../../../authentication/stand-in';

// Opened with ?sign-up, only ana@example.com has an account and the gate makes one for any other address.
const signUp = new URLSearchParams(window.location.search).has('sign-up');

// Who is signed in lasts across page loads in this tab, as a provider's cookie would.
const provider = standInSignIn({ store: sessionStorage, accounts: signUp ? ['ana@example.com'] : undefined });

const Later = lazy(() => import('./Later'));

const copies = savedCopies('fixture');

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

type Item = { id: string; title: string };
/** The server's answer for the list, whose field holding the items one build names differently from the next. */
export type Answer = Record<string, Item[]>;

function Items({ itemsOf }: { itemsOf: (answer: Answer) => Item[] }) {
  // The answer is kept as it came and read while drawing, as an app's screen does, so an answer in a shape this
  // build does not know crashes the draw, where the error boundary sees it.
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState<string>();
  const appDrawn = useAppDrawn();
  const load = () =>
    request<Answer>('/api/items')
      .then(setAnswer)
      .catch((e: Error) => setFailed(e.message));
  useEffect(() => {
    void load();
    // Loaded again whenever the page comes back in front, as an app's screens are.
    const stopReturn = onPageReturn(() => void load());
    const stopReconnect = onReconnect(() => void load());
    return () => {
      stopReturn();
      stopReconnect();
    };
  }, []);
  // Drawn once the list is in or has failed: a failure is shown too, never held back behind the placeholder.
  useLayoutEffect(() => {
    if (answer || failed) appDrawn();
  }, [answer, failed, appDrawn]);
  if (!answer) return failed ? <p>{failed}</p> : null;
  return (
    <ul>
      {itemsOf(answer).map((item) => (
        <li key={item.id}>
          <RowLink href={`/items/${item.id}`}>{item.title}</RowLink>
        </li>
      ))}
    </ul>
  );
}

/** A screen painted first from its saved copy, which crashes on an answer in any other shape, as a screen does. */
function Shelf() {
  const shelf = useScreenData<{ items: string[] }>(copies, '/api/shelf');
  const appDrawn = useAppDrawn();
  useLayoutEffect(() => {
    if (shelf.data || shelf.failure) appDrawn();
  }, [shelf.data, shelf.failure, appDrawn]);
  if (!shelf.data) return shelf.failure ? <p>{shelf.failure}</p> : null;
  return (
    <ul aria-label="Shelf">
      {shelf.data.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** One screen, with its page title, as each of an app's screens sets its own. */
function Screen({ title, children }: { title: string | null; children: ReactNode }) {
  useTitle(title);
  return children;
}

function App({ itemsOf }: { itemsOf: (answer: Answer) => Item[] }) {
  const [address, navigate] = useAddress();
  const signOut = useSignOut();
  const item = /^\/items\/(\w+)/.exec(address)?.[1];
  const path = address.split('?')[0];
  const known = Boolean(item) || ['/', '/later', '/shelf'].includes(path);
  // A screen with no data to wait for is drawn at once; the list, the shelf and the not-found page each say so themselves.
  const appDrawn = useAppDrawn();
  const drawnAtOnce = Boolean(item) || path === '/later';
  useLayoutEffect(() => {
    if (drawnAtOnce) appDrawn();
  }, [drawnAtOnce, appDrawn]);
  if (!known) {
    return (
      <NavigateProvider navigate={navigate}>
        <NotFound />
      </NavigateProvider>
    );
  }
  return (
    <NavigateProvider navigate={navigate}>
      <header>
        <NewBuildLine appName="the fixture" />
        <ConnectionLine />
        {signOut && <button onClick={signOut}>Sign out</button>}
      </header>
      <main>
        <h1>The app at {address}</h1>
        <Screen title={item ? `Item ${item}` : path === '/later' ? 'Later' : path === '/shelf' ? 'Shelf' : null}>
          {item ? <p>Item {item}</p> : path === '/later' ? <Suspense fallback={null}><Later /></Suspense> : path === '/shelf' ? <Shelf /> : <Items itemsOf={itemsOf} />}
        </Screen>
        <RowLink href="/later">Later</RowLink>
      </main>
    </NavigateProvider>
  );
}

const placeholder = <div role="progressbar">fixture</div>;

/** Starts the fixture app, given how this build reads the list out of the server's answer. */
export function start(itemsOf: (answer: Answer) => Item[]) {
  reloadOnFailedLoad();
  nameApp('the fixture');
  configureConnection({ probePath: '/api/health' });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary placeholder={placeholder}>
        <SignInGate provider={provider} placeholder={placeholder} signedOut={<SignInScreen />} waitForFirstDraw signUp={signUp}>
          <App itemsOf={itemsOf} />
        </SignInGate>
      </ErrorBoundary>
    </StrictMode>,
  );
}
