# Getter fixes its word buttons in one place, and app-kit fixes its own plain look but exports nothing yet

## Why

Hovering "Purchases" in Getter's header paints a tall gray rounded slab with the word touching both sides. Getter removed a text Button's side padding but kept the hover fill, the rounded corners and the press ripple, and those three only look right with padding. Short words like "Undo" are also under 44 pixels wide on a phone.

The kit's own plain look has the same kind of button with worse faults: on a phone its words are 23 pixels tall, a keyboard user sees nothing when one takes focus, an underline stays on after a tap, and its outlined and filled Buttons have no padding at all, including the Reload on the kit's own crash page. No app uses the plain look's web theme yet, so nobody has hit those.

## The change

Getter changes the one style constant its 27 word buttons already share, so none of them paints a slab. The kit fixes its plain look in place. A shared piece that apps install waits until a second app with its own theme actually moves onto it.

## Decisions

- **Should the kit own this? Its plain look, yes. An exported piece, not yet.** Timescale and Urge Surfer each built their own word button, and it would be tidy to have one. But their versions work, so neither would move, Getter would still be eight minor versions behind, and the piece would land with no app calling it. The owner's rule asks for one shared tool when two products need it, and today none would call this one. The honest case for building it now: three apps already differ and a fourth will come. The Details say what shape it takes when that happens.
- **A word button has a hover state.** This plan first recommended none, and that was wrong. Getter shipped it, the owner rejected it, and Getter now paints a soft fill with room around the word, drawn on a layer that moves nothing. The resting-pointer rule decides when hover paints, never whether a control has a hover state.
- **Yours to decide: which hover state the kit's plain look draws.** It underlines today. Getter's soft fill is the other choice. The `plain-look-buttons` ticket waits on this.
- **Getter kept a shared style constant rather than a theme variant.** That shipped: it edited one place, every word button already read it, and nothing on screen differs between the two. A `variant="word"` is the more correct use of MUI, since MUI's guidance puts a repeated style in a reusable component or the theme and not in `sx`, at the cost of a type declaration, a theme rule and 27 edited lines. It remains open to Getter if that ever matters more than the size of the change.
- **Press: no ripple, and the word dims to 60% while held.** With no hover on a phone, a tap would otherwise show nothing. This is a first pass at a taste call nobody has recorded, and it is easy to take out.
- **Keyboard focus: Getter uses its existing focus ring, and the plain look turns on MUI's own theme focus ring.** MUI's documentation says a Button with no ripple has no focus styling unless you add it, and today Getter's only focus paint is the ripple it is losing.
- **Tap area: at least 44 by 44 on a touch screen.** A word that ends a row can sit up to about 20 pixels in from the right edge on a phone, since the box grows and the word stays at its left. An invisible overlay would avoid that, at the cost of more rules and overlapping neighbors. A run in a windowless iPhone Simulator shows whether it matters.
- **A word inside a sentence stays MUI's `<Link component="button">`.** It sits in running text, so it needs no tap area, and WCAG exempts it. The kit's README says which is which.

## Risk

- **The phone results come from Chromium's touch emulation, not an iPhone,** and WebKit has open bugs about `:active` during scrolling. A windowless iPhone Simulator can check that a tap dims and that a scroll started on a word does not leave it dim; only how it feels on a physical phone needs the owner.
- **Turning on MUI's focus ring in the plain look changes other controls too:** it removes the faint focus fill on rows and menus in favor of the ring, in a look no app uses yet. It needs MUI 9.4; below that the plain look has no focus ring, as today.
- **The rule stays in two places,** the kit's plain look and Getter's constant, plus Timescale's and Urge Surfer's own. That is the cost of not building the piece, and no code keeps them equal.

## Left alone

- Getter's code. Getter's own thread makes that change.
- Timescale and Urge Surfer, which keep their own word buttons.
- The console look and the apps drawn in it (Argon Watcher, AI Buddy, Buddy System, Metamax). They keep a text Button's padding, so their hover fill has room and they have no slab.
- The plain look's Link and the extension stylesheet, which keep their underline on hover. They break the same resting-pointer rule, and changing them is a separate question.
- The kit's `NewBuildLine` and `ErrorBoundary`, which draw ordinary Buttons under whatever theme the app has.

