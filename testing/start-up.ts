// The test start-up file every project names in bunfig.toml's preload, as `app-kit/testing/start-up`: every `bun test`
// process keeps its temporary files in /tmp/<project>-tests/<pid>, outside the system temporary folder, which slows
// every process started in it as it fills. <project> is the name in package.json where the tests run, or the folder's
// name when it has none. temporary-folder.ts does the work, which the kit's browser tests share.
import { testsFolder, useOwnFolder } from './temporary-folder';

export { folderProblem, projectName, sweepEnded } from './temporary-folder';

useOwnFolder(testsFolder(process.cwd()));
