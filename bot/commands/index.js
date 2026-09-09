import * as profile from './profile.js';
import * as serverprofile from './serverprofile.js';
import * as settings from './settings.js';
import * as optout from './optout.js';
import * as verify from './verify.js';
import * as register from './register.js';
import * as generateData from './generateData.js';

/** All slash commands. `ephemeral: true` commands reply ephemerally. */
export const COMMANDS = [
  profile,
  serverprofile,
  settings,
  optout,
  verify,
  register,
  generateData,
];

export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.data.name, c]));