## Done when

You can read in this plan whether the kit should own the button, the evidence from the apps, the shape, and what Getter should do either way. Each ticket below has its own Done when.

## After yes

Getter's fix has shipped (894890f, with its hover state in 6b9043a). Building `plain-look-buttons` waits for your yes to that ticket and your choice of its hover state.

## Details

### Question 1: do other apps have this? Three do, and the kit itself, but only Getter shows a visible bug

Apps on the kit with a web interface, at each checkout's main. Read only.

| Where | How the word is made | Hover | Press | Tap area | Keyboard focus |
|---|---|---|---|---|---|
| Getter, `client/src/layout.ts:34`, 27 sites in 6 files | Button with `sx` | gray slab, measured | ripple, measured | 44 tall always, measured; narrower on short words | ripple's pulse only, measured |
| Kit plain look, `web/theme.ts:95-100`, no app yet | Button, rule on root, all variants | underline, measured, stays after a tap | none, measured | 22.8 tall on a phone, measured | nothing paints, measured |
| Timescale, `client/src/components/horizons/WordButton.tsx`, 6 sites | `<Box component="button">`, no Button | text darkens, gated on hover devices, read | none, read | invisible overlay 12 above and below on touch, about 40, by arithmetic | its own ring, read |
| Urge Surfer, `src/pages/*`, 32 sites of `component="button"`, most on Link | MUI Link | always underlined unless `underline="none"`, read | none | none at most sites, read; some are words inside sentences, which need none | browser's own outline, measured on the same component |

