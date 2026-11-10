import type { ReactNode } from 'react';
import { Box, CssBaseline, Link, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { lookTheme } from '../../theme';

// A short privacy page in the kit's plain theme, drawn two ways for public-pages.e2e.ts: by the app in the browser
// (privacy-app.html), and written at build as finished HTML (public-pages.tsx), which the fixture's server sends at
// /privacy. The two must look the same.

const theme = lookTheme({ name: 'plain' });

export function Privacy() {
  return (
    <Box component="main" sx={{ maxWidth: 640, mx: 'auto', px: 3, pt: 4, pb: 6 }}>
      <Typography variant="h5" component="h1">
        Privacy policy
      </Typography>
      <Typography color="textSecondary" sx={{ mt: 1 }}>
        Last changed 10 November 2026
      </Typography>
      <Typography variant="overline" component="h2" sx={{ display: 'block', mt: 3, mb: 1 }}>
        What the shop reads
      </Typography>
      <Typography sx={{ mb: 1.5 }}>
        The shop reads only the orders you open, to show them back to you. It keeps none of them, and sends nothing to anyone
        else.
      </Typography>
      <Typography>
        Questions go to <Link href="mailto:privacy@example.com">privacy@example.com</Link>.
      </Typography>
    </Box>
  );
}

/** What the app draws around its pages: the kit's theme and its baseline. */
export function wrap(page: ReactNode) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {page}
    </ThemeProvider>
  );
}
