import { Events } from 'discord.js';
import { startAggregationWorker } from '../../src/services/aggregationService.js';
import * as guildsModel from '../../src/models/guilds.model.js';
import { env } from '../../src/config/env.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId, guildPayloadFromGuild } from '../mappers.js';
import { logger } from '../../src/utils/logger.js';

const log = logger.child('discord:ready');

/** Registers existing guilds on boot (preserving admin-chosen sharing levels)
 *  and starts the aggregation worker. */
export function register(client) {
  client.once(Events.ClientReady, async (c) => {
    log.info(`logged in as ${c.user.tag} — ${c.guilds.cache.size} guilds`);
    startAggregationWorker();

    for (const guild of c.guilds.cache.values()) {
      try {
        const existing = await guildsModel.getGuild(guild.id);
        const payload = guildPayloadFromGuild(guild);
        if (!existing) {
          await ingest(EVENT_TYPES.GUILD_REGISTER, {
            ...payload,
            dataSharingLevel: env.discord.defaultSharingLevel,
            registeredByUserId: c.user.id,
          }, {
            eventId: deterministicEventId('djs', 'guildreg', guild.id),
            guildId: guild.id,
            sourceType: 'AZRA_SYSTEM',
          });
        } else {
          await ingest(EVENT_TYPES.GUILD_UPDATE, {
            name: payload.name,
            memberCount: payload.memberCount,
            iconHash: payload.iconHash,
          }, {
            eventId: deterministicEventId('djs', 'guildtouch', guild.id),
            guildId: guild.id,
            sourceType: 'AZRA_SYSTEM',
          });
        }
      } catch (err) {
        log.error('guild registration failed', { guildId: guild.id, error: err.message });
      }
    }
    log.info('startup sync complete');
  });
}
