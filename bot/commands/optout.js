import { SlashCommandBuilder } from 'discord.js';
import * as guildProfiles from '../../src/models/guildProfiles.model.js';
import { buildNoticeEmbed } from '../embeds.js';

export const ephemeral = true;

export const data = new SlashCommandBuilder()
  .setName('data-optout')
  .setDescription('Choose whether YOUR activity in this server feeds global AZRA profiles')
  .addStringOption((o) => o
    .setName('mode')
    .setDescription('Opt out or back in')
    .setRequired(true)
    .addChoices(
      { name: 'opt-out — stop sharing my data', value: 'disable' },
      { name: 'opt-in — resume sharing my data', value: 'enable' },
    ))
  .setDMPermission(false);

export async function execute(interaction) {
  const enabled = interaction.options.getString('mode', true) === 'enable';
  await guildProfiles.setDataSharingEnabled(interaction.guildId, interaction.user.id, enabled, {
    updatedByUserId: interaction.user.id,
  });

  return {
    embeds: [buildNoticeEmbed(
      enabled ? 'Opted back in' : 'Opted out',
      enabled
        ? 'Your activity in this server will contribute to global AZRA profiles again (where the server allows it).'
        : 'Your activity in this server will no longer feed global AZRA profiles. Server-local records are unaffected.',
      { color: enabled ? 0x57f287 : 0xfee75c },
    )],
  };
}
