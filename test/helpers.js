import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initStore, closeStore } from '../src/db/index.js';
import { ingestEvent } from '../src/events/processor.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';

/** Creates an isolated store in a fresh temp directory. */
export async function createTestStore(label = 'azra-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  await initStore({ dataDir: dir, flushDebounceMs: 0 });
  return dir;
}

export async function destroyTestStore() {
  await closeStore();
}

export const G = '300000000000000011'; // primary test guild
export const G2 = '300000000000000012'; // secondary test guild
export const ADMIN = '200000000000000100';
export const U1 = '200000000000000101';
export const U2 = '200000000000000102';
export const U3 = '200000000000000103';

let seq = 0;

/** Builds a raw event with a deterministic unique eventId. */
export function event(type, payload = {}, opts = {}) {
  seq += 1;
  return {
    eventId: opts.eventId ?? `test-${String(seq).padStart(5, '0')}`,
    type,
    guildId: opts.guildId ?? null,
    userId: opts.userId ?? null,
    sourceType: opts.sourceType,
    occurredAt: opts.at ?? '2026-08-01T12:00:00.000Z',
    payload,
  };
}

export async function registerGuild(guildId = G, { level = 'FULL', name = 'Test Guild' } = {}) {
  return ingestEvent(event(EVENT_TYPES.GUILD_REGISTER, {
    name, dataSharingLevel: level, registeredByUserId: ADMIN,
  }, { guildId }));
}

export async function joinGuild(guildId, userId, at = '2026-08-01T12:00:00.000Z') {
  return ingestEvent(event(EVENT_TYPES.MEMBER_JOINED, { username: 'tester' }, { guildId, userId, at }));
}

export async function messageActivity(guildId, userId, amount = 1, at = '2026-08-02T12:00:00.000Z') {
  return ingestEvent(event(EVENT_TYPES.ACTIVITY_MESSAGE, { amount }, { guildId, userId, at }));
}
