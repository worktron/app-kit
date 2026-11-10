import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { followTextSize } from '../..';
import { Privacy, wrap } from './Privacy';

// The privacy page as the app draws it in the browser, for public-pages.e2e.ts to hold the finished page to.
followTextSize();
createRoot(document.getElementById('root')!).render(<StrictMode>{wrap(<Privacy />)}</StrictMode>);
