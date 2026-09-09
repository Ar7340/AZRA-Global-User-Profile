import * as ready from './ready.js';
import * as guilds from './guilds.js';
import * as members from './members.js';
import * as messages from './messages.js';
import * as moderation from './moderation.js';
import * as voice from './voice.js';
import * as interactions from './interactions.js';

/** Wires every Discord gateway listener to the AZRA event pipeline. */
export function registerListeners(client) {
  ready.register(client);
  guilds.register(client);
  members.register(client);
  messages.register(client);
  moderation.register(client);
  voice.register(client);
  interactions.register(client);
}
