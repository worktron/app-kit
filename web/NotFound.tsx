import { useLayoutEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { RowLink } from './RowLink';
import { useAppDrawn } from './sign-in/SignInGate';
import { useTitle } from './title';

/**
 * What an address the app does not know shows: that address, and a link to the app's home, at the address that was
 * asked for, never a redirect home, which would make a stale link or a typo look as if it worked. It tells the sign-in
 * gate it has drawn, since with waitForFirstDraw the gate holds its placeholder until a screen says so.
 */
export function NotFound({ home = '/' }: { home?: string }) {
  const appDrawn = useAppDrawn();
  useTitle('Not found');
  useLayoutEffect(() => appDrawn(), [appDrawn]);
  const address = window.location.pathname + window.location.search;
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', px: 3, py: 6 }}>
      <Typography variant="h6" component="h1" gutterBottom>
        Not found
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
        Nothing is at {address}.
      </Typography>
      <Typography>
        <RowLink href={home} sx={{ display: 'inline', textDecoration: 'underline' }}>
          Go to the home page
        </RowLink>
      </Typography>
    </Box>
  );
}
