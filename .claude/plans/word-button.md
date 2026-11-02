# App-kit should own the button that reads as words, as one small theme piece, and Getter should fix its own now

## Why

Hovering "Purchases" in Getter's header paints a tall gray rounded slab with the word touching both sides. Getter removed a text Button's side padding but kept the hover fill, the rounded corners and the press ripple, and those three only look right with padding.

Getter is not alone in wanting this button. Three apps built their own, each with a different gap, and the kit's own plain look has the same idea with three faults of its own: on a phone its words are 23 pixels tall against the 44 the owner's rules ask for, a keyboard user sees nothing when one takes focus, and an underline stays on after a tap. No app uses the plain look's web theme yet, so nobody has hit those.

## The change

The kit gets one rule for a word button, which its plain look draws by default and any app with its own theme adopts in one line, as `<Button variant="word">`. Getter fixes its slab now with the same rule written locally and the same name, and drops the local copy whenever it next upgrades the kit.

## Decisions

- **The kit owns it, as a theme piece and a Button variant.** The alternatives are a `WordButton` component, and nothing. A component gives an app no way to set one size for all its word buttons from the theme, and needs its own typing for rendering as a link. Nothing would leave the plain look's faults in place and the rule in three copies. The honest case for nothing: only Getter shows a visible bug today, and Timescale and Urge Surfer work.
- **Hover: an underline, only on a device that can hover, and no fill.** This is what the kit's plain look and its extension stylesheet already do, and what MUI's own Link does. The other family of design systems keeps a fill and pulls the button back into line with negative margins (Radix's ghost button). That draws a chip on hover, which the owner's rules rule out, and needs the margins everywhere.
- **Press: the ripple off, and the word dims to 60% while held.** With no hover on a phone and no ripple, a tap would otherwise show nothing at all. This is a first pass at a taste call nobody has recorded, and it is easy to take out.
- **Keyboard focus: a 2 pixel outline in the word's own color.** MUI's documentation says a Button with no ripple has no focus styling unless you add it, and the measurement below shows exactly that in the plain look.
- **Tap area: at least 44 pixels on a touch screen, nothing added with a mouse.** An app that wants 44 everywhere, as Getter does for its row alignment, says so in the piece's one argument.
- **Size, weight and color stay the app's.** The piece sets none of them: color comes from Button's `color` prop or `sx`, size and weight from the piece's argument.
- **A word inside a sentence stays MUI's `<Link component="button">`.** It needs no tap area, since it sits in running text, and WCAG exempts it. The kit's README says which is which.
- **In the plain look, the rule moves from every Button to the `word` variant, and `word` becomes the default.** Today a plain look `<Button variant="outlined">`, which the kit's own crash page draws, has no padding at all.
- **Yours to decide: Getter fixes now with a local copy, or waits for the kit.** I recommend now. Getter is on kit v0.25.0 and the kit is at v0.33.2, so waiting ties a small visible fix to an upgrade across eight minor versions whose cost nobody has measured. The honest case for waiting: the rule never has two owners, even for a while.
- **Yours to decide: no app is made to move.** I recommend Timescale and Urge Surfer take it only when they next touch those buttons. Their versions work, and a sweep of 6 and 32 sites buys little.

## Risk

- **An app has its own `variants` list on Button's root.** The piece's list replaces it, since MUI's merge replaces arrays. No app does this today (checked by search; Argon Watcher's one `variants:` in its theme file was not read further). The README says so, as a limit the kit accepts.
- **The variant's type name reaches an app only through the piece's own import.** That is deliberate: if it came with every `app-kit/web` import, `variant="word"` would compile in an app that never installed the rule and draw a plain padded Button. This needs two small files, so the plain look can read the rule without carrying the type.
- **The ripple is hidden by CSS rather than turned off.** A theme's default props cannot differ by variant. MUI's ripple code still runs and paints nothing, which the measurement confirms.
- **A word in a list under a resting pointer still underlines,** which the owner's rule about hover paint under a still pointer forbids. CSS cannot tell a resting pointer from a moving one. Argon Watcher's input mode tracker can, and the `resting-hover` ticket below brings it to the kit. Until then this stays a known break of that rule, the smallest paint there is: no shape, nothing moves.
- **The phone results come from Chromium's touch emulation, not an iPhone.** The owner's rules say a browser run does not prove the phone. Getter's iPhone app is the check, and the owner's look is part of that ticket's Done when.

