import { expect, test } from 'bun:test';
import { createTheme } from '@mui/material/styles';
import { FIELD_FONT_SIZE, fieldsNeverZoom, rem } from '../web/fields';

test('a size in pixels at the default root size is the same size in rem', () => {
  expect([rem(16), rem(14), rem(24)]).toEqual(['1rem', '0.875rem', '1.5rem']);
});

test("passed as createTheme's second argument, the field size merges with the app's own field settings", () => {
  const theme = createTheme(
    { components: { MuiInputBase: { styleOverrides: { root: { letterSpacing: '0.01em' }, input: { padding: 4 } } } } },
    { components: fieldsNeverZoom },
  );
  expect(theme.components?.MuiInputBase?.styleOverrides).toEqual({
    root: { letterSpacing: '0.01em', fontSize: FIELD_FONT_SIZE },
    input: { padding: 4 },
  });
});
