import { HANDLERS } from './handlers/index.js';
import { ValidationError } from '../utils/errors.js';

/** Routes a validated event to its handler inside the caller's transaction. */
export async function dispatch(event, decision) {
  const handler = HANDLERS[event.type];
  if (!handler) {
    throw new ValidationError(`No handler registered for event type "${event.type}"`);
  }
  return handler(event, decision);
}
