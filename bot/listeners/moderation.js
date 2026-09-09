import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId } from '../mappers.js';

/** Bans and unbans → guild-local moderation records. */
export function register(client) {
  client.on(Events.GuildBanAdd, async (ban) => {
    await ingest(EVENT_TYPES.MODERATION_ACTION, {
      actionType: 'BAN',
      reason: ban.reason ?? null,
      moderatorId: null,
      caseId: null,
    }, {
      eventId: deterministicEventId('djs', 'ban', ban.guild.id, ban.user.id, Date.now()),
      guildId: ban.guild.id,
      userId: ban.user.id,
      sourceRef: ban.user.id,
    });
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    await ingest(EVENT_TYPES.MODERATION_ACTION, {
      actionType: 'UNBAN',
      reason: ban.reason ?? null,
      moderatorId: null,
    }, {
      eventId: deterministicEventId('djs', 'unban', ban.guild.id, ban.user.id, Date.now()),
      guildId: ban.guild.id,
      userId: ban.user.id,
      sourceRef: ban.user.id,
    });
  });
}
