import { createRoot } from 'react-dom/client';
import { waitForFonts } from '../..';

// A page drawn once its face is in, or after the font wait gives up.
void waitForFonts(['1em "Fixture Face"']).then(() => createRoot(document.getElementById('root')!).render(<p>Drawn in the fixture face</p>));
