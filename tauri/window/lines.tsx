import { Box, Button } from '@mui/material';
import { isAppWindow } from '../../web/installed-app';
import { line, newBuildMessage } from '../../web/lines';
import { useNewBuild } from '../../web/new-build';
import { restartLink, updateLink, useAppUpdate, useNewerBuildInstalled } from './index';

/**
 * Which update the app has, in the order the line offers them: an update from the app's releases installing, which
 * comes first because the install puts the newer app on disk before it restarts, and the window, coming forward in
 * between, would otherwise say a newer build is installed; a newer build of the app installed over the running one;
 * an update from the releases that failed or was found (`available`, the window's own name); a newer deploy of the
 * site. A release or a restart loads the newest page too, so it hides a deploy.
 */
export type Update = 'installing' | 'restart' | 'failed' | 'available' | 'deploy';

/**
 * Which update the app has, or null when it has none. Outside the Mac window only a newer deploy is ever found.
 * `reloadsItself` is `useNewBuild`'s option of that name, which holds only while a deploy is the one update.
 */
export function useUpdate({ reloadsItself = true }: { reloadsItself?: boolean } = {}): Update | null {
  const release = useAppUpdate();
  const restart = useNewerBuildInstalled();
  // A deploy reloads the page by itself only while it is the one update: the line offers the release or the restart
  // otherwise, which loads the newest page anyway.
  const deploy = useNewBuild({ reloadsItself: reloadsItself && !release && !restart });
  if (release === 'installing') return 'installing';
  if (restart) return 'restart';
  if (release) return release;
  return deploy ? 'deploy' : null;
}

/**
 * What the update line says for `update`, and its button, if any. In an app (`inApp`) every update that can be taken
 * is "<App> has an update." with Update; in a browser tab, where only a deploy is found, the page has changed, with
 * Reload.
 */
export function updateMessage(appName: string, update: Update, inApp: boolean): { message: string; action: string | null } {
  switch (update) {
    case 'installing':
      return { message: `Updating ${appName}. It restarts once the new version is in place.`, action: null };
    case 'failed':
      return { message: `${appName} could not update.`, action: 'Try again' };
    case 'restart':
    case 'available':
      return { message: `${appName} has an update.`, action: 'Update' };
    case 'deploy':
      return newBuildMessage(appName, inApp);
  }
}

/**
 * Takes `update`: a deploy reloads the page; a release found or failed opens `updateLink(scheme)`, which installs it
 * and restarts the app into it; a newer build installed opens `restartLink(scheme)`. Either restart loads the newest
 * page too. Nothing else is taken.
 */
export function takeUpdate(update: Update, scheme: string): void {
  if (update === 'deploy') window.location.reload();
  else if (update === 'available' || update === 'failed') window.location.href = updateLink(scheme);
  else if (update === 'restart') window.location.href = restartLink(scheme);
}

/**
 * The app's one update line, for an app on the Mac window, in place of `NewBuildLine`: "<App> has an update." with
 * Update for a newer deploy, a release found, a newer build installed or any of them at once, Update doing what that
 * needs (`takeUpdate`); while a release installs, a line saying so; if it failed, Try again. In a browser tab, where
 * only a deploy is found, it is `NewBuildLine`'s "<App> has changed since this page loaded." with Reload. Nothing
 * installs or restarts by itself; a deploy alone reloads by itself as `useNewBuild` says, unless `reloadsItself` is
 * false. `scheme` is the app's own link scheme, the one `Site::scheme` names. An app that draws its own lines uses
 * `useUpdate`, `updateMessage` and `takeUpdate` instead.
 */
export function UpdateLine({ appName, scheme, reloadsItself = true }: { appName: string; scheme: string; reloadsItself?: boolean }) {
  const update = useUpdate({ reloadsItself });
  if (!update) return null;
  const { message, action } = updateMessage(appName, update, isAppWindow());
  return (
    <Box role="status" sx={line}>
      {message}
      {action && (
        <Button size="small" onClick={() => takeUpdate(update, scheme)}>
          {action}
        </Button>
      )}
    </Box>
  );
}
