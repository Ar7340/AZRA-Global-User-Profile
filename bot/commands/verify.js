import { SlashCommandBuilder } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId } from '../mappers.js';
import { buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';

export const ephemeral = true;

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Record that you completed this server’s verification')
  .setDMPermission(false);

export async function execute(interaction) {
  // Once per user per day, self-reported (USER_SELF_REPORT provenance).
  const day = new Date().toISOString().slice(0, 10);
  const result = await ingest(EVENT_TYPES.VERIFICATION_COMPLETED, {
    method: 'MANUAL',
    verifiedByUserId: interaction.user.id,
  }, {
    eventId: deterministicEventId('djs', 'verify', interaction.guildId, interaction.user.id, day),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    sourceType: 'USER_SELF_REPORT',
  });

  if (result.status === 'duplicate') {
    return { embeds: [buildNoticeEmbed('Already verified today', 'Your verification for today was already recorded.', { color: 0xfee75c })] };
  }
  if (result.status === 'skipped') {
    return { embeds: [buildErrorEmbed(`Verification could not be recorded: ${result.reason}`)] };
  }
  return {
    embeds: [buildNoticeEmbed(
      'Verification recorded',
      `Your verification in **${interaction.guild?.name ?? 'this server'}** was recorded. It contributes to your global verification once the server permits VERIFICATION sharing.`,
    )],
  };
}
