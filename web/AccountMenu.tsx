import { useId, useState, type MouseEvent } from 'react';
import { Box, Button, Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';
import { opensElsewhere, useNavigate } from './RowLink';
import { usePerson, useSignOut } from './sign-in/SignInGate';

/** One of the app's own items in the account menu: a link to one of its screens, or an act. */
export type AccountMenuItem = { label: string; href: string } | { label: string; onSelect: () => void };

export interface AccountMenuProps {
  /** The app's own items, between who is signed in and Sign out: Settings, Diagnostics, a profile to switch to. */
  items?: AccountMenuItem[];
  /** What opens the menu: the word Account, or the first letter of the person's name or address in a circle. */
  button?: 'word' | 'initial';
  /** The person's name above the address, when the provider knows it. On unless false. */
  showName?: boolean;
}

/**
 * A quiet button at the right end of the app's bar, with a menu that says who is signed in, the app's own items and
 * Sign out. It draws nothing where there is no Sign out: outside the sign-in gate, or with no sign-in provider. An app
 * that wants Sign out somewhere else uses `useSignOut` and `usePerson` itself.
 */
export function AccountMenu({ items = [], button = 'word', showName = true }: AccountMenuProps) {
  const signOut = useSignOut();
  const person = usePerson();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  if (!signOut) return null;
  const email = person?.email ?? null;
  const name = showName ? (person?.name ?? null) : null;
  const initial = (person?.name || email || '').trim().charAt(0).toUpperCase();
  const close = () => setAnchor(null);
  const follow = (href: string) => (e: MouseEvent<HTMLElement>) => {
    close();
    if (!navigate || opensElsewhere(e)) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <>
      <Button
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined}
        sx={{ color: 'text.secondary', fontWeight: 'normal', '@media (pointer: coarse)': { minHeight: 44, minWidth: 44 } }}
      >
        {button === 'initial' && initial ? (
          <Box
            component="span"
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 1,
              borderColor: 'divider',
              display: 'grid',
              placeItems: 'center',
              typography: 'body2',
              lineHeight: 1,
            }}
          >
            {initial}
          </Box>
        ) : (
          'Account'
        )}
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          // A hairline and no shadow, as the plain look draws everything.
          paper: { elevation: 0, sx: { mt: 0.5, minWidth: 220, maxWidth: 'calc(100vw - 32px)', border: 1, borderColor: 'divider' } },
        }}
      >
        {(name || email) && (
          <ListSubheader component="div" sx={{ position: 'static', lineHeight: 1.4, pt: 0.5, pb: 1, bgcolor: 'transparent' }}>
            <Typography variant="body2" color="textSecondary">
              Signed in as
            </Typography>
            {name && (
              <Typography variant="body2" color="textPrimary" sx={{ overflowWrap: 'anywhere' }}>
                {name}
              </Typography>
            )}
            {email && (
              <Typography variant="body2" color={name ? 'textSecondary' : 'textPrimary'} sx={{ overflowWrap: 'anywhere' }}>
                {email}
              </Typography>
            )}
          </ListSubheader>
        )}
        {(name || email) && <Divider />}
        {items.map((item) =>
          'href' in item ? (
            <MenuItem key={item.label} component="a" href={item.href} onClick={follow(item.href)}>
              {item.label}
            </MenuItem>
          ) : (
            <MenuItem
              key={item.label}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </MenuItem>
          ),
        )}
        {items.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            close();
            signOut();
          }}
        >
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
