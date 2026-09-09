import * as profile from './profile.js';
import * as generateData from './generateData.js';

/** All slash commands. `ephemeral: true` commands reply ephemerally. */
export const COMMANDS = [
  profile,
  generateData,
];

export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.data.name, c]));

