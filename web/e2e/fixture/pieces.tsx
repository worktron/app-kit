import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { TextField } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { PullToRefresh, SignInGate, fieldsNeverZoom, request } from '../..';
import { standInSignIn } from '../../../authentication/stand-in';

// The pieces an installed app adds: pull to refresh, a field that never zooms, and a request sent as the page is left.
// It counts its loads in the tab, for the test to see a reload. With ?leave=<id> it deletes /api/left/<id> as the page
// is hidden or left, as an app sends what it must not lose, and the fixture's server records it. With ?pull=fails a pull
// refreshes in place, and the refresh fails.

const loads = Number(sessionStorage.getItem('pieces-loads') ?? 0) + 1;
sessionStorage.setItem('pieces-loads', String(loads));
const leave = new URLSearchParams(location.search).get('leave');
const pullFails = new URLSearchParams(location.search).get('pull') === 'fails';

const standIn = standInSignIn({ person: { id: 'person-1', email: 'pat@example.com' } });
// Asked for a token, this provider never answers, as one still asking while the page goes; the one it holds is the stand-in's.
const provider = { ...standIn, useSession: () => ({ ...standIn.useSession(), token: () => new Promise<string | null>(() => undefined) }) };

// The app's own field settings, which the kit's field size merges into.
const theme = createTheme({ components: { MuiInputBase: { styleOverrides: { root: { letterSpacing: '0.01em' } } } } }, { components: fieldsNeverZoom });

function Pieces() {
  useEffect(() => {
    if (!leave) return;
    const send = () => void request(`/api/left/${leave}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    const hidden = () => document.visibilityState === 'hidden' && send();
    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', send);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  return (
    <main style={{ padding: 16, minHeight: '200vh' }}>
      <h1>Pieces</h1>
      <p>
        Loads <output id="loads">{loads}</output>
      </p>
      <TextField label="Note" />
      <div id="list" style={{ height: 120, overflow: 'auto', border: '1px solid #ccc' }}>
        <p style={{ height: 1000, margin: 0 }}>In a list</p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <SignInGate provider={provider} placeholder={<p>fixture</p>} signedOut={<p>Signed out</p>}>
        <Pieces />
      </SignInGate>
      <PullToRefresh onPull={pullFails ? () => Promise.reject(new Error('the server did not answer')) : undefined} />
    </ThemeProvider>
  </StrictMode>,
);
