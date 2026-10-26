import { start } from './app';

// The build a later deploy serves, whose server names the items `rows`: the older build crashes reading that answer,
// as a page left open across a deploy that changed an answer's shape does.
start((answer) => answer.rows);
