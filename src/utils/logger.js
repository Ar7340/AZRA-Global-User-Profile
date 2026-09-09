import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS[env.logLevel] ?? LEVELS.info;

function emit(level, scope, args) {
  if ((LEVELS[level] ?? 20) < threshold) return;
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  target(prefix, ...args);
}

export const logger = {
  setLevel(level) {
    if (LEVELS[level]) threshold = LEVELS[level];
  },

  child(scope) {
    return {
      debug: (...args) => emit('debug', scope, args),
      info: (...args) => emit('info', scope, args),
      warn: (...args) => emit('warn', scope, args),
      error: (...args) => emit('error', scope, args),
    };
  },

  debug: (...args) => emit('debug', '', args),
  info: (...args) => emit('info', '', args),
  warn: (...args) => emit('warn', '', args),
  error: (...args) => emit('error', '', args),
};
