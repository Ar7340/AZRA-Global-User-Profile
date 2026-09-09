/**
 * AZRA Global User Profile System — public API.
 *
 * The Discord bot layer only needs this surface:
 *   - initStore / closeStore           storage lifecycle
 *   - ingestEvent                      the single event ingestion entry point
 *   - getGlobalProfileSummary          global profile with coverage metadata
 *   - getGuildProfileSummary           guild-scoped profile
 *   - startAggregationWorker           background aggregation
 *   - models                           direct repository access when needed
 */
export { initStore, closeStore, getStore, withTransaction } from './db/index.js';
export { ingestEvent } from './events/processor.js';
export { getGlobalProfileSummary, getGuildProfileSummary } from './services/profileService.js';
export {
  startAggregationWorker,
  stopAggregationWorker,
  runAggregationPass,
  isWorkerRunning,
} from './services/aggregationService.js';
export {
  buildCoverage,
  getUserDataCoverage,
  coverageNote,
  humanizeMetric,
  describeMetric,
} from './services/coverage.js';
export {
  EVENT_TYPES,
  DATA_CATEGORIES,
  VISIBILITY,
  VISIBILITY_RANK,
} from './domain/catalog.js';
export * as models from './models/index.js';
export {
  AzraError,
  ValidationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  StorageError,
  UnsupportedDriverError,
} from './utils/errors.js';
export { healthCheck } from './health.js';

export const VERSION = '0.1.0';
