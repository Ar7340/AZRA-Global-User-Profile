import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId } from '../mappers.js';
import { VoiceTracker } from '../voiceTracker.js';

const tracker = new VoiceTracker();

/** Voice presence → ACTIVITY_VOICE minutes on leave. */
export function register(client) {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild?.id ?? oldState.guild?.id;
    const userId = newState.id ?? oldState.id;
    if (!guildId || !userId) return;

    const joined = !oldState.channelId && newState.channelId;
    const left = oldState.channelId && !newState.channelId;

    if (joined) {
      tracker.join(guildId, userId);
      return;
    }

    if (left) {
      const session = tracker.leave(guildId, userId);
      if (session) {
        await ingest(EVENT_TYPES.ACTIVITY_VOICE, { amount: session.minutes }, {
          eventId: deterministicEventId('djs', 'voice', guildId, userId, session.joinedAt),
          guildId,
          userId,
        });
      }
    }
  });
}

/** Exposed for tests. */
export const __voiceTracker = tracker;
