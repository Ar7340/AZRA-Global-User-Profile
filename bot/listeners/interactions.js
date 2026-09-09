import { Events } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { deterministicEventId } from '../mappers.js';
import { COMMAND_MAP } from '../commands/index.js';
import { buildErrorEmbed } from '../embeds.js';
import { logger } from '../../src/utils/logger.js';

const log = logger.child('discord:commands');

/** Slash-command routing + command activity tracking. */
export function register(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = COMMAND_MAP.get(interaction.commandName);
    if (!command) return;

    try {
      if (interaction.inGuild() && !interaction.user.bot) {
        await ingest(EVENT_TYPES.ACTIVITY_COMMAND, {
          amount: 1,
          commandName: interaction.commandName,
        }, {
          eventId: deterministicEventId('djs', 'cmd', interaction.id),
          guildId: interaction.guildId,
          userId: interaction.user.id,
        });
      }

      await interaction.deferReply({ ephemeral: Boolean(command.ephemeral) });
      const reply = await command.execute(interaction);
      await interaction.editReply(reply);
    } catch (err) {
      log.error('command failed', {
        command: interaction.commandName,
        user: interaction.user.id,
        error: err.message,
      });
      const payload = { embeds: [buildErrorEmbed(err.message ?? 'Unexpected error.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
      }
    }
  });
}
