import { deterministicEventId } from './mappers.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';
import { validateEvent } from '../src/events/validators.js';

/**
 * Random demo-data generator. The plan builder is pure (injectable clock and
 * RNG) so it is fully unit-testable; the command ingests the plan through the
 * real pipeline with unique event ids so repeated runs ADD data.
 */
export const INTENSITY_PRESETS = {
  light: { activityEvents: 100, verification: true, badge: true, moderation: false },
  normal: { activityEvents: 250, verification: true, badge: true, moderation: true },
  heavy: { activityEvents: 500, verification: true, badge: true, moderation: true },
};

export const BADGE_POOL = [
  'BUG_HUNTER',
  'EARLY_SUPPORTER',
  'COMMUNITY_PILLAR',
  'EVENT_ORGANIZER',
  'PEACEKEEPER',
];

export const WARN_REASONS = [
  'Spamming channels',
  'Inappropriate content',
  'Excessive pinging',
  'Raid participation',
  'Harassment report',
];

// ~55% messages, ~22% reactions, ~11% voice, ~11% commands
const KIND_WEIGHTS = [
  'message', 'message', 'message', 'message', 'message',
  'reaction', 'reaction',
  'voice',
  'command',
];

const KIND_TO_TYPE = {
  message: EVENT_TYPES.ACTIVITY_MESSAGE,
  reaction: EVENT_TYPES.ACTIVITY_REACTION,
  voice: EVENT_TYPES.ACTIVITY_VOICE,
  command: EVENT_TYPES.ACTIVITY_COMMAND,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.trunc(Number(value) || min)));
}

/**
 * Builds a generation plan.
 * options: { guildId, userId, days (1-30), intensity ('light'|'normal'|'heavy'),
 *            runId (uniqueness per run), now (epoch ms, injectable), rng (seedable) }
 * Returns { events, summary: { total, byKind, extras }, runId } — every event
 * is validated before leaving the builder.
 */
export function buildGenerationPlan(options = {}) {
  const guildId = String(options.guildId);
  const userId = String(options.userId);
  const days = clamp(options.days ?? 14, 1, 30);
  const preset = INTENSITY_PRESETS[options.intensity] ?? INTENSITY_PRESETS.normal;
  const now = options.now ?? Date.now();
  const runId = String(options.runId ?? now.toString(36));
  const rng = options.rng ?? Math.random;

  const pick = (list) => list[Math.floor(rng() * list.length) % list.length];
  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const occurredAt = () => {
    const back = randInt(0, days - 1) * 86_400_000 + randInt(0, 82_800_000);
    return new Date(now - back).toISOString();
  };

  const events = [];
  const summary = { total: 0, byKind: {}, extras: [] };

  for (let i = 0; i < preset.activityEvents; i += 1) {
    const kind = pick(KIND_WEIGHTS);
    const amount = kind === 'voice' ? randInt(5, 90) : randInt(1, 4);
    events.push({
      eventId: deterministicEventId('djs', 'gen', guildId, userId, kind, runId, i),
      type: KIND_TO_TYPE[kind],
      guildId,
      userId,
      occurredAt: occurredAt(),
      payload: { amount },
    });
    summary.byKind[kind] = (summary.byKind[kind] ?? 0) + amount;
    summary.total += 1;
  }

  if (preset.verification) {
    events.push({
      eventId: deterministicEventId('djs', 'gen', guildId, userId, 'verify', runId),
      type: EVENT_TYPES.VERIFICATION_COMPLETED,
      guildId,
      userId,
      occurredAt: occurredAt(),
      payload: { method: 'MANUAL' },
    });
    summary.extras.push('verification');
    summary.total += 1;
  }

  if (preset.badge) {
    const badgeKey = pick(BADGE_POOL);
    events.push({
      eventId: deterministicEventId('djs', 'gen', guildId, userId, 'badge', runId),
      type: EVENT_TYPES.BADGE_AWARDED,
      guildId,
      userId,
      occurredAt: occurredAt(),
      payload: { badgeKey },
    });
    summary.extras.push(`badge:${badgeKey}`);
    summary.total += 1;
  }

  if (preset.moderation) {
    const reason = pick(WARN_REASONS);
    events.push({
      eventId: deterministicEventId('djs', 'gen', guildId, userId, 'warn', runId),
      type: EVENT_TYPES.MODERATION_ACTION,
      guildId,
      userId,
      occurredAt: occurredAt(),
      payload: { actionType: 'WARN', reason },
    });
    summary.extras.push('warn');
    summary.total += 1;
  }

  // Safety net: every generated event must be pipeline-valid.
  for (const event of events) validateEvent(event);

  return { events, summary, runId };
}
