import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGlobalProfileSummary } from '../../src/services/profileService.js';
import { NotFoundError } from '../../src/utils/errors.js';
import { buildProfileEmbed, buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';
import { viewerScopeFromPermissions } from '../mappers.js';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription("View a user's global AZRA profile")
  .addUserOption((o) => o
    .setName('user')
    .setDescription('User to inspect (defaults to yourself)')
    .setRequired(false));

/** Maps a guild member's permissions onto an AZRA viewer scope. */
export function viewerScopeForMember(member) {
  const has = (flag) => Boolean(member?.permissions?.has?.(flag));
  return viewerScopeFromPermissions({
    administrator: has(PermissionFlagsBits.Administrator),
    moderateMembers: has(PermissionFlagsBits.ModerateMembers),
    manageGuild: has(PermissionFlagsBits.ManageGuild),
    manageMessages: has(PermissionFlagsBits.ManageMessages),
  });
}

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const viewerScope = viewerScopeForMember(interaction.member);
  try {
    const summary = await getGlobalProfileSummary(target.id, {
      viewerId: interaction.user.id,
      viewerScope,
    });
    return {
      embeds: [buildProfileEmbed(summary, {
        scope: viewerScope,
        avatarUrl: target.displayAvatarURL?.({ size: 128 }) ?? null,
      })],
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        embeds: [buildNoticeEmbed(
          'No AZRA profile yet',
          `AZRA has not recorded any authorized data for **${target.username ?? target.id}** yet.`,
          { color: 0xfee75c },
        )],
      };
    }
    throw err;
  }
}
