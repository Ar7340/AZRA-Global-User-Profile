import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGlobalProfileSummary } from '../../src/services/profileService.js';
import { NotFoundError } from '../../src/utils/errors.js';
import { buildProfileEmbed, buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';
import { viewerScopeFromPermissions } from '../mappers.js';
import { renderProfileCard } from '../profileImage.js';
import { logger } from '../../src/utils/logger.js';

const log = logger.child('profile-cmd');

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

/** Fetches the member's avatar as a PNG buffer; null on any failure. */
async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } catch (err) {
    log.debug('avatar fetch failed', { error: err.message });
    return null;
  }
}

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const viewerScope = viewerScopeForMember(interaction.member);
  try {
    const summary = await getGlobalProfileSummary(target.id, {
      viewerId: interaction.user.id,
      viewerScope,
    });

    // Build the visual card (image part of the image+embed combo).
    // Graceful: if the card fails we still send the full text embed.
    let cardBuffer = null;
    try {
      cardBuffer = await renderProfileCard({
        summary,
        avatarBuffer: await fetchAvatar(target.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? null),
      });
    } catch (err) {
      log.debug('card skipped', { error: err.message });
    }

    const reply = {
      embeds: [buildProfileEmbed(summary, {
        scope: viewerScope,
        avatarUrl: target.displayAvatarURL?.({ size: 128 }) ?? null,
        imageUrl: cardBuffer ? 'attachment://azra-profile.png' : null,
      })],
    };
    if (cardBuffer) {
      reply.files = [{ attachment: cardBuffer, name: 'azra-profile.png' }];
    }
    return reply;
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
