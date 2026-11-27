/* What `app-kit play` and `app-kit android run` read from a Tauri app's checkout. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The app's name and package name, from its tauri.conf.json. */
export function readApp(cwd: string): { productName: string; identifier: string } | string {
  const config = join(cwd, 'src-tauri/tauri.conf.json');
  if (!existsSync(config)) return `${cwd} has no src-tauri/tauri.conf.json: run it from a Tauri app's checkout`;
  const { productName, identifier } = JSON.parse(readFileSync(config, 'utf8')) as { productName?: string; identifier?: string };
  if (!productName || !identifier) return `${config} names no productName or identifier`;
  return { productName, identifier };
}

