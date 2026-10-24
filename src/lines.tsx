import { Box, Button } from '@mui/material';
import { useServerReachable } from './connection';
import { useNewBuild } from './new-build';

const line = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2, py: 0.5, typography: 'body2', color: 'text.secondary' } as const;

/**
 * A quiet line once a newer build is deployed, with Reload. An app that draws its own lines under its bar uses
 * `useNewBuild` instead and draws this in its own style.
 */
export function NewBuildLine({ appName }: { appName: string }) {
  const newBuild = useNewBuild();
  if (!newBuild) return null;
  return (
    <Box role="status" sx={line}>
      A new version of {appName} is ready.
      <Button size="small" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </Box>
  );
}

/** What the server-unreachable line says. */
export function unreachableMessage(online: boolean): string {
  return online ? 'Cannot reach the server. This page reconnects by itself.' : 'You are offline. This page reconnects by itself.';
}

/** A line while the server cannot be reached, gone once it answers again. */
export function ConnectionLine() {
  const reachable = useServerReachable();
  if (reachable) return null;
  return (
    <Box role="status" sx={line}>
      {unreachableMessage(navigator.onLine)}
    </Box>
  );
}
