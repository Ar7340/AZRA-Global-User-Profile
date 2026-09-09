import * as guilds from '../models/guilds.model.js';
import * as guildActivity from '../models/guildActivity.model.js';

export const COMPLETENESS = {
  NO_COMMUNITIES: 'NO_COMMUNITIES',
  NONE: 'NONE',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
};

/**
 * Builds the data-coverage record attached to every global summary.
 *
 * THE DATA RULE: incomplete data is never presented as a zero. Coverage tells
 * the presentation layer how much of the participating network actually
 * contributed the data being shown, so zeros can be phrased honestly
 * ("No recorded bans in available AZRA data.") instead of asserted.
 */
export function buildCoverage({ participating, contributing }) {
  const participatingCommunities = Math.max(0, Math.trunc(Number(participating) || 0));
  const serversContributing = Math.max(0, Math.trunc(Number(contributing) || 0));
  let completeness;
  if (participatingCommunities === 0) completeness = COMPLETENESS.NO_COMMUNITIES;
  else if (serversContributing === 0) completeness = COMPLETENESS.NONE;
  else if (serversContributing < participatingCommunities) completeness = COMPLETENESS.PARTIAL;
  else completeness = COMPLETENESS.FULL;
  return { participatingCommunities, serversContributing, completeness };
}

export async function getUserDataCoverage(userId) {
  const stats = await guilds.getParticipationStats();
  const contributing = await guildActivity.countDistinctActiveGuilds(userId);
  return buildCoverage({ participating: stats.participating, contributing });
}

export function coverageNote(coverage) {
  switch (coverage?.completeness) {
    case COMPLETENESS.NO_COMMUNITIES:
      return 'No participating communities yet — AZRA is not collecting data.';
    case COMPLETENESS.NONE:
      return `No AZRA data yet — ${coverage.participatingCommunities} participating communities available.`;
    case COMPLETENESS.PARTIAL:
      return `Limited data — ${coverage.serversContributing} of ${coverage.participatingCommunities} participating communities.`;
    case COMPLETENESS.FULL:
      return `Complete coverage — ${coverage.participatingCommunities} participating communities.`;
    default:
      return '';
  }
}

/** Human sentence for a metric count. null = unknown (never "0" as fact). */
export function humanizeMetric({ label, plural, count }) {
  const pluralLabel = plural ?? `${label}s`;
  if (count == null) return `Unknown — not enough AZRA data for ${pluralLabel}.`;
  if (count === 0) return `No recorded ${pluralLabel} in available AZRA data.`;
  return `${count} ${label}${count === 1 ? '' : 's'} recorded.`;
}

/** humanizeMetric + the limited-data qualifier when coverage is partial. */
export function describeMetric({ label, plural, count, coverage }) {
  const base = humanizeMetric({ label, plural, count });
  if (count != null && count > 0 && coverage?.completeness === COMPLETENESS.PARTIAL) {
    return `${base} Limited data — ${coverage.serversContributing} of ${coverage.participatingCommunities} participating communities.`;
  }
  return base;
}
