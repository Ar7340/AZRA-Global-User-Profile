import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId } from '../mappers.js';

/** Message + reaction activity. Content is never stored — only the fact. */
export function register(client) {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    await ingest(EVENT_TYPES.ACTIVITY_MESSAGE, {
      username: message.author.username,
      globalName: message.author.globalName ?? null,
      amount: 1,
    }, {
      eventId: deterministicEventId('djs', 'msg', message.id),
      guildId: message.guildId,
      userId: message.author.id,
      sourceRef: message.id,
    });
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;
    const message = reaction.message?.partial ? await reaction.fetch().catch(() => reaction.message) : reaction.message;
    if (!message?.guildId) return;
    await ingest(EVENT_TYPES.ACTIVITY_REACTION, { amount: 1 }, {
      eventId: deterministicEventId('djs', 'react', message.id, user.id, reaction.emoji.id ?? reaction.emoji.name),
      guildId: message.guildId,
      userId: user.id,
      sourceRef: message.id,
    });
  });
}
