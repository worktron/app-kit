import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, List, ListItem, ListItemText, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { lookTheme } from '../..';

// The kit's MUI themes drawn on a settings page, the Plain Look Studies page's General and Profiles tabs as a web page
// draws them: section labels, rows between hairlines, status in colored words, a switch, a menu that reads as text, a
// field, actions as words and a removal in the error color, and the build at the foot. ?look=console draws the console
// theme; the plain one follows the system's light or dark setting, which the test sets.

const look = new URLSearchParams(location.search).get('look') === 'console' ? 'console' : 'plain';
const theme = lookTheme(look === 'console' ? { name: 'console' } : { name: 'plain' });

function Settings() {
  const [login, setLogin] = useState(true);
  const [browser, setBrowser] = useState(false);
  const [profile, setProfile] = useState('Personal');
  return (
    <Box component="main" sx={{ maxWidth: 460, px: 3, pt: 2.5, pb: 3 }}>
      <Typography variant="h6" component="h1">
        Settings
      </Typography>
      <Typography color="textSecondary">Where Beeline opens each link</Typography>
      <Typography variant="overline" component="h2" sx={{ display: 'block', mt: 3, mb: 1 }}>
        Starting
      </Typography>
      <List disablePadding sx={{ borderTop: 1, borderColor: 'divider' }}>
        <ListItem>
          <ListItemText primary="Open Beeline when you log in" secondary="Starts at login. Turn off to start it yourself." />
          <Switch checked={login} onChange={(event) => setLogin(event.target.checked)} slotProps={{ input: { 'aria-label': 'Open Beeline when you log in' } }} />
        </ListItem>
        <ListItem>
          <ListItemText primary="Make Beeline the default browser" secondary="Beta. Links from other apps go through Beeline first." />
          <Switch checked={browser} onChange={(event) => setBrowser(event.target.checked)} slotProps={{ input: { 'aria-label': 'Make Beeline the default browser' } }} />
        </ListItem>
      </List>
      <Typography variant="overline" component="h2" sx={{ display: 'block', mt: 3, mb: 1 }}>
        Links nothing settles
      </Typography>
      <List disablePadding sx={{ borderTop: 1, borderColor: 'divider' }}>
        <ListItem>
          <ListItemText primary="Open them in" />
          <Select variant="standard" value={profile} onChange={(event) => setProfile(event.target.value)} inputProps={{ 'aria-label': 'Open them in' }}>
            {['Personal', 'Work', 'Client'].map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        </ListItem>
        <ListItem>
          <Box sx={{ flex: 1 }}>
            <Typography>Test a link</Typography>
            <TextField fullWidth defaultValue="https://work.example.com/browse/" slotProps={{ htmlInput: { 'aria-label': 'A link' } }} sx={{ mt: 1 }} />
          </Box>
          <Button>Test</Button>
        </ListItem>
      </List>
      <Typography variant="overline" component="h2" sx={{ display: 'block', mt: 3, mb: 1 }}>
        Chrome profiles
      </Typography>
      <List disablePadding sx={{ borderTop: 1, borderColor: 'divider' }}>
        <ListItem>
          <ListItemText primary="Personal" secondary="pat@example.com · default" slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
          <Typography variant="body2" color="success">Connected</Typography>
        </ListItem>
        <ListItem>
          <ListItemText primary="Client" secondary="client@example.com · not heard from since 10:42" slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
          <Typography variant="body2" color="warning">Quiet</Typography>
        </ListItem>
        <ListItem>
          <ListItemText primary="Link memory" secondary="Learned from where links opened and where you moved them." />
          <Button color="error">Forget all</Button>
        </ListItem>
      </List>
      <Typography variant="body2" color="textSecondary" sx={{ mt: 3 }} id="build">
        Beeline 1.0.0, 873623f
      </Typography>
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Settings />
    </ThemeProvider>
  </StrictMode>,
);
