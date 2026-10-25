import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

/** How the app moves to another of its own screens without a page load: its router's navigate. */
export type Navigate = (href: string) => void;

const NavigateContext = createContext<Navigate | null>(null);

/** Gives every `RowLink` inside the app's own navigate. Without it, a link loads its page as any link does. */
export function NavigateProvider({ navigate, children }: { navigate: Navigate; children: ReactNode }) {
  return <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>;
}

/** A click the browser should handle itself: another button, a key held for a new tab or window, or a download. */
export function opensElsewhere(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>): boolean {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/**
 * A whole row or card that goes to another screen, as a real link: ⌘-click, ctrl-click and middle-click open it in a
 * new tab, and a plain click moves within the page through the app's navigate. Never a row with an onClick that
 * navigates, which a new tab cannot open.
 */
export function RowLink({ href, children, sx, ...rest }: { href: string; children: ReactNode; sx?: SxProps<Theme>; 'aria-label'?: string; 'aria-current'?: 'page' }) {
  const navigate = useContext(NavigateContext);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!navigate || opensElsewhere(e)) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <Box
      component="a"
      href={href}
      onClick={onClick}
      sx={[{ display: 'block', color: 'inherit', textDecoration: 'none' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    >
      {children}
    </Box>
  );
}
