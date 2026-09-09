import * as guildProfiles from '../../models/guildProfiles.model.js';
import * as guildRoles from '../../models/guildRoles.model.js';

export async function roleAdded(event) {
  await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
  });
  const result = await guildRoles.addRole({
    guildId: event.guildId,
    userId: event.userId,
    roleId: event.payload.roleId,
    roleName: event.payload.roleName ?? null,
    rolePosition: event.payload.rolePosition ?? null,
    addedAt: event.occurredAt,
    grantedByUserId: event.payload.grantedByUserId ?? null,
    sourceEventId: event.eventId,
  });
  return result;
}

export async function roleRemoved(event) {
  await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
  });
  return guildRoles.removeRole({
    guildId: event.guildId,
    userId: event.userId,
    roleId: event.payload.roleId,
    removedAt: event.occurredAt,
  });
}
