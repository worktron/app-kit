// A page that starts Web Push as an app does at every start: it registers the kit's worker, which the Vite plugin
// serves, and with permission granted tries to subscribe, which a browser with no push service refuses. A start never
// throws, so the page still says it started.
import { startWebPush } from '../..';

const started = document.getElementById('started')!;
void startWebPush({ publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', register: async () => {} }).then(() => {
  started.textContent = 'started';
});
