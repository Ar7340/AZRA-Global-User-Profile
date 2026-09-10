import { EmbedBuilder } from 'discord.js';
import {
  LEVEL_EMOJI,
  COVERAGE_EMOJI,
  badgeEmoji,
  achievementEmoji,
  eventEmoji,
  moderationEmoji,
  verificationEmoji,
  miniBar,
} from './emojiRegistry.js';

const LEVEL_COLORS = {
  NEW: 0x5865f2,
  ESTABLISHED: 0x57f287,
  TRUSTED: 0xfee75c,
  EXEMPLARY: 0xf1c40f,
  FLAGGED: 0xed4245,
};

function truncate(value, max = 1024) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const fmtDate = (iso) => (iso ?? '—').slice(0, 10);

/** Global profile summary → full-data Discord embed.
 *  `imageUrl` inlines the card INSIDE the embed (below the title). Omit it and attach the PNG via the response `files` array to place the card at the TOP (Discord renders standalone attachments above the embed). */
export function buildProfileEmbed(summary, { scope = 'PUBLIC', avatarUrl = null, imageUrl = null } = {}) {
  const rep = summary.reputation ?? {};
  const embed = new EmbedBuilder()
    .setColor(LEVEL_COLORS[rep.level] ?? LEVEL_COLORS.NEW)
    .setTitle(`${summary.user.globalName ?? summary.user.username ?? summary.user.userId} — Global Profile`)
    .setFooter({ text: `AZRA Global Profile · viewer scope: ${scope}` })
    .setTimestamp(new Date(summary.generatedAt));

  if (imageUrl) embed.setImage(imageUrl);
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  // ── 🛰️ Identity ────────────────────────────────────────────────────────
  const identityLines = [
    `👤 Username: \`${summary.user.username ?? '—'}\``,
    `🆔 User ID: \`${summary.user.userId}\``,
    `🤖 Bot: ${summary.user.isBot ? 'yes' : 'no'}`,
    `📅 Account created: ${fmtDate(summary.user.accountCreatedAt)}`,
    `🕒 First seen: ${fmtDate(summary.user.firstSeenAt)} · Last seen: ${fmtDate(summary.user.lastSeenAt)}`,
    `🗂️ Profile created: ${fmtDate(summary.user.profileCreatedAt)} · Updated: ${fmtDate(summary.user.profileUpdatedAt)}`,
  ];
  embed.addFields({ name: '🛰️ Identity', value: truncate(identityLines.join('\n')) });

  // ── 🌐 Data coverage ────────────────────────────────────────────────────
  const cov = summary.coverage ?? {};
  embed.addFields({
    name: `${COVERAGE_EMOJI[cov.completeness] ?? '🌐'} Data coverage`,
    value: truncate(`${cov.note ?? ''}\n▸ ${cov.serversContributing} of ${cov.participatingCommunities} contributing communities`),
  });

  // ── 📊 Activity ────────────────────────────────────────────────────────
  if (summary.activity?.hasData) {
    const a = summary.activity;
    const totals = a.totals;
    const bar = a.recentDays?.length
      ? miniBar(a.recentDays.map((d) => d.messagesSeen + d.reactionsAdded + d.voiceMinutes + d.commandsUsed))
      : '';
    const activityLines = [
      `💬 ${a.lines.messages}`,
      `👍 ${a.lines.reactions}`,
      `🎙️ ${a.lines.voiceMinutes}`,
      `⌨️ ${a.lines.commands}`,
      `🗓️ Active days: **${totals.activeDays}** · 🌐 Communities: **${a.contributingGuilds}**`,
      `🕒 First active: ${fmtDate(a.firstActiveAt)} · Last active: ${fmtDate(a.lastActiveAt)}`,
      bar ? `▸ Last ${a.recentDays.length} days:\n\`${bar}\`` : '',
    ].filter(Boolean);
    embed.addFields({ name: '📊 Activity', value: truncate(activityLines.join('\n')) });
  } else if (summary.activity) {
    embed.addFields({ name: '📊 Activity', value: truncate(summary.activity.note) });
  }

  if (summary.verification) {
    const v = summary.verification;
    embed.addFields({
      name: `${verificationEmoji(v.status)} Verification`,
      value: truncate([
        `Status: **${v.status}**`,
        `Level: ${v.highestLevel ?? '—'}`,
        `Guilds: ${v.confirmingGuilds}`,
        `Last verified: ${fmtDate(v.lastVerifiedAt)}`,
      ].join('\n')),
    });
  }

  // ── 🏅 Badges ──────────────────────────────────────────────────────────
  const badges = summary.badges ?? { count: 0, items: [] };
  embed.addFields({
    name: `🏅 Badges (${badges.count})`,
    value: truncate(badges.items.length
      ? badges.items.map((b) => `${badgeEmoji(b.key)} \`${b.key}\` — ${fmtDate(b.awardedAt)}`).join('\n')
      : 'None recorded yet.'),
  });

  // ── 🏆 Achievements ────────────────────────────────────────────────────
  const achievements = summary.achievements ?? { count: 0, items: [] };
  embed.addFields({
    name: `🏆 Achievements (${achievements.count})`,
    value: truncate(achievements.items.length
      ? achievements.items.map((a) => `${achievementEmoji(a.key)} \`${a.key}\` · tier ${a.tier} — ${fmtDate(a.achievedAt)}`).join('\n')
      : 'None unlocked yet.'),
  });

  // ── ⭐ Reputation ──────────────────────────────────────────────────────
  const repLine = scope === 'PUBLIC'
    ? `${LEVEL_EMOJI[rep.level] ?? ''} ${rep.level ?? 'NEW'}`
    : `${LEVEL_EMOJI[rep.level] ?? ''} ${rep.level ?? 'NEW'} (score ${rep.score ?? '—'})`;
  embed.addFields({
    name: '⭐ Reputation',
    value: truncate([
      repLine,
      rep.positiveSignals != null ? `👍 Positive signals: ${rep.positiveSignals} · 👎 Negative: ${rep.negativeSignals}` : '',
    ].filter(Boolean).join('\n')),
  });

  // ── 🚨 Moderation (moderator view) ─────────────────────────────────────
  if (scope !== 'PUBLIC' && summary.moderation) {
    const m = summary.moderation;
    const recent = (m.recent ?? []).slice(0, 5)
      .map((r) => `${moderationEmoji(r.actionType)} ${r.actionType} — ${r.guildId} — ${fmtDate(r.issuedAt)}`)
      .join('\n');
    embed.addFields({
      name: '🚨 Moderation (moderator view)',
      value: truncate([
        `⚠️ ${m.lines.warns}`,
        `⏳ ${m.lines.timeouts}`,
        `👢 ${m.lines.kicks}`,
        `🔨 ${m.lines.bans}`,
        recent ? `\n_Recent:_\n${recent}` : '',
      ].filter(Boolean).join('\n')),
    });
  }

  // ── ⛔ Restrictions (moderator view) ───────────────────────────────────
  if (scope !== 'PUBLIC' && summary.restrictions?.length) {
    embed.addFields({
      name: `⛔ Active global restrictions (${summary.restrictions.length})`,
      value: truncate(summary.restrictions.map((r) => [
        `${moderationEmoji(r.type)} \`${r.type}\``,
        r.reason ? `ₒ ${r.reason}` : '',
        `ₒ ${r.startsAt ? `Starts ${fmtDate(r.startsAt)}` : ''}${r.expiresAt ? ` · Expires ${fmtDate(r.expiresAt)}` : ''}`,
      ].filter(Boolean).join('\n')).join('\n\n')),
    });
  }

  // ── 📜 Timeline ────────────────────────────────────────────────────────
  if (summary.timeline.length) {
    embed.addFields({
      name: '📜 Recent history',
      value: truncate(summary.timeline.slice(0, 8).map((t) => {
        const emoji = t.eventType ? eventEmoji(t.eventType) : '📌';
        const guild = t.guildId ? ` (${t.guildId})` : '';
        return `${emoji} ${t.occurredAt.slice(0, 10)}${guild} — ${t.summary}`;
      }).join('\n')),
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
