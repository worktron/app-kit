import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';

interface Props {
  children: ReactNode;
  /** What to draw instead of the default: the app's wordmark over what failed, say. */
  fallback?: (error: Error, reload: () => void) => ReactNode;
}

const reload = () => window.location.reload();

/**
 * A crash shows what failed and a Reload button rather than an empty page. A class, since React has no hook that
 * catches a render error.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the one place a crash is kept on the page; the stack is there for a bug report.
    console.error('[web-client-kit] render crash', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, reload);
    return (
      <Box role="alert" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 420 }}>
          <Typography variant="h6" component="h1" gutterBottom>
            Something went wrong
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
            {error.message}
          </Typography>
          <Button variant="outlined" onClick={reload}>
            Reload
          </Button>
        </Box>
      </Box>
    );
  }
}
