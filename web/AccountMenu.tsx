import { useId, useState, type MouseEvent } from 'react';
import { Button, Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';
import { opensElsewhere, useNavigate } from './RowLink';
import { usePerson, useSignOut } from './sign-in/SignInGate';

/** One of the app's own items in the account menu: a link to one of its screens, or an act. */
export type AccountMenuItem = { label: string; href: string } | { label: string; onSelect: () => void };

/**
 * A quiet Account button with a menu that says who is signed in, the app's own items
 * (Settings, a profile to switch to) and Sign out. Put it at the right end of the app's bar. It draws nothing where
 * there is no Sign out: outside the sign-in gate, or with no sign-in provider. An app that wants Sign out somewhere
 * else uses `useSignOut` and `usePerson` itself.
 */
export function AccountMenu({ items = [] }: { items?: AccountMenuItem[] }) {
  const signOut = useSignOut();
  const person = usePerson();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  if (!signOut) return null;
  const email = person?.email ?? null;
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
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined}
        sx={{ color: 'text.secondary', fontWeight: 'normal', '@media (pointer: coarse)': { minHeight: 44 } }}
      >
        Account
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
        {email && (
          <ListSubheader component="div" sx={{ position: 'static', lineHeight: 1.4, pt: 0.5, pb: 1, bgcolor: 'transparent' }}>
            <Typography variant="body2" color="textSecondary">
              Signed in as
            </Typography>
            <Typography variant="body2" color="textPrimary" sx={{ overflowWrap: 'anywhere' }}>
              {email}
            </Typography>
          </ListSubheader>
        )}
        {email && <Divider />}
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
