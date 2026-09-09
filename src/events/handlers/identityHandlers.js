import * as guilds from '../../models/guilds.model.js';
import * as dataPermissions from '../../models/dataPermissions.model.js';
import * as globalUsers from '../../models/globalUsers.model.js';
import * as guildProfiles from '../../models/guildProfiles.model.js';
import * as globalTimeline from '../../models/globalTimeline.model.js';
import * as aggregationQueue from '../../models/aggregationQueue.model.js';
import { DEFAULT_PERMISSIONS_BY_LEVEL, VISIBILITY, JOB_TYPES } from '../../domain/catalog.js';

export async function guildRegister(event) {
  const level = event.payload.dataSharingLevel ?? 'NONE';
  const { guild, created } = await guilds.upsertGuild({
    guildId: event.guildId,
    name: event.payload.name ?? null,
    iconHash: event.payload.iconHash ?? null,
    memberCount: event.payload.memberCount ?? null,
    dataSharingLevel: level,
    seenAt: event.occurredAt,
  });
  await dataPermissions.replaceGuildPermissions(
    event.guildId,
    DEFAULT_PERMISSIONS_BY_LEVEL[level] ?? {},
    { updatedByUserId: event.payload.registeredByUserId ?? null },
  );
  return { guild, created };
}

export async function guildUpdate(event) {
  const payload = event.payload;
  const guild = await guilds.updateGuild(event.guildId, {
    name: payload.name ?? null,
    iconHash: payload.iconHash ?? null,
    memberCount: payload.memberCount ?? null,
    dataSharingLevel: payload.dataSharingLevel ?? null,
    isParticipating: payload.isParticipating ?? null,
    status: payload.status ?? null,
  });
  if (payload.dataSharingLevel != null) {
    await dataPermissions.replaceGuildPermissions(
      event.guildId,
      DEFAULT_PERMISSIONS_BY_LEVEL[payload.dataSharingLevel] ?? {},
      { updatedByUserId: payload.updatedByUserId ?? null },
    );
  }
  // Participation/sharing changes affect every aggregate touched by this guild.
  await aggregationQueue.enqueue({
    jobType: JOB_TYPES.REBUILD_GUILD_AGGREGATES,
    entityType: 'GUILD',
    entityId: event.guildId,
    priority: 6,
  });
  return { guild };
}

function identityPayload(event) {
  const p = event.payload;
  return {
    userId: event.userId,
    username: p.username ?? null,
    globalName: p.globalName ?? null,
    avatarHash: p.avatarHash ?? null,
    isBot: p.isBot ?? null,
    accountCreatedAt: p.accountCreatedAt ?? null,
    seenAt: event.occurredAt,
  };
}

export async function userUpsert(event, ctx) {
  const { user } = await globalUsers.upsertUser(identityPayload(event));
  const { profile } = await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
    nickname: event.payload.nickname ?? null,
  });
  return { user, profile };
}

export async function memberJoined(event, ctx) {
  await globalUsers.upsertUser(identityPayload(event));
  const { profile } = await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
    joinedAt: event.payload.joinedAt ?? event.occurredAt,
    nickname: event.payload.nickname ?? null,
    membershipStatus: 'MEMBER',
  });
  await globalTimeline.addTimelineEntry({
    userId: event.userId,
    occurredAt: event.occurredAt,
    eventType: event.type,
    guildId: event.guildId,
    summary: `Joined ${ctx.guild?.name ?? 'a participating community'}`,
    visibility: VISIBILITY.GUILD,
    sourceEventId: event.eventId,
  });
  return { profile };
}

export async function memberLeft(event, ctx) {
  await globalUsers.upsertUser({ userId: event.userId, seenAt: event.occurredAt });
  const { profile } = await guildProfiles.setMembershipStatus({
    guildId: event.guildId,
    userId: event.userId,
    status: 'LEFT',
    at: event.occurredAt,
  });
  await globalTimeline.addTimelineEntry({
    userId: event.userId,
    occurredAt: event.occurredAt,
    eventType: event.type,
    guildId: event.guildId,
    summary: `Left ${ctx.guild?.name ?? 'a participating community'}`,
    visibility: VISIBILITY.GUILD,
    sourceEventId: event.eventId,
  });
  return { profile };
}
