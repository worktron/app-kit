/*
 * iPhone Safari zooms the page into a text field set under 16 pixels as it takes focus, and leaves it zoomed after.
 * followTextSize scales the root font size down to about 0.82 at the smallest Text Size, so a field sized 1rem falls to
 * about 13 pixels there. A field's size is the larger of 16 pixels and the root size, so it never zooms and still grows
 * with a larger Text Size.
 */

/** A text field's font size: 16 pixels, or the Text Size's root size where that is larger. */
export const FIELD_FONT_SIZE = 'max(16px, 1rem)';

/**
 * A size given in pixels at the browser's default root size of 16, as rem, so it follows the phone's Text Size. For a
 * size written while a theme is being made, where MUI's `theme.typography.pxToRem` does not exist yet.
 */
export function rem(px: number): string {
  return `${px / 16}rem`;
}

/**
 * MUI's text fields at FIELD_FONT_SIZE, every one built on InputBase: TextField, Select, Autocomplete. Pass it as
 * createTheme's second argument, `createTheme(appTheme, { components: fieldsNeverZoom })`, which merges it into the
 * app's own `MuiInputBase` settings rather than replacing them, or spread it into lookTheme's components. An outlined
 * field and its label take the size on two-class rules, so the plain look's smaller outlined size gives way to it, and
 * so does an app's own `MuiOutlinedInput` written after it; the label stays the field's size, so it still rests where
 * the text starts and rises into the gap in the top line. A size the app sets on the input slot overrides it.
 */
export const fieldsNeverZoom = {
  MuiInputBase: { styleOverrides: { root: { fontSize: FIELD_FONT_SIZE, '&.MuiOutlinedInput-root': { fontSize: FIELD_FONT_SIZE } } } },
  MuiFormControl: { styleOverrides: { root: { '& .MuiInputLabel-outlined': { fontSize: FIELD_FONT_SIZE } } } },
} as const;
