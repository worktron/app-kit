// A simulated page for the unit tests, made before React loads. A script tag added to it counts as loaded, never run.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const PAGE = { url: 'http://localhost:5173/', settings: { handleDisabledFileLoadingAsSuccess: true } };

/**
 * Bun's own Request, for a test of server code that sends the headers only a browser sets: the simulated page's
 * Request drops `Origin` and `Sec-Fetch-Site`, as a page's script may not set them.
 */
export const ServerRequest = globalThis.Request;

GlobalRegistrator.register(PAGE);

/**
 * For a test of server code, which never runs in a page: the simulated page's Response cannot send a file, as Bun's can.
 * Call it in beforeAll; the returned function puts the page back, for afterAll, since every test file shares one process.
 */
export async function withoutPage(): Promise<() => void> {
  await GlobalRegistrator.unregister();
  return () => GlobalRegistrator.register(PAGE);
}
