import { useEffect } from 'react';

let appName = '';

/** Names the app once, at start, for every title `useTitle` writes: "Inbox · argon-watcher". */
export function nameApp(name: string): void {
  appName = name;
}

/**
 * The title for a screen's words and an app's name: "Inbox · argon-watcher", or either alone when the other is empty.
 * The one format every title takes, the app's own (titleFor) and a finished public page's (public-pages.tsx).
 */
export function titleWith(words: string | null | undefined, name: string): string {
  if (!words) return name;
  return name ? `${words} · ${name}` : words;
}

/** The page title for a screen: its words, then the app's name, or the app's name alone for a screen with none. */
export function titleFor(words: string | null | undefined): string {
  return titleWith(words, appName);
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
