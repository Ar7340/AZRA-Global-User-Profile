import * as profile from './profile.js';
import * as generateData from './generateData.js';
import * as readForward from './readForward.js';

/** All slash commands. `ephemeral: true` commands reply ephemerally. */
export const COMMANDS = [
  profile,
  generateData,
  readForward,
];

export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.data.name, c]));

