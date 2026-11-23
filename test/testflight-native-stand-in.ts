// The native upload's stand-ins: an Apple TV app's checkout laid out as Lifeform's tvos/ folder is (its names made up),
// and XcodeGen, xcodebuild's archive and export, and the keychain calls the upload makes, answering as their real
// counterparts do. 1Password, openssl, codesign and altool are the Tauri path's stand-ins (testflight-apple-stand-in.ts).
// Shared by the native upload's tests and by testflight-native-child.ts, which the tests run as a process of its own to
// stop it.
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../command-line/run.ts';
import { apple, plist, png, type Apple } from './testflight-apple-stand-in.ts';
import { commit, exit, git, ok, repository, type StandInBuild } from './testflight-stand-in.ts';

export const TV_BUNDLE_ID = 'com.example.couch.tv';
export const TV_TARGET = 'CouchTV';
/** The keychain already on the user's list, which the upload keeps there: the system's, so no home folder is named. */
export const LISTED_KEYCHAIN = '/Library/Keychains/System.keychain';

/** project.yml as Lifeform's Apple TV app writes it, cut to what the upload reads; `info` adds to the app's Info.plist. */
export const projectYml = (info = '        CFBundleVersion: $(CURRENT_PROJECT_VERSION)\n        CFBundleShortVersionString: $(MARKETING_VERSION)\n') => `name: Couch
options:
  bundleIdPrefix: com.example
  deploymentTarget:
    tvOS: "18.0"
settings:
  base:
    MARKETING_VERSION: "0.1.0"
    CURRENT_PROJECT_VERSION: "1"
targets:
  ${TV_TARGET}:
    type: application
    platform: tvOS
    sources:
      - path: ${TV_TARGET}
      - path: Icon.xcassets
        optional: true
        buildPhase: resources
    info:
      path: ${TV_TARGET}/Info.plist
      properties:
        ITSAppUsesNonExemptEncryption: false
${info}    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${TV_BUNDLE_ID}
        ASSETCATALOG_COMPILER_APPICON_NAME: "App Icon & Top Shelf Image"
  ${TV_TARGET}Tests:
    type: bundle.unit-test
    platform: tvOS
    sources:
      - path: ${TV_TARGET}Tests
  ${TV_TARGET}UITests:
    type: bundle.ui-testing
    platform: tvOS
    sources: ${TV_TARGET}UITests
`;

/** The Xcode project XcodeGen writes for it, cut to the app's and the unit tests' targets and their configurations. */
export const TV_PROJECT_FILE = 'Couch.xcodeproj/project.pbxproj';
export const TV_PROJECT = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objectVersion = 77;
	objects = {

/* Begin PBXNativeTarget section */
		T1 /* ${TV_TARGET} */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = L1 /* Build configuration list for PBXNativeTarget "${TV_TARGET}" */;
			name = ${TV_TARGET};
			productType = "com.apple.product-type.application";
		};
		T2 /* ${TV_TARGET}Tests */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = L2 /* Build configuration list for PBXNativeTarget "${TV_TARGET}Tests" */;
			name = ${TV_TARGET}Tests;
			productType = "com.apple.product-type.bundle.unit-test";
		};
/* End PBXNativeTarget section */

