/**
 * Base class for all AZRA errors. Carries a stable machine-readable `code`
 * plus optional structured `details` so callers (and the Discord layer) can
 * react programmatically instead of parsing messages.
 */
export class AzraError extends Error {
  static code = 'AZRA_ERROR';

  constructor(message, { code, details, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code ?? new.target.code;
    if (details !== undefined) this.details = details;
  }
}

/** Input failed schema/shape validation. */
export class ValidationError extends AzraError {
  static code = 'VALIDATION_ERROR';
}

/** The caller is not permitted to perform this action or read this data. */
export class PermissionDeniedError extends AzraError {
  static code = 'PERMISSION_DENIED';
}

/** Requested entity does not exist. */
export class NotFoundError extends AzraError {
  static code = 'NOT_FOUND';
}

/** Entity already exists / conflicting write. */
export class ConflictError extends AzraError {
  static code = 'CONFLICT';
}

/** Storage layer failure (driver, persistence, transaction). */
export class StorageError extends AzraError {
  static code = 'STORAGE_ERROR';
}

/** Configured storage driver is not available. */
export class UnsupportedDriverError extends AzraError {
  static code = 'UNSUPPORTED_DRIVER';
}
