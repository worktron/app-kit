import { start } from './app';

// The build a page opens on: the server's answer names its items `items`.
start((answer) => answer.items);