## Left alone

- Getter's code. Getter's own thread makes that change.
- The console look, and the apps drawn in it (Argon Watcher, AI Buddy, Buddy System, Metamax). They keep a text Button's padding, so their hover fill has room and they have no slab.
- The kit's `NewBuildLine` and `ErrorBoundary`, which draw ordinary Buttons under whatever theme the app has.
- The extension stylesheet and the Swift pieces. They already have their own action word and draw no MUI.

## Done when

This investigation is done when this plan says whether the kit should own the button, with the evidence, the recommended shape, and what Getter should do either way. It does, below. Each ticket has its own Done when.

## After yes

Your go lands this file on main and tells [ui](metamax://thread/getter/ui) the answer, so Getter's thread can proceed with `getter-words`. Building `word-button` and `resting-hover` waits for your yes to each; nothing is built by landing this.

## Details

### Question 1: do other apps have this? Yes, three, and the kit itself

Apps on the kit with a web interface, at each checkout's main. Read only.

| Where | How the word is made | Hover | Press | Tap area | Keyboard focus |
|---|---|---|---|---|---|
| Getter, `client/src/layout.ts:34`, 27 sites in 6 files | Button with `sx` | gray slab, measured | ripple, measured | 44 always, measured | ripple's pulse only, measured |
| Kit plain look, `web/theme.ts:95-100`, no app yet | Button, rule on root, all variants | underline, measured, stays after a tap | none, measured | 22.8 pixels on a phone, measured | nothing paints, measured |
| Timescale, `client/src/components/horizons/WordButton.tsx`, 6 sites | `<Box component="button">`, no Button | text darkens, gated on hover devices, read | none, read | invisible overlay 12 above and below on touch, about 40 pixels, read | its own ring, read |
| Urge Surfer, `src/pages/*`, 32 sites of `component="button"`, most on Link | MUI Link | always underlined unless `underline="none"`, read | none | none at most sites, read; some are words inside sentences, which need none | browser's own outline, measured on the same component |

Without the problem, read only: Argon Watcher (`src/theme.ts:189-210` keeps padding, ripple off everywhere, hover paint only after the mouse has moved, its own focus outline; only 2 of 117 Buttons come near a word, with side padding kept), AI Buddy and Buddy System (text Buttons with MUI's padding), Metamax's client (MUI's padding, and an outlined box on the phone). Amazon Connector and Beeline draw no MUI. Timescale's own overlay covers about 40 pixels by arithmetic (a 13 pixel word of about 16 plus 24); that was not measured.

### Measurements

Headless Chromium, a mouse at 800 wide and a touch-emulated phone at 390 wide (`hover: none`, `pointer: coarse`), on MUI 9.5.0. "Getter's theme" is its settings for this: `cssVariables: { nativeColor: true }`, corners 12, ink as primary, its root Button rule. Not committed; run from a scratchpad.

| | Getter today | Plain look | Candidate `word` variant | `<Link component="button">` |
|---|---|---|---|---|
| Space beside the word | 0 | 0 | 0 | 0 |
| Height, mouse / phone | 44 / 44 | 22.8 / 22.8 | 22.8 / 44 | 44 / 44 (set by hand) |
| Hover fill | `oklch(… / 0.04)`, the slab | none | none | none |
| Hover underline | no | yes | yes | yes |
| Ripple on press | yes | no | no | no |
| Underline after a tap on the phone | no | stays | no | stays |
| Keyboard focus, after Tab on a fresh page | ripple's pulse, no outline | no outline, no ripple | 2 pixels solid | browser's own |
| Disabled | gray, no pointer events | gray, no pointer events | gray, no pointer events | same as enabled, pointer cursor, though the browser refuses the click |

A plain look `<Button variant="outlined">` measures 45.3 by 24.8 with padding 0, and `contained` 30.4 by 24.8 with padding 0. The candidate under Getter's theme, passed as `createTheme`'s second argument: no page errors; `color="error"` draws red; `href` renders an `<a>`; `sx` color wins; `fontSize` and `minHeight` from the argument apply; a default Button keeps `6px 8px` and a contained one `6px 16px`; the app's root `fontWeight` survives; while held, opacity reads 0.6.

### Type reach

TypeScript 7.0.2, strict, against a stand-in package in `node_modules` shipping TypeScript sources as the kit does, with `declare module '@mui/material/Button' { interface ButtonPropsVariantOverrides { word: true } }` in the file exporting the piece. An app importing the piece compiles `<Button variant="word">`, and `variant="nope"` is still refused. The same app without the import is refused `variant="word"`. So the name reaches an app with no setting of its own, through the import that installs the rule.

### Question 2: why this shape

MUI's customization page names the tiers: `sx` is "the best option for adding style overrides to a single instance", and `styled()` is to "reuse the same overrides in different locations". Getter uses the first for what is the second or third, which answers whether it is using MUI properly: its theme is sound, this one style sits on the wrong tier. MUI's theme components page gives the custom variant through `styleOverrides.root.variants` and the augmentation above; it does not say where a library should put the augmentation, so the type result above is ours to hold in a test.

The kit precedent is `fieldsNeverZoom` (`web/fields.ts:24`), passed the same way, and `app-kit/web/age` for a piece with its own import name. `lookTheme`'s own merge (`web/theme.ts:15`) takes the piece too, for a console app that wants it.

The sketch, as measured:

```ts
export const wordButtons = (style = {}) => ({ MuiButton: { styleOverrides: { root: { variants: [{ props: { variant: 'word' }, style: {
  padding: 0, minWidth: 0, color: 'var(--variant-textColor)', backgroundColor: 'transparent', justifyContent: 'flex-start', textAlign: 'left',
  '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
  '@media (pointer: coarse)': { minHeight: 44 },
  '&:active': { opacity: 0.6 },
  '& .MuiTouchRipple-root': { display: 'none' },
  '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: 2 },
  ...style,
} }] } } } })
```

An app adopts it as `createTheme(appTheme, { components: { ...fieldsNeverZoom, ...wordButtons({ fontSize: rem(13), minHeight: 44 }) } })`, then `<Button variant="word">`.

### Question 3: what outside guidance says

- MUI's Button page says text buttons "are typically used for less-pronounced actions" and says nothing about padding or hover; the hover fill is in its source (`Button.js:173-176`), gated on `@media (hover: hover)`.
- MUI's Link page: "If a link doesn't have a meaningful href, it should be rendered using a `<button>` element", with `underline="hover"`. MUI itself offers the underline family, on a different component.
- MUI's ButtonBase page: "Without a ripple there is no styling for :focus-visible by default", and says to style `.Mui-focusVisible`.
- Radix Themes' ghost button: "Ghost buttons behave like text in layout, as they use a negative margin", and keeps its padding on hover. This is the alternative Getter's thread weighed.
- shadcn/ui's `link` variant and XRPL's tertiary button are text with an underline on hover. Primer has `invisible`, and a `link` variant it does not describe. These came from a search, not from reading each system's source. Polaris and Apple's pages could not be read; Material's own specification page returned no content.
- WCAG 2.2 target size minimum: 24 by 24 pixels, with an exception for a target "in a sentence". The owner's 44 is stricter, so it holds for words that stand alone.

So nothing outside points against this. MUI's standard Button points to a fill, which needs padding; MUI's Link, and the owner's rule of plain text instead of chips, point to the underline.

## word-button · The kit's one rule for a Button that reads as words, and the plain look's faults fixed

Goal: a Button that reads as words has one rule in the kit, as the Details above sketch it. It is the `word` variant, exported as `wordButtons(style)` from its own import name `app-kit/web/word-button`, which also carries the variant's type name. The plain look moves its rule from Button's root onto that variant and makes `word` its default, so outlined and contained Buttons get their padding back. The rule is free of the type declaration, in a file of its own that `web/theme.ts` reads, so `app-kit/web` does not carry the name.

Done when: under the plain look and under a stand-in app theme, in the fixture's hidden Chromium, a word button has no fill on hover and an underline; no ripple; 44 tall on a touch-emulated page; no underline left after a tap; a 2 pixel outline after Tab; a dimmed state while held; and an outlined Button keeps its padding. A type test compiles `variant="word"` with the import and refuses it without. `test/theme.test.ts:51-52`, which holds the old root rule, moves with it, and the README's look section says which of word button and Link goes where, and that the piece replaces an app's own root `variants`. `scripts/gates.sh` passes. Release: minor.

Do not touch: `NewBuildLine`, `ErrorBoundary`, the console look, the extension stylesheet, Swift, any app.

Needs: the owner's yes to this ticket.

Touches: `web/theme.ts`, new `web/word-button.ts` and the rule's file, `package.json` exports, `test/theme.test.ts`, `test/exports.test.ts`, a new unit test, `web/e2e/look.e2e.ts`, `web/e2e/fixture/look.tsx`, `README.md`, `AGENTS.md`'s layout line.

## getter-words · Getter's word buttons stop painting a slab

Goal: in Getter's own repository, on Getter's thread. Move the `wordButton` and `act` styling from `sx` onto a `word` Button variant in Getter's theme, with the rule above written locally and its type declared locally, `fontSize: rem(13)`, `fontWeight: 500` and `minHeight: 44` in it, and the 27 sites taking `variant="word"`. Color overrides at a site stay as `sx`. Use Getter's own `focusRing` values for the outline, since removing the ripple removes the only focus paint those buttons have today. Whether to do this now or wait for `word-button` is the owner's decision above; if it waits, the same steps with the kit's piece in place of the local rule, after upgrading from v0.25.0.

Done when: hovering "Purchases" shows the word, underlined, with no fill, in a headless browser test that also holds 44 tall, no ripple and a visible focus outline; `client/src/theme/controls.test.tsx` draws the variant; and the owner has looked at it on the iPhone.

Do not touch: app-kit; Getter's two `ButtonBase` rows in `client/src/ResearchLines.tsx`; Getter's filled and outlined Buttons.

Needs: the owner's choice of Getter's two buttons of timing above, and their look at the iPhone.

Touches: Getter `client/src/theme/index.ts`, `client/src/layout.ts`, and the 27 sites in `App.tsx`, `ReadingBlock.tsx`, `Purchases.tsx`, `AddNeed.tsx`, `NeedRow.tsx`, `ResearchLines.tsx`.

## resting-hover · Hover paint is off while the pointer rests, for every web app on the kit

Goal: the owner's interface rule says hover paint is off while the pointer rests, and CSS alone cannot do that. Argon Watcher already can: `src/lib/inputMode.ts` writes `data-input-mode` on the page's root from real pointer movement, and its theme gates every hover rule on it. Bring that to `app-kit/web` as one hook, compare its 4 pixel movement threshold against the rule's 16 pixels and hold, and have the plain look's hover rules, the word button's among them, read it. Offered, not recommended for now: it matters most in lists, and no app has asked for it.

Done when: in the fixture's hidden Chromium, a word button appearing under a still pointer paints no underline, and one the pointer has moved onto does; a tap does not claim mouse mode.

Do not touch: Argon Watcher, which keeps its own until it chooses to move.

Needs: the owner's yes to this ticket, after `word-button`.

Touches: new `web/input-mode.ts`, `web/index.ts`, `web/theme.ts`, the word rule, `README.md`, a unit test and `web/e2e/`.
