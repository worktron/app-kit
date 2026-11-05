import { Box, Button } from '@mui/material';
import { line } from '../../web/lines';
import { updateLink, useAppUpdate, type AppUpdate } from './index';

/** What the Mac app's update line says in each state, and the button it offers, if any. */
export function appUpdateMessage(appName: string, update: AppUpdate): { message: string; action: string | null } {
  switch (update) {
    case 'available':
      return { message: `A new version of ${appName} for Mac is ready.`, action: 'Update' };
    case 'installing':
      return { message: `Updating ${appName} for Mac. It restarts once the new version is in place.`, action: null };
    case 'failed':
      return { message: `${appName} for Mac could not update.`, action: 'Try again' };
  }
}

/**
 * A quiet line once the Mac window has found a newer release of the app, with Update; while it installs, a line saying
 * so; and if it failed, Try again. Update and Try again open `updateLink(scheme)`, which installs the release and
 * restarts the app into it, loading the newest page too. `scheme` is the app's own link scheme, the one `Site::scheme`
 * names. Outside the Mac window, and until a release is found, it draws nothing, so a page shows it everywhere beside
 * `NewBuildLine`. An app that draws its own lines uses `useAppUpdate` and `appUpdateMessage` instead.
 */
export function AppUpdateLine({ appName, scheme }: { appName: string; scheme: string }) {
  const update = useAppUpdate();
  if (!update) return null;
  const { message, action } = appUpdateMessage(appName, update);
  return (
    <Box role="status" sx={line}>
      {message}
      {action && (
        <Button size="small" href={updateLink(scheme)}>
          {action}
        </Button>
      )}
    </Box>
  );
}
