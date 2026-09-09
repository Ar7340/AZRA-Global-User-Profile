import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { EVENT_TYPES } from '../../src/domain/catalog.js';
import { ingest } from '../ingest.js';
import { buildGenerationPlan } from '../randomData.js';
import { deterministicEventId, identityPayloadFromUser } from '../mappers.js';
import { runAggregationPass } from '../../src/services/aggregationService.js';
import { buildErrorEmbed, buildNoticeEmbed } from '../embeds.js';

export const ephemeral = true;

export const data = new SlashCommandBuilder()
  .setName('generate-data')
  .setDescription('Generate random demo data for a member through the AZRA pipeline (Manage Server)')
  .addUserOption((o) => o
    .setName('user')
    .setDescription('Target member (defaults to yourself)')
    .setRequired(false))
  .addIntegerOption((o) => o
    .setName('days')
    .setDescription('Spread activity over the past N days (default 14)')
    .setMinValue(1)
    .setMaxValue(30))
  .addStringOption((o) => o
    .setName('intensity')
    .setDescription('Volume of generated data (default normal)')
    .addChoices(
      { name: 'light — ~100 activity events', value: 'light' },
      { name: 'normal — ~250 activity events', value: 'normal' },
      { name: 'heavy — ~500 activity events', value: 'heavy' },
    ))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const days = interaction.options.getInteger('days') ?? 14;
  const intensity = interaction.options.getString('intensity') ?? 'normal';
  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  // Ensure the target's identity exists before generating activity.
  await ingest(EVENT_TYPES.USER_UPSERT, identityPayloadFromUser(target), {
    eventId: deterministicEventId('djs', 'gen-id', interaction.guildId, target.id, runId),
    guildId: interaction.guildId,
    userId: target.id,
    sourceType: 'AZRA_SYSTEM',
  });

  const plan = buildGenerationPlan({
    guildId: interaction.guildId,
    userId: target.id,
    days,
    intensity,
    runId,
  });

  let processed = 0;
  let skipped = 0;
  const skipReasons = new Map();
  for (const event of plan.events) {
    const result = await ingest(event.type, event.payload, {
      eventId: event.eventId,
      guildId: event.guildId,
      userId: event.userId,
      occurredAt: event.occurredAt,
      sourceType: 'AZRA_SYSTEM',
    });
    if (result.status === 'processed') {
      processed += 1;
    } else if (result.status === 'skipped') {
      skipped += 1;
      skipReasons.set(result.reason, (skipReasons.get(result.reason) ?? 0) + 1);
    }
  }

  // Recalculate aggregates immediately so /profile reflects the new data.
  await runAggregationPass();

  if (processed === 0 && skipped > 0) {
    const [topReason] = [...skipReasons.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      embeds: [buildErrorEmbed(
        `No data could be generated: ${topReason}\n\nAn admin can change sharing with \`/profile-settings\`.`,
      )],
    };
  }

  const byKind = Object.entries(plan.summary.byKind)
    .map(([kind, total]) => `• ${kind}: ${total}`)
    .join('\n');
  const extras = plan.summary.extras.length ? plan.summary.extras.join(', ') : 'none';
  const skippedLine = skipped ? `\n• Skipped by the permission gate: ${skipped}` : '';

  return {
    embeds: [buildNoticeEmbed(
      `Generated ${processed} events for ${target.username ?? target.id}`,
      `• Days covered: ${days}\n${byKind}\n• Extras: ${extras}${skippedLine}\n• Aggregates recalculated — run \`/profile\` to see the result.`,
    )],
  };
}
