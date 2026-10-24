// A simulated page for the unit tests, made before React loads. A script tag added to it counts as loaded, never run.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5173/', settings: { handleDisabledFileLoadingAsSuccess: true } });