Without the problem, read only: Argon Watcher (`src/theme.ts:189-210` keeps padding, ripple off everywhere, hover paint only after the mouse has moved, its own focus outline; only 2 of 117 Buttons come near a word, with side padding kept), AI Buddy and Buddy System (text Buttons with MUI's padding), Metamax's client (MUI's padding, and an outlined box on the phone). Amazon Connector and Beeline draw no MUI. A search for `lookTheme(` across the projects finds it only in app-kit.

### Measurements

Headless Chromium, a mouse at 800 wide and a touch-emulated phone at 390 wide (`hover: none`, `pointer: coarse`), on MUI 9.5.0. "Getter's theme" is its settings for this: `cssVariables: { nativeColor: true }`, corners 12, ink as primary, its root Button rule. Not committed; run from a scratchpad, and not on Getter's real page.

| | Getter today | Plain look today | Getter's constant, changed | Plain look, changed | `<Link component="button">` |
|---|---|---|---|---|---|
| Space beside the word | 0 | 0 | 0 | 0 | 0 |
| Height and width on a phone, "Undo" | 44 tall | 22.8 tall | 44 by 44 | 44 by 44 | 44 tall, set by hand |
| Hover fill | `oklch(… / 0.04)`, the slab | none | none | none | none |
| Hover underline | no | yes | no | no | yes |
| Ripple on press | yes | no | no | no | no |
| Held opacity | 1 | 1 | 0.6 | 0.6 | 1 |
| Underline after a tap on the phone | no | stays | no | no | stays |
| Keyboard focus, after Tab on a fresh page | ripple's pulse | nothing | 2 pixels solid | 2 pixels solid, on word, outlined, filled and Link | browser's own |
| Disabled | gray, no pointer events | gray | unchanged | unchanged | same as enabled, pointer cursor |

Plain look `<Button variant="outlined">` today measures 45.3 by 24.8 with padding 0, and `contained` 30.4 by 24.8 with padding 0; changed, they pad `5px 15px` and `6px 16px`. The "changed" columns measure this plan's first version, with no hover state; the hover state Getter shipped is not in them. A theme ring in `currentColor` was tried and drew white on a filled Button, so the plain look takes MUI's default, the accent. The plain look's Switch read no outline on its button element in the same check; `plain-look-buttons` must confirm what it paints.

### Question 2: the shape when a second app moves

MUI's customization page names the tiers: `sx` is "the best option for adding style overrides to a single instance", and `styled()` is to "reuse the same overrides in different locations". Getter's shared constant gives the style one owner on the first tier, which answers whether it is using MUI properly: its theme is sound, this one style sits on a lower tier than MUI suggests, and nothing on screen differs.

If an own-theme app moves, build a `word` Button variant passed as `createTheme`'s second argument, the way `fieldsNeverZoom` (`web/fields.ts:24`) is, with its own import name as `app-kit/web/age` has. Checked for that day:

- The type name reaches an app with no setting of its own. TypeScript 7.0.2, strict, against a stand-in package shipping TypeScript sources: an app importing the file holding `declare module '@mui/material/Button' { interface ButtonPropsVariantOverrides { word: true } }` compiles `<Button variant="word">` and still refuses `variant="nope"`; without the import it refuses `word`. A plain look app can use `import type {} from` that file, MUI's own form.
- The style has to be a plain CSS function in a file with no types, and the variant list typed only in the file with the augmentation, or every app importing `app-kit/web` fails to compile.
- MUI's merge replaces arrays, so the piece's list replaces an app's own root `variants`. No app has any today; Argon Watcher's one `variants:` is on its Paper.
- `disableRipple` has no per-variant form, and MUI's v9 upgrade guide says to reach the ripple through `.MuiTouchRipple-*` classes.

### Question 3: what outside guidance says

- MUI's Button page says text buttons "are typically used for less-pronounced actions" and says nothing about padding or hover; the hover fill is in its source (`Button.js:173-176`), gated on `@media (hover: hover)`. Button has no link-like variant (`Button.js:706`).
- MUI's Link page: "If a link doesn't have a meaningful href, it should be rendered using a `<button>` element", with `underline="hover"`.
- MUI's ButtonBase page: "Without a ripple there is no styling for :focus-visible by default". Its focus-visible page, from v9.4: "Set `focusVisible: true` on the theme to render a default focus indicator on every ButtonBase-derived component".
- Hover in other systems, read from each repository's default branch on 2026-11-02: Polaris plain and Primer link underline with no fill, and shadcn's link variant underlines. Chakra's plain changes color only. Radix's ghost keeps a fill and pulls itself into line with a negative margin, which is the alternative Getter's thread weighed and which draws a chip.
- Press: Apple's interface guidelines say "Always include a press state for a custom button", and React Native's TouchableOpacity dims. None of the web link-style buttons read do so, so the dim is a taste call.
- Target size: WCAG 2.2's minimum is 24 by 24, with an exception for a target "in a sentence". Apple asks 44 by 44, as the owner's rule does.

So outside practice leans to the underline, with a fill as the other family. The plan's first version took the owner's rules to rule out the fill and to favor painting nothing; the owner rejected painting nothing, and Getter's soft fill is live.

## plain-look-buttons · The plain look's words get a tap area and a focus ring, and its other Buttons get their padding

Goal: in `web/theme.ts`, move the plain look's word rule from Button's root to its `text` style override, so outlined and filled Buttons keep MUI's padding; add a tap area of at least 44 by 44 on a touch screen and a dim to 60% while held; set the theme's `focusVisible: true`. Hover is the state the owner chooses above, shown only on a device that can hover. `flexShrink` and `whiteSpace` stay on root. `disableRipple` stays a default.

Done when: in the fixture's hidden Chromium, under the plain look, a word shows the chosen hover state, no ripple, a 2 pixel outline after Tab, a dim while held, 44 by 44 on a touch-emulated page and no decoration after a tap; an outlined Button keeps its padding and its outline; the Switch shows something on keyboard focus. `test/theme.test.ts:51-52`, which holds the old rule, moves with it, and the README's look section says a word standing alone is a `Button` and a word in a sentence a `Link`. `scripts/gates.sh` passes. Release: patch.

Do not touch: `NewBuildLine`, `ErrorBoundary`, the console look, the extension stylesheet, Swift, any app.

Needs: the owner's yes to this ticket and their choice of hover state.

Touches: `web/theme.ts`, `test/theme.test.ts`, `web/e2e/look.e2e.ts`, `web/e2e/fixture/look.tsx`, `README.md`.
