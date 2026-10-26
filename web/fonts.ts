/*
 * A browser fetches a font file only when text first uses it, so a first draw goes out in the fallback face and swaps a
 * moment later. Asking for each face first and drawing once they are in keeps the swap off screen. document.fonts.load
 * is the way to ask: WebKit's document.fonts.check() answers true for a face not yet loaded.
 */

/** The longest the first draw waits for the fonts. A slow connection still gets the page after this, in the fallbacks. */
export const FONT_WAIT_MS = 1500;

/**
 * Resolves once every face is loaded, or after `atMostMs`, whichever comes first; never rejects. Each face is a CSS font
 * shorthand naming a weight and family, as `500 1em "Cormorant Variable"`; the size only picks the face. Its
 * `@font-face` must already be in a stylesheet the page has, or there is nothing to load. Draw the app in its `then`,
 * with the page's own HTML showing a wordmark until then, so the page is never blank.
 */
export function waitForFonts(faces: readonly string[], { atMostMs = FONT_WAIT_MS }: { atMostMs?: number } = {}): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  // Every face settles before the draw, so one that fails at once never lets the draw go out while another still loads.
  const loaded = Promise.allSettled(
    faces.map((face) =>
      document.fonts.load(face).then(
        (found) => {
          if (found.length === 0) console.log(`[app-kit] fonts: no @font-face matches ${face}, so nothing waits for it`);
        },
        (error: unknown) => console.log(`[app-kit] fonts: ${face} failed to load, so it draws in its fallback`, error),
      ),
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.log(`[app-kit] fonts: not all in after ${atMostMs} ms, drawing in the fallbacks`);
      resolve();
    }, atMostMs);
  });
  return Promise.race([loaded, late]).then(() => clearTimeout(timer));
}
