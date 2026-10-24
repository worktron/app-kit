/** The parts of `window` and `document` that say the page is in front again, so tests can pass stand-ins. */
export interface PageEvents {
  win: EventTarget;
  doc: EventTarget & { readonly visibilityState: DocumentVisibilityState };
}

const page = (): PageEvents => ({ win: window, doc: document });

/**
 * Calls `onReturn` each time the page comes back in front: restored from the back-forward cache, shown again after
 * being hidden, or given the focus back, as when the sheet a phone's home-screen app opens Google in is closed.
 * Returns the function that stops listening.
 */
export function onPageReturn(onReturn: () => void, { win, doc }: PageEvents = page()): () => void {
  const pageShown = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) onReturn();
  };
  const visibility = () => {
    if (doc.visibilityState === 'visible') onReturn();
  };
  win.addEventListener('pageshow', pageShown);
  win.addEventListener('focus', onReturn);
  doc.addEventListener('visibilitychange', visibility);
  return () => {
    win.removeEventListener('pageshow', pageShown);
    win.removeEventListener('focus', onReturn);
    doc.removeEventListener('visibilitychange', visibility);
  };
}
