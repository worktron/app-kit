import { Box, ListItem, ListItemText, MenuItem, Select } from '@mui/material';
import { chooseTextSize, TEXT_SIZES, useTextSize } from './text-size';

/*
 * The Text size row for an app's settings page, in the plain look: "Same as the phone" or one of the seven sizes, in
 * the kit's menu that reads as text, from the Text Size Studies page's option A. The page resizes as the menu closes,
 * so nothing moves under the finger. Off a phone there is no phone size to follow, and the first choice reads
 * "Standard".
 */

/** The menu's value for following the phone, since a menu's values are strings. */
const FOLLOW = 'follow';

const percent = (scale: number) => `${Math.round(scale * 100)}%`;

/** The Text size row. Put it in a `List`, as every row is; it follows the size by itself. */
export function TextSizeSetting() {
  const { choice, phone } = useTextSize();
  const follow = phone === null ? 'Standard' : 'Same as the phone';
  return (
    // At the largest sizes the menu goes under its name, and its words wrap, rather than reach past a phone's edge.
    <ListItem sx={{ flexWrap: 'wrap' }}>
      <ListItemText primary="Text size" />
      <Select
        variant="standard"
        sx={{
          maxWidth: '100%',
          '& .MuiSelect-select': { whiteSpace: 'normal' },
          // On a touch screen the menu takes a tap at least 44 pixels tall: 9 more pixels of padding above and below its
          // words, given back by margins, so the words and the hairline stay where they are. The menu clips what
          // overflows it, so a larger box drawn outside it would take no tap.
          '@media (pointer: coarse)': { '& .MuiSelect-select': { paddingTop: '13px', paddingBottom: '14px', marginTop: '-9px', marginBottom: '-9px' } },
        }}
        value={choice === null ? FOLLOW : String(choice)}
        onChange={(event) => chooseTextSize(TEXT_SIZES.find((size) => String(size) === event.target.value) ?? null)}
        renderValue={(value) => (value === FOLLOW ? follow : percent(Number(value)))}
        inputProps={{ 'aria-label': 'Text size' }}
      >
        <MenuItem value={FOLLOW}>
          {follow}
          {phone !== null && (
            <Box component="span" sx={{ color: 'text.secondary', ml: 0.75 }}>
              {percent(phone)}
            </Box>
          )}
        </MenuItem>
        {TEXT_SIZES.map((size) => (
          <MenuItem key={size} value={String(size)}>
            {percent(size)}
          </MenuItem>
        ))}
      </Select>
    </ListItem>
  );
}
