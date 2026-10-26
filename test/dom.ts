// A simulated page for the unit tests, made before React loads. A script tag added to it counts as loaded, never run.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const PAGE = { url: 'http://localhost:5173/', settings: { handleDisabledFileLoadingAsSuccess: true } };

GlobalRegistrator.register(PAGE);

/**
 * For a test of server code, which never runs in a page: the simulated page's Response cannot send a file, as Bun's can.
 * Call it in beforeAll; the returned function puts the page back, for afterAll, since every test file shares one process.
 */
export async function withoutPage(): Promise<() => void> {
  await GlobalRegistrator.unregister();
  return () => GlobalRegistrator.register(PAGE);
}
