import { useEffect } from 'react';

let appName = '';

/** Names the app once, at start, for every title `useTitle` writes: "Inbox · argon-watcher". */
export function nameApp(name: string): void {
  appName = name;
}

/** The page title for a screen: its words, then the app's name, or the app's name alone for a screen with none. */
export function titleFor(words: string | null | undefined): string {
  if (!words) return appName;
  return appName ? `${words} · ${appName}` : words;
}

/**
 * Sets the page title while the screen is shown, and puts back the title it found when the screen goes. One call per
 * screen: a layout around the screens that called it too would run after the screen's call and win.
 */
export function useTitle(words: string | null | undefined): void {
  useEffect(() => {
    const before = document.title;
    document.title = titleFor(words);
    return () => {
      document.title = before;
    };
  }, [words]);
}
