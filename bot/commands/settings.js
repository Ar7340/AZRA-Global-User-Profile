import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { assertSharingLevel, deterministicEventId, sharingLevelDescription } from '../mappers.js';
import { buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';

export const ephemeral = true;

export const data = new SlashCommandBuilder()
  .setName('profile-settings')
  .setDescription('Configure what this server shares with global AZRA profiles')
  .addStringOption((o) => o
    .setName('sharing')
    .setDescription('Data-sharing level')
    .setRequired(true)
    .addChoices(
      { name: 'NONE — share nothing globally', value: 'NONE' },
      { name: 'MINIMAL — basic identity only', value: 'MINIMAL' },
      { name: 'STANDARD — identity, activity, roles, verification', value: 'STANDARD' },
      { name: 'FULL — everything incl. moderation metadata', value: 'FULL' },
    ))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  const level = assertSharingLevel(interaction.options.getString('sharing', true));
  const result = await ingest(EVENT_TYPES.GUILD_UPDATE, {
    dataSharingLevel: level,
    updatedByUserId: interaction.user.id,
  }, {
    eventId: deterministicEventId('djs', 'settings', interaction.guildId, level, Date.now()),
    guildId: interaction.guildId,
    sourceType: 'AZRA_SYSTEM',
  });

  if (result.status !== 'processed') {
    return {
      embeds: [buildErrorEmbed(
        `Could not update settings (status: ${result.status}${result.reason ? ` — ${result.reason}` : ''}).`,
      )],
    };
  }

  return {
    embeds: [buildNoticeEmbed(
      `Sharing level set to ${level}`,
      `${sharingLevelDescription(level)}\n\nChanges take effect immediately — aggregates are recalculated in the background.`,
    )],
  };
}
