import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVERAGE_EMOJI, badgeEmoji, achievementEmoji, eventEmoji,
  moderationEmoji, levelEmoji, verificationEmoji, miniBar,
} from '../bot/emojiRegistry.js';
import { buildProfileEmbed } from '../bot/embeds.js';
import { createTestStore, destroyTestStore } from './helpers.js';

const FULL_SUMMARY = {
  user: {
    userId: '200000000000000101', username: 'alice', globalName: 'Alice',
    isBot: false, accountCreatedAt: '2020-01-01T00:00:00.000Z',
    firstSeenAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-20T00:00:00.000Z',
    profileCreatedAt: '2026-08-01T00:00:00.000Z', profileUpdatedAt: '2026-08-20T00:00:00.000Z',
  },
  coverage: { completeness: 'PARTIAL', serversContributing: 1, participatingCommunities: 2, note: 'Limited data — 1 of 2 participating communities.' },
  verification: { status: 'VERIFIED', highestLevel: 'CROSS_GUILD', confirmingGuilds: 2, lastVerifiedAt: '2026-08-10T00:00:00.000Z' },
  badges: { count: 2, items: [{ key: 'BUG_HUNTER', awardedAt: '2026-08-05T00:00:00.000Z' }, { key: 'PEACEKEEPER', awardedAt: '2026-08-08T00:00:00.000Z' }] },
  achievements: { count: 1, items: [{ key: 'CONVERSATION_STARTER', tier: 2, achievedAt: '2026-08-06T00:00:00.000Z' }] },
  activity: {
    hasData: true, contributingGuilds: 1,
    totals: { messagesSeen: 120, reactionsAdded: 30, voiceMinutes: 45, commandsUsed: 12, activeDays: 14 },
    lines: {
      messages: '120 messages recorded.', reactions: '30 reactions recorded.',
      voiceMinutes: '45 voice minutes recorded.', commands: '12 command uses recorded.',
    },
    firstActiveAt: '2026-08-01T00:00:00.000Z', lastActiveAt: '2026-08-19T00:00:00.000Z',
    recentDays: [
      { date: '2026-08-19', messagesSeen: 10, reactionsAdded: 2, voiceMinutes: 0, commandsUsed: 1 },
      { date: '2026-08-18', messagesSeen: 20, reactionsAdded: 4, voiceMinutes: 5, commandsUsed: 2 },
      { date: '2026-08-17', messagesSeen: 0, reactionsAdded: 0, voiceMinutes: 0, commandsUsed: 0 },
    ],
  },
  reputation: { level: 'ESTABLISHED', score: 40, positiveSignals: 6, negativeSignals: 1 },
  moderation: {
    counts: { WARN: 2, BAN: 1 },
    lines: { warns: '2 warnings recorded.', timeouts: 'No recorded timeouts in available AZRA data.', kicks: 'No recorded kicks in available AZRA data.', bans: '1 ban recorded.' },
    recent: [{ actionType: 'WARN', guildId: '300000000000000001', issuedAt: '2026-08-09T00:00:00.000Z' }],
  },
  restrictions: [{ type: 'VERIFICATION_HOLD', reason: 'review', startsAt: '2026-08-10T00:00:00.000Z', expiresAt: null, status: 'ACTIVE' }],
  timeline: [
    { occurredAt: '2026-08-10T00:00:00.000Z', eventType: 'ACHIEVEMENT_UNLOCKED', guildId: '300000000000000001', summary: 'Unlocked achievement CONVERSATION_STARTER', visibility: 'GLOBAL' },
    { occurredAt: '2026-08-05T00:00:00.000Z', eventType: 'BADGE_AWARDED', guildId: '300000000000000001', summary: 'Earned the BUG_HUNTER badge', visibility: 'GLOBAL' },
  ],
  generatedAt: '2026-08-20T12:00:00.000Z',
};