/* Begin XCBuildConfiguration section */
		C1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = ${TV_BUNDLE_ID};
				SDKROOT = appletvos;
			};
			name = Debug;
		};
		C2 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = ${TV_BUNDLE_ID};
				SDKROOT = appletvos;
			};
			name = Release;
		};
		C3 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = ${TV_BUNDLE_ID}.tests;
			};
			name = Debug;
		};
		C4 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = ${TV_BUNDLE_ID}.tests;
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		L1 /* Build configuration list for PBXNativeTarget "${TV_TARGET}" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				C1 /* Debug */,
				C2 /* Release */,
			);
			defaultConfigurationName = Release;
		};
		L2 /* Build configuration list for PBXNativeTarget "${TV_TARGET}Tests" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				C3 /* Debug */,
				C4 /* Release */,
			);
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
}
`;

/** A 2 by 2 picture in colour with an alpha channel, at `opacity` everywhere. */
const layer = (opacity: number) => png(6, [[9, 9, 9, opacity], [9, 9, 9, opacity], [9, 9, 9, opacity], [9, 9, 9, opacity]]);

/**
 * Writes the Apple TV icon catalog as Lifeform's icon script draws it: brand assets whose App Store image stack has a
 * Front layer and a Back layer, the front see-through around its picture and the back opaque, unless told otherwise.
 */
export function drawTvIcons(folder: string, { front = 0, back = 255, appStore = true }: { front?: number; back?: number; appStore?: boolean } = {}) {
  const brand = join(folder, 'Icon.xcassets/App Icon & Top Shelf Image.brandassets');
  const write = (path: string, contents: object) => {
    mkdirSync(join(brand, path), { recursive: true });
    writeFileSync(join(brand, path, 'Contents.json'), JSON.stringify({ ...contents, info: { author: 'xcode', version: 1 } }));
  };
  write('', {
    assets: [
      ...(appStore ? [{ filename: 'App Icon - App Store.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '1280x768' }] : []),
      { filename: 'App Icon.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '400x240' },
    ],
  });
  for (const stack of ['App Icon - App Store.imagestack', 'App Icon.imagestack']) {
    write(stack, { layers: [{ filename: 'Front.imagestacklayer' }, { filename: 'Back.imagestacklayer' }] });
    for (const [name, opacity] of [['Front', front], ['Back', back]] as const) {
      write(`${stack}/${name}.imagestacklayer`, {});
      write(`${stack}/${name}.imagestacklayer/Content.imageset`, { images: [{ filename: '1x.png', idiom: 'tv', scale: '1x' }] });
      writeFileSync(join(brand, stack, `${name}.imagestacklayer/Content.imageset/1x.png`), layer(opacity));
    }
  }
}

/** An Apple TV app's origin with main two commits long, its clone checked out at main. */
export function tvFixture(folder: string, files: Record<string, string> = {}) {
  const origin = repository(join(folder, 'origin'), {
    'project.yml': projectYml(),
    [`${TV_TARGET}/App.swift`]: 'import SwiftUI\n',
    [`${TV_TARGET}Tests/AppTests.swift`]: 'import XCTest\n',
    'README.md': '# Couch on the TV\n',
    '.gitignore': `Couch.xcodeproj/\n${TV_TARGET}/Info.plist\nIcon.xcassets/\nnode_modules/\n`,
    ...files,
  });
  commit(origin, { [`${TV_TARGET}/Home.swift`]: 'import SwiftUI\n' }, 'the home screen');
  const app = join(folder, 'app');
  git(folder, 'clone', '-q', `file://${origin}`, app);
  return { origin, app };
}

export type Tv = Apple & {
  /** What XcodeGen writes as the app's CFBundleVersion: the build setting, unless the project fixes a number. */
  bundleVersion?: string;
  /** The icons the step before XcodeGen draws; none when false. */
  icons?: Parameters<typeof drawTvIcons>[1] | false;
  /** Whether xcodegen is on PATH. */
  xcodegen?: boolean;
  /** Whether XcodeGen also changes a committed file. */
  writesCommitted?: string;
  /** Where the archive's app says it is from, when not the app's own bundle id. */
  bundleId?: string;
  /** The archive hangs, printing a line with the marker, which also names the hanging process. */
  hangArchive?: string;
};

