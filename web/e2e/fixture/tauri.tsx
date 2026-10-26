import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { standInSignIn } from '../../../authentication/stand-in';
import { desktopSignInAddress, listenForDesktopSignIn, useDesktopSignInWindow } from '../../../tauri/sign-in';
import { startIphoneNotifications } from '../../../tauri/iphone-notifications';
import { signInInSheet } from '../../../tauri/iphone-sign-in';

// A page run as a Tauri app's, with the kit's real page halves of desktop sign-in, iPhone notifications and iPhone
// sign-in, for the Tauri steps' browser test: the shell's bridge is the steps' stand-in, and the page prints what each
// half did.

const provider = standInSignIn({ store: sessionStorage });
listenForDesktopSignIn();

let registered = 'none';
const opened: string[] = [];
let redraw = () => {};
startIphoneNotifications({
  register: async (device) => {
    registered = `${device.environment} ${device.token.slice(0, 8)}`;
    redraw();
  },
  open: (page) => {
    opened.push(page);
    redraw();
  },
});

function App() {
  const session = provider.useSession();
  const window_ = useDesktopSignInWindow(session);
  const [, setDraws] = useState(0);
  redraw = () => setDraws((n) => n + 1);
  return (
    <main>
      <p>Signed in as {session.person?.email ?? 'nobody'}</p>
      <p>Window {window_.state === 'failed' ? `failed: ${window_.message}` : window_.state}</p>
      <p>Registered {registered}</p>
      <p>Opened {opened.join(', ') || 'nothing'}</p>
      <button onClick={() => void window.open(desktopSignInAddress(null))}>Continue with Google in the Mac app</button>
      <button onClick={() => void signInInSheet(desktopSignInAddress(null), { scheme: 'com.example.app' })}>Continue with Google in the iPhone app</button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <provider.Root>
    <App />
  </provider.Root>,
);
