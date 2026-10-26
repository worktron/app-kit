import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { afterCrash } from './crash-reload';
import { runningEntry } from './new-build';

interface Props {
  children: ReactNode;
  /** What to draw instead of the default: the app's wordmark over what failed, say. */
  fallback?: (error: Error, reload: () => void) => ReactNode;
  /**
   * What to draw while a crashed page asks the server whether a newer build is out, at most a few seconds: the same
   * placeholder the app gives the sign-in gate, so one steady screen stands through the crash, the reload and sign-in.
   * Without one, the crash is drawn while it asks, and the page may still reload from under it.
   */
  placeholder?: ReactNode;
}

interface State {
  error: Error | null;
  /** Whether the page is still asking which build the server serves, or reloading onto it. */
  checking: boolean;
}

const reload = () => window.location.reload();

/**
 * A crash shows what failed and a Reload button rather than an empty page. A built page first asks the server which
 * build it serves, and reloads by itself onto a newer one (afterCrash), since a page left open across a deploy crashes
 * on data in a shape its build does not know. A class, since React has no hook that catches a render error.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, checking: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Set with the error, so the crash screen is never drawn before the page knows whether it is reloading.
    return { error, checking: runningEntry() !== null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the one place a crash is kept on the page; the stack is there for a bug report.
    console.error('[app-kit] render crash', error, info.componentStack);
    if (!this.state.checking) return;
    void afterCrash().then((reloading) => {
      if (!reloading) this.setState({ checking: false });
    });
  }

  override render() {
    const { error, checking } = this.state;
    if (!error) return this.props.children;
    if (checking && this.props.placeholder !== undefined) return this.props.placeholder;
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