/** XcodeGen, xcodebuild and the keychain as the native upload meets them, beside the Tauri path's 1Password, codesign and altool. */
export function tv(app: string, builds: StandInBuild[], options: Tv = {}) {
  const base = apple(app, builds, { ...options, hang: undefined });
  /** What the build saw: the generated project and the export settings as each was handed to xcodebuild. */
  const during: { project?: string; exportOptions?: string; tools?: Record<string, string> } = {};
  /** The keychains on the user's list, as `security list-keychains` keeps it. */
  const keychains = [LISTED_KEYCHAIN];
  const run: typeof base.run = async (command, runOptions = {}) => {
    const cwd = runOptions.cwd ?? app;
    const answer = (result: Awaited<ReturnType<typeof base.run>>) => {
      base.calls.push({ command, options: runOptions });
      if (result.stdout) runOptions.output?.(result.stdout, 'stdout');
      if (result.stderr) runOptions.output?.(result.stderr, 'stderr');
      return result;
    };
    if (command[0] === 'xcodegen') {
      if (options.xcodegen === false) return answer(exit(127, 'xcodegen: command not found'));
      if (command[1] === '--version') return answer(ok('Version: 2.46.0\n'));
      mkdirSync(join(cwd, 'Couch.xcodeproj'), { recursive: true });
      writeFileSync(join(cwd, TV_PROJECT_FILE), TV_PROJECT);
      writeFileSync(join(cwd, TV_TARGET, 'Info.plist'), plist(`\t<key>CFBundleVersion</key>\n\t<string>${options.bundleVersion ?? '$(CURRENT_PROJECT_VERSION)'}</string>\n`));
      // The step before the generate draws the icons afresh, or, in a project without one, nothing is there.
      rmSync(join(cwd, 'Icon.xcassets'), { recursive: true, force: true });
      if (options.icons !== false) drawTvIcons(cwd, options.icons);
      if (options.writesCommitted) writeFileSync(join(cwd, options.writesCommitted), 'rewritten\n');
      return answer(ok('Loaded project\nCreated project at Couch.xcodeproj\n'));
    }
    if (command[0] === '/usr/bin/security' && command[1] !== 'find-generic-password') {
      const [, verb, ...rest] = command;
      if (verb === 'list-keychains' && !rest.includes('-s')) return answer(ok(keychains.map((path) => `    "${path}"\n`).join('')));
      if (verb === 'list-keychains') keychains.splice(0, keychains.length, ...rest.slice(rest.indexOf('-s') + 1));
      if (verb === 'create-keychain') writeFileSync(rest.at(-1)!, 'a keychain holding the private key');
      return answer(ok());
    }
    if (command[0] === 'xcodebuild' && command[1] === 'archive') {
      during.project = readFileSync(join(cwd, TV_PROJECT_FILE), 'utf8');
      // The folder first on the build's PATH, with where each of its links goes.
      const tools = runOptions.env?.PATH?.split(':')[0] ?? '';
      during.tools = Object.fromEntries(readdirSync(tools).map((name) => [name, readlinkSync(join(tools, name))]));
      const archive = command[command.indexOf('-archivePath') + 1]!;
      const derived = command[command.indexOf('-derivedDataPath') + 1]!;
      if (options.hangArchive) return runCommand(['sh', '-c', `echo "[stand-in] hanging ${options.hangArchive}"; while :; do sleep 1; done # ${options.hangArchive}`], runOptions);
      if (options.build === 'compile') return answer(exit(65, `${cwd}/${TV_TARGET}/Home.swift:3:5: error: cannot find 'x' in scope\n** ARCHIVE FAILED **\n`));
      const number = command.find((argument) => argument.startsWith('CURRENT_PROJECT_VERSION='))!.split('=')[1]!;
      for (const where of [join(archive, 'Products/Applications'), join(derived, 'Build/Intermediates.noindex/ArchiveIntermediates/Couch/InstallationBuildProductsLocation/Applications')]) {
        mkdirSync(join(where, `${TV_TARGET}.app`), { recursive: true });
        writeFileSync(join(where, `${TV_TARGET}.app/number`), number);
      }
      return answer(ok('** ARCHIVE SUCCEEDED **\n'));
    }
    if (command[0] === 'xcodebuild' && command[1] === '-exportArchive') {
      const archive = command[command.indexOf('-archivePath') + 1]!;
      const exportPath = command[command.indexOf('-exportPath') + 1]!;
      during.exportOptions = readFileSync(command[command.indexOf('-exportOptionsPlist') + 1]!, 'utf8');
      const number = readFileSync(join(archive, `Products/Applications/${TV_TARGET}.app/number`), 'utf8');
      const stage = join(exportPath, '..', 'stage');
      const payload = join(stage, `Payload/${TV_TARGET}.app`);
      mkdirSync(payload, { recursive: true });
      const encryption = options.encryption === false ? '' : '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n';
      writeFileSync(
        join(payload, 'Info.plist'),
        plist(`\t<key>CFBundleIdentifier</key>\n\t<string>${options.bundleId ?? TV_BUNDLE_ID}</string>\n\t<key>CFBundleVersion</key>\n\t<string>${number}</string>\n${encryption}`),
      );
      mkdirSync(exportPath, { recursive: true });
      const zipped = Bun.spawnSync(['zip', '-qr', join(exportPath, `${TV_TARGET}.ipa`), 'Payload'], { cwd: stage });
      rmSync(stage, { recursive: true, force: true });
      if (zipped.exitCode !== 0) return answer(exit(1, 'zip failed'));
      return answer(ok('** EXPORT SUCCEEDED **\n'));
    }
    return base.run(command, runOptions);
  };
  return { ...base, run, during, keychains, exists: (path: string) => existsSync(path) };
}
