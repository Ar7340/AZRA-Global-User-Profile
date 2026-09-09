import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId, guildPayloadFromGuild } from '../mappers.js';

/** Bot added to / removed from guilds. */
export function register(client) {
  client.on(Events.GuildCreate, async (guild) => {
    await ingest(EVENT_TYPES.GUILD_REGISTER, {
      ...guildPayloadFromGuild(guild),
      dataSharingLevel: undefined, // bot bootstrap uses env default on next ready sync
      registeredByUserId: guild.client?.user?.id ?? null,
    }, {
      eventId: deterministicEventId('djs', 'guildcreate', guild.id),
      guildId: guild.id,
      sourceType: 'AZRA_SYSTEM',
    });
  });

  client.on(Events.GuildDelete, async (guild) => {
    // Bot removed (or guild deleted): stop participating immediately.
    await ingest(EVENT_TYPES.GUILD_UPDATE, {
      status: 'REMOVED',
      isParticipating: false,
    }, {
      eventId: deterministicEventId('djs', 'guildremove', guild.id, Date.now()),
      guildId: guild.id,
      sourceType: 'AZRA_SYSTEM',
    });
  });
}
