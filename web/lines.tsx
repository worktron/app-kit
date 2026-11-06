import { Box, Button } from '@mui/material';
import { useServerReachable } from './connection';
import { isAppWindow } from './installed-app';
import { useNewBuild } from './new-build';

/** The look of the quiet lines under an app's bar, shared with the Mac app's update line (tauri/window/lines.tsx). */
export const line = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2, py: 0.5, typography: 'body2', color: 'text.secondary' } as const;

/**
 * What the line for a newer deploy says, and its button, which reloads the page. In an app (`isAppWindow`), where
 * people do not think of a page, it is the app's update; in a browser tab, the page has changed. Kept to the kit: an
 * app drawing its own line takes these words from `updateMessage` in app-kit/tauri/window.
 */
export function newBuildMessage(appName: string, inApp: boolean): { message: string; action: string } {
  return inApp
    ? { message: `${appName} has an update.`, action: 'Update' }
    : { message: `${appName} has changed since this page loaded.`, action: 'Reload' };
}

/**
 * A quiet line once a newer build is deployed, with a button that reloads the page: "<App> has an update." with Update
 * in an app, "<App> has changed since this page loaded." with Reload in a browser tab. An app on the Mac window draws
 * `UpdateLine` from app-kit/tauri/window instead, which offers the app's own update on the same line. An app that draws
 * its own lines under its bar uses `useNewBuild` instead. `reloadsItself={false}` is useNewBuild's option of that name.
 */
export function NewBuildLine({ appName, reloadsItself = true }: { appName: string; reloadsItself?: boolean }) {
  const newBuild = useNewBuild({ reloadsItself });
  if (!newBuild) return null;
  const { message, action } = newBuildMessage(appName, isAppWindow());
  return (
    <Box role="status" sx={line}>
      {message}
      <Button size="small" onClick={() => window.location.reload()}>
        {action}
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
