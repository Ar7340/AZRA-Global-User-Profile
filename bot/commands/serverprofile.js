import { SlashCommandBuilder } from 'discord.js';
import { getGuildProfileSummary } from '../../src/services/profileService.js';
import { NotFoundError } from '../../src/utils/errors.js';
import { buildGuildProfileEmbed, buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';
import { viewerScopeForMember } from './profile.js';

export const data = new SlashCommandBuilder()
  .setName('serverprofile')
  .setDescription("View a member's profile as recorded for THIS server")
  .addUserOption((o) => o
    .setName('user')
    .setDescription('Member to inspect (defaults to yourself)')
    .setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const viewerScope = viewerScopeForMember(interaction.member);
  try {
    const summary = await getGuildProfileSummary(interaction.guildId, target.id, {
      viewerId: interaction.user.id,
      viewerScope,
    });
    return { embeds: [buildGuildProfileEmbed(summary, { username: target.username })] };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        embeds: [buildNoticeEmbed(
          'No server profile yet',
          'AZRA has no record of this member in this server yet.',
          { color: 0xfee75c },
        )],
      };
    }
    throw err;
  }
}