describe('emojiRegistry', () => {
  test('maps known values and falls back on unknown without throwing', () => {
    assert.equal(badgeEmoji('BUG_HUNTER'), '🐛');
    assert.equal(badgeEmoji(''), '🏅');
    assert.equal(badgeEmoji('UNKNOWN_BADGE'), '🏅');
    assert.equal(achievementEmoji('CONVERSATION_STARTER'), '💬');
    assert.equal(achievementEmoji('UNKNOWN_ACHIEVEMENT'), '🏆');
    assert.equal(eventEmoji('ACTIVITY_MESSAGE'), '💬');
    assert.equal(eventEmoji('NOPE'), '📌');
    assert.equal(moderationEmoji('BAN'), '🔨');
    assert.equal(moderationEmoji('WHATEVER'), '🚨');
    assert.equal(levelEmoji('TRUSTED'), '🛡️');
    assert.equal(verificationEmoji('VERIFIED'), '✅');
    assert.equal(COVERAGE_EMOJI.PARTIAL, '⚠️');
  });

  test('miniBar renders fixed-width rows', () => {
    assert.equal(miniBar([0, 0]), '▯▯▯▯▯▯▯ ▯▯▯▯▯▯▯');
    assert.equal(miniBar([5]), '▮▮▮▮▮▮▮');
    const row = miniBar([2, 5, 0, 8, 3]);
    const parts = row.split(' ');
    assert.equal(parts.length, 5);
    for (const part of parts) assert.equal(part.length, 7);
  });
});

describe('buildProfileEmbed', () => {
  test('moderator scope includes every data section', () => {
    const embed = buildProfileEmbed(FULL_SUMMARY, { scope: 'MODERATOR', imageUrl: 'attachment://azra-profile.png' });
    const json = embed.toJSON();
    const fields = json.fields.map((f) => f.name);
    for (const expected of [
      '🛰️ Identity',
      '⚠️ Data coverage',
      '📊 Activity',
      '✅ Verification',
      '🏅 Badges (2)',
      '🏆 Achievements (1)',
      '⭐ Reputation',
      '🚨 Moderation (moderator view)',
      '⛔ Active global restrictions (1)',
      '📜 Recent history',
    ]) {
      assert.ok(fields.includes(expected), `missing field: ${expected}`);
    }
    const image = json.image?.url ?? json.image ?? '';
    assert.ok(String(image).includes('attachment://azra-profile.png'), 'image attachment url present');
  });

  test('PUBLIC scope hides moderation and restrictions', () => {
    const embed = buildProfileEmbed(FULL_SUMMARY, { scope: 'PUBLIC' });
    const names = embed.toJSON().fields.map((f) => f.name);
    assert.ok(!names.some((n) => n.includes('Moderation')), `moderation hidden from PUBLIC (got ${names.filter((n) => n.includes('Moderation'))})`);
    assert.ok(!names.some((n) => n.includes('restrictions')), `restrictions hidden from PUBLIC (got ${names.filter((n) => n.includes('restriction'))})`);
    assert.ok(names.includes('⭐ Reputation'));
  });

  test('never-fake-zero language appears in the embed', () => {
    const embed = buildProfileEmbed(FULL_SUMMARY, { scope: 'MODERATOR' });
    const value = embed.toJSON().fields.map((f) => f.value).join('\n');
    assert.match(value, /No recorded timeouts in available AZRA data\./);
    assert.match(value, /1 ban recorded\./);
  });
});

describe('profile card image generation', () => {
  beforeEach(async () => {
    await createTestStore('card-test');
  });

  afterEach(async () => {
    await destroyTestStore();
  });

  test('renderProfileCard produces a valid PNG buffer in all cases', async () => {
    const { renderProfileCard, createAvatarPlaceholder } = await import('../bot/profileImage.js');
    const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('ascii');

    // Full summary with placeholder avatar.
    const full = await renderProfileCard({ summary: FULL_SUMMARY });
    assert.ok(full && full.length > 100, 'full card rendered');
    assert.equal(Buffer.from(full.slice(0, 4)).toString('ascii'), PNG_HEAD, 'PNG magic bytes');

    // Featureless summary must not throw.
    const bare = await renderProfileCard({
      summary: {
        user: { userId: '200000000000000999', username: 'nobody', displayName: 'N' },
        coverage: { completeness: 'NONE', serversContributing: 0, participatingCommunities: 2, note: 'No AZRA data yet.' },
        reputation: { level: 'NEW' },
        badges: { count: 0, items: [] },
        achievements: { count: 0, items: [] },
        activity: { hasData: false, note: 'No data.' },
        generatedAt: new Date().toISOString(),
      },
    });
    assert.ok(bare && bare.length > 100, 'bare card rendered');

    // With a literal avatar buffer.
    const placeholder = await createAvatarPlaceholder('200000000000000101', 'Alice');
    assert.ok(placeholder && placeholder.length > 100, 'placeholder avatar is a PNG');
    const withAvatar = await renderProfileCard({ summary: FULL_SUMMARY, avatarBuffer: placeholder });
    assert.ok(withAvatar && withAvatar.length > 100, 'card with avatar rendered');
  });
});