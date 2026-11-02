import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { AccountMenu, SignInGate, lookTheme } from '../..';
import { standInSignIn } from '../../../authentication/stand-in';

// The account menu at the right end of an app's bar, in the kit's MUI themes, signed in as the stand-in's person. Opened
// with ?look=console it draws the console theme; the plain one follows the system's light or dark setting.

const look = new URLSearchParams(location.search).get('look') === 'console' ? 'console' : 'plain';
const theme = lookTheme(look === 'console' ? { name: 'console' } : { name: 'plain' });
const provider = standInSignIn({ person: { id: 'p1', email: 'pat.morgan@example.com' } });

function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          Errands
        </Typography>
        <AccountMenu items={[{ label: 'Settings', href: '/settings' }, { label: 'Purchases', href: '/purchases' }]} />
      </Box>
      <Box component="main" sx={{ maxWidth: 960, mx: 'auto', px: 3, py: 3 }}>
        <Typography variant="h6" component="h1">
          Things I need
        </Typography>
      </Box>
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SignInGate provider={provider} placeholder={null} signedOut={<h1>Sign in</h1>}>
        <App />
      </SignInGate>
    </ThemeProvider>
  </StrictMode>,
);
