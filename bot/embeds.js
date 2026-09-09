import { EmbedBuilder } from 'discord.js';

const LEVEL_COLORS = {
  NEW: 0x5865f2,
  ESTABLISHED: 0x57f287,
  TRUSTED: 0xfee75c,
  EXEMPLARY: 0xf1c40f,
  FLAGGED: 0xed4245,
};

const COVERAGE_EMOJI = {
  FULL: '✅',
  PARTIAL: '⚠️',
  NONE: '🚫',
  NO_COMMUNITIES: '🌐',
};

function truncate(value, max = 1024) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Global profile summary → Discord embed. Shows only what the service
 *  already filtered for the caller's viewer scope. */
export function buildProfileEmbed(summary, { scope = 'PUBLIC', avatarUrl = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(LEVEL_COLORS[summary.reputation?.level] ?? LEVEL_COLORS.NEW)
    .setTitle(`${summary.user.username ?? summary.user.userId} — Global Profile`)
    .setFooter({ text: `AZRA Global Profile · viewer scope: ${scope}` })
    .setTimestamp(new Date(summary.generatedAt));

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  if (summary.user.globalName) embed.setAuthor({ name: summary.user.globalName });

  embed.addFields({
    name: `${COVERAGE_EMOJI[summary.coverage.completeness] ?? 'ℹ️'} Data coverage`,
    value: truncate(summary.coverage.note),
  });

  if (summary.activity?.hasData) {
    embed.addFields({
      name: 'Activity',
      value: truncate([
        `• ${summary.activity.lines.messages}`,
        `• ${summary.activity.lines.reactions}`,
        `• ${summary.activity.lines.voiceMinutes}`,
        `• Contributing communities: ${summary.activity.contributingGuilds}`,
        `• Active days: ${summary.activity.totals.activeDays}`,
      ].join('\n')),
    });
  } else if (summary.activity) {
    embed.addFields({ name: 'Activity', value: truncate(summary.activity.note) });
  }

  if (summary.verification) {
    embed.addFields({
      name: 'Verification',
      value: `${summary.verification.status} · ${summary.verification.highestLevel} · ${summary.verification.confirmingGuilds} communities`,
    });
  }

  embed.addFields({
    name: 'Reputation',
    value: scope === 'PUBLIC'
      ? summary.reputation.level
      : `${summary.reputation.level} (score ${summary.reputation.score ?? '—'})`,
  });

  embed.addFields({
    name: `Badges (${summary.badges.count})`,
    value: truncate(summary.badges.items.length
      ? summary.badges.items.map((b) => `\`${b.key}\``).join(' ')
      : 'None recorded'),
  });

  if (summary.moderation) {
    embed.addFields({
      name: 'Moderation (moderator view)',
      value: truncate([
        `• ${summary.moderation.lines.bans}`,
        `• ${summary.moderation.lines.kicks}`,
        `• ${summary.moderation.lines.timeouts}`,
        `• ${summary.moderation.lines.warns}`,
      ].join('\n')),
    });
  }

  if (summary.restrictions?.length) {
    embed.addFields({
      name: 'Active global restrictions',
      value: truncate(summary.restrictions.map((r) => `• ${r.type}${r.expiresAt ? ` (until ${r.expiresAt.slice(0, 10)})` : ''}`).join('\n')),
    });
  }

  if (summary.timeline.length) {
    embed.addFields({
      name: 'Recent history',
      value: truncate(summary.timeline.slice(0, 5).map((t) => `• ${t.occurredAt.slice(0, 10)} — ${t.summary}`).join('\n')),
    });
  }

  return embed;
}

export function buildNoticeEmbed(title, description, { color = 0x57f287 } = {}) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(truncate(description));
}

export function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Something went wrong')
    .setDescription(truncate(message));
}
