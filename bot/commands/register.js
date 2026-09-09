import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId, identityPayloadFromUser } from '../mappers.js';
import { buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';

export const ephemeral = true;

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Register a member in AZRA (yourself, or others as a moderator)')
  .addUserOption((o) => o
    .setName('user')
    .setDescription('Member to register (moderators only — defaults to yourself)')
    .setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;

  if (target.id !== interaction.user.id) {
    const canModerate = interaction.member?.permissions?.has?.(PermissionFlagsBits.ModerateMembers) ?? false;
    if (!canModerate) {
      return {
        embeds: [buildErrorEmbed(
          'Only moderators (**Moderate Members**) can register another member. Use `/register` without a target to register yourself.',
        )],
      };
    }
  }

  const nowIso = new Date().toISOString();
  const identity = identityPayloadFromUser(target);

  // 1. Global identity upsert.
  const upsert = await ingest(EVENT_TYPES.USER_UPSERT, identity, {
    eventId: deterministicEventId('djs', 'register-id', interaction.guildId, target.id),
    guildId: interaction.guildId,
    userId: target.id,
    sourceType: 'AZRA_SYSTEM',
  });

  // 2. Guild membership record for this server.
  const join = await ingest(EVENT_TYPES.MEMBER_JOINED, { ...identity, joinedAt: nowIso }, {
    eventId: deterministicEventId('djs', 'register-join', interaction.guildId, target.id),
    guildId: interaction.guildId,
    userId: target.id,
    occurredAt: nowIso,
    sourceType: 'AZRA_SYSTEM',
  });

  const statuses = [upsert.status, join.status];

  if (statuses.includes('skipped')) {
    const reason = upsert.status === 'skipped' ? upsert.reason : join.reason;
    return {
      embeds: [buildErrorEmbed(
        `Registration was blocked by this server's data-sharing settings:\n> ${reason}\n\nAn admin can change this with \`/profile-settings\`.`,
      )],
    };
  }

  if (statuses.every((s) => s === 'duplicate')) {
    return {
      embeds: [buildNoticeEmbed(
        'Already registered',
        `**${target.username ?? target.id}** is already registered in AZRA for this server.\n\nUse \`/profile\` for the global view or \`/serverprofile\` for this server's records.`,
        { color: 0xfee75c },
      )],
    };
  }

  return {
    embeds: [buildNoticeEmbed(
      'Registered in AZRA',
      `**${target.username ?? target.id}** is now tracked in this server's AZRA records.\n\nUse \`/profile\` for the global profile or \`/serverprofile\` for this server's view. Admins can seed demo data with \`/generate-data\`.`,
    )],
  };
}
