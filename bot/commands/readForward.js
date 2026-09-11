import { SlashCommandBuilder } from 'discord.js';
import { buildForwardReportEmbeds, buildNoticeEmbed } from '../embeds.js';
import { logger } from '../../src/utils/logger.js';

const log = logger.child('read-forward-cmd');

/**
 * Parses a Discord message link into its IDs.
 * Accepts both channel formats; null-safe, returns null for non-links.
 */
export function parseMessageLink(url) {
  const match = String(url ?? '').match(
    /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)\/?$/,
  );
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

/**
 * Finds the most recent forwarded message in a newest-first message array.
 * A forwarded message carries `messageSnapshots`. Returns null when absent.
 */
export function findForwardInMessages(messages) {
  return (messages ?? []).find((m) => (m.messageSnapshots?.size ?? 0) > 0) ?? null;
}

/** Serializes one discord.js-like embed into plain structured data. */
function serializeEmbed(embed) {
  return {
    author: embed.author?.name ?? null,
    title: embed.title ?? null,
    description: embed.description ?? null,
    fields: (embed.fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: Boolean(f.inline) })),
    footer: embed.footer?.text ?? null,
    color: typeof embed.color === 'number' ? embed.color : null,
    imageUrl: embed.image?.url ?? embed.image?.proxyURL ?? null,
    thumbnailUrl: embed.thumbnail?.url ?? embed.thumbnail?.proxyURL ?? null,
    timestamp: embed.timestamp ?? null,
  };
}

/**
 * Reads the forwardable content of a message.
 * - A true forward carries `messageSnapshots` (Discord's message-forwarding API)
 * - Any other message falls back to its own content/embeds/attachments
 * Pure: safe to run against fake messages in tests.
 */
export function parseForwardedMessage(message) {
  if (!message) return null;

  const snapshot = message.messageSnapshots?.first?.() ?? null;
  const isForward = (message.messageSnapshots?.size ?? 0) > 0 && snapshot != null;

  const source = isForward
    ? {
        content: snapshot.content ?? '',
        createdAt: snapshot.createdAt ?? null,
        embeds: (snapshot.embeds ?? []).map(serializeEmbed),
        attachments: (snapshot.attachments ?? []).map((a) => ({
          url: a.url ?? null,
          contentType: a.contentType ?? null,
          name: a.name ?? null,
          size: a.size ?? null,
        })),
        componentsCount: snapshot.components?.length ?? 0,
      }
    : {
        content: message.content ?? '',
        createdAt: message.createdAt ?? null,
        embeds: (message.embeds ?? []).map(serializeEmbed),
        attachments: (message.attachments ?? []).map((a) => ({
          url: a.url ?? null,
          contentType: a.contentType ?? null,
          name: a.name ?? null,
          size: a.size ?? null,
        })),
        componentsCount: message.components?.length ?? 0,
      };

  return {
    isForward,
    source,
    forwardAuthor: message.author
      ? { id: message.author.id, username: message.author.username ?? null, displayName: message.author.displayName ?? null }
      : null,
    snapshotCount: message.messageSnapshots?.size ?? 0,
    embedCount: source.embeds.length,
    attachmentCount: source.attachments.length,
  };
}

export const data = new SlashCommandBuilder()
  .setName('read-forward')
  .setDescription('Read the contents of a forwarded message (or any message)')
  .addStringOption((o) => o
    .setName('message')
    .setDescription('Message link to read (right-click → Copy Message Link). Defaults to the latest forward here.')
    .setRequired(false))
  .addIntegerOption((o) => o
    .setName('scan')
    .setDescription('How many recent messages to scan for the latest forward (default 10)')
    .setMinValue(1)
    .setMaxValue(50)
    .setRequired(false));

export const ephemeral = true;

export async function execute(interaction) {
  const messageLink = interaction.options.getString('message');
  const scanDepth = interaction.options.getInteger('scan') ?? 10;

  // 1. Explicit message link wins.
  if (messageLink) {
    const link = parseMessageLink(messageLink);
    if (!link) {
      return {
        embeds: [buildNoticeEmbed(
          'Invalid message link',
          'That option did not look like a Discord message link.\nRight-click a message -> Copy Message Link, then paste it here.',
          { color: 0xfee75c },
        )],
      };
    }

    if (link.guildId === '@me') {
      return {
        embeds: [buildNoticeEmbed(
          'DM messages are not supported',
          'That link points to a direct message, which AZRA cannot read.\nForward the message into this channel and run the command again.',
          { color: 0xfee75c },
        )],
      };
    }

    try {
      const targetChannel = await interaction.client.channels.fetch(link.channelId);
      if (!targetChannel?.messages?.fetch) {
        throw new Error('That channel type cannot be read.');
      }
      const targetMessage = await targetChannel.messages.fetch(link.messageId);
      const parsed = parseForwardedMessage(targetMessage);
      return {
        embeds: buildForwardReportEmbeds(parsed, { channelNote: link.channelId }),
      };
    } catch (fetchError) {
      log.debug('message link fetch failed', { error: fetchError.message });
      return {
        embeds: [buildNoticeEmbed(
          'Cannot read that message',
          'AZRA could not fetch the linked message. Make sure it is in a server the bot can access, then run the command again.',
          { color: 0xfee75c },
        )],
      };
    }
  }

  // 2. Scan the current channel for the latest forward.
  let candidates = null;
  try {
    const fetched = await interaction.channel.messages.fetch({ limit: scanDepth });
    candidates = [...fetched.values()];
  } catch (err) {
    log.debug('channel scan failed', { error: err.message });
    return {
      embeds: [buildNoticeEmbed(
        'Cannot scan this channel',
        `AZRA lacks permission to read recent messages here.\nForward the message into this channel and run the command again, or paste a message link.\n_(Discord said: \`${err.message}\`)_`,
        { color: 0xfee75c },
      )],
    };
  }

  const forward = findForwardInMessages(candidates);
  if (!forward) {
    return {
      embeds: [buildNoticeEmbed(
        'No forwarded message found',
        `No forward in the last ${candidates.length} message(s).\n▸ Forward the message into this channel, then run the command again.\n▸ Or use the \`message\` option with a message link.`,
        { color: 0xfee75c },
      )],
    };
  }

  const parsed = parseForwardedMessage(forward);
  return {
    embeds: buildForwardReportEmbeds(parsed, { channelNote: interaction.channelId ?? null }),
  };
}
