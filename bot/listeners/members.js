import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import {
  deterministicEventId,
  diffRoles,
  identityPayloadFromUser,
  timeoutChanged,
} from '../mappers.js';

function roleList(member) {
  return [...(member?.roles?.cache?.values() ?? [])].map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
  }));
}

/** Joins, leaves, role changes, nickname changes and timeouts. */
export function register(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    await ingest(EVENT_TYPES.MEMBER_JOINED, {
      ...identityPayloadFromUser(member.user),
      nickname: member.nickname ?? null,
      joinedAt: member.joinedAt?.toISOString() ?? null,
    }, {
      eventId: deterministicEventId('djs', 'memberjoin', member.guild.id, member.id, member.joinedTimestamp ?? Date.now()),
      guildId: member.guild.id,
      userId: member.id,
      occurredAt: member.joinedAt?.toISOString(),
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await ingest(EVENT_TYPES.MEMBER_LEFT, {}, {
      eventId: deterministicEventId('djs', 'memberleave', member.guild.id, member.id, Date.now()),
      guildId: member.guild.id,
      userId: member.id,
    });
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const guildId = newMember.guild.id;
    const userId = newMember.id;

    // Role diffs — skip when the old member object is partial (uncached).
    if (!oldMember?.partial) {
      const { added, removed } = diffRoles(roleList(oldMember), roleList(newMember));
      for (const role of added) {
        await ingest(EVENT_TYPES.ROLE_ADDED, {
          roleId: role.id, roleName: role.name, rolePosition: role.position,
        }, {
          eventId: deterministicEventId('djs', 'roleadd', guildId, userId, role.id, Date.now()),
          guildId, userId,
        });
      }
      for (const role of removed) {
        await ingest(EVENT_TYPES.ROLE_REMOVED, { roleId: role.id }, {
          eventId: deterministicEventId('djs', 'roleremove', guildId, userId, role.id, Date.now()),
          guildId, userId,
        });
      }
    }

    // Nickname / profile refresh.
    if (oldMember?.nickname !== newMember.nickname) {
      await ingest(EVENT_TYPES.USER_UPSERT, {
        ...identityPayloadFromUser(newMember.user),
        nickname: newMember.nickname,
      }, {
        eventId: deterministicEventId('djs', 'memberprofile', guildId, userId, Date.now()),
        guildId, userId,
      });
    }

    // Fresh timeouts become moderation records with expiry.
    if (timeoutChanged(oldMember, newMember)) {
      await ingest(EVENT_TYPES.MODERATION_ACTION, {
        actionType: 'TIMEOUT',
        reason: null,
        moderatorId: null,
        expiresAt: new Date(newMember.communicationDisabledUntilTimestamp).toISOString(),
      }, {
        eventId: deterministicEventId('djs', 'timeout', guildId, userId, newMember.communicationDisabledUntilTimestamp),
        guildId, userId,
      });
    }
  });
}
