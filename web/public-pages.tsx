/**
 * An app's public pages (privacy, terms, about) as finished HTML, for readers that run no JavaScript: the Chrome Web
 * Store's check of a privacy link and Google's sign-in verification read the HTML they are sent, and the app's index
 * page holds no words until its code runs. Run once after `vite build`, from the app's own bun script, it renders each
 * page's component into a copy of the built index page, without the app's code, and writes `<name>.html` beside it
 * with the list of pages, which serveBuiltPage reads when told `publicPages: true`.
 *
 * The page keeps everything in the index page's head but the app's code: its stylesheets, so the fonts are the app's,
 * and its small inline scripts, such as the first frame's colors. Emotion, which MUI styles through, writes each
 * component's styles beside it when no page is there to put them in, and a theme with both color schemes writes both,
 * so light and dark follow the browser's setting with no script. One script is added, textSizeScript, so the text
 * keeps the size the person chose.
 */
import { join, relative } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PUBLIC_PAGES_LIST } from './server';
import { textSizeScript } from './text-size';
import { titleWith } from './title';

export interface PublicPage {
  /** Where it is read, one segment under the root, as `/privacy`. */
  address: string;
  /** The page's words for its title, as `useTitle` takes them: "Privacy policy". */
  title: string;
  /** The page's component, as the app draws it at that address. */
  page: ReactNode;
}

export interface PublicPagesOptions {
  /** The folder Vite built, holding index.html. */
  folder: string;
  /** The app's name, as `nameApp` takes it, for each page's title. */
  appName: string;
  pages: PublicPage[];
  /** What the app draws around a page: its theme and CssBaseline, and anything the components read while rendering. */
  wrap?: (page: ReactNode) => ReactNode;
  /**
   * The font files to ask for at the start of the head, by the name the app's stylesheet takes them under, as
   * 'figtree-latin-wght-normal.woff2', so a first visit draws in them rather than in a fallback that swaps.
   */
  fonts?: string[];
  /** CSS of the app's own the page needs that its theme does not write, such as colors it sets from a script. */
  style?: string;
  /** The id of the element the app draws into, `root` unless the app says otherwise. */
  root?: string;
}

const ADDRESS = /^\/[a-z0-9][a-z0-9-]*$/;

/** Writes each page as `<name>.html` in the folder, and the list of them; returns the files written. */
export async function writePublicPages(options: PublicPagesOptions): Promise<string[]> {
  // Emotion decides once, as it loads, whether a page is there to take its styles; with one, they go into it and the
  // file gets none. The kit's own unit tests run in a simulated page, so a test of this runs it in a process of its own.
  if (typeof document !== 'undefined') {
    throw new Error('app-kit public pages: run outside a page, from a plain bun script, or the styles go into that page instead of the file.');
  }
  const { folder, appName, pages, wrap = (page) => page, fonts = [], style, root = 'root' } = options;
  const index = await Bun.file(join(folder, 'index.html')).text();
  const seen = new Set<string>();
  for (const { address } of pages) {
    if (!ADDRESS.test(address) || address === '/index') throw new Error(`app-kit public pages: ${JSON.stringify(address)} is not one lower-case segment under the root, as '/privacy'.`);
    if (seen.has(address)) throw new Error(`app-kit public pages: ${address} is listed twice.`);
    seen.add(address);
  }
  const preloads = await Promise.all(fonts.map((font) => builtFont(folder, font)));
  const head = [
    style ? `<style>${style}</style>` : '',
    `<script>${textSizeScript()}</script>`,
  ].join('');

  const written: string[] = [];
  for (const { address, title, page } of pages) {
    const markup = renderToStaticMarkup(wrap(page));
    if (!words(markup)) throw new Error(`app-kit public pages: ${address} renders no words.`);
    const html = finished(index, { markup, title: titleWith(title, appName), preloads, head, root });
    const file = join(folder, `${address.slice(1)}.html`);
    await Bun.write(file, html);
    written.push(file);
  }
  await Bun.write(join(folder, PUBLIC_PAGES_LIST), `${JSON.stringify(pages.map((page) => page.address))}\n`);
  return written;
}

/** The text a reader sees in rendered markup, with the styles Emotion writes beside it taken out. */
function words(markup: string): string {
  return markup
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** The address a built font file is read at, from the name the app's stylesheet takes it under. */
async function builtFont(folder: string, font: string): Promise<string> {
  if (!/^[^/\\]+\.woff2$/.test(font)) throw new Error(`app-kit public pages: ${JSON.stringify(font)} is not a woff2 file's name, as 'figtree-latin-wght-normal.woff2'.`);
  const stem = font.slice(0, -'.woff2'.length);
  // Vite names a built file after its source and what it holds: figtree-latin-wght-normal-B6Ywmhx1.woff2.
  const named = new RegExp(`(^|/)${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-[A-Za-z0-9_-]{8})?\\.woff2$`);
  for await (const path of new Bun.Glob('**/*.woff2').scan({ cwd: folder })) {
    if (named.test(path)) return `/${relative('.', path)}`;
  }
  throw new Error(`app-kit public pages: the build has no font file ${font}. Name a woff2 the app's stylesheet uses.`);
}

const remove = (element: HTMLRewriterTypes.Element) => {
  element.remove();
};

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The index page with the page's markup in the app's element, its title, and none of the app's code. */
function finished(index: string, page: { markup: string; title: string; preloads: string[]; head: string; root: string }): string {
  let titled = false;
  let rooted = false;
  const result = new HTMLRewriter()
    // The app's code, and what asks for it early. Inline scripts stay: they are the page's own, run before it draws.
    .on('script[src]', { element: remove })
    .on('script[type="module"]', { element: remove })
    .on('link[rel="modulepreload"]', { element: remove })
    .on('title', {
      element: (element) => {
        titled = true;
        element.setInnerContent(escapeText(page.title));
      },
    })
    .on(`#${page.root}`, {
      element: (element) => {
        rooted = true;
        element.setInnerContent(page.markup, { html: true });
      },
    })
    .on('head', {
      element: (element) => {
        // The fonts first, so they are asked for before anything else, with the bare crossorigin a font's own fetch
        // uses, or the browser fetches each twice.
        for (const href of [...page.preloads].reverse()) {
          element.prepend(`<link rel="preload" as="font" type="font/woff2" href="${href}" crossorigin>`, { html: true });
        }
        element.onEndTag((end) => {
          end.before(`${titled ? '' : `<title>${escapeText(page.title)}</title>`}${page.head}`, { html: true });
        });
      },
    })
    .transform(index);
  if (!rooted) throw new Error(`app-kit public pages: the built index.html has no element with the id ${page.root}.`);
  return result;
}
